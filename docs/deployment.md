---
owner: tecnico
sources:
  - specs
---

# Entornos y despliegue

## Desarrollo

Todo corre en la máquina, separado por producto: Refine, Supabase CLI, Kestra
y Superset. Es el entorno diario y no genera costo cloud adicional.

```powershell
pnpm dev:refine
pnpm dev:supabase
pnpm dev:kestra
pnpm dev:superset
pnpm dev:nango
```

## Entornos (Dokploy en VPS2, detrás de Traefik)

- **dev**: `https://dev.212-90-120-53.sslip.io` — se despliega al pushear a la rama `dokploy`.
- **stg**: `https://stg.212-90-120-53.sslip.io`.
- **prd**: `https://prd.212-90-120-53.sslip.io`.

La app web (Refine) y los servicios (Kestra, Superset, Nango, Supabase) corren en Dokploy (VPS2),
detrás de **Traefik**. **No se usa Vercel.**

Staging valida migraciones, permisos, workflows y conexión entre componentes sin tocar datos reales.

## Producción

- `apps/web`: app web (Refine) en Dokploy (VPS2), detrás de Traefik. La imagen sirve
  `apps/web/nginx.conf`: el `index.html` va con `Cache-Control: no-cache` (el navegador
  revalida y baja el bundle nuevo en cada deploy) y los assets con hash, con cache
  inmutable de 1 año. Como el HTML referencia el hash del bundle, no hace falta invalidar
  nada a mano (evita el «no aparece la pantalla nueva» hasta un Ctrl+Shift+R).
- `supabase/`: proyecto Supabase Cloud de producción mediante migraciones.
- `infra/kestra/compose.yaml`: Kestra en el VPS, detrás de HTTPS/reverse proxy.
- `infra/superset/compose.yaml`: Superset en el VPS, detrás de HTTPS/reverse proxy.
- `infra/playwright/compose.yaml`: solo para desarrollo local
  (`pnpm dev:playwright`). **No** es un producto de plataforma compartido
  como Kestra/Superset/Nango — cada cliente corre su propia instancia
  dedicada de Playwright (decisión tomada y documentada en el producto
  derivado), así que `scripts/deploy-vps.mjs` no lo despliega al VPS
  central. `docs/architecture.md` ya dejaba esto como pregunta abierta;
  tratarlo como compartido en el mecanismo de CI de
  `20261003-105444-cicd-staging-produccion` chocó en T025 contra una
  instancia dedicada real ya corriendo en el mismo puerto.
- `infra/nango/compose.yaml` + `infra/nango/compose.vps.yaml`: Nango
  self-hosted en el VPS, incluido en `scripts/deploy-vps.mjs`, detrás de
  HTTPS/reverse proxy propio del producto derivado — el callback OAuth
  (`NANGO_SERVER_URL`/`NANGO_PUBLIC_SERVER_URL`) necesita ese dominio; el
  template no provee el reverse proxy en sí (spec
  `20260930-153545-conexiones-oauth-nango`,
  [guía de adopción](./adoptar-conexiones-oauth.md)).
- Los workers se agregan como su propio Compose cuando exista un caso concreto.

`scripts/deploy-vps.mjs` corre `docker compose pull --ignore-buildable` seguido de
`docker compose build` por producto antes de `up -d`: un servicio con `image:` se baja
del registro, uno con `build:` (como `superset-init`) se compila desde su Dockerfile —
sin esto, el deploy fallaba al toparse con el primer producto que no tiene de dónde
bajarse. El script usa `fileURLToPath(import.meta.url)` en vez de `import.meta.dirname`
porque corre contra el Node preinstalado del VPS, no necesariamente ≥20.11.

No se promueven bases copiando datos. Se promueven código, migraciones y
configuración; las credenciales son distintas en cada entorno.

## Servidores de organización

Supabase, Kestra, Refine y Superset siguen siendo instancias centrales
compartidas; cada worker de integración se ejecuta, en cambio, en el
servidor aislado de su organización. El alta de ese servidor es un
procedimiento manual: hoy no requiere ni justifica una herramienta de
aprovisionamiento propia.

1. Preparar el VPS de la organización con Docker y `sshd`. Crear un usuario
   de despacho acotado para Kestra, restringido a la operación del worker;
   no usar una cuenta administrativa general del VPS.
2. Registrar desde la pantalla de superadmin
   `apps/web/src/pages/servidores/create.tsx` la organización, host, puerto
   SSH, usuario y credencial SSH de ese usuario. La llamada
   `private.aprovisionar_servidor_organizacion` crea el rol de base de datos
   `worker_*` limitado a esa organización y guarda tanto la credencial SSH
   como la de base en Supabase Vault.
3. Copiar y almacenar de forma segura la contraseña del rol de base de datos
   que la pantalla muestra una sola vez. No se puede volver a obtener en texto
   plano: queda cifrada en Vault y solo se usa durante el despacho.
4. Verificar el alta con el flujo de prueba de
   `specs/013-orquestacion-multi-organizacion/quickstart.md`: Kestra debe
   conectar por SSH, descargar la imagen del worker desde GHCR y ejecutarla
   en ese VPS, no en la infraestructura central.

### Continuidad tras restaurar un backup

Si se restaura una copia de la base compartida en un proyecto Supabase distinto,
las credenciales cifradas de Vault no son recuperables. La respuesta operativa
aceptada es reconectar cada sistema externo y volver a aprovisionar cada
servidor de organización para generar sus nuevas credenciales SSH y de base.
No se debe intentar copiar ni reconstruir claves de cifrado desde el backup.

## CI

`.github/workflows/validate.yml` corre en un runner self-hosted (no en
`ubuntu-latest`), para no depender de la cuota de minutos de GitHub Actions.
Vive en `infra/runner/` (`pnpm dev:runner` / `pnpm dev:down:runner`), como
cualquier otro producto — un contenedor Docker, no un proceso nativo del
sistema operativo.

La imagen (`infra/runner/Dockerfile`) es genérica: no tiene nada específico
de este proyecto adentro, solo Node/pnpm/Docker CLI/el runner de GitHub. Lo
que ata un contenedor a un repo puntual son las variables de entorno
(`RUNNER_REPO`, `RUNNER_NAME`, `RUNNER_LABELS` en `infra/runner/compose.yaml`
y `GH_RUNNER_PAT` en `.env`) — para reutilizarlo en otro proyecto, se copia
la carpeta tal cual y solo cambia `RUNNER_REPO`.

Usa el mismo patrón Docker-fuera-de-Docker que Kestra (monta
`/var/run/docker.sock`): los `docker compose`/`supabase start` que corren los
jobs terminan controlando el Docker del host, no uno anidado.

Hoy corre en la PC de desarrollo, no en un VPS — cuando exista uno, se migra
sin cambiar nada del Dockerfile, solo dónde se levanta el compose.

Detalle a tener en cuenta: dentro del contenedor del runner, `127.0.0.1` es
el contenedor mismo, no el host — por eso el job `database` usa
`pnpm test:db:ci` (conecta por `host.docker.internal`) en vez de
`pnpm test:db` (que asume `127.0.0.1`, correcto solo para correrlo a mano en
el host). `supabase start` sí funciona igual en los dos casos porque controla
al Docker del host vía el socket montado, no depende de la red del
contenedor.

### Réplicas, memoria, red y store de pnpm del runner

Spec: `specs/20260925-221701-optimizar-runners-locales/` (research con la
medición y el análisis de concurrencia). Variables en `.env` (todas opcionales,
con default en `infra/runner/compose.yaml`; contrato en
`specs/20260925-221701-optimizar-runners-locales/contracts/variables-runner.md`):

- `RUNNER_REPLICAS` (default `3`): cuántos jobs de este repo corren a la vez.
  Cada corrida de Validate usa tres runners (application, infrastructure,
  database) más uno para `Verificar alcance de plataforma`. Conviene bajarla a
  `1` o `2` cuando hay varios agentes activos con sus stacks (Supabase, Kestra)
  levantados, cuando `docker stats` muestra la memoria del host cerca del
  límite, o cuando la red es un Wi-Fi compartido y lento. Con menos réplicas
  los jobs esperan en cola y el CI de un PR tarda más, pero no se cae. `0` no
  levanta runners de este repo (útil para liberar la máquina sin borrar
  nada). Un valor no numérico o negativo hace fallar `docker compose`.
- `RUNNER_MEMORY_LIMIT` (default `3g`): tope de memoria de cada réplica. Cubre
  lo que corre dentro del runner (pnpm, `tsc`, `vite build`, `vitest`,
  `pg_prove`), no los contenedores que el job lanza por el socket (el stack de
  Supabase del CI). Si un job lo supera, el step falla con código 137
  (OOM); subirlo en `.env` y recrear.
- `RUNNER_CPU_LIMIT` (default `2`, `0` = sin tope): tope de CPU por réplica.
  Evita que un job (vitest es multi-núcleo) se coma la máquina y deje sin CPU a
  los otros runners, a los stacks de Supabase y a los agentes. Ver
  `docs/control-ci.md`.
- `RUNNER_PNPM_NETWORK_CONCURRENCY` (default `16`): descargas simultáneas de
  cada `pnpm install` en el runner (pnpm usaría 64 en una máquina de 12
  núcleos). El runner fija además `pnpm_config_fetch_retries=5` para
  reintentar cortes como `ECONNRESET`, y `pnpm_config_fetch_timeout=600000`
  (10 min por descarga): el binario opcional `@supabase/cli-linux-x64` pesa
  57 MB y con el timeout de 60 s nunca terminaba de bajar en un Wi-Fi lento,
  así que cada install lo reintentaba sin llegar a guardarlo.
- `RUNNER_PNPM_STORE_VOLUME` (default `platform-runner-pnpm-store`): volumen
  del store de pnpm.

**Store compartido.** El runner monta ese volumen en `/pnpm` y exporta
`pnpm_config_store_dir=/pnpm/store` y `pnpm_config_cache_dir=/pnpm/cache`, que
los steps heredan y que ganan sobre el `$PNPM_HOME/store` que implica
`pnpm/action-setup` (antes cada réplica tenía su propio store dentro del
contenedor y se perdía al recrearlo). El caché importa tanto como el store:
pnpm 11 verifica el lockfile contra sus políticas de supply-chain pidiendo la
metadata de cada paquete al registro, y solo se saltea esa consulta si
encuentra el resultado para ese mismo lockfile en el caché. Todas las
réplicas lo comparten y, como el nombre por defecto es el mismo en todos los
productos que adopten la capacidad `local-ci-runners`, también los runners de
otros productos de la máquina: una dependencia se descarga una sola vez. Para
aislar un producto, darle otro nombre en su `.env`. Compartirlo no amplía la
confianza: los runners ya montan el socket de Docker del host.

Es seguro con instalaciones en paralelo (verificado en el código de pnpm
11.19.0): cada archivo del store se nombra por su hash y se escribe en modo
exclusivo o con temporal + `rename` atómico; si dos procesos escriben el mismo
archivo escriben los mismos bytes, y pnpm verifica la integridad de cada
archivo al importarlo. El índice (`index.db`) es SQLite en modo WAL con
`busy_timeout`, que coordina varios procesos con locks del kernel. El caché
se escribe con temporal + `rename` y un registro de una línea por lockfile
verificado; sus errores nunca hacen fallar un install. Probado con tres
contenedores instalando a la vez: los tres `reused 317, downloaded 0` y
`pnpm store status` sin archivos alterados. Límites:

- Tiene que ser un volumen local de Docker (o un disco local en Linux), nunca
  una carpeta de Windows montada ni un sistema de archivos de red.
- `pnpm store prune` **no** es seguro con instalaciones en curso. Para
  limpiar, confirmar que ningún runner que use el volumen esté `busy` (en
  todos los repos que lo compartan) y correr
  `docker run --rm --entrypoint pnpm -v platform-runner-pnpm-store:/pnpm automation-platform-template-runner-dev-runner store prune --store-dir /pnpm/store`
  (la imagen es la que construye `pnpm dev:runner`).
  Tamaño actual: `docker run --rm -v platform-runner-pnpm-store:/s busybox du -sh /s`.
- El store y el directorio de trabajo del job están en sistemas de archivos
  distintos, así que pnpm copia en vez de crear enlaces duros. Es más lento
  que un enlace, pero mucho más rápido que descargar.

**Recrear los runners corta los jobs en curso.** Antes de `pnpm dev:runner`
tras cambiar alguna de estas variables, verificar que ninguno esté ocupado:

```bash
gh api repos/<owner>/<repo>/actions/runners \
  -q '.runners[] | select(.status=="online") | "\(.name) busy=\(.busy)"'
```

Adopción en productos derivados: `docs/adoptar-runners-locales.md`.

### Stack de Supabase propio del CI

Como el runner comparte el Docker del host con los stacks de desarrollo (el
del template y los de cada producto derivado), el job `database` **nunca**
usa el `project_id` ni los puertos de `supabase/config.toml`. Antes se
reutilizaba el stack de desarrollo del template (5434) y `db:reset:ci` lo
borraba en cada PR, también en los PR del producto que copió el workflow (ver
`.specify/bugs/ci-supabase-desarrollo-compartido/`).

- `pnpm db:ci:preparar` (`scripts/supabase-ci.mjs preparar`) genera
  `.supabase-ci/supabase/` (ignorado por Git) con una copia de `supabase/` y un
  `config.toml` reescrito: `project_id = "ci-<repo>"` (o `ci-rN-<repo>` para la ranura `N`) y cada
  puerto `p` convertido en `20000 + ranura*6000 + p % 10000`. En el template queda
  `ci-automation-platform-template` con la base en 25434; en
  estudio-contable-automation (desarrollo en 6434), `ci-estudio-contable-automation`
  con la base en 26434. Como los stacks de desarrollo ya usan puertos
  distintos entre sí, los del CI tampoco chocan. Se genera un archivo aparte
  porque `config.toml` no admite `env()` en los puertos (excepción FR-006 de
  la spec 015). Migraciones y seed quedan desactivados en ese `start`: los
  aplica `db:reset:ci`.
- `supabase start --workdir "$SUPABASE_CI_WORKDIR" -x …` levanta sólo lo que
  usan los pgTAP (Postgres, Auth y Storage; sin Kong ni PostgREST, que
  además no podrían validar `dominio` antes de que `db:reset:ci` aplique las
  migraciones, y cuyo health-check por `127.0.0.1` no llega desde el runner). Para inicializar
  el stack, el CLI se conecta a `127.0.0.1:<puerto>`, que dentro del runner es
  el propio contenedor. Por eso, mientras dura el `start`, corre
  `scripts/supabase-ci.mjs puente`, que reenvía sólo el puerto derivado del CI
  hacia `host.docker.internal`. El CI anterior nunca lo necesitó porque no
  levantaba nada: encontraba el stack de desarrollo ya corriendo.
- `pnpm db:reset:ci` y `pnpm test:db:ci` pasan primero por la guarda
  `scripts/supabase-ci.mjs verificar`. La guarda aborta si falta
  `SUPABASE_DB_PORT` o `SUPABASE_CI_PROJECT_ID` (no hay puerto por defecto),
  si el project_id o el puerto son de desarrollo o no son los derivados para la
  **ranura declarada** (`SUPABASE_CI_RANURA`), o si el contenedor que publica ese
  puerto no es exactamente `supabase_db_ci-<repo>` (o `supabase_db_ci-rN-<repo>`).
- **Ranuras del stack (S3a, FEAT-134):** varias corridas del job `database` del
  mismo repo pueden convivir sin pisarse. Antes había **una sola** pila y un
  `concurrency: group: supabase-ci-<repo>`; al entrar una tercera corrida, GitHub
  **cancelaba** la pendiente (BUG-179) y la historia quedaba frenada. Ahora el
  job **no** usa `concurrency`: antes de levantar el stack, `scripts/supabase-ci.mjs
  reclamar` reserva una **ranura** (`ci-rN-<repo>` + su rango de puertos) con un
  `mkdir` atómico en `/pnpm/.ci-locks` — el volumen pnpm que ya comparten todas las
  réplicas del runner. Si no hay ranura libre (hasta 5; `SUPABASE_CI_RANURAS`), el
  job **espera** (`SUPABASE_CI_LOCK_MIN`, 20 min) en vez de que lo cancelen; al
  terminar (siempre), `liberar` la suelta. Un lock huérfano (job que murió sin
  liberar) se recicla a los `SUPABASE_CI_LOCK_TTL_MIN` (50 min; el job tiene
  `timeout-minutes: 40`).
- El stack del CI **se mantiene entre corridas** (por ranura) para que el arranque
  sea rápido. No guarda datos de nadie: cada corrida lo resetea. Como
  un `start` sobre un stack ya levantado no relee `config.toml`, después de
  cambiar esa configuración hay que bajarlo a mano:
  `supabase stop --project-id ci-<repo> --no-backup` (o `ci-rN-<repo>`).
- Adopción en productos derivados: `docs/adoptar-ci-base-aislada.md`.

### Deploy de infraestructura del VPS (staging → producción)

`.github/workflows/deploy-infraestructura-vps.yml` (spec
`20261003-105444-cicd-staging-produccion`) corre `pnpm deploy:vps -- <entorno>`
sin que nadie se conecte por SSH a mano. El job controla el Docker remoto
del VPS con `DOCKER_HOST=ssh://usuario@host`, usando una clave SSH (secret
`VPS_SSH_PRIVATE_KEY`, mismo patrón que `SECRET_ORQUESTACION_SSH_PRIVATE_KEY`
de la spec 014) cargada en un `ssh-agent` efímero del job. El archivo
`.env.<entorno>` que `scripts/deploy-vps.mjs` sigue exigiendo (sin cambios
de código) se sintetiza en el workspace del job desde el secret
`VPS_DEPLOY_ENV` — nunca vuelve a persistir en el filesystem del VPS. Mismo
gate que el resto de esta spec: `staging` dispara en cada push relevante;
`production` solo corre si alguien lo dispara a mano desde Actions
(`workflow_dispatch`) — alternativa sin costo a required reviewers, que
necesita un plan de pago no disponible aquí (ver tasks.md T027).
`infra/runner/Dockerfile` agrega `openssh-client` para poder usar
`DOCKER_HOST=ssh://...`. Detalle de diseño en
`specs/20261003-105444-cicd-staging-produccion/research.md` §1-2 y
`contracts/cli-deploy-vps-ci.md`.

### Import de dashboards de Superset (versionados, automático en el deploy)

`infra/superset/importar-dashboards.mjs` importa los dashboards versionados
bajo `infra/superset/dashboards/<producto>/` contra la instancia de Superset
de un entorno, autenticando vía la API REST de Superset (login + CSRF token).
Dos modos:

- `--directorio infra/superset/dashboards/rentabilidad`: empaqueta los YAML
  con `infra/superset/empaquetar-dashboards.mjs` (sustituye el host de la
  base y excluye `reportes.json`) y los importa. Es el modo que usa el
  despliegue de infraestructura (`deploy-infraestructura-vps.yml`) en cada
  push que toca `infra/superset/dashboards/**`, después de `pnpm deploy:vps`.
- `--source <paquete.zip>`: mantiene el contrato manual de la spec
  `20261003-105444-cicd-staging-produccion` para un paquete ya exportado.

El import registra además, de forma idempotente, los reportes de
`reportes.json` en `public.reportes` con su `seccion` (p. ej.
`rentabilidad`), siempre que el Environment defina `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` y `SUPERSET_REPORTE_CREADO_POR` (UUID de un
usuario existente). La service-role key se usa solo server-side en este
script; nunca en el navegador. Si faltan, los dashboards igual se importan y
el log avisa que no se registraron reportes. Las contraseñas de las bases
viajan en el campo `passwords` del import desde
`SUPERSET_ANALITICA_DB_PASSWORD`; no se versionan. El rol `superset_analitica`
nace `nologin` y sin contraseña en la migración; `pnpm db:migrar:cloud` lo
habilita (`alter role ... with login password`) con esa misma variable, que
debe existir también como secret de los Environments `migraciones-cloud-*`, y
falla si falta. Si `psql` falla o no está en el runner después de `db push`, las
migraciones ya quedaron aplicadas y el rol sigue `nologin`: se reintenta
`pnpm db:migrar:cloud` completo (es idempotente). El paquete que se importa a
Superset lleva una carpeta raíz `dashboard_export_<producto>/` (Superset descarta
el primer componente de cada ruta). En producción el deploy falla si falta
`SUPERSET_URL`; en staging solo avisa. `reportes.json` de rentabilidad queda
vacío hasta que F-REN-02/F-REN-03 agreguen sus dashboards.

Ver `docs/adoptar-cicd-staging-produccion.md` y
`specs/20261023-170000-rentabilidad-margen/contracts/analitica-margen.md`.

### Publicación de flows de Kestra (staging → producción)

`.github/workflows/publicar-flows-kestra.yml` (spec
`20261003-105444-cicd-staging-produccion`) publica todos los flows de
`infra/kestra/flows/*.yml` contra el Kestra de cada entorno corriendo
`infra/kestra/desplegar-flow.mjs` sin ningún cambio de código — ya aceptaba
credenciales y URL por variable de entorno o flag. `id` y `namespace` se
leen del propio YAML de cada flow. Mismo gate que el resto de esta spec:
`staging` por push, `production` solo por `workflow_dispatch` manual.
Secrets por Environment: `KESTRA_BASIC_AUTH_USERNAME`,
`KESTRA_BASIC_AUTH_PASSWORD`, `KESTRA_PUBLIC_URL`.

### Migraciones cloud (staging → producción)

**Hook de bloqueo de intentos (migración `20261014100000`, MSF-470) — ACTIVADO (2026-10-15):** en los
entornos self-hosted (STG y PROD, VPS2) el hook no se activa por migración: se habilita en la config de
GoTrue del entorno (`GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_ENABLED=true` y
`GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI=pg-functions://postgres/public/verificar_intento_acceso`) y se
verifica con el checklist de `docs/tecnico/acceso.md` («Activación por entorno (checklist)»). **Verificado en STG y PROD**
(5 intentos fallidos + 6.º correcto → «Demasiados intentos…»). Persistido en el `supabase/config.toml` del
workdir del Supabase CLI de cada entorno (`/root/supabase-stg`, `/root/supabase-prd`).

`.github/workflows/migraciones-cloud.yml` (spec
`20261003-105444-cicd-staging-produccion`) aplica `supabase/migrations/**`
contra el proyecto Supabase cloud de cada entorno con `scripts/migrar-supabase-cloud.mjs`
(`supabase db push --db-url`). Ya no es un paso manual: push a `main` dispara
el job `staging` automáticamente; el job `production` corre bajo el GitHub
Environment `migraciones-cloud-production` solo cuando alguien lo dispara a
mano desde la pestaña Actions (`workflow_dispatch`) — alternativa sin costo
a required reviewers, que necesita un plan de pago no disponible aquí (ver
tasks.md T027 de la spec).
`SUPABASE_DB_URL` es un secret por Environment — una cadena de conexión
acotada al proyecto, no un access token de cuenta. Antes de aplicar nada,
`scripts/validar-migraciones-aditivas.mjs` rechaza cualquier migración
destructiva (`DROP TABLE`/`COLUMN`, `TRUNCATE`) que no documente su
Reversión — misma convención ya vigente en `supabase/migrations/` (un
comentario de encabezado con la palabra "Reversión" y los pasos para
deshacerla), ignora los `DROP` que ya viven comentados como esa
instrucción. No flaguea `ALTER TABLE ... DROP CONSTRAINT/DEFAULT/NOT NULL`
(redefinir un constraint no destruye datos) — corregido tras un falso
positivo real contra `20261003183000_esperando_aprobacion_ia.sql` durante
la validación end-to-end de esta capacidad. Detalle de diseño y
alternativas descartadas en
`specs/20261003-105444-cicd-staging-produccion/research.md`.

### Migraciones self-hosted (DEV)

En DEV la base es self-hosted y el cron `migrar-supabase-vps.sh` (orquestador, cada 10 min)
aplica las pendientes de la rama `dokploy` y las registra en
`supabase_migrations.schema_migrations`. Reglas (BUG-229/BUG-231):

- **Una versión es inmutable**: si el contenido de una versión ya publicada cambia, el
  registro y el archivo discrepan y la migración NO se aplica (pasó con `20261021162400`,
  que dejó la app sin `dominio.tiendas`). Para corregir se usa una versión nueva y mayor.
- **El DDL es idempotente**: `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, para que una aplicación parcial no trabe el reintento.
- **La cola no se frena en silencio**: el aplicador sigue ante un error "ya existe" y deja
  el estado en `runs/migraciones-estado.json`; el watchdog alerta si la racha de fallas
  reales es ≥ 2.
- **Chequeo en CI**: `pnpm migraciones:check` (corre dentro de `docs:check`) bloquea
  versiones duplicadas, reusadas o editadas, y DDL no idempotente en migraciones nuevas.

## Promoción simple

```text
rama de feature → Preview → staging (si hace falta) → main/producción
```

Para cambios sólo visuales se puede omitir el staging completo. Para cambios de
datos, permisos o automatizaciones, staging es obligatorio.

En el VPS, `pnpm deploy:vps -- staging` o `pnpm deploy:vps -- production` despliega Kestra y
Superset como proyectos Docker separados (`platform-<entorno>-kestra` y
`platform-<entorno>-superset`). `scripts/deploy-vps.mjs` acepta el entorno
con o sin el separador `--` (pnpm 11.19.0 y 12.3.4 confirmados reenviándolo
literal al script en vez de eliminarlo, a diferencia de la convención
documentada de npm/pnpm run) — hallazgo real de la validación end-to-end de
`20261003-105444-cicd-staging-produccion`. También fija `--project-directory
infra/<producto>` al invocar `docker compose` por producto (buena práctica
defensiva, aunque no fue la causa real de lo siguiente).

**Bind mounts relativos no funcionan con `DOCKER_HOST=ssh` remoto.**
`scripts/deploy-vps.mjs` controla el Docker del VPS desde el runner de CI
vía `DOCKER_HOST=ssh://...` — el cliente local solo envía al daemon remoto
la ruta ya resuelta de cualquier bind mount; el daemon la usa contra SU
PROPIO filesystem. Un bind mount con ruta relativa (`./superset_config.py`
en `infra/superset/compose.yaml`) resuelve, del lado del cliente, a una
ruta que existe en el checkout del runner pero no en el VPS — Docker crea
ahí un directorio vacío en vez de fallar, y el contenedor arranca con
`IsADirectoryError`. El `build` de una imagen no tiene este problema (el
contexto se transmite completo al daemon remoto). Por eso
`infra/superset/Dockerfile` ahora hornea (`COPY`) sus tres archivos de
configuración en vez de bind-montearlos — cualquier producto futuro que
agregue un bind mount relativo a su `compose.yaml` necesita el mismo
patrón, no bind-mount. Detalle completo y alternativas descartadas en
`specs/20261003-105444-cicd-staging-produccion/research.md` §2.

## CI más rápido (`validate.yml`)

- **Jobs condicionales por diff** (job `changes`): si el PR **no toca código** (sólo `docs/`, `specs/`,
  archivos `.md` o `.github/`), el CI **pesado** (`build`, `test:ia`, `test:auth`, e2e y `database`) queda
  **`skipped`** —el orquestador lo trata como OK—; `docs:check` y `lint` **sí** corren siempre. El job
  `infrastructure` (`infra:config`) corre **sólo si el diff toca `infra/` o `scripts/`**.
- **Clon superficial**: el job `web` (3 réplicas, la suite más larga) clona con `fetch-depth: 1` — no usa git.
  Los jobs que corren scripts con `git` (`application` → `docs:check`, `database`, `infrastructure`) y `changes`
  mantienen `fetch-depth: 0` (necesitan el merge-base/historial).
- **Suite web SHARDEADA** (job `web`): `pnpm --filter @platform/web test -- --shard=i/3` en **3 jobs en paralelo**
  (la suite web es ~80% del tiempo del CI: ~6 min → ~2 min). `test:edge:invitar-miembro` corre sólo en el shard 1.
  Con `fail-fast: true`: si un shard falla, **cancela los hermanos** (feedback rápido; igual se re-corre al corregir).
- **Runners**: `RUNNER_REPLICAS` (default `3`) en `infra/runner/compose.yaml` define cuántos jobs corren en
  paralelo en este repo.
- **Admisión y control** (`docs/control-ci.md`): con la variable de repo `CI_LANES` el job `changes` reserva
  un carril por PR y lo libera al terminar (los PRs de más esperan, con fail-open); `CI_PAUSED` es el kill
  switch y `CI_LOAD_MAX` el cortacircuitos por carga del host. Para integrar sin romper `dokploy`, un
  **merge queue** (disparador `merge_group`) prueba el PR sobre el base actualizado; se activa con un
  ruleset de rama (`merge_queue` + `required_status_checks`) — ver `docs/control-ci.md`.
- **Filtro `web`** (job `changes`): si el diff SÓLO toca dirs que no afectan a la app web (`supabase/`,
  `infra/`, `scripts/`, `apps/api/`, `docs/`, `specs/`, `.github/`), los jobs **`web`** (suite shardeada) y el
  **e2e** se **saltean**. Es **conservador**: `web` es `true` por defecto y sólo se apaga cuando TODOS los
  archivos caen en esos dirs (cualquier archivo de raíz o desconocido lo vuelve a prender). `apps/web` depende
  de `@platform/ia`, por eso `packages/**` cuenta como `web`.
- **e2e y suite web SÓLO al integrar la épica** (`e2e`, output del job `changes`): un PR de **historia** o el
  **cierre** apuntan a la rama de la **épica** (`epic/<KEY>-…`), así que `e2e` es `false` y la **suite `web`**
  (job `web`) más el **Playwright e2e** se **saltean** — se validan al integrar la épica (PR `epic/* → dokploy`,
  o un push a `dokploy`/`main`/`staging`, donde `e2e` es `true`). El `build` (type-check) **sí** sigue corriendo
  por historia. Cualquier base que **no** sea `epic/*` corre e2e (conservador). Motivo: la suite `web` es el
  **long pole** del CI (~10 min); correrla por historia consume runners y serializa el resto (era la espera
  dominante, ver `reports/ci-serie.md` del orquestador).
- **Supabase CLI**: en `database` se reusa el binario `supabase` del runner si ya está en la versión esperada
  (evita el `curl | tar` en cada corrida); si no, se descarga.
- **Cache de Playwright**: los browsers (`~/.cache/ms-playwright`) se cachean (clave por `pnpm-lock.yaml`); el
  `playwright install --with-deps` es de lo más lento y el binario no cambia entre runs.
- **Store de pnpm**: **no** se configura `cache: pnpm` — los runners self-hosted comparten un store persistente en
  volumen Docker. Ver `docs/ci-self-hosted-storage.md`.
