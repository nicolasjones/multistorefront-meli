---
owner: plataforma
sources:
  - infra/vps/firewall-docker-user.sh
  - infra/vps/obtener-clave-host.sh
  - infra/runner/Dockerfile
  - infra/runner/compose.yaml
  - infra/runner/compose.deploy.yaml
  - infra/runner/entrypoint.mjs
  - infra/runner/supervisor.mjs
  - infra/runner/config-runner.mjs
  - infra/runner/verificar-compose.mjs
  - infra/kestra/compose.estricto.yaml
  - scripts/verificar-compose-puertos.mjs
  - scripts/verificar-compose-credenciales.mjs
  - scripts/verificar-puertos-externos.mjs
  - scripts/secretos-por-defecto.mjs
  - scripts/generar-secretos-entorno.mjs
  - scripts/verificar-secretos-por-defecto.mjs
  - scripts/instalar-binario-verificado.sh
  - scripts/comprobar-conexion-db.mjs
  - scripts/abrir-issue-alerta.mjs
  - scripts/reconciliar-base.mjs
  - scripts/verificar-workflows.mjs
  - supabase/migrations/20270517000000_reafirmar_acl_rpc_internas_de_publico.sql
  - supabase/tests/database/lote99_reafirmar_acl_publico.test.sql
  - .github/workflows/release-please.yml
  - .github/workflows/worker-images.yml
---

# Endurecimiento de la infraestructura (lote 99)

Qué quedó resuelto **en el repositorio**, qué falta ejecutar en servidores o en la configuración de GitHub (acciones de Nicolás, al
final, con los comandos exactos) y cómo operar cada pieza. Ningún script de este lote escribe en un servidor por defecto: todos imprimen
un plan o son de solo lectura, y los que escriben exigen un flag explícito. **Nunca** se imprimen ni se commitean secretos.

## Estado por ticket

| Ticket | Qué se hizo en el repo | Estado |
|---|---|---|
| MSF-648 puertos publicados | Guard de CI `pnpm infra:verificar` (ningún Compose ni `docker run -p` fuera de loopback/Tailscale), script de firewall con rollback, comprobación externa de puertos, runbook | **PARCIAL**: falta abrir el firewall real y quitar los «Published Ports» de Dokploy (acción de servidor) |
| MSF-649 secreto JWT y contraseña por defecto | Generador de secretos, detector de valores por defecto (también dentro del preflight del deploy), runbook de rotación | **PARCIAL**: la rotación en DEV/STG/PRD es del servidor |
| MSF-705 credenciales por defecto | El overlay estricto ya existía (lote 36); el guard nuevo encontró 3 credenciales de Kestra sin cubrir y se agregaron; el preflight rechaza además valores por defecto ya definidos | **PARCIAL**: falta cargar 3 variables en `VPS_DEPLOY_ENV` y revisar a mano los `.env` reales |
| MSF-703 / MSF-704 runners | Supervisor con el PAT (único proceso que lo ve) y un contenedor NUEVO por job (`docker run --rm`, configuración JIT de un solo uso fuera del argv, usuario no root, sin `docker.sock`, sysbox, topes, red dedicada aislada por el firewall), store propio por contenedor, pool de deploy aparte, workflows por variable de repo, guards. La separación de pools se documenta como lo que es (no un límite de confianza frente a un workflow modificado) y el control principal pasa a ser Environments con ramas protegidas | **PARCIAL**: hay que rotar secretos, aplicar el firewall, restringir los Environments a ramas protegidas, instalar sysbox, recrear los runners y fijar las variables de repo (en ese orden) |
| MSF-706 clave de host | Ya estaba (lote 36); se agrega `infra/vps/obtener-clave-host.sh` y se corrige la doc (`infra/vps/` ya existe) | **PARCIAL**: falta cargar `VPS_SSH_KNOWN_HOSTS` |
| MSF-712 binarios, imágenes y credenciales de Docker | Digest en las imágenes (ya estaba, doc corregida), Supabase CLI y gitleaks con SHA256 fijado, plugin scout y CLI con SHA256 en la imagen, `DOCKER_CONFIG` temporal con `logout` y `rmi` en `worker-images.yml`, `id-token` sin uso retirado | **TOTAL en el repo** (las acciones ya iban por SHA desde MSF-925) |
| MSF-680 release-please y staging | Token propio por secret con aviso si falta, issue `alerta-ci` cuando falla release-please o el gate de staging, comprobación de conexión con mensaje accionable | **PARCIAL**: falta el secret (o el ajuste de GitHub) y revisar `SUPABASE_DB_URL` de staging |
| MSF-685 `Validate` en push a `dokploy` | Ya resuelto en el lote 36 por decisión de Nicolás (corrida diaria `validate-diario.yml`; doc corregida) | **TOTAL**; la corrida diaria arranca cuando el workflow llegue a `main` |
| MSF-653 ACL de `crear_consulta_publica` | Migración idempotente `20270517000000` con función reutilizable y pgTAP, `scripts/reconciliar-base.mjs` | **PARCIAL**: aplicar la migración en el DEV es del cron; el script se corre en VPS2 |
| MSF-658 / MSF-671 / MSF-915 deriva del DEV | `scripts/reconciliar-base.mjs` (diagnóstico de solo lectura; repara solo el ACL con `--aplicar --confirmo`), runbook | **PARCIAL**: reconciliar el registro y limpiar la organización de prueba exige decisión y acceso al DEV |
| MSF-902 / MSF-898 | Solo diagnóstico (abajo) | **PARCIAL** por diseño |

## MSF-648: puertos publicados a Internet

**Causa.** Los contenedores de Postgres (7634-7636), Studio (4301/4304/4305), Kong (9300-9302), Inbucket (4306/4307) y Dokploy (3000) de
DEV/STG/PRD los levanta `supabase start` o Dokploy, que publican en `0.0.0.0`, y el firewall del host estaba desactivado. Esos stacks **no**
están en los Compose del repo; los Compose del repo (`infra/*/compose*.yaml`) ya publicaban solo en `127.0.0.1`.

**Qué verifica el repo.** `pnpm infra:verificar` (job `chequeos` de `validate.yml`) ejecuta `scripts/verificar-compose-puertos.mjs`: falla si
algún Compose de `infra/` publica un puerto sin IP, con `0.0.0.0`, con una variable sin valor por defecto o con una IP que no sea loopback
(`127.0.0.0/8`, `::1`) ni de Tailscale (`100.64.0.0/10`), si usa `network_mode: host`, o si un `docker run -p` de `package.json`, `scripts/` o
`.github/` publica sin IP. Cubre la sintaxis corta y la larga (`published`/`host_ip`). Se corrigió `docs:wiki:serve`, que publicaba `8000:8000`.
Cada caso se prueba con una tabla de entradas que fallan y que pasan y con mutaciones sobre los Compose reales
(`scripts/verificar-compose-puertos.test.mjs`).

**Firewall (en el VPS, como root).** Tres capas, porque `ufw` no filtra los puertos que publica Docker:

1. `ufw`: entra solo 22 (y los demás puertos donde escucha sshd), 80, 443 y lo que llegue por la interfaz de Tailscale. **Los contenedores de los SERVICIOS del host (Kestra, Superset...) siguen llegando a lo
   que usan por `host.docker.internal`** (Postgres 7634-7636, Storage/API 9300-9302, SMTP 587/25, el router de alertas 8098): `deny incoming` los cortaría porque ese tráfico entra por `br-*` a la cadena
   INPUT, así que el script agrega `ufw allow from <subred de Docker> to any port <p>` (`--subredes-docker`, por defecto `172.16.0.0/12`; `--puertos-host-desde-docker` para otros puertos).
   **Esos `allow` NO alcanzan a los jobs de CI:** las redes de los jobs (abajo) llevan un `deny in on <puente>` puesto PRIMERO, antes de cualquier `allow` amplio. Si Docker usa
   `default-address-pools` fuera de `172.16.0.0/12`, pasalo. Verificado con `ufw` real en un contenedor descartable (QA reprodujo el fallo): con ufw RECIÉN INSTALADO (sin reglas) `ufw insert 1` falla con «Invalid position» y los siguientes `insert` quedan en
   desorden (los allow de deploy terminaban DEBAJO de su deny y quedaban inertes). Por eso las reglas de las redes de jobs se aplican con **`ufw prepend` en orden inverso** (funciona igual con la lista vacía o llena) y **al terminar el
   script verifica el orden con `ufw status numbered`**: el deny de PR arriba de todo allow y ningún allow de deploy debajo del deny de su red; si no, revierte y sale 1.
2. Cadena `DOCKER-USER` de iptables (Docker la evalúa antes que sus reglas): se descarta lo que entra por CADA interfaz externa (`--interfaz-externa eth0,eth1`) salvo los puertos públicos, filtrando por el
   puerto **original** de destino (`--ctorigdstport`). La cadena se reemplaza de forma **atómica** con `iptables-restore --noflush` (un solo `COMMIT`: nunca queda vacía ni a medias; verificado contra un
   `iptables` real en un contenedor descartable, aplicado dos veces deja las mismas reglas y el salto desde `FORWARD` intacto).
3. IPv6: el script **exige `IPV6=yes`** en `/etc/default/ufw` (los puertos que publica Docker también escuchan en `[::]` y de ese filtrado se ocupa ufw) y replica `DOCKER-USER` con `ip6tables` cuando existe
   (sin las reglas de jobs, que son IPv4: la red de jobs no tiene IPv6). Verificación: `ss -ltn | grep '\[::\]'` y `node scripts/verificar-puertos-externos.mjs --host <ipv6-publica>`.

**Redes de los jobs de CI (revisión C+S del #1238).** Los contenedores de job corren código de PRs. Por eso **no** usan `docker0`: el supervisor crea una red DEDICADA por pool
(`platform-runner-jobs-pr` 172.29.250.0/24, puente `br-jobs-pr`, y `platform-runner-jobs-deploy` 172.29.251.0/24, puente `br-jobs-deploy`; subred y NOMBRE DE PUENTE fijos, `com.docker.network.bridge.enable_icc=false`: ningún job
habla con otro) y lanza cada job con `--network <esa red>` y `--dns` explícitos. Si la red ya existe con otro driver, ICC activo, otro puente u otra subred, el supervisor **falla cerrado** (no la usa). El firewall las trata aparte
(`--subred-jobs-*`, `--bridge-jobs-*`; tienen que coincidir con `RUNNER_JOBS_SUBNET_*` y `RUNNER_JOBS_BRIDGE_*`):

- **Por interfaz, no solo por IP.** Un job es root-equivalente dentro de su red y podría falsificar el origen con una IP de la red de servicios que ufw permite. Por eso en ufw va `deny in on <puente>` (primero, con `ufw insert`) y en
  `DOCKER-USER` `-i <puente> ! -s <subred> -j DROP` (anti-falsificación) antes que cualquier otra regla de jobs.
- **Puertos del host.** La red de PR no recibe ninguno. La de **deploy** recibe `--puertos-db-deploy` (por defecto 7635 y 7636) y `--puertos-host-deploy` (para servicios del propio host que NO publica Docker, p. ej. SSH: `22`), y luego `deny`. **Ojo: `--puertos-host-deploy` abre el puerto en TODAS las IPs locales del host** (la regla de ufw no acota el destino).
- **Postgres publicado por Docker entra por FORWARD tras el DNAT, no por INPUT** (los `ufw allow` no intervienen): por eso `DOCKER-USER` lleva, ANTES de los DROP de jobs, `-i br-jobs-deploy -s <subred-deploy> -p tcp -m conntrack --ctorigdst <ip-db> --ctorigdstport <puerto-db> -j RETURN`
  para cada `--puertos-db-deploy`. **`--ip-db-deploy <ip>` es OBLIGATORIO** (una IPv4 de unicast: sin rangos, sin 0.0.0.0, sin loopback ni multicast): sin `--ctorigdst` la excepción valdría para ese puerto de CUALQUIER nodo de la tailnet o de la red privada.
  Sin esa regla el deploy no llegaría a la base y fallarían `migraciones-cloud-*` (lo reprodujo QA con iptables real). **No se pudo probar el puerto 7636 por el camino real** (el laboratorio de QA no tenía DNAT para 7636): la regla está en el plan y en los tests.
- **IPv6.** El DOCKER-USER de IPv6 descarta todo lo que entra por los puentes de jobs (`-i br-jobs-* -j DROP`): esas redes no tienen IPv6.
- **Hacia afuera.** Se DESCARTA todo lo que va a `tailscale0` y a `100.64.0.0/10` (la tailnet), `169.254.0.0/16` (metadatos), `10/8`, `172.16/12`, `192.168/16`, `192.0.0.0/24`, `198.18.0.0/15` y `224.0.0.0/4`. A los jobs les queda **solo Internet**.
  Excepciones de deploy, **acotadas por puerto**: `--destinos-tailnet-deploy 100.x.y.z:puerto[,...]` (una IP sola no vale).
- **El destino SSH del deploy (`VPS_SSH_HOST`).** Si es el propio host del runner: `--puertos-host-deploy 22`. Si es un nodo de Tailscale: `--destinos-tailnet-deploy <ip>:22` (si no, el DROP a `100.64.0.0/10` lo corta). Si es otra máquina con IP pública
  no necesita regla.
- **DNS.** Como se descartan las redes privadas, los jobs usan resolvedores públicos (`--dns`, `RUNNER_JOBS_DNS`, por defecto `1.1.1.1,8.8.8.8`); con un resolvedor privado o de metadatos perderían DNS.
- **Lo que un job NO puede (declarado).** No alcanza servicios del propio VPS por su IP pública ni por su dominio (el paquete llega al host por INPUT y ufw lo descarta), ni el gateway de su red, ni el supervisor ni el socket de Docker.
  Todo lo que necesite del host se declara con los flags de arriba.
- **Autenticación de las bases.** Un PR que caiga en el pool de deploy llega a 7635/7636 (STG/PRD): esos Postgres **tienen que exigir `scram-sha-256`** (`password_encryption` y `pg_hba.conf`) y contraseñas propias (acción 7). El firewall no sustituye a la autenticación.

Consecuencia (y corrección de lo que decía la versión anterior de esta doc): un job **no** llega al host del VPS ni a la tailnet por defecto; el `SUPABASE_DB_URL` de los entornos `migraciones-cloud-*` tiene que apuntar a la IP del host por la que el job
entra a un puerto de `--puertos-db-deploy` (la IP de Tailscale del VPS, puerto 7635/7636), o a un nodo listado en `--destinos-tailnet-deploy`.

Antes de aplicar, el script **detecta los puertos de sshd** cruzando `sshd -T` (lo que dice `sshd_config`) con los sockets que de verdad escuchan (`ss -ltnp`, procesos `sshd`: con `ssh.socket` en Ubuntu 24.04 pueden
diferir) y aborta si alguno no está en `--puertos-publicos`.

```bash
# Copiar el script al VPS (desde esta máquina) y mirar el plan: no ejecuta nada
scp infra/vps/firewall-docker-user.sh root@<ip-vps>:/root/
ssh root@<ip-vps> 'bash /root/firewall-docker-user.sh --interfaz-externa <eth0> --ip-db-deploy <ip-tailscale-del-vps>'
# Aplicar (ya dentro del VPS, en una sesión que no vas a cerrar). El rollback queda DESACOPLADO de la sesión (setsid + nohup), así que el comando vuelve enseguida.
# Cada --chequeo corre al terminar con tope de 20 s (CHEQUEO_TIMEOUT) y, si falla, revierte al instante y cancela el temporizador. Probá las DOS rutas: servicio->host Y
# deploy->base (el segundo solo existe una vez creada la red de jobs: la primera vez, aplicá sin él y verificalo con «Chequeos de aislamiento»).
bash /root/firewall-docker-user.sh --aplicar --interfaz-externa <eth0> --ip-db-deploy <ip-tailscale-del-vps> --puertos-host-deploy 22 \
  --chequeo 'docker exec <contenedor-kestra> bash -c "echo > /dev/tcp/host.docker.internal/7634"' \
  --chequeo 'docker run --rm --network platform-runner-jobs-deploy alpine nc -z -w 5 <ip-tailscale-del-vps> 7635'
# En OTRA sesión SSH, comprobá que entrás y confirmá antes de los 120 s:
touch /run/firewall-docker-user.confirmado
```

`--chequeo` se ejecuta con `bash -c` **como root**: es un `eval` que escribe el operador; nunca le pases datos de terceros (ningún workflow ni script del repo lo usa). El rollback (si no confirmás) restaura la cadena
`DOCKER-USER` (IPv4 **e IPv6**), `/etc/ufw` y el estado de ufw (activo/inactivo); **no** restaura las reglas de `FORWARD`/`nat` de contenedores creados durante la ventana (Docker las recrea al reiniciar ese contenedor).
`iptables-save`, `ip6tables-save` y `/etc/ufw` se respaldan en `/root/respaldo-firewall/`. Al cambiar `--subredes-docker` o las subredes de jobs el script **no retira** reglas `ufw` viejas: revisá `ufw status numbered` y
borralas a mano. La interfaz externa se autodetecta con las rutas por defecto IPv4 e IPv6; con varias salidas pasalas separadas por coma. Después de confirmar, correr los chequeos de conectividad de los servicios
(backups de Kestra, Superset, correo) antes de dar el cambio por bueno.

Persistencia tras un reinicio **y tras reiniciar Docker** (instalar sysbox lo reinicia): la unidad se reaplica cuando Docker vuelve; el reemplazo atómico evita que la cadena quede vacía si el script falla a medias:

```ini
# /etc/systemd/system/firewall-docker-user.service
[Unit]
Description=Reglas DOCKER-USER (MSF-648)
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service
PartOf=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash /root/firewall-docker-user.sh --aplicar --sin-rollback --interfaz-externa <eth0> --ip-db-deploy <ip-tailscale-del-vps>
[Install]
WantedBy=multi-user.target docker.service
```

`systemctl daemon-reload && systemctl enable --now firewall-docker-user.service`. Con `PartOf=docker.service` y `RemainAfterExit=yes`, un `systemctl restart docker` reinicia la unidad y vuelve a cargar las reglas
(comprobarlo después de instalar sysbox con `iptables -S DOCKER-USER`). `ufw` persiste solo. **Límite declarado:** entre que Docker publica los puertos al arrancar y corre esta unidad hay una ventana de segundos con
`DOCKER-USER` sin reglas; el `ufw` activo sigue protegiendo lo que no es de Docker. Para cerrarla del todo hay que cargar las reglas antes de Docker (`Before=docker.service` con la cadena creada por la propia
unidad), cambio que no se hizo para no arriesgar el arranque de Docker sin poder probarlo en un servidor real.

**Chequeos de aislamiento (runbook; correrlos en el VPS tras aplicar el firewall y de nuevo al recrear los runners).** Cada comando usa la red real de jobs; el resultado esperado va en el comentario:

```bash
# 1. DEPLOY llega a la base y PR NO (misma IP, mismo puerto)
docker run --rm --network platform-runner-jobs-deploy alpine nc -vz -w 5 <ip-tailscale-del-vps> 7635    # conecta
docker run --rm --network platform-runner-jobs-pr     alpine nc -vz -w 5 <ip-tailscale-del-vps> 7635    # FALLA
docker run --rm --network platform-runner-jobs-deploy alpine nc -vz -w 5 <ip-tailscale-del-vps> 7634    # FALLA (puerto no listado: DEV)
# 2. El gateway y el host por cualquiera de sus IPs son inalcanzables desde un job
docker run --rm --network platform-runner-jobs-pr alpine nc -vz -w 5 172.29.250.1 22                    # FALLA
docker run --rm --network platform-runner-jobs-pr alpine nc -vz -w 5 <ip-publica-del-vps> 22            # FALLA
# 3. Metadatos del proveedor y otros nodos de la tailnet: inalcanzables
docker run --rm --network platform-runner-jobs-pr alpine wget -T 5 -qO- http://169.254.169.254/         # FALLA
docker run --rm --network platform-runner-jobs-pr alpine nc -vz -w 5 <ip-de-otro-nodo-tailscale> 22     # FALLA
# 4. DNS e Internet siguen funcionando
docker run --rm --network platform-runner-jobs-pr alpine sh -c 'nslookup github.com && wget -T 10 -qO- https://api.github.com >/dev/null && echo ok'   # ok
# 5. Falsificar el origen con la IP de un servicio permitido por ufw NO sirve (anti-spoof por puente). La respuesta TCP no vuelve con o sin la regla, así que NO sirve para
#    discriminar: se mira el CONTADOR de la regla anti-falsificación antes y después del intento (los paquetes tienen que subir; hay que correr los dos comandos en el VPS).
iptables -L DOCKER-USER -vnx | grep -E '!172\.29\.250\.0/24'                      # anotá la columna pkts (primera)
docker run --rm --cap-add NET_ADMIN --network platform-runner-jobs-pr nicolaka/netshoot sh -c \
  'ip addr add <ip-de-un-contenedor-de-servicio>/32 dev eth0 && curl -m 5 --interface <ip-de-un-contenedor-de-servicio> http://<ip-tailscale-del-vps>:7634; echo salida=$?'   # no responde
iptables -L DOCKER-USER -vnx | grep -E '!172\.29\.250\.0/24'                      # pkts TIENE QUE HABER SUBIDO: el DROP anti-falsificación vio el intento
```

**El chequeo 1 (DEPLOY→base) es BLOQUEANTE: si no conecta, NO instales los runners** (el deploy fallaría). Revisá primero `iptables -S DOCKER-USER | grep ctorigdst` (tiene que estar el RETURN con la IP y el puerto antes de los DROP) y `ss -ltn | grep 7635`. Un RETURN en `DOCKER-USER` solo deja pasar el paquete a las reglas de Docker: si igual no conecta, mirá `iptables -S DOCKER-ISOLATION-STAGE-1`/`-STAGE-2` (el aislamiento entre redes de Docker podría descartar el paso hacia la red del Postgres) y los contadores con `iptables -L DOCKER-USER -vnx`.

**Qué tiene que seguir funcionando.** Quien necesite Postgres, Studio o Kestra desde afuera entra por Tailscale. Los **jobs** salen solo a Internet (ver arriba). `scripts/migrar-supabase-cloud.mjs` comprueba la conexión
antes de migrar y, si falla, dice el puerto, enmascara el host en el log desde el principio (`::add-mask::`, el repo es público) y qué revisar (ver MSF-680).

**Dokploy.** En cada servicio de Supabase quitar los «Published Ports» y exponerlo solo por Traefik con TLS; el panel (3000) detrás de
Tailscale o de un dominio con TLS y autenticación. El firewall de arriba es la red de seguridad, no el único control.

**Verificación (desde una máquina FUERA del VPS y de la VPN).** Solo lectura:

```bash
node scripts/verificar-puertos-externos.mjs --host <ip-publica>
```

Sale 1 y nombra los puertos sensibles que abren; sale 0 si ninguno acepta conexiones. Correrlo antes y después de aplicar el firewall.

## MSF-649: secretos por defecto

**Qué se considera «por defecto»** (`scripts/secretos-por-defecto.mjs`): el secreto JWT público del Supabase local, cualquier JWT HS256 firmado
con él o con `iss: supabase-demo`, los valores fijos que viajan en `infra/nango/compose.yaml`, contraseñas `postgres`/`password`, todo lo que
empieza con `change-me`/`changeme` o termina en `-local`, y URLs de conexión con una de esas contraseñas. Los mensajes llevan **solo el nombre
de la variable y el motivo**.

- **En el deploy.** `scripts/deploy-vps.mjs` cuenta un valor por defecto como faltante: en `staging` y `production` corta antes de tocar Docker;
  en `dev` advierte (modo transicional) hasta `VPS_ESTRICTO=1`.
- **Sobre lo que corre hoy** (solo lectura; STG y PRD se revisan igual que DEV, sin imprimir valores):

```bash
# Contenedor de auth y de base de cada entorno (los nombres salen de `docker ps`)
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' <contenedor-auth> | node scripts/verificar-secretos-por-defecto.mjs --archivo -
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' <contenedor-db>   | node scripts/verificar-secretos-por-defecto.mjs --archivo -
```

- **Generar valores propios** (sin imprimirlos; el archivo queda 0600 fuera del repo y no se sobrescribe):

```bash
node scripts/generar-secretos-entorno.mjs --entorno staging --salida /root/secretos/staging.env
```

Genera `JWT_SECRET`, `ANON_KEY` y `SERVICE_ROLE_KEY` firmadas con él (HS256, `iss: supabase`, 10 años), `POSTGRES_PASSWORD` y las credenciales de
Kestra, Superset y Nango que el despliegue exige, incluida `KESTRA_BACKUPS_PGDUMP_URL` con la contraseña y el puerto de ese entorno y el par S3 de
los respaldos.

### Rotar los secretos de un entorno

Hacerlo primero en DEV. **Invalida todas las sesiones y obliga a redesplegar** las apps, el Studio y las Edge Functions. **Congelar los deploys** (no mergear a `main` ni disparar `deploy-infraestructura-vps`) desde el paso 2 hasta el 4: entre
   que el stack reinicia con valores nuevos y que se actualizan los secrets de GitHub, un deploy fallaría.

1. Generar el archivo (arriba) y revisarlo con `node scripts/verificar-secretos-por-defecto.mjs --archivo /root/secretos/<entorno>.env`: debe salir 0.
2. Cargar `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` y `POSTGRES_PASSWORD` en las variables del stack de Supabase en Dokploy (nunca en git) y
   reiniciar el stack. La contraseña de Postgres hay que **cambiarla también dentro de la base** para cada rol que la usa
   (`select rolname from pg_roles where rolcanlogin and rolname like any (array['postgres','supabase\_%','authenticator','pgbouncer'])`):
   `alter role <rol> with password ...` leyendo el valor desde el archivo (`\set nueva \`grep '^POSTGRES_PASSWORD=' /root/secretos/<entorno>.env | cut -d= -f2-\`` y
   `alter role <rol> with password :'nueva';`) para que no pase por la consola ni el historial. **Ojo con `log_statement`:** con `ddl` o `all` el `alter role ... password` queda en el log del servidor;
   comprobarlo antes (`show log_statement;`) y, si hace falta, usar `\password <rol>` (psql lo cifra en el cliente) o bajarlo a `none` durante el cambio.
3. Actualizar donde viven las claves: secrets del Environment de GitHub (`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_DB_URL`, `VPS_DEPLOY_ENV`) y los secrets de las Edge Functions.
4. Redesplegar y verificar: los dos comandos de `docker inspect` de arriba salen en 0 y el login funciona.
5. Borrar el archivo generado (`shred -u`) cuando todo esté cargado.

## MSF-705: credenciales obligatorias

`infra/<producto>/compose.estricto.yaml` (kestra, superset, nango) exige cada credencial con `${VAR:?mensaje}`; `scripts/deploy-vps.mjs` lo suma en
staging y producción siempre y en dev con `VPS_ESTRICTO=1` (modo transicional, ver `docs/deployment.md`). `scripts/verificar-compose-credenciales.mjs`
(parte de `pnpm infra:verificar`) cierra la brecha de fondo: toda variable del Compose base con un valor por defecto público tiene que ser
obligatoria en el overlay; una credencial nueva con `${X:-change-me}` sin cubrir rompe el CI, y un Compose sin overlay no puede traer ninguna. Las
cuatro claves **anon** de los flows de Kestra (`*_APIKEY`) están exentas por nombre porque son públicas (viajan al cliente).

Con el guard se agregaron tres credenciales de Kestra que seguían con un valor por defecto: `KESTRA_BACKUPS_PGDUMP_URL` (era `postgres:postgres@...`,
el superusuario), `RESPALDOS_STORAGE_ACCESS_KEY_ID` y `RESPALDOS_STORAGE_SECRET_ACCESS_KEY`. **Hay que cargarlas en `VPS_DEPLOY_ENV` de staging y
producción antes del próximo merge a `main`** (si faltan, el preflight corta el deploy nombrándolas). Es el mismo mecanismo de MSF-705 y
no relaja nada: antes esos servicios arrancaban con la credencial conocida.

## MSF-703 / MSF-704: runners

**Riesgos que se cierran.** El repo es público; los runners corrían código de PR como root, con el socket de Docker del host, el PAT del runner en el entorno de los jobs, un store de pnpm
compartido y los mismos runners (y el mismo contenedor, reutilizado) para PR y para deploy.

**Arquitectura (revisión C+S del lote 99).** Hay dos tipos de contenedor y el PAT solo existe en el primero:

- **Supervisor** (`infra/runner/supervisor.mjs`, el Compose `compose.yaml`/`compose.deploy.yaml`). Lee el PAT de un archivo de secretos (root, 0400), le pide a GitHub una configuración **JIT** (de
  un solo uso, atada a un runner) y lanza un contenedor **nuevo por job** con `docker run --rm`. Nunca ejecuta código de un job. Es el único contenedor con el socket de Docker del host (lo necesita
  para crear los de los jobs) y es de confianza porque solo corre el código de la imagen.
- **Contenedor del job** (`infra/runner/entrypoint.mjs`). Recibe solo la configuración JIT, inicia su propio `dockerd` (sysbox), corre **un** job como `runner` (uid 1001) y termina; el supervisor lo
  destruye. **No tiene el PAT** (el entrypoint rechaza cualquier variante por entorno), **ni el socket del host, ni volúmenes**, y no hereda nada de un job anterior.

| Control | Cómo | Qué cubre y qué NO |
|---|---|---|
| Sin root | Usuario `runner`; root solo para iniciar `dockerd` en el contenedor del job. Binarios (`supabase`, `docker-scout`, módulos del entrypoint) de root y de solo lectura | Dentro del contenedor del job el usuario `runner` es root-equivalente vía su propio dockerd; por eso el contenedor es **descartable** |
| Sin `docker.sock` del host | El job usa su propio daemon con **sysbox** (`RUNNER_RUNTIME`, `sysbox-runc` por defecto); sin sysbox no arranca. `argumentosDockerRun` no admite volúmenes, `--privileged` ni namespaces del host (probado) | Sysbox protege al host, no a los secretos del propio contenedor: por eso el PAT no está ahí |
| PAT | Solo en el supervisor (archivo 0400). Al contenedor del job le llega únicamente la configuración JIT de ESE runner, que no sirve para nada más | Quien comprometa el supervisor tiene el PAT; el supervisor no ejecuta código de jobs ni recibe entrada de PRs |
| Un contenedor por job | `docker run --rm` nuevo en cada ciclo, con nombre único: no persisten imágenes, contenedores, procesos, `/home/runner` ni nada escrito como root-equivalente de un job al siguiente | El costo es descargar dependencias en cada job (store propio y vacío por contenedor) |
| Red de los jobs | Red DEDICADA por pool (`platform-runner-jobs-pr` 172.29.250.0/24 con puente `br-jobs-pr`, `platform-runner-jobs-deploy` 172.29.251.0/24 con `br-jobs-deploy`; subred y puente fijos, ICC desactivado) y `--network` y `--dns` obligatorios en el `docker run` (probado: nunca `bridge`/`host`); si la red existe distinta, el supervisor falla cerrado. El firewall filtra por interfaz y por origen y les deja solo Internet (sin host, sin tailnet, sin metadatos, sin red interna) | Es la parte que **no se pudo probar con un host real**: solo funciona con las reglas de `infra/vps/firewall-docker-user.sh` aplicadas. Mientras no estén, un job alcanza los puertos del host: por eso el firewall va ANTES de activar los runners (ver acciones) |
| Topes | `--memory`, `--cpus`, `--pids-limit` por contenedor de job (`RUNNER_MEMORY_LIMIT`, `RUNNER_CPU_LIMIT`, `RUNNER_PIDS_LIMIT`) | |
| Supervisor endurecido | `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `tmpfs /tmp` y `DOCKER_CONFIG=/tmp/.docker` (el cliente de docker necesita un directorio escribible); al arrancar elimina solo los contenedores de jobs de su rol que ya NO corren (los que corren terminan su job; una ranura que falla 5 veces se corta sola, las demás siguen, y se reintenta hasta 3 rondas con aviso en el log (`AVISO: la ranura N se cortó...`); si se agotan, queda cortada y el log lo dice) | Un docker-socket-proxy que solo permita crear/arrancar/borrar contenedores sin `privileged` sería lo siguiente; **no se hizo** (no se puede probar sin un host real). **Tampoco se probó el supervisor con `read_only` + `cap_drop ALL` contra el socket real**: si no conecta al socket, es lo primero a mirar |
| Pools | `platform-local` + `platform-pr` para PR/CI; `platform-deploy` (nunca `platform-local`) para los jobs con `environment:` y release-please | **No es un límite de confianza frente a un workflow modificado**: en un `pull_request` GitHub usa el workflow del PR, que puede pedir `runs-on` de deploy, y los guards corren desde ese mismo PR. Ver «Control principal» |

**Control principal (frente a un PR malicioso o un workflow modificado).** No son los pools ni `verificar-workflows.mjs` (defensa secundaria y de higiene: avisan de errores, no frenan a un autor
hostil). Lo que protege los secretos de producción es:

1. **Los secretos de deploy están en Environments de GitHub restringidos a ramas protegidas** (`dokploy` y `main`): un job de PR que declare `environment:` no los recibe, caiga donde caiga. Hay que fijarlo
   (acción de Nicolás, comandos abajo). Los runner groups de GitHub, que limitarían un pool a ramas, **solo existen en organizaciones**; este repo es de una cuenta personal, así que no hay un grupo de runners
   restringible y el control equivalente son los Environments.
2. **El contenedor de cada job se destruye**: aunque un PR caiga en el pool de deploy, no deja un troyano para el próximo deploy legítimo.
3. **La política de aprobación de PRs de forks** (`all_external_contributors`): hasta que un mantenedor aprueba, el workflow del PR no corre en ningún runner. **Va ANTES de activar los pools nuevos.**

**Workflows.** Ningún `runs-on` fija `self-hosted` a mano: va por `vars.CI_RUNS_ON_PR` (PR/CI), `vars.CI_RUNS_ON_PESADO` (jobs pesados, ya existía) o `vars.CI_RUNS_ON_DEPLOY` (jobs con `environment:` y
release-please). Mientras las variables no existan, todos caen en `["self-hosted","platform-local"]`: el merge no cambia nada hasta que se fijen (despliegue gradual). `scripts/verificar-workflows.mjs` falla si un
job con `environment:` o el de release-please no usa el pool de deploy, si otro job lo usa, si un workflow disparado por `pull_request` tiene un `environment:` o si aparece una etiqueta fija (higiene: ver «Control
principal»). Los pasos que escribían en `/usr/local/bin` (Supabase CLI, gitleaks) instalan en `$RUNNER_TEMP/bin` y verifican el SHA256 (MSF-712); los de `playwright install-deps` solo corren como root (las
dependencias del SO de Chromium ya vienen en la imagen).

**Etiquetas y actualización del runner (M-1).** Un runner JIT no hereda las etiquetas de sistema operativo y arquitectura: el supervisor envía `Linux` y `X64` además de las del rol (los workflows eligen por `platform-*`, así que no cambia a qué jobs
responde). **No se probó de punta a punta**: si GitHub rechazara las etiquetas o el runner no tomara jobs, es lo PRIMERO que hay que mirar en la primera recreación (la ranura se corta a los 5 fallos seguidos). Con
`RUNNER_DISABLE_AUTO_UPDATE=1` la versión del runner la fija `RUNNER_VERSION` del Dockerfile y **GitHub deja de asignar jobs a runners demasiado viejos**: hay que subir ese `ARG` y reconstruir la imagen con
regularidad (por ejemplo, junto a cada release de `actions/runner`; un runner que de repente queda sin jobs suele ser esto).

**Límites y no verificado.** La imagen se construyó y se comprobó (usuario, dueños, plugins, rechazo de configuración inválida) y la lógica del supervisor y del `docker run` está probada con `fetch` y `docker`
inyectados, pero **no se pudo probar un runner real registrado contra GitHub, la configuración JIT (`run.sh --jitconfig`) de punta a punta, el daemon interno con sysbox ni el aislamiento de la red de jobs con el firewall sobre un host real** (no hay sysbox ni PAT en el entorno del lote). Verificar
en la primera recreación con el checklist de abajo. `RUNNER_MEMORY_LIMIT` sube a 6g por defecto porque el stack de Supabase de los jobs corre dentro del contenedor del job. Los workflows que corren `docker` contra el
daemon del job (`supabase start`, `docker compose`) usan `host.docker.internal`, que el `docker run` resuelve al loopback del contenedor. La deuda preexistente del Dockerfile (repo apt de NodeSource con `curl | bash` y
`npx playwright` sin verificar) queda declarada en el propio Dockerfile.

### Recrear los runners (runbook)

Cortar jobs en curso: comprobar antes que ninguno esté ocupado (`gh api repos/nicolasjones/multistorefront-meli/actions/runners -q '.runners[] | "\(.name) \(.status) busy=\(.busy)"'`).

1. **Antes que nada, la política de forks, los Environments protegidos, la rotación de secretos y el firewall con las reglas de jobs** (acciones 4, 5, 7 y 8 de la lista de abajo). Sin eso, activar los pools nuevos no agrega protección
   frente a un PR hostil: **mientras el firewall con las redes de jobs no esté aplicado, un job de PR alcanza los puertos del host (Postgres de DEV/STG/PRD incluidos) y, con contraseñas por defecto, las bases.**
2. **Comprobación BLOQUEANTE antes de instalar los runners:** en el VPS, el chequeo 1 de «Chequeos de aislamiento» (DEPLOY→base conecta, PR→base falla). Si el RETURN por `ctorigdst` no llega realmente al Postgres tras el DNAT, no sigas.
3. **Instalar sysbox** en el host (una vez): paquete `.deb` de https://github.com/nestybox/sysbox/releases para la versión de Ubuntu, `apt install ./sysbox-ce_*.deb`, `systemctl status sysbox`.
   `docker info | grep -i runtimes` debe listar `sysbox-runc`. (Reinicia el daemon de Docker: hacerlo en una ventana.)
4. **PAT del runner** en un archivo que solo lea root: `install -d -m 0700 /etc/platform-runner && install -m 0400 /dev/null /etc/platform-runner/gh_runner_pat` y pegar el token con un editor (no por
   `echo`). Mejor un PAT de grano fino solo con `Administration: write` sobre este repo, o una GitHub App.
5. **Construir y levantar el pool de PR** con las etiquetas nuevas, *en paralelo* a los runners viejos (que siguen con `platform-local`): `GH_RUNNER_PAT_FILE=/etc/platform-runner/gh_runner_pat pnpm dev:runner`.
   Comprobar: en GitHub aparecen runners efímeros `automation-platform-pr-*` con `platform-local, platform-pr` mientras corren un job; `docker ps` muestra el supervisor y, durante un job, un contenedor nuevo
   cada vez (el nombre cambia); `docker network ls` muestra `platform-runner-jobs-pr` con la subred 172.29.250.0/24 y `ip link show br-jobs-pr` existe; después corré los «Chequeos de aislamiento» del firewall; `docker exec <contenedor-del-job> id runner` y `docker exec <contenedor-del-job> env | grep -c GH_` da 0; `docker exec <contenedor-del-job> docker ps` funciona sin tocar el daemon del host.
6. **Levantar el pool de deploy**: `GH_RUNNER_PAT_FILE=... pnpm dev:runner:deploy`; debe aparecer con solo `platform-deploy`.
7. **Fijar las variables de repo** (esto es lo que mueve el tráfico): `gh variable set CI_RUNS_ON_PR --body '["self-hosted","platform-pr"]'` y `gh variable set CI_RUNS_ON_DEPLOY --body '["self-hosted","platform-deploy"]'`.
   Si `CI_RUNS_ON_PESADO` está fijada a runners self-hosted, también debe incluir `platform-pr`.
8. **Probar**: un PR de prueba corre en `platform-pr`; `env` dentro de un step no muestra el PAT; un workflow_dispatch de `Deploy infraestructura VPS` corre en `platform-deploy`.
9. **Retirar los runners viejos** (con root y `docker.sock`): `docker compose -p multistorefront-meli-runner-dev down` y borrar el volumen `platform-runner-pnpm-store` cuando ningún otro producto lo use. **No dejarlos registrados**: son justo el riesgo que este lote cierra
   (confirmar con `gh api repos/nicolasjones/multistorefront-meli/actions/runners -q '.runners[] | .name'` que solo quedan los efímeros nuevos).

**Rollback**: volver a `CI_RUNS_ON_PR`/`CI_RUNS_ON_DEPLOY` en `["self-hosted","platform-local"]` (los runners viejos siguen registrados hasta el paso 9). El estado anterior del código está en el commit
previo a este lote (`infra/runner/` con root y `docker.sock`).

Un solo repo público con runners self-hosted sigue siendo desaconsejado por GitHub: la solución de fondo es un repo privado o runners hospedados para los PR.

## MSF-712: binarios, imágenes y credenciales de Docker

- **Imágenes de workers.** El despacho de Kestra hace `docker image inspect X || docker pull X`: con `:latest` el `pull` nunca corre. Las imágenes se
  referencian por digest (`imagen@sha256:...`) o por tag de 40 hex (el SHA del commit): el preflight del deploy rechaza `:latest`, un tag sin digest y cualquier
  otro mutable. **Política de actualización:** cada push a `main` que toque `workers/` hace que `worker-images.yml` publique el digest nuevo en el resumen del
  run (`scripts/resumen-imagenes-workers.mjs`); quien despliega lo copia a la variable `*_IMAGEN` correspondiente de `VPS_DEPLOY_ENV` y redespliega.
- **Binarios.** `scripts/instalar-binario-verificado.sh <url> <sha256> <miembro> <destino>` verifica el hash antes de extraer; Supabase CLI v2.116.0 y gitleaks v8.30.1
  usan los hashes de sus `checksums.txt` (recalculados descargando el tarball). La imagen del runner verifica Supabase CLI y el plugin scout. Para subir una versión:
  descargar, `sha256sum`, cambiar URL y hash en el workflow y el `ARG` del Dockerfile.
- **Credenciales de Docker en el runner.** `worker-images.yml` usa un `DOCKER_CONFIG` temporal por corrida y, al terminar (también si falla), `docker logout` y
  `docker rmi` de las imágenes locales; `~/.docker` además se vacía entre jobs del runner efímero.
- **Acciones de terceros** ya iban por SHA completo (MSF-925, `pnpm workflows:check`).

## MSF-680: release-please y migraciones a staging

- **release-please.** Usa `secrets.RELEASE_PLEASE_TOKEN` (un PAT con permiso de PR o un token de una GitHub App) y, si no existe, el `GITHUB_TOKEN` con un
  `::warning::` explícito (con ese token el job seguirá fallando mientras el ajuste «Allow GitHub Actions to create and approve pull requests» esté apagado).
- **Alerta.** `scripts/abrir-issue-alerta.mjs` abre (o comenta, sin duplicar) un issue `alerta-ci` con el enlace al run cuando falla release-please o el job `staging` de
  `Migraciones cloud`. Usa el `GITHUB_TOKEN` del job con `issues: write`; no necesita secrets nuevos.
- **Conexión.** El job `staging` fallaba con `connect ECONNREFUSED` contra la IP del bridge de Docker y el puerto 7635. `scripts/comprobar-conexion-db.mjs` prueba la conexión TCP antes de `supabase db push` y el
  error nombra el puerto y qué revisar; el host se enmascara en el log (sin usuario ni contraseña). La causa de fondo es operativa: el secret `SUPABASE_DB_URL` del Environment (puerto de staging 7635) y el
  alcance de red desde el runner (ver «MSF-648»).

## MSF-685 y MSF-706 (ya resueltos, doc corregida)

`Validate` sigue sin correr en cada push a `dokploy` por decisión (costo de runners); `validate-diario.yml` lo dispara una vez por día sobre `dokploy`, y como `schedule` solo corre desde
la rama por defecto, **empieza cuando el workflow llegue a `main`** (los últimos tres runs de `Validate` en `dokploy` son manuales y de antes del 17/11). La clave del host del VPS está fijada
(`StrictHostKeyChecking=yes`, sin `ssh-keyscan`); `infra/vps/` ya existe, así que también sirve versionar `infra/vps/known_hosts.<entorno>` (las claves públicas de host no son secretas).
`infra/vps/obtener-clave-host.sh <host>` imprime la huella y la línea para cargar; **comparar la huella con la del servidor por la consola del proveedor** antes de usarla.

## Base de datos: MSF-653, MSF-658, MSF-671, MSF-915

- **Migración `20270517000000`.** Crea `private.reafirmar_acl_rpc_internas_de_publico()` (idempotente; sin acceso para ningún rol de la API) y la invoca: repite el `revoke` de
  `publico.crear_consulta_publica` y `publico.registrar_interes_whatsapp` a `public`, `anon` y `authenticated` y el `grant` a `service_role`. Como el cron sí aplica las migraciones nuevas, la reparación llega
  al DEV aunque las anteriores figuren registradas sin haber corrido. El pgTAP `lote99_reafirmar_acl_publico.test.sql` simula la deriva y llama a la **misma** función (no copia el SQL);
  se verificó contra un Postgres 16 con pgTAP y una mutación (función sin `revoke`) lo hace fallar. Los índices de MSF-671 ya los crean `20270507190000` y `…190100`: en el DEV faltan
  porque esas migraciones no se aplicaron (deriva), no porque falte código.
- **`scripts/reconciliar-base.mjs`** (solo lectura: la sesión de `psql` va con `default_transaction_read_only = on`). Compara `supabase_migrations.schema_migrations` con `supabase/migrations`
  y separa las versiones registradas sin archivo en *renumeradas* (el repo tiene un archivo con el mismo nombre y otra versión: el guard renumera archivos, no filas, y suele ser la mayor parte de la diferencia
  de MSF-915) y *sin equivalente* (a revisar); lista los nombres distintos (MSF-658), las `aplicada-manual`, las organizaciones `Org T…` sin usuarios ni empresas, los índices ausentes y
  las funciones de `publico` ejecutables por `anon` fuera de la lista cerrada del pgTAP `lote42`. Con `--aplicar --confirmo <mismo-destino>` repara **únicamente** el ACL de esas dos RPC. No borra filas de
  `schema_migrations`, no renombra registros, no borra organizaciones ni crea índices: eso queda como PLAN impreso.

```bash
# En VPS2, contra el contenedor de la base DEV (solo lectura):
node scripts/reconciliar-base.mjs --docker supabase_db_multistorefront-meli-supabase-dev --salida /root/reconciliacion-dev.txt
# Reparar el ACL (escribe; mismo destino en --confirmo):
node scripts/reconciliar-base.mjs --docker supabase_db_multistorefront-meli-supabase-dev --aplicar --confirmo supabase_db_multistorefront-meli-supabase-dev
```

### Reconciliar el registro (runbook, con aprobación y primero sobre una copia restaurada)

1. Correr el diagnóstico y leer el listado completo. Las «renumeradas» son histórico legítimo: no se tocan.
2. «Con otro nombre» (MSF-658): para cada versión, mirar `select version, name, statements from supabase_migrations.schema_migrations where version = '<v>'` y comprobar **por el objeto**
   qué SQL corrió (`to_regclass`, `has_function_privilege`, `\d`). No renombrar el registro sin esa comprobación.
3. «Sin equivalente»: decidir una por una; el borrado de filas es un `delete` explícito y auditado dentro de una transacción con `returning`, nunca masivo, y solo con el análisis de qué migración aplicada corresponde a qué.
4. «aplicada-manual» (13): verificar objeto por objeto (ACL de anon, `bloqueo_acceso_hasta`, `registrar_fallo_acceso`); si el objeto está, dejar la fila; si no, el cron reaplica la migración con su nombre real.
5. Organización de prueba (`Org T019`): `begin;` contar `usuarios_organizacion` de esa organización (debe dar 0), `delete from public.organizaciones where id = '<id>'` (cascada) y `commit` solo si el conteo dio 0.
   No volver a correr `supabase/verificacion/clientes_explain.sql` ni `clientes_plan_indices.test.sql` contra el DEV compartido.
6. Repetir el diagnóstico: sin hallazgos nuevos.

## MSF-902 y MSF-898: diagnóstico (2026-11-26)

- MSF-902 hablaba de 49 PR abiertos y 37 en `DIRTY`. Hoy hay **7 abiertos**, todos de Nicolás y contra `dokploy`: **uno en `DIRTY`** (el #1003, `fix/bug-MSF-560`, «medir LCP móvil»; abierto el 15/11,
  último movimiento el 24/11, con `quality`, `web (3)` y `validacion` en rojo), cuatro `BLOCKED` (esperan checks o revisión) y dos `CLEAN`. No se tocó: decide Nicolás si se rehace sobre `dokploy` o se cierra.
- MSF-898 (el bloque MSF-691): los cinco PR contra `main` (#287, #366, #460, #515, #518) están **cerrados** desde el 1/11 y los dos de historia (#549, #520) mergeados. Del segundo
  punto (dos corridas duplicadas) no queda evidencia reproducible hoy; el workflow tiene `concurrency` con `cancel-in-progress` por rama. El seguimiento MSF-773 (E2E del catálogo de ingreso y truncado del filtro de empresas) es de producto, no de infra.

## ACCIONES DE NICOLÁS

Todas requieren actuar en un servidor o en la configuración de GitHub; ninguna la ejecutó el lote. **Orden (importa):** la 2 (Environment `release`) va antes de mergear este PR a `main` y la 1 antes del primer deploy a `main`; 1, 2 y 3 no tienen riesgo; 4 y 5 (forks y Environments) y 7 (rotar secretos) van **antes** de activar los
runners (9); 6 (la base alcanzable por Tailscale) va **antes** del firewall (8); y el firewall con las reglas de jobs (8) va **antes** que los runners (9): hasta entonces un job de PR alcanzaría los puertos del host.

1. **Cargar 3 variables nuevas en `VPS_DEPLOY_ENV`** de `deploy-infraestructura-vps-staging` y `-production` (antes del próximo merge a `main`): `KESTRA_BACKUPS_PGDUMP_URL`,
   `RESPALDOS_STORAGE_ACCESS_KEY_ID`, `RESPALDOS_STORAGE_SECRET_ACCESS_KEY`. Valores reales (la URL de pg_dump con la contraseña PROPIA del entorno). Confirmar de paso que ya trae las 14 credenciales
   y las 5 `*_IMAGEN` por digest; el job de deploy rechaza valores por defecto y nombra cada faltante.
2. **release-please (MSF-680)**, una de las dos. **ANTES de mergear este PR a `main`** (si no, el primer run crea el Environment `release` sin restricciones):
   (a) token propio: crear el Environment `release`, restringirlo a `main`, guardar ahí el token y **borrar el secret de REPO si existía** (como secret de repo lo recibiría un workflow de cualquier rama):
   ```bash
   R=nicolasjones/multistorefront-meli
   gh api -X PUT "repos/$R/environments/release" -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST "repos/$R/environments/release/deployment-branch-policies" -f name=main -f type=branch   # 422 si ya existe: es esperable al re-ejecutar
   gh secret set RELEASE_PLEASE_TOKEN --env release                                                  # PAT (o token de GitHub App) con permiso para crear PR
   gh secret delete RELEASE_PLEASE_TOKEN                                                             # el de REPO, si existía (puede dar 404 si no existe)
   ```
   (b) o habilitar «Allow GitHub Actions to create and approve pull requests». **Antes, leé el valor actual** y conservalo (poner `read` puede romper workflows sin `permissions:` si hoy es `write`):
   ```bash
   gh api repos/$R/actions/permissions/workflow        # mirá default_workflow_permissions y can_approve_pull_request_reviews
   gh api -X PUT repos/$R/actions/permissions/workflow -f default_workflow_permissions=<valor-actual> -F can_approve_pull_request_reviews=true
   ```
3. **Clave de host del VPS (MSF-706)**: `bash infra/vps/obtener-clave-host.sh <host>`, comparar la huella con `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` en la consola del proveedor y
   cargar la línea: `gh secret set VPS_SSH_KNOWN_HOSTS --env deploy-infraestructura-vps-staging` (y `-production`).
4. **Política de aprobación de forks (MSF-703)**: `gh api -X PUT repos/nicolasjones/multistorefront-meli/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors`
   (comprobar antes con el mismo `gh api` en GET). **Antes de activar los runners nuevos.** Y no aprobar PRs de externos mientras el repo sea público.
5. **Environments de deploy restringidos a ramas protegidas (control principal de MSF-704)**. Los de **producción** aceptan SOLO `main`; los de staging, `main` y `dokploy`. **El `PUT` de un Environment puede reiniciar
   protecciones que no se reenvían (reviewers, `wait_timer`, `prevent_self_review`, `can_admins_bypass`): leé primero lo que hay y reenviálo todo.** El script además **retira las políticas de rama que sobren** (un Environment
   de producción que ya aceptaba `dokploy` la seguiría aceptando). Requiere `jq`.
   ```bash
   R=nicolasjones/multistorefront-meli
   for E in deploy-infraestructura-vps-staging deploy-infraestructura-vps-production migraciones-cloud-staging migraciones-cloud-production \
            publicar-flows-kestra-staging publicar-flows-kestra-production worker-images-production; do
     echo "== $E (antes)"; gh api "repos/$R/environments/$E" --jq '{reglas: .protection_rules, ramas: .deployment_branch_policy, admins: .can_admins_bypass}'
     WAIT=$(gh api "repos/$R/environments/$E" --jq '[.protection_rules[]? | select(.type=="wait_timer") | .wait_timer][0] // 0')
     REVIEWERS=$(gh api "repos/$R/environments/$E" --jq '[.protection_rules[]? | select(.type=="required_reviewers") | .reviewers[]? | {type: .type, id: .reviewer.id}]')
     PREVENT=$(gh api "repos/$R/environments/$E" --jq '[.protection_rules[]? | select(.type=="required_reviewers") | .prevent_self_review][0] // false')
     BYPASS=$(gh api "repos/$R/environments/$E" --jq '.can_admins_bypass')
     gh api -X PUT "repos/$R/environments/$E" --input <(jq -n --argjson r "$REVIEWERS" --argjson w "$WAIT" --argjson p "$PREVENT" --argjson b "$BYPASS" \
       '{wait_timer: $w, prevent_self_review: $p, reviewers: $r, can_admins_bypass: $b, deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}')
     case "$E" in *-production) RAMAS="main" ;; *) RAMAS="main dokploy" ;; esac
     # retirar las políticas de rama que no estén en RAMAS (p. ej. `dokploy` en producción)
     for ID_NOMBRE in $(gh api "repos/$R/environments/$E/deployment-branch-policies" --jq '.branch_policies[] | "\(.id):\(.name)"'); do
       case " $RAMAS " in *" ${ID_NOMBRE#*:} "*) ;; *) gh api -X DELETE "repos/$R/environments/$E/deployment-branch-policies/${ID_NOMBRE%%:*}" ;; esac
     done
     for B in $RAMAS; do gh api -X POST "repos/$R/environments/$E/deployment-branch-policies" -f name="$B" -f type=branch; done   # 422 si ya existía: esperable
     echo "== $E (después)"; gh api "repos/$R/environments/$E" --jq '{reglas: .protection_rules, ramas: .deployment_branch_policy, admins: .can_admins_bypass}'; gh api "repos/$R/environments/$E/deployment-branch-policies" --jq '[.branch_policies[].name]'
   done
   ```
   Así un job de PR que declare ese `environment:` no recibe sus secretos aunque su workflow pida el pool de deploy. Comparar el «antes» y el «después» de cada Environment: reviewers, `wait_timer`, `prevent_self_review` y `can_admins_bypass` tienen que seguir iguales y
   las ramas de producción tienen que ser solo `["main"]`.
6. **`SUPABASE_DB_URL` de los Environments `migraciones-cloud-staging` y `-production`**: apuntar a la IP de Tailscale del VPS y publicar Postgres también en esa IP (`100.x.y.z:7635`) **antes** del firewall (8)
   y de los runners (9). Comando: `gh secret set SUPABASE_DB_URL --env migraciones-cloud-staging` (pegar el valor por stdin; no por argumento). Recordá que los jobs de deploy solo alcanzan los puertos de base
   (`--puertos-db-deploy`), los de `--puertos-host-deploy` (p. ej. el 22 si el destino SSH es el propio host) y los `ip:puerto` de `--destinos-tailnet-deploy` (p. ej. el 22 de un nodo de Tailscale).
7. **Rotar los secretos de DEV, STG y PRD (MSF-649)** con «Rotar los secretos de un entorno» (congelando los deploys). Primero verificar si STG y PRD usan los valores por defecto
   (`docker inspect ... | node scripts/verificar-secretos-por-defecto.mjs --archivo -`). **Y exigir `scram-sha-256` en los Postgres de STG/PRD** (`password_encryption = scram-sha-256` y `pg_hba.conf`): un PR que caiga en el pool de deploy llega a 7635/7636 y solo la autenticación lo frena. **Antes de instalar los runners:** hasta que el firewall con las redes de jobs esté aplicado, un job de PR llega a esas bases.
8. **Firewall (MSF-648)**, en el VPS y **solo con la 6 hecha**: los comandos de «Firewall (en el VPS, como root)» (con `--chequeo` de la conectividad contenedor-host) y la unidad systemd. Antes de aplicar, `ss -ltn` y
   `sshd -T | grep ^port` para ver qué escucha, e `IPV6=yes` en `/etc/default/ufw`. Después, desde fuera de la VPN: `node scripts/verificar-puertos-externos.mjs --host <ip-publica>` (y con la IPv6). En Dokploy,
   quitar los «Published Ports» de los servicios de Supabase y mover el panel (3000) detrás de Tailscale o de TLS con autenticación.
9. **Runners (MSF-703/704)**: seguir «Recrear los runners (runbook)» (instalar sysbox, archivo del PAT, `pnpm dev:runner`, `pnpm dev:runner:deploy`, variables `CI_RUNS_ON_PR` y `CI_RUNS_ON_DEPLOY`, los «Chequeos de aislamiento» y **retirar los runners viejos con root y `docker.sock`**). Solo con 4, 5, 7 y 8 hechos.
10. **Base DEV (MSF-653/658/671/915)**: correr `node scripts/reconciliar-base.mjs --docker <contenedor-db-dev>` en VPS2 y pasarle el informe a quien decida las filas sin equivalente; después, cuando el cron aplique
    `20270517000000`, volver a correrlo (el ACL debe dar OK); si hace falta antes, `--aplicar --confirmo`. Borrar `Org T019` con el procedimiento del runbook.
11. **Modo estricto de dev**: cuando el `.env.dev` esté completo y sin valores por defecto, definir `VPS_ESTRICTO=1` (ver «Pasar dev a modo estricto» en `docs/deployment.md`).
12. **PR #1003 (MSF-902)**: rehacerlo sobre `dokploy` o cerrarlo.
13. **`validate-diario.yml`** corre cuando llegue a `main`; mientras tanto, «Run workflow» manual sobre `dokploy`.
