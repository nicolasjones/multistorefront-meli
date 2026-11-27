#!/usr/bin/env bash
# MSF-648 · Firewall del VPS: desde Internet solo entran 22 (el puerto REAL de sshd), 80 y 443; el resto (Postgres 7634-7636, Studio, Kong, Inbucket,
# Dokploy, Kestra, Superset, Nango...) solo por loopback, por Tailscale o desde los contenedores del propio host.
#
# Tres capas, porque `ufw` no filtra los puertos que publica Docker:
#   1. ufw (cadena INPUT, tráfico del host): default deny incoming; permite los puertos públicos, la interfaz de Tailscale y,
#      EXPLÍCITAMENTE, a las subredes de Docker hacia los servicios del host que los contenedores usan por host.docker.internal
#      (Postgres, Storage, SMTP...: sin esto `deny incoming` los corta en silencio; revisión del lote 99, A3).
#   2. DOCKER-USER (puertos publicados por Docker, tras el DNAT): se filtra por el puerto ORIGINAL (`conntrack --ctorigdstport`) y por CADA
#      interfaz externa. La cadena se reemplaza de forma ATÓMICA con `iptables-restore --noflush` (nunca queda vacía ni a medias).
#   3. IPv6: el filtrado v6 de los puertos que publica docker-proxy depende de ufw (IPV6=yes en /etc/default/ufw, que el script EXIGE) y se
#      replican las reglas de DOCKER-USER con ip6tables si existe.
#
# SOLO IMPRIME por defecto (no toca nada). Con --aplicar:
#   1. detecta el puerto de sshd (`sshd -T`) y ABORTA si no está en --puertos-publicos (te quedarías sin SSH);
#   2. guarda iptables (tabla filter), /etc/ufw y el estado de ufw;
#   3. aplica las reglas; 4. corre los --chequeo (comandos que tienen que seguir funcionando; si uno falla revierte AL INSTANTE);
#   5. arma un rollback automático DESACOPLADO de la sesión (setsid + nohup): si en --rollback-segundos no existe el archivo de confirmación,
#      restaura DOCKER-USER, /etc/ufw y el estado de ufw. Desde OTRA sesión SSH comprobá que entrás y confirmá con:
#        touch /run/firewall-docker-user.confirmado
# Lo que el rollback NO restaura: reglas de FORWARD/nat de contenedores creados durante la ventana (Docker las recrea al reiniciar el contenedor).
# Persistencia tras un reinicio: docs/endurecimiento-infra.md, «Firewall del VPS».
#
# Uso: infra/vps/firewall-docker-user.sh [--aplicar] [--interfaz-externa eth0[,eth1]] [--interfaz-tailscale tailscale0]
#          [--puertos-publicos 22,80,443] [--subredes-docker 172.16.0.0/12] [--puertos-host-desde-docker 7634,7635,7636,9300,587,8098]
#          [--chequeo '<comando>']... [--rollback-segundos 120] [--sin-rollback]
# --sin-rollback (solo con --aplicar) es para la unidad systemd que reaplica las reglas al arrancar: sin rollback ni confirmación.
# Variables de prueba: IPTABLES, IP6TABLES, IPTABLES_SAVE, IPTABLES_RESTORE, IP6TABLES_RESTORE, UFW, SSHD, UFW_DIR, UFW_DEFAULT, ARCHIVO_CONFIRMACION, DIR_RESPALDO.
set -euo pipefail

IPTABLES="${IPTABLES:-iptables}"
IP6TABLES="${IP6TABLES:-ip6tables}"
IPTABLES_SAVE="${IPTABLES_SAVE:-iptables-save}"
IPTABLES_RESTORE="${IPTABLES_RESTORE:-iptables-restore}"
IP6TABLES_RESTORE="${IP6TABLES_RESTORE:-ip6tables-restore}"
UFW="${UFW:-ufw}"
SSHD="${SSHD:-sshd}"
UFW_DIR="${UFW_DIR:-/etc/ufw}"
UFW_DEFAULT="${UFW_DEFAULT:-/etc/default/ufw}"
ARCHIVO_CONFIRMACION="${ARCHIVO_CONFIRMACION:-/run/firewall-docker-user.confirmado}"
DIR_RESPALDO="${DIR_RESPALDO:-/root/respaldo-firewall}"

aplicar=0
externas=""
tailscale="tailscale0"
publicos="22,80,443"
subredes_docker="172.16.0.0/12"
puertos_docker="7634,7635,7636,9300,9301,9302,587,25,8098"
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
    --chequeo) chequeos+=("${2:-}"); shift 2 ;;
    --rollback-segundos) rollback="${2:-}"; shift 2 ;;
    --sin-rollback) sin_rollback=1; shift ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

error() { echo "Error: $*" >&2; exit 2; }

# Validación estricta: estos valores terminan en comandos de firewall. Un nombre que empiece con `-` se tomaría por una opción.
lista_de_puertos() { case "$1" in ''|*[!0-9,]*|,*|*,|*,,*) return 1 ;; esac; }
lista_de_puertos "$publicos" || error "--puertos-publicos debe ser una lista de números separada por comas"
lista_de_puertos "$puertos_docker" || error "--puertos-host-desde-docker debe ser una lista de números separada por comas"
case "$rollback" in ''|*[!0-9]*) error "--rollback-segundos debe ser un número" ;; esac
[ "$rollback" -ge 30 ] && [ "$rollback" -le 3600 ] || error "--rollback-segundos entre 30 y 3600"
nombre_valido() { case "$1" in ''|-*|*[!A-Za-z0-9._-]*) return 1 ;; esac; }
nombre_valido "$tailscale" || error "nombre de interfaz de Tailscale inválido"
IFS=',' read -r -a lista_publicos <<< "$publicos"
IFS=',' read -r -a lista_docker <<< "$puertos_docker"
for p in "${lista_publicos[@]}" "${lista_docker[@]}"; do
  [ "$p" -ge 1 ] && [ "$p" -le 65535 ] || error "puerto fuera de rango: $p"
done
IFS=',' read -r -a lista_subredes <<< "$subredes_docker"
for s in "${lista_subredes[@]}"; do
  case "$s" in ''|*[!0-9./]*) error "--subredes-docker: subred inválida" ;; esac
done

# Interfaces externas: la de la ruta por defecto (IPv4 e IPv6) salvo que se indique; admite una lista (VLAN, bond, segunda NIC).
if [ -z "$externas" ]; then
  externas="$(ip -o route show default 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | sort -u | paste -sd, - || true)"
fi
[ -n "$externas" ] || error "no pude detectar la interfaz externa: indicala con --interfaz-externa"
IFS=',' read -r -a lista_externas <<< "$externas"
for i in "${lista_externas[@]}"; do nombre_valido "$i" || error "nombre de interfaz externa inválido"; done

# SSH: el puerto REAL de sshd tiene que estar permitido (si no, `ufw enable` te deja afuera). Sin poder detectarlo, se avisa.
puertos_sshd="$("$SSHD" -T 2>/dev/null | awk '/^port /{print $2}' | sort -un | tr '\n' ' ' || true)"
if [ -z "${puertos_sshd// /}" ]; then
  echo "AVISO: no pude leer el puerto de sshd (\`sshd -T\` necesita root): comprobá a mano que --puertos-publicos lo incluya." >&2
else
  for p in $puertos_sshd; do
    case ",$publicos," in *",$p,"*) ;; *) error "sshd escucha en el puerto $p y no está en --puertos-publicos ($publicos): te quedarías sin SSH" ;; esac
  done
fi


# IPv6: sin IPV6=yes ufw no filtra v6 y docker-proxy escucha en [::].
if [ -r "$UFW_DEFAULT" ] && ! grep -Eq '^IPV6=yes' "$UFW_DEFAULT"; then
  error "ufw no filtra IPv6 (falta IPV6=yes en $UFW_DEFAULT): activalo antes (los puertos que publica Docker también escuchan en [::])"
fi

# Contenido ATÓMICO de DOCKER-USER (iptables-restore --noflush: se aplica todo en el COMMIT; la cadena nunca queda vacía).
reglas_docker_user() {
  echo "*filter"
  echo ":DOCKER-USER - [0:0]"
  echo "-F DOCKER-USER"
  echo "-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"
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

plan() {
  echo "# ufw (tráfico del host)"
  echo "ufw default deny incoming"
  echo "ufw default allow outgoing"
  for p in "${lista_publicos[@]}"; do echo "ufw allow $p/tcp"; done
  echo "ufw allow in on $tailscale"
  # Los contenedores llegan al host (host.docker.internal) por docker0/br-*: sin estas reglas `deny incoming` los corta.
  for s in "${lista_subredes[@]}"; do for p in "${lista_docker[@]}"; do echo "ufw allow from $s to any port $p proto tcp"; done; done
  echo "ufw --force enable"
  echo "# DOCKER-USER (IPv4), reemplazo atómico: iptables-restore --noflush"
  reglas_docker_user
  echo "# DOCKER-USER (IPv6), si ip6tables existe: las mismas reglas con ip6tables-restore --noflush"
}

ejecutar_ufw() {
  "$UFW" default deny incoming
  "$UFW" default allow outgoing
  for p in "${lista_publicos[@]}"; do "$UFW" allow "$p/tcp"; done
  "$UFW" allow in on "$tailscale"
  for s in "${lista_subredes[@]}"; do for p in "${lista_docker[@]}"; do "$UFW" allow from "$s" to any port "$p" proto tcp; done; done
  "$UFW" --force enable
}

if [ "$aplicar" = 0 ]; then
  echo "# Plan (no se ejecutó nada). Externas: $externas · Tailscale: $tailscale · públicos: $publicos · Docker→host: $subredes_docker puertos $puertos_docker"
  plan
  echo "# Para aplicarlo con rollback automático: $0 --aplicar"
  exit 0
fi

[ "$(id -u)" = 0 ] || error "--aplicar necesita root"
mkdir -p "$DIR_RESPALDO"
chmod 700 "$DIR_RESPALDO"
marca="$(date +%Y%m%d-%H%M%S)"
respaldo_ipt="$DIR_RESPALDO/iptables-$marca.rules"
respaldo_ufw="$DIR_RESPALDO/ufw-$marca"
"$IPTABLES_SAVE" -t filter > "$respaldo_ipt"
mkdir -p "$respaldo_ufw"
if [ -d "$UFW_DIR" ]; then cp -a "$UFW_DIR/." "$respaldo_ufw/"; fi
ufw_estaba_activo=0
if "$UFW" status 2>/dev/null | grep -q "Status: active"; then ufw_estaba_activo=1; fi
rm -f "$ARCHIVO_CONFIRMACION"

# Script de rollback: restaura SOLO DOCKER-USER (no toca FORWARD/nat de Docker), /etc/ufw y el estado de ufw.
script_rollback="$DIR_RESPALDO/rollback-$marca.sh"
{
  echo '#!/usr/bin/env bash'
  echo 'set -u'
  echo "{ echo '*filter'; echo ':DOCKER-USER - [0:0]'; echo '-F DOCKER-USER'; grep -- '^-A DOCKER-USER ' '$respaldo_ipt' || true; echo 'COMMIT'; } | '$IPTABLES_RESTORE' --noflush"
  echo "if [ -d '$respaldo_ufw' ] && [ -d '$UFW_DIR' ]; then cp -a '$respaldo_ufw/.' '$UFW_DIR/'; fi"
  if [ "$ufw_estaba_activo" = 1 ]; then echo "'$UFW' --force reload"; else echo "'$UFW' --force disable"; fi
  echo "echo 'Rollback del firewall ejecutado.' >&2"
} > "$script_rollback"
chmod 700 "$script_rollback"

if [ "$sin_rollback" = 0 ]; then
  # DESACOPLADO de la sesión: setsid + nohup (sobrevive a un SIGHUP) y sin heredar stdout/stderr (el ssh no queda bloqueado).
  setsid nohup bash -c "sleep $rollback; [ -f '$ARCHIVO_CONFIRMACION' ] || bash '$script_rollback'" </dev/null >"$DIR_RESPALDO/rollback-$marca.log" 2>&1 &
  echo "Rollback programado en ${rollback}s (pid $!). Respaldo: $respaldo_ipt y $respaldo_ufw"
fi

ejecutar_ufw
reglas_docker_user | "$IPTABLES_RESTORE" --noflush
if command -v "$IP6TABLES" >/dev/null 2>&1 && "$IP6TABLES" -S DOCKER-USER >/dev/null 2>&1; then
  reglas_docker_user | "$IP6TABLES_RESTORE" --noflush || echo "AVISO: no pude aplicar DOCKER-USER en IPv6." >&2
fi

# Chequeos posteriores: lo que tiene que seguir funcionando (p. ej. un contenedor que llega a Postgres por host.docker.internal).
for c in "${chequeos[@]}"; do
  if ! bash -c "$c" >/dev/null 2>&1; then
    echo "FALLÓ el chequeo posterior: $c" >&2
    bash "$script_rollback"
    exit 1
  fi
done

if [ "$sin_rollback" = 0 ]; then echo "Reglas aplicadas. Desde OTRA sesión SSH comprobá el acceso y confirmá con: touch $ARCHIVO_CONFIRMACION"; else echo "Reglas aplicadas (sin rollback)."; fi
