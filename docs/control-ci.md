---
owner: plataforma
sources:
  - infra/runner
  - scripts/ci-lane.mjs
  - scripts/estado-ci.mjs
  - scripts/limpiar-ci.mjs
---

# Control de concurrencia del CI

Cómo evitar que, con muchos PRs en paralelo, el CI (y la máquina) se vaya al
diablo: admisión, cortacircuitos, límites de recursos, integración segura y
limpieza. Todo versionado salvo las **variables de repo** de GitHub.

## El problema

Los runners son un pool **fijo** (`infra/runner/`, `RUNNER_REPLICAS`). Si 20 PRs
disparan a la vez, GitHub encola jobs y los 5 runners se oversuscriben: el CI se
vuelve lento e inestable (timeouts, el browser del E2E sin `libglib`), los
stacks de Supabase del CI compiten por CPU/RAM, y **Claude** (que corre en la
misma máquina) se queda sin CPU. Subir runners no alcanza: el cuello es CPU, no
cantidad declarada.

## Piezas

| Pieza | Qué hace | Dónde |
|---|---|---|
| **Admisión por carriles** | 1 carril por PR; los de más esperan | `scripts/ci-lane.mjs`, job `changes` + `liberar` || **Kill switch** | Frena lo pesado sin tocar el repo | variable `CI_PAUSED` |
| **Cortacircuitos por carga** | No arranca pesado si el host está saturado | variable `CI_LOAD_MAX` |
| **Draft** | Un PR en borrador no corre lo pesado | `if` de los jobs pesados |
| **Timeouts** | Ningún job queda colgado para siempre | `timeout-minutes` en cada job |
| **Límite de CPU** | Cada runner no se come la máquina | `RUNNER_CPU_LIMIT` (`infra/runner/compose.yaml`) |
| **Integración protegida** | PR probado contra el `dokploy` actual | ruleset `dokploy-integracion-protegida` + `merge_group` |
| **Janitor** | Limpia locks y stacks CI abandonados | `scripts/limpiar-ci.mjs` |
| **Estado** | Foto de carriles, carga y runners | `scripts/estado-ci.mjs` |

## Sharding de la suite web

El job `web` es el 80 % del tiempo del CI y corre en 3 shards. Más tramos no aceleran: la máquina (8 núcleos) está limitada por CPU, no por tramos. El flag tiene que
llegar a vitest como **opción**, no como filtro de archivos:

```bash
pnpm --filter @platform/web exec vitest run --shard=N/3   # correcto
pnpm --filter @platform/web test -- --shard=N/3           # INCORRECTO
```

Con `--` en el medio, vitest interpreta `--shard=N/3` como un patrón posicional:
no matchea ningún archivo y **cada job corre la suite completa**. Eso triplica la
carga del pool, hace que todos los shards rocen el timeout y termina bloqueando
`validacion` en todos los PRs de épica (MSF-237, AGE-1049). Por eso el
`timeout-minutes` del job es sólo una red de seguridad: si los shards son reales,
cada uno termina muy por debajo.

### Tests afectados en los PRs, suite completa al integrar

En un PR a `dokploy` el job `web` corre `vitest run --changed <merge-base>`: solo los tests que dependen (por el grafo de
imports) de los archivos modificados; un cambio de configuración o de `package.json` dispara la suite completa. La suite
**completa** corre en el `push` a `main`/`staging` (el push a `dokploy` no dispara `Validate`: decisión pendiente más abajo), en el cierre de la épica (PR `epic/* → dokploy`) y en
`merge_group`: es la red de seguridad. El store de pnpm se cachea entre corridas (`setup-node` con `cache: pnpm`).

El job `web` hace el clon completo en los PRs para poder calcular el diff (`fetch-depth: ${{ github.event_name == 'pull_request' && '0' || '1' }}`).
El `'0'` va **entre comillas**: en una expresión de GitHub el número `0` es falso, y `a && 0 || 1` siempre da `1` (clon
superficial, `git merge-base` falla y los 3 tramos web quedan en rojo; pasó con #716 y se corrigió en #719).

Buenas prácticas para no repetir el CI: agrupar cambios relacionados en una rama de épica (los PRs a `epic/*` saltean la suite
web y el e2e), juntar commits antes de empujar (cada push cancela y reinicia la corrida) y, ante un tramo con fallo
intermitente, repetir solo ese job con `gh run rerun <id> --failed`.

## Activación

Las que son de GitHub se configuran como **variables de repo** (Settings →
Actions → Variables, o `gh variable set`):

```bash
gh variable set CI_LANES --body 5        # carriles = nº de runners (0/vacío = admisión apagada)
gh variable set CI_LOAD_MAX --body 1.2   # cortacircuitos: no arrancar si load > núcleos × factor (0 = off)
gh variable set CI_PAUSED --body true    # kill switch (borrar la variable para reactivar)
```

Las del host van en el `.env` del deploy de runners: `RUNNER_REPLICAS`,
`RUNNER_MEMORY_LIMIT`, `RUNNER_CPU_LIMIT` (ver `.env.example`). Subir
`RUNNER_REPLICAS` **sólo** después de tener CPU libre: con 12 vCPU y el load ya
alto, más réplicas reparten el mismo CPU.

### Semántica de la admisión

- **Carril normal:** el PR espera hasta `CI_LANE_WAIT_MIN` (15 min) por un carril.
- **Fail-open:** si se agota la espera (o el cortacircuitos ve el host cargado),
  el PR **sigue sin carril** y deja un aviso en el log. La admisión protege el
  caso normal sin bloquear la entrega bajo una avalancha sostenida.
- **TTL:** un carril de un job muerto se recicla a los `CI_LANE_TTL_MIN` (50 min).

### El carril se libera en un job que compite por runner (2026-11-03)

El carril lo suelta el job `liberar`, que **necesita un runner** como cualquier
otro: si la cola del CI está larga, `liberar` espera detrás de los jobs pesados
y el carril queda tomado mientras su PR **ya terminó** (sus jobs pesados están
en verde). Con 5 carriles y 5 runners, los 5 runners acaban ocupados por jobs
que esperan un carril que no se libera → el CI se clava.

Peor: el job `changes` **espera el carril dentro del runner** (hasta
`CI_LANE_WAIT_MIN`), así que un PR sin carril **ocupa un runner 15 min sin
hacer nada**. Con el host saturado (load > 12 × `CI_LOAD_MAX`), el
cortacircuitos de carga además hace que ese PR espere por el host y luego
continue sin admisión (fail-open) tras los 15 min: 15 min de runner Gastados
para nada.

**Cómo se ve:** `pnpm ci:estado` con `enUso` = nº de runners y la cola de runs
creciendo; los jobs `changes` de los runs en cola llevan `Cambios en el
archivo` sin pasos de código.

**Qué hacer (runbook):**

- Reciclar a mano los carriles **vencidos** (los que ya pasaron el TTL de 50
  min): es exactamente lo que hace `intentarCarriles()` cuando encuentra un
  lock viejo, pero sin esperar a que un PR nuevo lo toque:

  ```bash
  docker exec multistorefront-meli-runner-dev-runner-1 sh -c '
    now=$(date +%s); ttl=$((50*60))
    for d in /pnpm/.ci-lanes/ci-*; do
      [ -d "$d" ] || continue
      edad=$(( now - $(stat -c %Y "$d") ))
      [ $edad -gt $ttl ] && { echo "reciclando $(basename $d) (${edad}s)"; rm -rf "$d"; }
    done'
  ```

- Si la cola es larga pero **no** hay carriles vencidos, el problema es el
  volumen: bajar `RUNNER_REPLICAS` (menos jobs pesados simultáneos) o bajar
  `CI_LANE_WAIT_MIN` para que un PR sin carril no retenga un runner 15 min.

## Runbook

- **El CI “no arranca” o tarda muchísimo:** `pnpm ci:estado` muestra carriles en
  uso, carga y runners ocupados. Si hay carriles tomados sin jobs, correr
  `pnpm ci:limpiar` (dry-run) y luego `pnpm ci:limpiar --aplicar`.
- **Frenar todo:** `gh variable set CI_PAUSED --body true` y, del lado del host,
  pausar el cron de migraciones. Para reactivar, borrar la variable.
- **La máquina está al límite:** bajar `RUNNER_REPLICAS` (recrear corta jobs:
  verificar que ninguno esté `busy`), o mover Claude a otra máquina.
- **Un stack de Supabase del CI quedó colgado:** el workflow **CI janitor**
  (`ci-janitor.yml`, cada 6 h o manual con `workflow_dispatch`) corre
  `pnpm ci:limpiar --aplicar` dentro de un runner: borra locks/carriles vencidos
  y stacks `supabase_*_ci-*` **detenidos** (nunca los que están `Up` ni
  dev/stg/prd). Para verlo antes de limpiar: `pnpm ci:limpiar` (dry-run).
- **Un PR quedó `BEHIND` y el job `application` falla por el guard de migraciones:** el
  guard juzga sólo las migraciones que la rama agregó o modificó desde el punto de
  divergencia con la base (MSF-749), así que un rojo por «versión duplicada», «REUSADA» o
  «MODIFICADA» de una migración que la rama heredó ya no corresponde a ese PR. Si el log
  dice «la base `origin/dokploy` renumeró N migración(es) que tu rama heredó», actualizá la
  rama (merge de la base en la rama del PR) antes de mergear: si no, la migración vieja y
  la renumerada conviven al integrar.

## Cambios de CI de la auditoría MSF-647 (lote 26)

- **Borrador → Ready (MSF-675).** `Validate` escucha `pull_request` con `types: [opened, synchronize, reopened, ready_for_review]`.
  Antes, un PR abierto como borrador dejaba los jobs pesados en `skipped` y `validacion` en verde (los `skipped` cuentan como OK);
  al marcarlo Ready no había corrida nueva y se podía mergear sin tests, build ni base de datos. Con `ready_for_review` el cambio a
  Ready dispara una corrida completa. El `concurrency` por rama cancela la corrida del borrador en curso, sin pérdida.
- **Gate de egress de workers (MSF-684).** `workers/egress-allowlists.json` declara ahora las redes `worker-egress-<sistema>` que
  usan los flows (`comprobantes-pdf`, `historial-ventas`, `importar-productos`) y los workers de cada una (`workers`). Los 5 workers
  solo hablan con Supabase (ya cubierto por `common`), por eso `solo_supabase: true` y `domains: []`. `scripts/validar-egress-workers.mjs`
  falla si hay un worker descubierto sin entrada, si la política nombra un worker inexistente o si un flow referencia una red sin
  entrada, o si hay `solo_supabase: true` con `domains` no vacío; los dominios no admiten comodines de TLD (`*.com`). Lee la red de
  los flows con comillas simples o dobles, `--network=…`, `--network …`, `--net`, `network_mode:`/`networkMode:`, continuaciones de línea con `\` y
  subdirectorios de `infra/kestra/flows`, y rechaza cualquier red literal (`host`, `bridge`, `$(…)`) fuera de la convención
  `worker-egress-<sistema>` (se aceptan variables `$VAR`, `${VAR:?msg}` y `none`; `${VAR…}` se acepta sin resolver el valor real de la variable (solo se valida el valor por defecto literal; que `WORKER_NETWORK` valga una red correcta en el servidor no se comprueba): `${VAR:-host}` y los defaults anidados (`${A:-${B:-host}}`) se rechazan (un default solo puede ser una red válida, `none` o una variable simple `$X`): un valor por defecto literal debe ser una red válida; `--network=\` + salto de línea + valor se une antes de validar). **No cubre** `networks:` de un compose ni un `--network` fuera de los YAML de `infra/kestra/flows` (test: `scripts/validar-egress-workers.test.mjs`). Se corre
  también en el job `application` (dentro de `test:ci:scripts`; antes solo corría en `worker-images.yml`, que dispara solo en `main`).
  **Límite**: valida estructura y consistencia; NO detecta un `fetch` nuevo a un tercero en un worker ya listado (la allowlist real
  la aplica el firewall/proxy del servidor). Nota: 4 workers pueden enviar errores a GlitchTip con `ERRORES_DSN`
  (`workers/_comun/errores.mjs`); hoy ningún flow lo pasa (no-op). Si se activa, hay que declarar el host en `domains`
  (ver el campo `notas` del JSON).
- **Migraciones aditivas (MSF-688).** `validar-migraciones-aditivas.mjs` también detecta `DROP SCHEMA`, `DROP FUNCTION` y
  `DELETE FROM` sin `WHERE`; un tokenizador mínimo respeta literales `'…'`, `E'…\'…'`, dollar-quoting `$tag$…$tag$` (su cuerpo se analiza como SQL) y comentarios de bloque anidados (`select '--'; drop table x;` ya no pasa) y el marcador
  debe ser un comentario que nombre la «reversión» sin negarla (`-- sin reversión` no vale; `reversible` tampoco; `-- Reversión: ninguna` / `n/a` / `no aplica` / vacío sin pasos en la línea siguiente tampoco). El filtro es conservador: `-- Reversión: no hay reversión automática` se rechaza aunque declare un camino manual; reescribirlo (p. ej. `-- Reversión: restaurar desde el backup`). No se exige que
  empiece con «Reversión:» porque las 750 migraciones históricas usan formatos distintos. Corre también en `application` sobre las
  750 (~1,5 s). **Límites** (no cubre): SQL dinámico con `execute`; `DROP TYPE/VIEW/POLICY/INDEX/TRIGGER/ROLE/EXTENSION/OWNED`;
  `ALTER TABLE t DROP c` sin `COLUMN`; `UPDATE` sin `WHERE`; `REVOKE`; no valida que la reversión tenga pasos. `DROP
  CONSTRAINT/DEFAULT/NOT NULL` sigue sin marcarse (falso positivo conocido). Tampoco modela `standard_conforming_strings = off`. Los tags
  de dollar-quote admiten letras Unicode (`$é$`) y el análisis es casi lineal: el índice de tags se calcula una vez sobre el texto completo (con ~1 MB hostil, de tags únicos, repetidos o anidados, tarda 0,1 a 0,4 s); los dollar-quotes anidados más allá de 100 niveles se tratan como código plano (sus `drop` cuentan); `$a$a$ drop table t; $a$` se marca destructivo aunque en PG es un string (falso positivo conservador); las líneas de comentario se normalizan (espacios colapsados) antes de las regex del marcador para evitar ReDoS. `-- Reversion: none` /
  `n.a.` / `na` / `nothing` también se rechazan.
- **Tests rápidos de tooling en el job `application` (MSF-679, parcial).** Paso `pnpm test:ci:scripts` (Node puro, sin base ni red,
  ~1,5 a 3 minutos en el runner de CI; la cifra no se reproduce en hosts cargados, donde medimos ~160 s): lo corre `scripts/correr-suites.mjs`, que ejecuta TODAS las suites y falla al final con un resumen de las que
  fallaron (no corta en la primera). Cada suite tiene timeout (600 s por defecto; `--timeout <s>` o `CORRER_SUITES_TIMEOUT_S`) y una
  suite muerta por señal se informa como «murió por SIGKILL», no como un exit genérico. `test:ci:scripts` (y `docs:wiki:check`) necesitan un `.git` real: no corren en un worktree montado sin gitdir. Un timeout inválido (no numérico, ≤ 0 o > 86400 s) termina con exit 2 y un mensaje claro. Cada suite corre en su propio grupo de procesos (`detached` = setsid; se guarda `pid > 1` antes de `kill(-pid)` porque `kill(-0)`/`kill(-1)` alcanzarían al propio runner o a todos los procesos) y al vencer el timeout se mata el grupo entero (shell, pnpm, node y nietos); un Ctrl-C o SIGTERM al runner no llega al grupo de la suite en curso (sigue hasta su timeout). La suite `ia:sincronizar-edge-functions` requiere un checkout git (usa `git`); el job
  `application` ya hace checkout completo. Ver «Decisiones pendientes del lote 26».

### Decisiones pendientes del lote 26 (no se tocaron a propósito)

- **`Validate` en `push` a `dokploy` (MSF-685).** Hoy no corre (`push: branches: [main, staging]`); la documentación lo afirmaba y
  se corrigió. Encenderlo haría correr web (~10 min repartidos en shards), build, e2e y `database` en CADA merge a `dokploy` (varios
  por día) sobre los runners, con el riesgo de rojos por la cola compartida del stack de Supabase. Alternativas: (a) agregar
  `dokploy` a `push.branches` (cobertura total, costo alto); (b) mantener el e2e nocturno (`e2e-nocturno.yml`) como red de seguridad
  (ya existe, costo nulo en el camino del PR). Se recomienda (b) más la cola de merge (`merge_group`, ya soportado por el workflow)
  si se quiere validar el resultado integrado (no verificado si el repo tiene merge queue o ruleset activos: no se pudo consultar
  la API de rulesets). Requiere decisión de Nicolás.
- **Tests que el CI sigue sin correr (MSF-679).** Quedan fuera por pesados o por fallar hoy (ver la tabla en
  «Verificación» del PR): `template:capabilities:check`, `test:outbox:frontera` y `test:ia:aprovisionamiento` fallan en `dokploy`
  actual y hay que arreglarlos antes de encenderlos; los `test:*:e2e`, `test:db` y los de runtime necesitan stack.
- **`release-please` y migraciones a staging cloud (MSF-680).** Ramas `main`, credenciales y flujo de promoción STG/PRD: no se
  tocan acá. Propuesta (no verificado: el diagnóstico sale del texto del ítem, no se revisaron los logs ni los ajustes del repo):
  habilitar «Allow GitHub Actions to create and approve pull requests» en Settings → Actions, o pasar `token:` de un PAT/GitHub App
  a `release-please-action` (secret nuevo); revisar el secret `SUPABASE_DB_URL` del Environment `staging` y su puerto (según el
  ítem, el destino rechazaba conexiones) y agregar una alerta cuando falle el job `staging`.
- **`docs:check` elude fácil (MSF-688).** `verificar-documentacion-cambios.mjs` da por documentado cualquier cambio en
  `docs/`/`specs/`. Propuesta: mapear rutas de código a documentos concretos (p. ej. `.github/workflows/**` → `docs/control-ci.md`
  o `docs/deployment.md`). No se aplica sin acordar el mapa: bloquearía PRs en vuelo. El `accessControlProvider` (llamadas de red por
  ítem de menú, `lib/superadmin.ts`) es código de la app, no de CI: queda como ítem aparte.

## Integración protegida de `dokploy`

`dokploy` tiene un **ruleset activo** (`dokploy-integracion-protegida`) con:

- **Check requerido único: `validacion`** (job agregador que siempre corre y
  falla si `changes`, `application`, `web`, `infrastructure` o `database`
  fallaron o se cancelaron; los `skipped` cuentan como OK). Así un PR de docs
  (que saltea `web`/`database`) no queda bloqueado, pero un shard web rojo sí.
- **Rama al día: desactivada** (`strict_required_status_checks_policy: false`, desde 2026-11-04). Antes el PR debía
  probarse contra el `dokploy` actual y, cada vez que otro PR entraba, había que actualizar la rama y repetir todo el CI;
  con PRs de agentes entrando seguido ninguno llegaba a mergear. Con el auto-merge del repo habilitado, un PR entra solo
  cuando `validacion` pasa. Riesgo aceptado: dos PRs verdes por separado podrían romper juntos; lo cubre la suite completa
  de la suite completa que corre al integrar la épica (PR `epic/* → dokploy`) y del e2e nocturno sobre `dokploy`. Para volver atrás: ponerlo en `true` en el ruleset.
- **Bypass de admin** para emergencias. Con `CI_PAUSED=true`, `validacion`
  falla a propósito: mientras el CI está pausado no se mergea.

Esto reemplaza al merge queue: GitHub no expone `merge_queue` por API para este
repo (el ruleset lo rechaza), pero el workflow ya soporta `merge_group`, así que
si se habilita desde la UI/plan no hay que tocar nada.

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[] | "\(.id) \(.name) \(.enforcement)"'
gh api --method DELETE repos/<owner>/<repo>/rulesets/<id>   # desactivar
```

Consecuencia operativa: `gh pr merge --merge` puede fallar con *"head branch is
not up to date"*; en ese caso, actualizar la rama y reintentar. Es intencional:
evita el “verde en su rama, rojo al integrar”.

## Navegadores huérfanos y zombies de los runners (AGE-1311)

Un job de Playwright que falla, se cancela o agota su timeout puede dejar
procesos de Chromium vivos dentro del contenedor del runner. Quedan con PPID 1
(el `entrypoint.mjs`), nadie los mata y se acumulan entre corridas: el 26/10
había 2.260 `chrome-headless` repartidos entre 5 runners y 4.453 zombies en el
host, con load 11 sobre 12 vCPU. Esa saturación hizo que el watchdog viera
`ai-dev-gateway` con timeout aunque el gateway respondiera en loopback.

La corrección tiene tres capas, de la más barata a la red de seguridad:

1. **Limpieza al final de cada job** (`validate.yml`, jobs `application` y
   `web`): un paso con `if: always()` mata los navegadores del propio runner
   después de los tests, también cuando el job falla o se cancela, y deja el
   conteo antes/después en el log. No toca otros runners.
2. **`init: true` en `infra/runner/compose.yaml`**: tini queda como PID 1 y
   cosecha los zombies que dejan los procesos nietos. Sin esto, el `node` del
   entrypoint no los recoge y se acumulan hasta agotar los PIDs.
3. **Janitor** (`scripts/limpiar-ci.mjs` + `ci-janitor.yml`): en cada corrida
   recorre las réplicas del proyecto Compose del runner y mata sólo navegadores
   con más de `CI_RUNNER_BROWSERS_TTL_MIN` minutos (45 por defecto, por encima
   del timeout de 30 min de los jobs). Nunca toca procesos recientes ni otros
   productos de la máquina. Deja una línea por runner con navegadores y zombies
   antes/después, y falla si después de limpiar queda más de
   `CI_RUNNER_BROWSERS_MAX` (5) navegadores por runner. Si quedan más de
   `CI_RUNNER_ZOMBIS_MAX` (20) zombies, avisa: hay que recrear los runners con
   el compose actual para que tini los coseche.

Comandos:

```bash
pnpm ci:limpiar                 # dry-run: lista navegadores y zombies por runner
pnpm ci:limpiar --aplicar       # limpia locks, stacks y navegadores vencidos
node scripts/limpiar-ci.mjs --verificar   # falla si hay más de 5 huérfanos por runner (lo corre el job infrastructure)
CI_RUNNER_BROWSERS_TTL_MIN=60 pnpm ci:limpiar --aplicar
```

Recrear los runners (`pnpm dev:runner`) sólo cuando GitHub Actions no tenga
jobs `in_progress` ni `queued`: corta cualquier job en curso y, como pasó en
AGE-1027, puede perder runs en cola. El reinicio programado se descartó por eso;
la limpieza de fin de job y el janitor resuelven el caso normal sin cortar nada.

**El schedule del janitor sólo corre desde la rama por defecto de GitHub.** Si
`ci-janitor.yml` no está en `main`, el cron no se dispara: al promover esta
corrección hay que asegurarse de que el workflow llegue a la rama por defecto
(o cambiar la rama por defecto del repositorio). Mientras tanto, la limpieza de
fin de cada job en `validate.yml` ya evita que la fuga se acumule.

## El runner no se autoactualiza dentro del contenedor (2026-11-03)

El runner de GitHub se autoactualiza en el sitio: renombra `bin` a
`bin.<version>` y recién **después** deja el `bin` nuevo. Dentro de un contenedor
eso es una ventana peligrosa: si el contenedor se reinicia en medio del swap (host
saturado, OOM, `docker compose up`), `bin` queda ausente y el runner no arranca.

Síntoma exacto (pasó el 2026-11-03, con el host a load 19 sobre 12 vCPU):

- El contenedor `runner-5` queda en `Restarting (1)` para siempre, con el log
  repeating `./config.sh: line 80: ./bin/Runner.Listener: No such file or
  directory`: `config.sh` no encuentra el listener, no se puede deregistrar y
  nunca llega a registrarse.
- En GitHub el runner queda **`offline` + `busy`**: el job que tenía tomado
  (`application`) queda **huérfano para siempre**. El PR espera un CI que nunca
  termina y `mergeable` no lo resuelve.
- El pool pierde una réplica y la cola del CI se agranda: 9 runs en cola, el de
  MSF-223 esperando **2 h 40 min**, y las épicas MSF-192 y MSF-193 trabadas con
  sus historias en `Merging`.

Tres medidas, de la más fuerte a la más débil:

1. **`RUNNER_DISABLE_AUTO_UPDATE=1`** en `infra/runner/compose.yaml`: el runner
   no se autoactualiza en caliente. La versión la fija la imagen
   (`RUNNER_VERSION` del `Dockerfile`), así que se actualiza **reconstruyendo la
   imagen**, no con un swap a mitad de un job.
2. **Autorreparación** (`infra/runner/restaurar-bin.mjs`, usado por
   `entrypoint.mjs`): si `bin` falta pero quedó un respaldo `bin.<version>`,
   se restaura antes de registrar. Cubre los contenedores que ya quedaron
   rotos antes de aplicar (1).
3. **Prueba** (`infra/runner/restaurar-bin.test.mjs`, `pnpm
   test:runner:selfheal`): la heurística del respaldo es determinista y está
   cubierta.

Si vuelve a pasar, el arreglo manual es restaurar el `bin` del contenedor roto
(sin cortar los jobs en curso de los otros runners):

```bash
C=multistorefront-meli-runner-dev-runner-5
docker stop $C
docker cp $C:/home/runner/bin.2.337.0 /tmp/rbin
docker cp /tmp/rbin $C:/home/runner/bin
docker start $C
```

Y hay que borrar el runner **fantasma** que quedó registrado en GitHub sin
contenedor (`offline` + `busy=false`): `gh api -X DELETE
repos/nicolasjones/multistorefront-meli/actions/runners/<id>`.

Para ver el estado real del pool:

```bash
gh api repos/nicolasjones/multistorefront-meli/actions/runners \
  --jq '.runners[] | "\(.name)\t\(.status)\tbusy=\(.busy)"'
```

Un runner `offline` **con** `busy=true` es un job huérfano: ese PR está
esperando un CI que no va a llegar.

## Runners hosted para los jobs pesados (CI_RUNS_ON_PESADO)

Los jobs pesados (`application`, `web`, `e2e-tienda`, `database`) esperaban en cola de 1 a 2 horas porque VPS2 (12 núcleos, carga
cercana a 40) comparte la CPU con dev, los stacks de prueba y las sesiones de Claude. Como el repositorio es **público**, los
runners estándar de GitHub (`ubuntu-latest`, 4 vCPU) no tienen costo ni tope de minutos (hasta 20 jobs simultáneos).

La variable de repo `CI_RUNS_ON_PESADO` decide dónde corren esos cuatro jobs; los livianos (`changes`, `liberar`, `validacion`,
`infrastructure`) siguen en `[self-hosted, platform-local]`:

| Valor | Efecto |
|---|---|
| sin definir | todo en los runners self-hosted (comportamiento histórico) |
| `["ubuntu-latest"]` | los jobs pesados corren en runners hosted gratis, sin cola |

Medición de la prueba (rama `ci/runners-hosted-prueba`, sobre `dokploy`): `database` **5 min 30 s** y `e2e-tienda` **7 min** en
hosted, contra ~22 y ~29 min de ejecución más 1 a 2 horas de cola en VPS2. Para volver atrás basta borrar la variable.

En hosted el Docker es el de la VM, así que los jobs hacen lo siguiente (`if: runner.environment == 'github-hosted'`): instalan
el CLI de Supabase (`supabase/setup-cli`) y `pg_prove`, mapean `host.docker.internal` a `127.0.0.1`, mueven los locks de
ranuras a `$RUNNER_TEMP` y omiten el `puente` de puertos (solo existe para los runners dentro de Docker). Con la admisión por
carriles (`CI_LANES`) conviene subir el valor al pasar a hosted, porque ya no protege la CPU de VPS2.

Cuando una corrida hosted necesita secretos o acceso a la red privada de VPS2, no sirve: esos jobs deben quedar en self-hosted.

## Menos CI y menos rojos: cache y pre-push

- **Cache de pnpm:** los jobs `application`, `e2e-visible-sesion`, `e2e-tienda` y `database` usan `cache: pnpm` en `setup-node`
  (como `web`). En runners hosted cada job parte de una VM limpia y el cache evita reinstalar todo.
- **Verificación local antes de pushear (`pnpm prepush`):** `scripts/pre-push-rapido.mjs` corre solo lo que el diff puede afectar
  (`tsc -b`, `oxlint` y los tests afectados con `vitest --changed` si cambia web; `docs:check` si cambian docs/specs). Así el CI es la
  verificación final y no el primer aviso. Es opt-in: se corre a mano o como hook (`.git/hooks/pre-push` que llame a
  `pnpm prepush`); `SKIP_PREPUSH=1` lo saltea. No se activa por `core.hooksPath` global porque lo compartirían todos los worktrees.
- **Cola de merge:** el workflow ya reacciona a `merge_group`, pero el ruleset `dokploy-integracion-protegida` hoy solo exige el
  check `validacion` y no tiene regla de cola de merge. Activarla cambia el flujo de merge de todas las sesiones (cada PR corre el CI
  completo al integrar), así que es una decisión aparte.

## E2E con sesión (`e2e-visible-sesion`): arranque del stack

El job manual `e2e-visible-sesion` (`workflow_dispatch` con `e2e_sesion`) levanta el Supabase del CI con `kong` y `postgrest`. PostgREST arranca antes de que las migraciones creen el esquema `dominio` y no queda sano hasta que `pnpm db:reset:ci` las aplica, así que `supabase start` falla su chequeo de salud en una ranura sin migraciones. Igual que `e2e-tienda`, el job baja antes el stack de la ranura, arranca con `--ignore-health-check` y reinicia el contenedor de PostgREST después de `db:reset:ci`. Sin esto la corrida moría en «Levantar el stack de Supabase del CI» y ningún E2E con sesión llegaba a ejecutarse (corrida del 2026-11-15).

La API del stack se expone a los specs y al build por `host.docker.internal` (no `127.0.0.1`): el puente de arranque muere al terminar su paso y, dentro del contenedor del runner, `127.0.0.1` es el propio contenedor. Antes de eso el único test con sesión (`permisos-por-empresa.e2e.ts`) fallaba con `ECONNREFUSED 127.0.0.1:29300`.

Para elegir qué specs corre el job manual `e2e-visible-sesion`, el workflow tiene el input `e2e_archivos` (nombres de archivo de `apps/web/e2e` separados por espacio; por defecto `permisos-por-empresa.e2e.ts`): `gh workflow run validate.yml --ref <rama> -f e2e_sesion=true -f "e2e_archivos=inicio.e2e.ts clientes-recorrido.e2e.ts"`. Antes el archivo estaba fijo en el workflow y el input `e2e_grep` («vacío = toda la suite») solo filtraba dentro de ese único spec.
