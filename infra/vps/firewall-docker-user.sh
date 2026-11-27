#!/usr/bin/env bash
# MSF-648 · Firewall del VPS: desde Internet solo entran 22 (los puertos que realmente escucha sshd), 80 y 443; el resto (Postgres 7634-7636, Studio,
# Kong, Inbucket, Dokploy, Kestra, Superset, Nango...) solo por loopback, por Tailscale o desde los contenedores de los servicios del propio host.
#
# Tres capas, porque `ufw` no filtra los puertos que publica Docker:
#   1. ufw (cadena INPUT, tráfico del host): default deny incoming; permite los puertos públicos, la interfaz de Tailscale y, EXPLÍCITAMENTE, a las
#      subredes de los SERVICIOS de Docker (Kestra, Superset...) hacia lo que usan por host.docker.internal (Postgres, Storage, SMTP...).
#      Las redes de los JOBS de CI (código de PRs) se EXCLUYEN: `deny in on <puente de jobs>` va PRIMERO (ufw insert) y se filtra por la INTERFAZ de entrada,
#      no solo por IP (un job es root-equivalente en su red y puede falsificar el origen): ningún job alcanza los puertos del host (revisión C+S del #1238).
#      Solo la red de jobs de DEPLOY recibe los puertos que migra/usa (--puertos-db-deploy, --puertos-host-deploy). El orden de las reglas importa y se
#      arma con `ufw prepend` en orden inverso (con ufw sin reglas `ufw insert N` NO sirve: verificado con ufw real) y se VERIFICA al terminar
#      (`ufw status numbered`: ningún allow de deploy puede quedar debajo de un deny de su misma red; si no, se revierte).
#   2. DOCKER-USER (puertos publicados por Docker y tráfico reenviado, tras el DNAT): por el puerto ORIGINAL (`conntrack --ctorigdstport`) y por CADA
#      interfaz externa. De las redes de jobs se descarta todo origen que no sea su subred (anti-falsificación, `-i <puente> ! -s <subred>`) y se les
#      DENIEGA salir hacia tailscale0, 100.64.0.0/10 (la tailnet), 169.254.0.0/16 (metadatos), 10/8, 172.16/12, 192.168/16, 192.0.0.0/24, 198.18.0.0/15 y
#      224.0.0.0/4: solo Internet. La red de DEPLOY tiene excepciones puntuales: los puertos de base de datos que Docker publica (FORWARD tras el DNAT, por
#      `--ctorigdst <ip-db>` + `--ctorigdstport`, SOLO hacia esa IP: --ip-db-deploy es obligatorio) y los destinos `ip:puerto` de la tailnet que se indiquen. La cadena se reemplaza de forma ATÓMICA con
#      `iptables-restore --noflush` (nunca queda vacía ni a medias).
#   3. IPv6: el filtrado v6 de los puertos que publica docker-proxy depende de ufw (IPV6=yes en /etc/default/ufw, que el script EXIGE); DOCKER-USER se
#      replica con ip6tables si existe (sin las reglas de jobs, que son IPv4: la red de jobs no tiene IPv6).
#
# SOLO IMPRIME por defecto (no toca nada). Con --aplicar:
#   1. detecta los puertos de sshd (`sshd -T` Y lo que de verdad escucha, `ss -ltnp`: con ssh.socket en Ubuntu 24.04 pueden diferir) y ABORTA si alguno
#      no está en --puertos-publicos (te quedarías sin SSH);
#   2. guarda iptables e ip6tables (tabla filter), /etc/ufw y el estado de ufw;
#   3. aplica las reglas; 4. corre los --chequeo (con tope CHEQUEO_TIMEOUT, 20 s); si uno falla revierte AL INSTANTE y cancela el temporizador;
#   5. arma un rollback automático DESACOPLADO de la sesión (setsid + nohup): si en --rollback-segundos no existe el archivo de confirmación, restaura
#      DOCKER-USER (v4 y v6), /etc/ufw y el estado de ufw. Desde OTRA sesión SSH comprobá que entrás y confirmá con:
#        touch /run/firewall-docker-user.confirmado
# Lo que el rollback NO restaura: reglas de FORWARD/nat de contenedores creados durante la ventana (Docker las recrea al reiniciar el contenedor).
#
# ADVERTENCIAS DE USO:
#   - `--chequeo` se ejecuta con `bash -c` como root: es un `eval` escrito por el OPERADOR. Nunca le pases datos de terceros; ningún workflow ni script
#     del repo lo usa.
#   - `--puertos-host-deploy` abre el puerto en TODAS las IPs locales del host (la regla de ufw no acota el destino): solo para puertos que querés ofrecer así.
#   - Un job NO alcanza servicios del propio VPS por su IP pública ni por su dominio (el paquete llega al host por INPUT y se descarta): lo que necesite
#     del host tiene que declararse (--puertos-db-deploy, --puertos-host-deploy). El destino SSH del deploy: propio host -> --puertos-host-deploy 22;
#     nodo de Tailscale -> --destinos-tailnet-deploy <ip>:22; otra máquina con IP pública no necesita regla.
#   - Al cambiar --subredes-docker o --subred-jobs-*, el script NO retira reglas `ufw allow/deny` viejas: revisá `ufw status numbered` y borralas a mano.
#   - La interfaz externa se autodetecta con la ruta por defecto IPv4 e IPv6; con varias salidas pasalas con --interfaz-externa eth0,eth1.
# Persistencia tras un reinicio: docs/endurecimiento-infra.md, «Firewall del VPS».
#
# Uso: infra/vps/firewall-docker-user.sh [--aplicar] [--interfaz-externa eth0[,eth1]] [--interfaz-tailscale tailscale0]
#          [--puertos-publicos 22,80,443] [--subredes-docker 172.16.0.0/12]
#          [--puertos-host-desde-docker 7634,7635,7636,9300,9301,9302,587,25,8098]
#          [--subred-jobs-pr 172.29.250.0/24] [--subred-jobs-deploy 172.29.251.0/24] [--bridge-jobs-pr br-jobs-pr] [--bridge-jobs-deploy br-jobs-deploy]
#          --ip-db-deploy <ip-del-postgres-publicado> [--puertos-db-deploy 7635,7636] [--puertos-host-deploy 22] [--destinos-tailnet-deploy 100.64.0.10:5432[,ip:puerto...]]
#          [--chequeo '<comando>']... [--rollback-segundos 120] [--sin-rollback]
# --sin-rollback (solo con --aplicar) es para la unidad systemd que reaplica las reglas al arrancar: sin rollback ni confirmación.
# Variables de prueba: IPTABLES, IP6TABLES, IPTABLES_SAVE, IP6TABLES_SAVE, IPTABLES_RESTORE, IP6TABLES_RESTORE, UFW, SSHD, SS, UFW_DIR, UFW_DEFAULT,
# ARCHIVO_CONFIRMACION, DIR_RESPALDO, CHEQUEO_TIMEOUT.
set -euo pipefail

IPTABLES="${IPTABLES:-iptables}"
IP6TABLES="${IP6TABLES:-ip6tables}"
IPTABLES_SAVE="${IPTABLES_SAVE:-iptables-save}"
IP6TABLES_SAVE="${IP6TABLES_SAVE:-ip6tables-save}"
IPTABLES_RESTORE="${IPTABLES_RESTORE:-iptables-restore}"
IP6TABLES_RESTORE="${IP6TABLES_RESTORE:-ip6tables-restore}"
UFW="${UFW:-ufw}"
SSHD="${SSHD:-sshd}"
SS="${SS:-ss}"
UFW_DIR="${UFW_DIR:-/etc/ufw}"
UFW_DEFAULT="${UFW_DEFAULT:-/etc/default/ufw}"
ARCHIVO_CONFIRMACION="${ARCHIVO_CONFIRMACION:-/run/firewall-docker-user.confirmado}"
DIR_RESPALDO="${DIR_RESPALDO:-/root/respaldo-firewall}"
CHEQUEO_TIMEOUT="${CHEQUEO_TIMEOUT:-20}"

aplicar=0
externas=""
tailscale="tailscale0"
publicos="22,80,443"
subredes_docker="172.16.0.0/12"
puertos_docker="7634,7635,7636,9300,9301,9302,587,25,8098"
subred_jobs_pr="172.29.250.0/24"
subred_jobs_deploy="172.29.251.0/24"
bridge_jobs_pr="br-jobs-pr"
bridge_jobs_deploy="br-jobs-deploy"
ip_db_deploy=""
puertos_db_deploy="7635,7636"
puertos_host_deploy=""
destinos_tailnet_deploy=""
rollback=120
sin_rollback=0
chequeos=()

while [ $# -gt 0 ]; do
  case "$1" in
    --aplicar) aplicar=1; shift ;;
    --interfaz-externa) externas="${2:-}"; shift 2 ;;
    --interfaz-tailscale) tailscale="${2:-}"; shift 2 ;;
    --puertos-publicos) publicos="${2:-}"; shift 2 ;;
    --subredes-docker) subredes_docker="${2:-}"; shift 2 ;;
    --puertos-host-desde-docker) puertos_docker="${2:-}"; shift 2 ;;
    --subred-jobs-pr) subred_jobs_pr="${2:-}"; shift 2 ;;
    --subred-jobs-deploy) subred_jobs_deploy="${2:-}"; shift 2 ;;
    --bridge-jobs-pr) bridge_jobs_pr="${2:-}"; shift 2 ;;
    --bridge-jobs-deploy) bridge_jobs_deploy="${2:-}"; shift 2 ;;
    --ip-db-deploy) ip_db_deploy="${2:-}"; shift 2 ;;
    --puertos-db-deploy) puertos_db_deploy="${2:-}"; shift 2 ;;
    --puertos-host-deploy) puertos_host_deploy="${2:-}"; shift 2 ;;
    --destinos-tailnet-deploy) destinos_tailnet_deploy="${2:-}"; shift 2 ;;
    --chequeo) chequeos+=("${2:-}"); shift 2 ;;
    --rollback-segundos) rollback="${2:-}"; shift 2 ;;
    --sin-rollback) sin_rollback=1; shift ;;
    -h|--help) sed -n '2,64p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

error() { echo "Error: $*" >&2; exit 2; }

# Validación estricta: estos valores terminan en comandos de firewall. Un nombre que empiece con `-` se tomaría por una opción.
lista_de_puertos() { case "$1" in ''|*[!0-9,]*|,*|*,|*,,*) return 1 ;; esac; }
lista_de_puertos "$publicos" || error "--puertos-publicos debe ser una lista de números separada por comas"
lista_de_puertos "$puertos_docker" || error "--puertos-host-desde-docker debe ser una lista de números separada por comas"
lista_de_puertos "$puertos_db_deploy" || error "--puertos-db-deploy debe ser una lista de números separada por comas"
case "$rollback" in ''|*[!0-9]*) error "--rollback-segundos debe ser un número" ;; esac
[ "$rollback" -ge 30 ] && [ "$rollback" -le 3600 ] || error "--rollback-segundos entre 30 y 3600"
case "$CHEQUEO_TIMEOUT" in ''|*[!0-9]*) error "CHEQUEO_TIMEOUT debe ser un número de segundos" ;; esac
nombre_valido() { case "$1" in ''|-*|*[!A-Za-z0-9._-]*) return 1 ;; esac; }
nombre_valido "$tailscale" || error "nombre de interfaz de Tailscale inválido"
IFS=',' read -r -a lista_publicos <<< "$publicos"
IFS=',' read -r -a lista_docker <<< "$puertos_docker"
IFS=',' read -r -a lista_db_deploy <<< "$puertos_db_deploy"
lista_host_deploy=()
if [ -n "$puertos_host_deploy" ]; then
  lista_de_puertos "$puertos_host_deploy" || error "--puertos-host-deploy debe ser una lista de números separada por comas"
  IFS=',' read -r -a lista_host_deploy <<< "$puertos_host_deploy"
fi
for p in "${lista_publicos[@]}" "${lista_docker[@]}" "${lista_db_deploy[@]}" "${lista_host_deploy[@]}"; do
  [ "$p" -ge 1 ] && [ "$p" -le 65535 ] || error "puerto fuera de rango: $p"
done
subred_valida() { case "$1" in ''|*[!0-9./]*|/*|*/|*//*) return 1 ;; esac; case "$1" in */*) ;; *) return 1 ;; esac; }
IFS=',' read -r -a lista_subredes <<< "$subredes_docker"
for s in "${lista_subredes[@]}"; do subred_valida "$s" || error "--subredes-docker: subred inválida"; done
subred_valida "$subred_jobs_pr" || error "--subred-jobs-pr: subred inválida"
subred_valida "$subred_jobs_deploy" || error "--subred-jobs-deploy: subred inválida"
[ "$subred_jobs_pr" != "$subred_jobs_deploy" ] || error "las redes de jobs de PR y de deploy tienen que ser distintas"
# El nombre del puente (com.docker.network.bridge.name) lo fija el supervisor al crear la red; Linux limita los nombres de interfaz a 15 caracteres.
puente_valido() { nombre_valido "$1" && [ "${#1}" -le 15 ]; }
puente_valido "$bridge_jobs_pr" || error "--bridge-jobs-pr: nombre de interfaz inválido (hasta 15 caracteres)"
puente_valido "$bridge_jobs_deploy" || error "--bridge-jobs-deploy: nombre de interfaz inválido (hasta 15 caracteres)"
[ "$bridge_jobs_pr" != "$bridge_jobs_deploy" ] || error "los puentes de jobs de PR y de deploy tienen que ser distintos"
# La IP del Postgres publicado: OBLIGATORIA. Sin ella la excepción de base de datos valdría para CUALQUIER destino con ese puerto (otro nodo de la tailnet o de la red
# privada). Una sola IPv4 de unicast: sin rangos (/), sin 0.0.0.0, sin loopback ni multicast/reservadas.
ip_valida() {
  local ip="$1" o
  [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  for o in "${BASH_REMATCH[@]:1}"; do [ "$((10#$o))" -le 255 ] || return 1; done
  [ "$((10#${BASH_REMATCH[1]}))" -ne 0 ] && [ "$((10#${BASH_REMATCH[1]}))" -ne 127 ] && [ "$((10#${BASH_REMATCH[1]}))" -lt 224 ]
}
[ -n "$ip_db_deploy" ] || error "falta --ip-db-deploy <ip>: la IP del Postgres publicado (sin ella la excepción de base valdría para cualquier destino)"
ip_valida "$ip_db_deploy" || error "--ip-db-deploy debe ser UNA IPv4 de unicast (sin rangos, sin 0.0.0.0, sin loopback ni multicast)"
lista_destinos=()
if [ -n "$destinos_tailnet_deploy" ]; then
  IFS=',' read -r -a lista_destinos <<< "$destinos_tailnet_deploy"
  for d in "${lista_destinos[@]}"; do
    case "$d" in *:*:*|:*|*:) error "--destinos-tailnet-deploy: usá ip:puerto" ;; esac
    case "${d%%:*}" in ''|*[!0-9.]*) error "--destinos-tailnet-deploy: IPv4 inválida" ;; esac
    case "${d#*:}" in ''|*[!0-9]*) error "--destinos-tailnet-deploy: cada destino lleva puerto (ip:puerto): se acota POR PUERTO" ;; esac
    [ "${d#*:}" -ge 1 ] && [ "${d#*:}" -le 65535 ] || error "--destinos-tailnet-deploy: puerto fuera de rango"
  done
fi

# Interfaces externas: las de las rutas por defecto (IPv4 e IPv6) salvo que se indiquen; admite una lista (VLAN, bond, segunda NIC).
if [ -z "$externas" ]; then
  externas="$({ ip -o route show default 2>/dev/null; ip -o -6 route show default 2>/dev/null; } | sed -n 's/.* dev \([^ ]*\).*/\1/p' | sort -u | paste -sd, - || true)"
fi
[ -n "$externas" ] || error "no pude detectar la interfaz externa: indicala con --interfaz-externa"
IFS=',' read -r -a lista_externas <<< "$externas"
for i in "${lista_externas[@]}"; do nombre_valido "$i" || error "nombre de interfaz externa inválido"; done

# SSH: TODOS los puertos donde sshd escucha tienen que estar permitidos, o `ufw enable` te deja afuera. Con ssh.socket (Ubuntu 24.04) el puerto
# efectivo es el del socket y `sshd -T` (que lee sshd_config) puede diferir: se cruzan `sshd -T` y los sockets en escucha de procesos sshd (`ss -ltnp`).
puertos_sshd_config="$("$SSHD" -T 2>/dev/null | awk '/^port /{print $2}' || true)"
puertos_sshd_escucha="$("$SS" -Hltnp 2>/dev/null | awk '/sshd/{n=split($4,a,":"); print a[n]}' || true)"
puertos_sshd="$(printf '%s\n%s\n' "$puertos_sshd_config" "$puertos_sshd_escucha" | grep -E '^[0-9]+$' | sort -un | tr '\n' ' ' || true)"
if [ -z "${puertos_sshd// /}" ]; then
  echo "AVISO: no pude leer los puertos de sshd (\`sshd -T\` y \`ss -ltnp\` necesitan root): comprobá a mano que --puertos-publicos los incluya." >&2
else
  for p in $puertos_sshd; do
    case ",$publicos," in *",$p,"*) ;; *) error "sshd escucha o está configurado en el puerto $p y no está en --puertos-publicos ($publicos): te quedarías sin SSH" ;; esac
  done
fi

# IPv6: sin IPV6=yes ufw no filtra v6 y docker-proxy escucha en [::].
if [ -r "$UFW_DEFAULT" ] && ! grep -Eq '^IPV6=yes' "$UFW_DEFAULT"; then
  error "ufw no filtra IPv6 (falta IPV6=yes en $UFW_DEFAULT): activalo antes (los puertos que publica Docker también escuchan en [::])"
fi

# Contenido ATÓMICO de DOCKER-USER (iptables-restore --noflush: se aplica todo en el COMMIT; la cadena nunca queda vacía). Argumento: 4 o 6.
reglas_docker_user() {
  local familia="$1"
  echo "*filter"
  echo ":DOCKER-USER - [0:0]"
  echo "-F DOCKER-USER"
  echo "-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"
  if [ "$familia" = 6 ]; then
    # Las redes de jobs no tienen IPv6: nada que venga de esos puentes sale por v6.
    echo "-A DOCKER-USER -i $bridge_jobs_pr -j DROP"
    echo "-A DOCKER-USER -i $bridge_jobs_deploy -j DROP"
  fi
  if [ "$familia" = 4 ]; then
    # Redes de JOBS (código de PRs). 1) Anti-falsificación: por el puente solo sale tráfico con el origen de su subred (un job es root en su red y
    # podría usar una IP de la red de servicios que ufw permite). 2) Excepciones puntuales de DEPLOY. 3) Solo Internet: nada hacia la tailnet, los
    # metadatos del proveedor ni la red interna.
    echo "-A DOCKER-USER -i $bridge_jobs_pr ! -s $subred_jobs_pr -j DROP"
    echo "-A DOCKER-USER -i $bridge_jobs_deploy ! -s $subred_jobs_deploy -j DROP"
    # Postgres publicado por Docker entra por FORWARD tras el DNAT (no por INPUT): se permite por la IP y el puerto ORIGINALES de destino (solo ESE Postgres).
    for p in "${lista_db_deploy[@]}"; do echo "-A DOCKER-USER -i $bridge_jobs_deploy -s $subred_jobs_deploy -p tcp -m conntrack --ctorigdst $ip_db_deploy --ctorigdstport $p -j RETURN"; done
    for d in "${lista_destinos[@]}"; do echo "-A DOCKER-USER -i $bridge_jobs_deploy -s $subred_jobs_deploy -d ${d%%:*} -p tcp --dport ${d#*:} -o $tailscale -j RETURN"; done
    for b in "$bridge_jobs_pr" "$bridge_jobs_deploy"; do
      echo "-A DOCKER-USER -i $b -o $tailscale -j DROP"
      for destino in 169.254.0.0/16 100.64.0.0/10 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 192.0.0.0/24 198.18.0.0/15 224.0.0.0/4; do echo "-A DOCKER-USER -i $b -d $destino -j DROP"; done
    done
  fi
  echo "-A DOCKER-USER -i lo -j RETURN"
  echo "-A DOCKER-USER -i $tailscale -j RETURN"
  for i in "${lista_externas[@]}"; do
    for p in "${lista_publicos[@]}"; do
      echo "-A DOCKER-USER -i $i -p tcp -m conntrack --ctorigdstport $p -j RETURN"
    done
    echo "-A DOCKER-USER -i $i -j DROP"
  done
  echo "-A DOCKER-USER -j RETURN"
  echo "COMMIT"
}

# Reglas de ufw de las redes de jobs en el orden FINAL en que se evalúan (de arriba hacia abajo): deny de PR, allow de deploy, deny de deploy. Van por INTERFAZ de entrada (el
# puente de cada red): filtrar solo por IP de origen se evade falsificándola. Se aplican con `ufw prepend` en orden INVERSO: con ufw sin reglas `ufw insert N` no sirve
# («Invalid position», y los siguientes quedan en desorden: verificado con ufw real), mientras que `prepend` funciona igual con la lista vacía o llena.
ufw_reglas_jobs() {
  local p
  echo "deny in on $bridge_jobs_pr"
  for p in "${lista_db_deploy[@]}" "${lista_host_deploy[@]}"; do echo "allow in on $bridge_jobs_deploy to any port $p proto tcp"; done
  echo "deny in on $bridge_jobs_deploy"
}

# Verificación de ORDEN al terminar (`ufw status numbered`, solo las reglas IPv4): el deny de PR tiene que estar ARRIBA de todo allow, y ningún allow del puente de deploy
# puede quedar debajo del deny de ese mismo puente (quedaría inerte). Devuelve 0 si el orden es correcto.
verificar_orden_ufw() {
  "$UFW" status numbered 2>/dev/null | awk -v pr="$bridge_jobs_pr" -v dep="$bridge_jobs_deploy" '
    /^\[ *[0-9]+\]/ && $0 !~ /\(v6\)/ {
      match($0, /\[ *[0-9]+\]/); n = substr($0, RSTART + 1, RLENGTH - 2) + 0
      if ($0 ~ ("on " pr " ") && $0 ~ /DENY IN/) { denypr = n }
      if ($0 ~ ("on " dep " ") && $0 ~ /DENY IN/) { denydep = n }
      if ($0 ~ ("on " dep " ") && $0 ~ /ALLOW IN/) { if (n > maxallowdep) maxallowdep = n }
      if ($0 ~ /ALLOW IN/ && (minallow == 0 || n < minallow)) { minallow = n }
    }
    END {
      if (denypr == 0 || denydep == 0) { print "falta el deny de una red de jobs en ufw" > "/dev/stderr"; exit 1 }
      if (minallow != 0 && denypr > minallow) { print "el deny de la red de PR quedó DEBAJO de un allow (" denypr " > " minallow ")" > "/dev/stderr"; exit 1 }
      if (maxallowdep != 0 && maxallowdep > denydep) { print "un allow de deploy quedó debajo del deny de su red (" maxallowdep " > " denydep ")" > "/dev/stderr"; exit 1 }
      exit 0
    }'
}

plan() {
  echo "# ufw (tráfico del host). Las redes de jobs con \`ufw prepend\` en orden inverso: el resultado, de arriba abajo, es deny PR, allow deploy..., deny deploy; después lo demás"
  echo "ufw default deny incoming"
  echo "ufw default allow outgoing"
  local -a jobs=()
  mapfile -t jobs < <(ufw_reglas_jobs)
  local k
  for ((k=${#jobs[@]}-1; k>=0; k--)); do echo "ufw prepend ${jobs[$k]}"; done
  for p in "${lista_publicos[@]}"; do echo "ufw allow $p/tcp"; done
  echo "ufw allow in on $tailscale"
  # Los contenedores de los SERVICIOS llegan al host (host.docker.internal) por br-*: sin estas reglas `deny incoming` los corta.
  for s in "${lista_subredes[@]}"; do for p in "${lista_docker[@]}"; do echo "ufw allow from $s to any port $p proto tcp"; done; done
  echo "ufw --force enable"
  echo "# DOCKER-USER (IPv4), reemplazo atómico: iptables-restore --noflush"
  reglas_docker_user 4
  echo "# DOCKER-USER (IPv6), si ip6tables existe: ip6tables-restore --noflush (los puentes de jobs solo descartan: no tienen IPv6)"
}

ejecutar_ufw() {
  "$UFW" default deny incoming
  "$UFW" default allow outgoing
  local -a jobs=() partes=()
  local k
  mapfile -t jobs < <(ufw_reglas_jobs)
  for ((k=${#jobs[@]}-1; k>=0; k--)); do
    read -r -a partes <<< "${jobs[$k]}"
    "$UFW" prepend "${partes[@]}"
  done
  for p in "${lista_publicos[@]}"; do "$UFW" allow "$p/tcp"; done
  "$UFW" allow in on "$tailscale"
  for s in "${lista_subredes[@]}"; do for p in "${lista_docker[@]}"; do "$UFW" allow from "$s" to any port "$p" proto tcp; done; done
  "$UFW" --force enable
}

if [ "$aplicar" = 0 ]; then
  echo "# Plan (no se ejecutó nada). Externas: $externas · Tailscale: $tailscale · públicos: $publicos · servicios Docker→host: $subredes_docker puertos $puertos_docker · jobs PR: $subred_jobs_pr ($bridge_jobs_pr) · jobs deploy: $subred_jobs_deploy ($bridge_jobs_deploy; DB: $ip_db_deploy:$puertos_db_deploy; host: ${puertos_host_deploy:-ninguno})"
  plan
  echo "# Para aplicarlo con rollback automático: $0 --aplicar"
  exit 0
fi

[ "$(id -u)" = 0 ] || error "--aplicar necesita root"
mkdir -p "$DIR_RESPALDO"
chmod 700 "$DIR_RESPALDO"
marca="$(date +%Y%m%d-%H%M%S)"
respaldo_ipt="$DIR_RESPALDO/iptables-$marca.rules"
respaldo_ip6="$DIR_RESPALDO/ip6tables-$marca.rules"
respaldo_ufw="$DIR_RESPALDO/ufw-$marca"
cancelado="$DIR_RESPALDO/rollback-$marca.cancelado"
"$IPTABLES_SAVE" -t filter > "$respaldo_ipt"
tiene_ip6=0
if command -v "$IP6TABLES" >/dev/null 2>&1 && "$IP6TABLES" -S DOCKER-USER >/dev/null 2>&1; then
  tiene_ip6=1
  "$IP6TABLES_SAVE" -t filter > "$respaldo_ip6"
fi
mkdir -p "$respaldo_ufw"
if [ -d "$UFW_DIR" ]; then cp -a "$UFW_DIR/." "$respaldo_ufw/"; fi
ufw_estaba_activo=0
if "$UFW" status 2>/dev/null | grep -q "Status: active"; then ufw_estaba_activo=1; fi
rm -f "$ARCHIVO_CONFIRMACION"

# Script de rollback: restaura SOLO DOCKER-USER (v4 y v6; no toca FORWARD/nat de Docker), /etc/ufw y el estado de ufw.
script_rollback="$DIR_RESPALDO/rollback-$marca.sh"
{
  echo '#!/usr/bin/env bash'
  echo 'set -u'
  echo "{ echo '*filter'; echo ':DOCKER-USER - [0:0]'; echo '-F DOCKER-USER'; grep -- '^-A DOCKER-USER ' '$respaldo_ipt' || true; echo 'COMMIT'; } | '$IPTABLES_RESTORE' --noflush"
  if [ "$tiene_ip6" = 1 ]; then
    echo "{ echo '*filter'; echo ':DOCKER-USER - [0:0]'; echo '-F DOCKER-USER'; grep -- '^-A DOCKER-USER ' '$respaldo_ip6' || true; echo 'COMMIT'; } | '$IP6TABLES_RESTORE' --noflush"
  fi
  echo "if [ -d '$respaldo_ufw' ] && [ -d '$UFW_DIR' ]; then cp -a '$respaldo_ufw/.' '$UFW_DIR/'; fi"
  if [ "$ufw_estaba_activo" = 1 ]; then echo "'$UFW' --force reload"; else echo "'$UFW' --force disable"; fi
  echo "echo 'Rollback del firewall ejecutado.' >&2"
} > "$script_rollback"
chmod 700 "$script_rollback"

# Un rollback inmediato (chequeo fallido) cancela el temporizador: si no, un temporizador viejo podría revertir una aplicación posterior.
revertir_ahora() { touch "$cancelado"; bash "$script_rollback"; }

if [ "$sin_rollback" = 0 ]; then
  # DESACOPLADO de la sesión: setsid + nohup (sobrevive a un SIGHUP) y sin heredar stdout/stderr (el ssh no queda bloqueado).
  setsid nohup bash -c "sleep $rollback; [ -f '$cancelado' ] || [ -f '$ARCHIVO_CONFIRMACION' ] || bash '$script_rollback'" </dev/null >"$DIR_RESPALDO/rollback-$marca.log" 2>&1 &
  echo "Rollback programado en ${rollback}s (pid $!). Respaldo: $respaldo_ipt, $respaldo_ip6 y $respaldo_ufw"
fi

ejecutar_ufw
if ! verificar_orden_ufw; then
  echo "FALLÓ la verificación del orden de las reglas de ufw: se revierte" >&2
  revertir_ahora
  exit 1
fi
reglas_docker_user 4 | "$IPTABLES_RESTORE" --noflush
if [ "$tiene_ip6" = 1 ]; then
  reglas_docker_user 6 | "$IP6TABLES_RESTORE" --noflush || echo "AVISO: no pude aplicar DOCKER-USER en IPv6." >&2
fi

# Chequeos posteriores: lo que tiene que seguir funcionando (p. ej. un contenedor de Kestra que llega a Postgres por host.docker.internal). Con tope de
# tiempo: con un DROP un chequeo de red cuelga más que la ventana de rollback.
for c in "${chequeos[@]}"; do
  if ! timeout "$CHEQUEO_TIMEOUT" bash -c "$c" >/dev/null 2>&1; then
    echo "FALLÓ el chequeo posterior (o superó ${CHEQUEO_TIMEOUT}s): $c" >&2
    revertir_ahora
    exit 1
  fi
done

if [ "$sin_rollback" = 0 ]; then echo "Reglas aplicadas. Desde OTRA sesión SSH comprobá el acceso y confirmá con: touch $ARCHIVO_CONFIRMACION"; else echo "Reglas aplicadas (sin rollback)."; fi
