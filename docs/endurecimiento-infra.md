---
owner: plataforma
sources:
  - infra/vps/firewall-docker-user.sh
  - infra/vps/obtener-clave-host.sh
  - infra/runner/Dockerfile
  - infra/runner/compose.yaml
  - infra/runner/compose.deploy.yaml
  - infra/runner/entrypoint.mjs
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
  - supabase/migrations/20270514000000_reafirmar_acl_rpc_internas_de_publico.sql
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
| MSF-703 / MSF-704 runners | Imagen no root, runner efímero, sin `docker.sock`, store propio por contenedor, PAT por archivo 0400, pool de deploy aparte con etiqueta propia, workflows por variable de repo, guard | **PARCIAL**: hay que instalar sysbox, recrear los runners y fijar las variables de repo |
| MSF-706 clave de host | Ya estaba (lote 36); se agrega `infra/vps/obtener-clave-host.sh` y se corrige la doc (`infra/vps/` ya existe) | **PARCIAL**: falta cargar `VPS_SSH_KNOWN_HOSTS` |
| MSF-712 binarios, imágenes y credenciales de Docker | Digest en las imágenes (ya estaba, doc corregida), Supabase CLI y gitleaks con SHA256 fijado, plugin scout y CLI con SHA256 en la imagen, `DOCKER_CONFIG` temporal con `logout` y `rmi` en `worker-images.yml`, `id-token` sin uso retirado | **TOTAL en el repo** (las acciones ya iban por SHA desde MSF-925) |
| MSF-680 release-please y staging | Token propio por secret con aviso si falta, issue `alerta-ci` cuando falla release-please o el gate de staging, comprobación de conexión con mensaje accionable | **PARCIAL**: falta el secret (o el ajuste de GitHub) y revisar `SUPABASE_DB_URL` de staging |
| MSF-685 `Validate` en push a `dokploy` | Ya resuelto en el lote 36 por decisión de Nicolás (corrida diaria `validate-diario.yml`; doc corregida) | **TOTAL**; la corrida diaria arranca cuando el workflow llegue a `main` |
| MSF-653 ACL de `crear_consulta_publica` | Migración idempotente `20270514000000` con función reutilizable y pgTAP, `scripts/reconciliar-base.mjs` | **PARCIAL**: aplicar la migración en el DEV es del cron; el script se corre en VPS2 |
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

**Firewall (en el VPS, como root).** Dos capas, porque `ufw` no filtra los puertos que publica Docker:

1. `ufw`: entra solo 22, 80, 443 y lo que llegue por la interfaz de Tailscale.
2. Cadena `DOCKER-USER` de iptables (Docker la evalúa antes que sus reglas): se descarta lo que entra por la interfaz externa salvo 22, 80 y 443,
   filtrando por el puerto **original** de destino (`--ctorigdstport`).

```bash
# Copiar el script al VPS (desde esta máquina) y mirar el plan: no ejecuta nada
scp infra/vps/firewall-docker-user.sh root@<ip-vps>:/root/
ssh root@<ip-vps> 'bash /root/firewall-docker-user.sh --interfaz-externa <eth0>'
# Aplicar con rollback automático a los 120 s si no confirmás
ssh root@<ip-vps> 'bash /root/firewall-docker-user.sh --aplicar --interfaz-externa <eth0>'
# En OTRA sesión SSH, comprobá que entrás y confirmá:
ssh root@<ip-vps> 'touch /run/firewall-docker-user.confirmado'
```

Persistencia tras un reinicio (el script reaplica las reglas sin rollback cuando arranca Docker):

```ini
# /etc/systemd/system/firewall-docker-user.service
[Unit]
Description=Reglas DOCKER-USER (MSF-648)
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/bin/bash /root/firewall-docker-user.sh --aplicar --sin-rollback --interfaz-externa <eth0>
[Install]
WantedBy=multi-user.target
```

`systemctl daemon-reload && systemctl enable --now firewall-docker-user.service`. `ufw` persiste solo.

**Qué tiene que seguir funcionando.** Quien necesite Postgres, Studio o Kestra desde afuera entra por Tailscale. Los **runners de deploy** (contenedores
con su propio daemon) no llegan a `172.17.0.1` ni a `localhost` del VPS: el `SUPABASE_DB_URL` de los entornos `migraciones-cloud-*` tiene que
apuntar a la **IP de Tailscale** del VPS, y Postgres tiene que publicar también en esa IP (`100.x.y.z:7635`). `scripts/migrar-supabase-cloud.mjs`
comprueba la conexión antes de migrar y, si falla, dice cuál destino y qué revisar (ver MSF-680).

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

Hacerlo primero en DEV. **Invalida todas las sesiones y obliga a redesplegar** las apps, el Studio y las Edge Functions.

1. Generar el archivo (arriba) y revisarlo con `node scripts/verificar-secretos-por-defecto.mjs --archivo /root/secretos/<entorno>.env`: debe salir 0.
2. Cargar `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` y `POSTGRES_PASSWORD` en las variables del stack de Supabase en Dokploy (nunca en git) y
   reiniciar el stack. La contraseña de Postgres hay que **cambiarla también dentro de la base** para cada rol que la usa
   (`select rolname from pg_roles where rolcanlogin and rolname like any (array['postgres','supabase\_%','authenticator','pgbouncer'])`):
   `alter role <rol> with password ...` leyendo el valor desde el archivo (`\set nueva \`grep '^POSTGRES_PASSWORD=' /root/secretos/<entorno>.env | cut -d= -f2-\`` y
   `alter role <rol> with password :'nueva';`) para que no pase por la consola ni el historial.
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

**Riesgos que se cierran.** El repo es público; los runners corrían código de PR como root, con el socket de Docker del host, el PAT del runner
en el entorno de los jobs, un store de pnpm compartido y los mismos runners para PR y para deploy.

| Control | Cómo |
|---|---|
| Sin root | La imagen crea el usuario `runner` (uid 1001). El entrypoint (PID 1) es root solo para leer el PAT y supervisar; el listener y cada job corren como `runner`. Sin `RUNNER_ALLOW_RUNASROOT`. Los binarios (`supabase`, `docker-scout`, los módulos del entrypoint) son de root y de solo lectura para `runner` |
| Sin `docker.sock` | Cada runner levanta su **propio** `dockerd` dentro del contenedor con el runtime **sysbox** (`RUNNER_RUNTIME`, `sysbox-runc` por defecto). Sin sysbox el contenedor no arranca: no hay modo inseguro. Se rechaza `RUNNER_DOCKER_SOCKET` |
| PAT fuera del entorno | `RUNNER_PAT_FILE` apunta a un secreto de Compose (`GH_RUNNER_PAT_FILE` en el host: dueño root, modo 0400; el entrypoint rechaza un modo más abierto). Pasarlo por `GH_PAT`/`GH_RUNNER_PAT` falla. El entorno de los jobs no lo hereda |
| Efímero | `config.sh --ephemeral`: un job y el runner se descarta; el entrypoint registra uno nuevo. Entre jobs se vacía `_work`, `~/.docker`, `~/.ssh`, `.gitconfig` y `.npmrc` |
| Store aislado | Sin volumen compartido: el store y el caché de pnpm viven dentro de cada contenedor. `RUNNER_LIMPIAR_STORE=1` los vacía en cada job (siempre en el pool de deploy) |
| Pools separados | `platform-local` + `platform-pr` para PR/CI; `platform-deploy` (nunca `platform-local`) para los jobs con `environment:` y release-please. `config-runner.mjs` rechaza etiquetas cruzadas |

**Workflows.** Ningún `runs-on` fija `self-hosted` a mano: va por `vars.CI_RUNS_ON_PR` (PR/CI), `vars.CI_RUNS_ON_PESADO` (jobs pesados, ya existía) o
`vars.CI_RUNS_ON_DEPLOY` (jobs con `environment:` y release-please). Mientras las variables no existan, todos caen en `["self-hosted","platform-local"]`: el
merge no cambia nada hasta que se fijen (despliegue gradual). `scripts/verificar-workflows.mjs` falla si un job con `environment:` o el de release-please
no usa el pool de deploy, si otro job lo usa, si un workflow disparado por `pull_request` tiene un `environment:` o si aparece una etiqueta fija.
Los pasos que escribían en `/usr/local/bin` (Supabase CLI, gitleaks) instalan en `$RUNNER_TEMP/bin` y verifican el SHA256 (MSF-712); los de `playwright
install-deps` solo corren como root (las dependencias del SO de Chromium ya vienen en la imagen).

**Límites y no verificado.** La imagen se construyó y se comprobó (usuario, dueños, plugins, rechazo de configuración inválida) pero **no se pudo
probar un runner real registrado contra GitHub ni el daemon interno con sysbox** (no hay sysbox ni PAT en el entorno del lote). Verificar en la
primera recreación con el checklist de abajo. `RUNNER_MEMORY_LIMIT` sube a 6g por defecto porque el stack de Supabase de los jobs ahora corre dentro
del contenedor. Los workflows que corren `docker` contra el daemon del job (`supabase start`, `docker compose`) usan `host.docker.internal`, que el
Compose resuelve al loopback del contenedor.

### Recrear los runners (runbook)

Cortar jobs en curso: comprobar antes que ninguno esté ocupado (`gh api repos/nicolasjones/multistorefront-meli/actions/runners -q '.runners[] | "\(.name) \(.status) busy=\(.busy)"'`).

1. **Instalar sysbox** en el host (una vez): paquete `.deb` de https://github.com/nestybox/sysbox/releases para la versión de Ubuntu, `apt install ./sysbox-ce_*.deb`,
   `systemctl status sysbox`. `docker info | grep -i runtimes` debe listar `sysbox-runc`. (Reinicia el daemon de Docker: hacerlo en una ventana.)
2. **PAT del runner** en un archivo que solo lea root: `install -d -m 0700 /etc/platform-runner && install -m 0400 /dev/null /etc/platform-runner/gh_runner_pat` y pegar el
   token con un editor (no por `echo`). Mejor un PAT de grano fino solo con `Administration: write` sobre este repo, o una GitHub App.
3. **Construir y levantar el pool de PR** con las etiquetas nuevas, *en paralelo* a los runners viejos (que siguen con `platform-local`):
   `GH_RUNNER_PAT_FILE=/etc/platform-runner/gh_runner_pat pnpm dev:runner`. Comprobar: en GitHub aparecen runners `multistorefront-meli-pr-*` con `platform-local, platform-pr`;
   `docker exec <contenedor> id runner`; `docker exec <contenedor> env | grep -c GH_` da 0; `docker exec <contenedor> docker ps` funciona sin tocar el daemon del host.
4. **Levantar el pool de deploy**: `GH_RUNNER_PAT_FILE=... pnpm dev:runner:deploy`; debe aparecer `multistorefront-meli-deploy-*` con solo `platform-deploy`.
5. **Fijar las variables de repo** (esto es lo que mueve el tráfico): `gh variable set CI_RUNS_ON_PR --body '["self-hosted","platform-pr"]'` y
   `gh variable set CI_RUNS_ON_DEPLOY --body '["self-hosted","platform-deploy"]'`. Si `CI_RUNS_ON_PESADO` está fijada a runners self-hosted, también debe incluir `platform-pr`.
6. **Probar**: un PR de prueba corre en `platform-pr`; `env` dentro de un step no muestra el PAT; un workflow_dispatch de `Deploy infraestructura VPS` corre en `platform-deploy`.
7. **Retirar los runners viejos** (`docker compose -p multistorefront-meli-runner-dev down`) y borrar el volumen `platform-runner-pnpm-store` cuando ningún otro producto lo use.

**Rollback**: volver a `CI_RUNS_ON_PR`/`CI_RUNS_ON_DEPLOY` en `["self-hosted","platform-local"]` (los runners viejos siguen registrados hasta el paso 7). El estado anterior del
código está en el commit previo a este lote (`infra/runner/` con root y `docker.sock`).

**Ajustes de GitHub que no están en el repo** (acción de Nicolás): política de aprobación de PRs de forks `all_external_contributors` y no aprobar
PRs de externos mientras el repo sea público. Un runner efímero y sin privilegios reduce el daño, pero GitHub desaconseja runners self-hosted en repos públicos: la
solución de fondo es un repo privado o runners hospedados para los PR.

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
- **Conexión.** El job `staging` fallaba con `connect ECONNREFUSED 172.17.0.1:7635`. `scripts/comprobar-conexion-db.mjs` prueba la conexión TCP antes de `supabase db push` y el
  error nombra host y puerto (sin usuario ni contraseña) y qué revisar. La causa de fondo es operativa: el secret `SUPABASE_DB_URL` del Environment (puerto de staging 7635) y el
  alcance de red desde el runner (ver «MSF-648»).

## MSF-685 y MSF-706 (ya resueltos, doc corregida)

`Validate` sigue sin correr en cada push a `dokploy` por decisión (costo de runners); `validate-diario.yml` lo dispara una vez por día sobre `dokploy`, y como `schedule` solo corre desde
la rama por defecto, **empieza cuando el workflow llegue a `main`** (los últimos tres runs de `Validate` en `dokploy` son manuales y de antes del 17/11). La clave del host del VPS está fijada
(`StrictHostKeyChecking=yes`, sin `ssh-keyscan`); `infra/vps/` ya existe, así que también sirve versionar `infra/vps/known_hosts.<entorno>` (las claves públicas de host no son secretas).
`infra/vps/obtener-clave-host.sh <host>` imprime la huella y la línea para cargar; **comparar la huella con la del servidor por la consola del proveedor** antes de usarla.

## Base de datos: MSF-653, MSF-658, MSF-671, MSF-915

- **Migración `20270514000000`.** Crea `private.reafirmar_acl_rpc_internas_de_publico()` (idempotente; sin acceso para ningún rol de la API) y la invoca: repite el `revoke` de
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

Todas requieren actuar en un servidor o en la configuración de GitHub; ninguna la ejecutó el lote. Orden sugerido: 1, 6, 7 (sin riesgo), luego 2, 3, 5, 4.

1. **Cargar 3 variables nuevas en `VPS_DEPLOY_ENV`** de `deploy-infraestructura-vps-staging` y `-production` (antes del próximo merge a `main`): `KESTRA_BACKUPS_PGDUMP_URL`,
   `RESPALDOS_STORAGE_ACCESS_KEY_ID`, `RESPALDOS_STORAGE_SECRET_ACCESS_KEY`. Valores reales (la URL de pg_dump con la contraseña PROPIA del entorno). Confirmar de paso que ya trae las 14 credenciales
   y las 5 `*_IMAGEN` por digest. Revisar a mano que ningún valor sea el por defecto: `gh secret list --env deploy-infraestructura-vps-staging`, y para el contenido real el job de deploy ya lo rechaza.
2. **Firewall (MSF-648)**, en el VPS: los comandos de «Firewall (en el VPS, como root)» y la unidad systemd. Después, desde fuera de la VPN: `node scripts/verificar-puertos-externos.mjs --host <ip-publica>`.
   Y en Dokploy, quitar los «Published Ports» de los servicios de Supabase y mover el panel (3000) detrás de Tailscale o de TLS con autenticación.
3. **`SUPABASE_DB_URL` de los Environments `migraciones-cloud-staging` y `-production`**: pasar el host a la IP de Tailscale del VPS (y publicar Postgres también en esa IP) **antes** de mover el deploy al
   pool nuevo o de cerrar el firewall. Comando: `gh secret set SUPABASE_DB_URL --env migraciones-cloud-staging` (pegar el valor por stdin; no por argumento).
4. **Rotar los secretos de DEV, STG y PRD (MSF-649)** con «Rotar los secretos de un entorno». Primero verificar si STG y PRD usan los valores por defecto (`docker inspect ... | node scripts/verificar-secretos-por-defecto.mjs --archivo -`).
5. **Runners (MSF-703/704)**: seguir «Recrear los runners (runbook)» (instalar sysbox, archivo del PAT, `pnpm dev:runner`, `pnpm dev:runner:deploy`, variables `CI_RUNS_ON_PR` y `CI_RUNS_ON_DEPLOY`).
   Y la política de forks: `gh api -X PUT repos/nicolasjones/multistorefront-meli/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors`
   (comprobar antes con el mismo `gh api` en GET).
6. **release-please (MSF-680)**, una de las dos: (a) `gh secret set RELEASE_PLEASE_TOKEN` con un PAT (o token de GitHub App) con permiso para crear PR; o (b) habilitar «Allow GitHub Actions to create and approve pull requests»:
   `gh api -X PUT repos/nicolasjones/multistorefront-meli/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`.
   Crear además la etiqueta `alerta-ci` si querés color propio (se crea sola al abrir el primer issue).
7. **Clave de host del VPS (MSF-706)**: `bash infra/vps/obtener-clave-host.sh <host>`, comparar la huella con `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` en la consola del proveedor y
   cargar la línea: `gh secret set VPS_SSH_KNOWN_HOSTS --env deploy-infraestructura-vps-staging` (y `-production`).
8. **Base DEV (MSF-653/658/671/915)**: correr `node scripts/reconciliar-base.mjs --docker <contenedor-db-dev>` en VPS2 y pasarle el informe a quien decida las filas sin equivalente; después, cuando el cron aplique
   `20270514000000`, volver a correrlo (el ACL debe dar OK); si hace falta antes, `--aplicar --confirmo`. Borrar `Org T019` con el procedimiento del runbook.
9. **Modo estricto de dev**: cuando el `.env.dev` esté completo y sin valores por defecto, definir `VPS_ESTRICTO=1` (ver «Pasar dev a modo estricto» en `docs/deployment.md`).
10. **PR #1003 (MSF-902)**: rehacerlo sobre `dokploy` o cerrarlo.
11. **`validate-diario.yml`** corre cuando llegue a `main`; mientras tanto, «Run workflow» manual sobre `dokploy`.
