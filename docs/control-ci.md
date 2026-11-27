---
owner: plataforma
sources:
  - infra/runner
  - scripts/ci-lane.mjs
  - scripts/estado-ci.mjs
  - scripts/gate-integracion.mjs
  - scripts/limpiar-ci.mjs
  - scripts/verificar-workflows.mjs
  - scripts/verificar-inventario-suites.mjs
  - scripts/migraciones-reversion.mjs
  - scripts/verificar-validacion.mjs
  - .github/workflows/validate.yml
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
| **Límite de procesos** | Un fork-bomb o un chrome-headless que deja zombis no agota los PIDs del host | `RUNNER_PIDS_LIMIT` (`deploy.resources.limits.pids` en `infra/runner/compose.yaml`) |
| **Integración protegida** | PR probado contra el `dokploy` actual | ruleset `dokploy-integracion-protegida` + `merge_group` |
| **Estado del gate** | Lee el gate real de merge (rulesets) y da el veredicto | `scripts/gate-integracion.mjs` (`pnpm ci:gate`) |
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
`RUNNER_MEMORY_LIMIT`, `RUNNER_CPU_LIMIT`, `RUNNER_PIDS_LIMIT` (ver `.env.example`). Subir
`RUNNER_REPLICAS` **sólo** después de tener CPU libre: con 12 vCPU y el load ya
alto, más réplicas reparten el mismo CPU.

`RUNNER_PIDS_LIMIT` (default `4096`, `-1` = sin tope) acota los procesos de cada réplica
(`deploy.resources.limits.pids` en `infra/runner/compose.yaml`): `init: true` cosecha los zombis, pero no frena un fork-bomb ni un
chrome-headless que no cierra sus hijos. **Acción de Nicolás en el VPS:** el cambio del repo no toca los runners en marcha; surte efecto
al recrearlos (`docker compose up -d --force-recreate` en `infra/runner`). Verificar con
`docker inspect --format '{{.HostConfig.PidsLimit}}' <contenedor>` (esperado `4096`).

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
- **Un PR quedó `BEHIND` y el job `chequeos` falla por el guard de migraciones:** el
  guard juzga sólo las migraciones que la rama agregó o modificó desde el punto de
  divergencia con la base (MSF-749), así que un rojo por «versión duplicada», «REUSADA» o
  «MODIFICADA» de una migración que la rama heredó ya no corresponde a ese PR. Si el log
  dice «la base `origin/dokploy` renumeró N migración(es) que tu rama heredó», actualizá la
  rama (merge de la base en la rama del PR) antes de mergear: si no, la migración vieja y
  la renumerada conviven al integrar.
- **Un PR quedó `BEHIND` y el merge falla con «head branch is not up to date»:** corré
  `pnpm ci:gate -- --pr <n>` para ver el gate real de la base. Si «rama al día» está
  desactivada (el estado actual), ese rechazo no viene del gate: no resincronices la
  rama a ciegas (eso reinicia el CI y vuelve a dejar la rama atrás).

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

### Acceso por ítem de menú (MSF-688, lote 58)

`can()` de Refine corre por ítem de menú y acción; `lib/superadmin.ts` comparte una promesa por usuario (TTL corto, igual que
los permisos por sección) para el usuario de Auth y para el resultado de superadmin, y la descarta con cualquier evento de
`onAuthStateChange`. Regla: un error de la consulta a `superadmins` o a Auth deniega (nunca concede superadmin) y no se cachea,
así un fallo transitorio no queda fijado. La organización activa no se cachea: cambia al entrar o salir de soporte. Un `false` también se cachea el mismo TTL: quien acaba de ser promovido a superadmin ve denegado hasta que vence o cambia la sesión; la revocación se ve igual con ese retraso en la UI, y RLS decide en el servidor.

### Decisiones pendientes del lote 26 (no se tocaron a propósito)

- **`Validate` en `push` a `dokploy` (MSF-685).** Hoy no corre (`push: branches: [main, staging]`); la documentación lo afirmaba y
  se corrigió. Encenderlo haría correr web (~10 min repartidos en shards), build, e2e y `database` en CADA merge a `dokploy` (varios
  por día) sobre los runners, con el riesgo de rojos por la cola compartida del stack de Supabase. Alternativas: (a) agregar
  `dokploy` a `push.branches` (cobertura total, costo alto); (b) mantener el e2e nocturno (`e2e-nocturno.yml`) como red de seguridad
  (ya existe, costo nulo en el camino del PR). Se recomienda (b) más la cola de merge (`merge_group`, ya soportado por el workflow)
  si se quiere validar el resultado integrado (no verificado si el repo tiene merge queue o ruleset activos: no se pudo consultar
  la API de rulesets). **Resuelto en el lote 36:** decisión de Nicolás = no encenderlo en cada push; corrida diaria (ver abajo, MSF-685).
- **Qué tests corre el CI y cuáles deja fuera (MSF-679).** Los de Node y Python puros que no necesitan base, red ni credenciales
  corren en el job `chequeos` por dos caminos. `test:ci:scripts` suma tooling, workers (`discover`, `scan`, `idempotency`, `audit`), el
  contrato estático de Kestra (`test:kestra:runtime`), el despachador programado y la frontera de outbox. `test:ci:suites-baratas` suma
  el resto: edge sin red ni base, validadores de flows de Kestra, monitoreo, DER, manifiesto e importaciones de docs, cobertura y
  videos de e2e, y las suites de Python. Regla: una suite `test:*` entra al CI si es determinista y no necesita servicios, docker ni
  credenciales, y se suma a uno de esos dos scripts en vez de quedar suelta; sin esa regla las suites nuevas se acumulan sin que
  nadie las corra. Ambos runners ejecutan todas las suites y fallan al final con un resumen; cada suite tiene su timeout
  (600 s por defecto) y el job su `timeout-minutes`, que manda: varias suites colgadas a la vez pueden agotar el job antes de que cada una venza.
  `test:outbox:frontera` fallaba por un falso positivo: la palabra «webhook» dentro de un `comment on ... is '...'`.
  El guard ahora recorre el SQL de una pasada (literales `'...'`, identificadores, dollar-quoting, comentarios `--` y
  `/* */` anidables): descarta comentarios, evalúa todo lo demás (incluido SQL dinámico y `do $$`) e ignora únicamente el
  literal de una sentencia que empieza con `comment on ... is`. Un literal o comentario sin cerrar falla cerrado. El recorrido es lineal (un archivo adversarial con cientos de miles de literales no cuelga el job) y no guarda estado entre llamadas. Un
  regex sobre texto crudo no sirve: un comentario o un literal puede simular el inicio de un `comment on` y esconder una
  llamada saliente real.
  Quedan fuera a propósito, cada grupo por su motivo:
  - `template:capabilities:check` compara contra `origin/main`, que el job no garantiza.
  - `test:ia:aprovisionamiento` usa `docker`, que no hay en el job.
  - `test:superset:embebido` y `test:superset:aislamiento-tokens` exigen un Superset y credenciales vivas.
  - `test:db`, `test:acceso:e2e`, `test:auth:hook-bloqueo:e2e`, `test:kestra:secretos:e2e`, `test:kestra:evidencia:e2e`,
    `test:kestra:reintentos:e2e` y `test:kestra:conexion-trabada:e2e` necesitan Supabase o Kestra levantados.
  - `test:web` y `test:e2e` ya corren con vitest y playwright en sus propios jobs; `test:e2e:headed` (corre con navegador visible),
    `test:e2e:report` (abre el reporte HTML y queda esperando), `test:e2e:trace` (abre el visor de trazas), `test:e2e:codegen` (graba acciones en un navegador
    abierto) y `test:e2e:storage` (graba el estado de sesión en `auth.json`) son herramientas interactivas de depuración local: necesitan
    una persona frente a la pantalla y no verifican nada; `test:e2e:ui` abre la interfaz
    interactiva de Playwright, `test:e2e:record` graba video y traza para revisar a mano y `test:e2e:evidencia` corre con navegador visible
    para capturar evidencia: ninguna de las tres está en los scripts del CI.
  - `test:historia:item` y `test:tracker:duplicados` corren dentro de `test:tooling` (mismo archivo); no se repiten.
  - `test:afectados` es un selector que corre otros tests según el diff, no una suite propia.
- **`release-please` y migraciones a staging cloud (MSF-680).** Ramas `main`, credenciales y flujo de promoción STG/PRD: no se
  tocan acá. Propuesta (no verificado: el diagnóstico sale del texto del ítem, no se revisaron los logs ni los ajustes del repo):
  habilitar «Allow GitHub Actions to create and approve pull requests» en Settings → Actions, o pasar `token:` de un PAT/GitHub App
  a `release-please-action` (secret nuevo); revisar el secret `SUPABASE_DB_URL` del Environment `staging` y su puerto (según el
  ítem, el destino rechazaba conexiones) y agregar una alerta cuando falle el job `staging`.
- **Gates eludibles (MSF-688 y MSF-869, cerrados en el lote 96 salvo lo de GitHub).**
  - `verificar-documentacion-cambios.mjs`: la correspondencia código→doc (`sources:` de cada doc) ahora es **error en todo PR**
    (`validate.yml`, job `chequeos`, `DOCUMENTACION_CORRESPONDENCIA_ESTRICTA=1` solo en `pull_request`). Antes quedaba en aviso desde el
    lote 88. Se redujo el ruido estructural y hay una excepción auditable (`Docs-no-aplica: <motivo>` en un commit): detalle y cifras
    en `docs/documentacion-cambios.md`.
  - `validar-migraciones-aditivas.mjs` (verificado en el árbol, ya estaba hecho): detecta además `DROP SCHEMA`, `DROP FUNCTION` y
    `DELETE FROM` sin `WHERE`; el marcador de reversión exige la palabra «Reversión» completa (no «reversible»), sin negar y con
    contenido. `DROP CONSTRAINT` no se marca a propósito (falso positivo comprobado: redefinir un check es seguro). Límites en
    `scripts/migraciones-reversion.mjs`.
  - `accessControlProvider`/`superadmin.ts` (llamadas de red por ítem de menú): atendido en «Acceso por ítem de menú (MSF-688, lote 58)».
  - **De Nicolás, no resolubles desde el repo** (ajustes de GitHub; recomendaciones, no se pudo consultar el ruleset): que el ruleset de `dokploy` siga exigiendo `validacion` (que ya
    agrega `chequeos`, donde corre el estricto); no permitir saltar el ruleset con «bypass» a los administradores si se quiere que el
    estricto también los alcance; y no marcar como requerido ningún check que dependa del filtro de rutas.
- **Inventario de suites contra el CI (MSF-679, lote 96).** `scripts/verificar-inventario-suites.mjs` (`pnpm test:suites:inventario`,
  corre en `test:ci:scripts`) falla si una suite `test:*` de `package.json` o un archivo de test (`scripts/`, `supabase/functions/`,
  `infra/`, `workers/`, `packages/`) no lo ejecuta ningún workflow, salvo que figure en su tabla `EXCLUIDAS` con el motivo; también
  falla si una exclusión quedó vieja (la suite ya corre o ya no existe) o si esta sección no la nombra. «Corre en el CI» es
  alcanzable desde el texto de los workflows siguiendo `pnpm <script>`. Primer barrido: estaban sin correr los tests de los cinco
  workers (`pnpm test:workers:unit`, ~15 s, vitest sin servicios), `supabase/functions/_shared/log-seguro.test.ts` (ahora en
  `test:edge:compartido-ia`) y `scripts/prototipo-inventario.test.mjs` (ahora en `test:prototipo:inventario`). Lo caro o con servicios
  sigue fuera, con el motivo en la lista de abajo. El test del inventario (`test:suites:inventario:unit`) fija sus fronteras.

## Cambios de CI de la auditoría MSF-647 (lote 36)

Lote 36 (infraestructura como código, CI y Kestra). Cada ítem dice si se hizo, si ya estaba o si necesita una acción de Nicolás.

- **MSF-685 · `Validate` diario sobre `dokploy` (decisión tomada: NO en cada push).** `Validate` sigue sin correr en cada push a
  `dokploy`; el gate por PR queda igual. Se agrega `.github/workflows/validate-diario.yml`: una vez por día (06:23 UTC) **dispara**
  `Validate` completo con `workflow_dispatch` sobre `--ref dokploy` (`e2e_record=false`). Se dispara en vez de agregar `schedule` a
  `validate.yml` porque `schedule` solo corre desde la rama por defecto (`main`) y queremos validar `dokploy` con SU versión del
  workflow. El resultado se mira en Actions → Validate → rama `dokploy` (check `validacion`); si queda rojo, se arregla antes de
  promover. La primera corrida ocurre cuando el archivo llegue a `main`; antes se puede probar con «Run workflow».
- **MSF-904 · `application` paralelizado.** Era una cadena serial de ~14 pasos. Los chequeos estáticos y las suites de Node puro
  (`docs:check`, tests de docs, guards de migraciones, `test:ci:scripts`, estilos, matriz, prototipo, `lint`) pasaron al job nuevo
  **`chequeos`**, que corre en paralelo con `application` (build, tests con `needs.changes`, e2e). Cada paso vive en exactamente uno
  de los dos jobs y los dos cuentan para `validacion` y `liberar`: no se perdió ningún check. Además la instalación de Chromium
  (`playwright install`, la parte más lenta del e2e) arranca en segundo plano mientras se compila y un paso `esperar playwright
  install` la espera y falla si terminó con error (código de salida en `$RUNNER_TEMP/playwright-install.rc`). El caché de
  `~/.cache/ms-playwright` y las dependencias del SO se mantienen como antes.
- **MSF-901 · `validacion` y la matriz `web`.** `web` ahora corre con `fail-fast: false`: un shard rojo ya no cancela a los otros dos
  (antes `validacion` veía jobs `cancelled` mezclados con la falla real). La lógica de `validacion` salió del YAML a
  `scripts/verificar-validacion.mjs` (con tests, `pnpm test:ci`): `failure` falla siempre y se informa primero; un `cancelled` sin
  ninguna falla falla con un mensaje propio («la corrida no cuenta como validada: volvé a correrla»); `e2e-tienda` es no bloqueante
  mientras `E2E_TIENDA_BLOQUEA` no sea `true` también cuando termina `cancelled` (su `continue-on-error` solo cubría `failure`); un
  job que no figura en `needs` no se da por bueno. Un PR de un fork nunca hace checkout ni ejecuta su código en este job.
- **MSF-925 · acciones pineadas por SHA.** Las acciones de GitHub (`checkout`, `setup-node`, `pnpm/action-setup`, `cache`,
  `upload-artifact`, `setup-python`, `supabase/setup-cli`, `release-please-action`) van por SHA completo de commit con el tag en un
  comentario (`@<sha> # v4`). Los SHA se resolvieron con `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (y, si el tag es anotado,
  con `git/tags/<sha>`; `supabase/setup-cli@v1` es una rama y se resolvió a `v1.7.3`, que es el comentario). Para subir una versión: resolver el SHA nuevo
  y cambiar los dos valores. `pnpm workflows:check` (`scripts/verificar-workflows.mjs`, en `chequeos` y en `test:ci`) falla si
  aparece una acción por tag o un SHA sin comentario.
- **MSF-926 · `timeout-minutes` en todos los jobs.** Los 8 workflows que no lo tenían ahora lo declaran en cada job que corre pasos
  (deploy de infraestructura 30, migraciones 20, docs 45, nightly 45, publicar flows 15, quality 20, release-please 15,
  worker-images 60; valores por encima del máximo observado con `gh run list`, salvo corridas con cola de runner). Los jobs que solo
  llaman a un workflow reutilizable (`promover-todo-a-produccion`) no admiten la clave. Lo verifica `pnpm workflows:check`.
- **MSF-928 · los tests omitidos no pasan en verde por omisión.** `scripts/verificar-e2e-omitidos.mjs` suma `--requeridos=a,b`: falla
  si algún test de esos specs se omitió o si el spec no aparece en el reporte, y escribe en el resumen del job cuántos tests corrieron
  y cuántos se omitieron por archivo. El job `application` lo corre con los dos specs públicos (`acceso-publico` y
  `recorrido-publico`, `--max=0`). **Ya estaba:** `e2e-tienda` (`--max=1`) y el nocturno (falla si más de la mitad se omite y lista
  los omitidos por archivo). Los 26 tests con sesión se siguen saltando sin stack en las corridas sin base, a propósito: no se pueden
  exigir donde no hay Supabase; los cubre `e2e-visible-sesion`/nocturno.
- **MSF-929 · `quality` y el store de pnpm.** `.gitleaks.toml` excluye por ruta `.pnpm-store/`, `node_modules/`,
  `.local/share/pnpm/` y `.cache/pnpm/` (código de terceros descargado, con claves de ejemplo de sus propios tests). **No** se exime
  ninguna carpeta del repo: un secreto en `apps/`, `packages/`, `supabase/`, etc. se sigue detectando (test en
  `scripts/calidad.test.mjs`, necesita el binario `gitleaks`; se saltea si no está).
- **MSF-706 · clave de host del VPS fijada.** El deploy ya no usa `ssh-keyscan`; `scripts/preparar-known-hosts-vps.mjs` toma la
  clave pública del host del secret `VPS_SSH_KNOWN_HOSTS` (o de `infra/vps/known_hosts.<entorno>`, que hoy no existe: `infra/vps/` no se creó), la valida (un solo host, sin
  comodines ni marcadores) y configura SSH con `StrictHostKeyChecking=yes` y ese único archivo. **Sin clave fijada el job falla** con
  instrucciones. En `dev` solo advierte (modo transicional); en staging/production necesita acción de Nicolás antes del próximo deploy: ver `docs/deployment.md`, «Clave de host del VPS».
- **MSF-674 · gate de promoción `stg → prd`.** `scripts/verificar-staging-exitoso.mjs` exigía un run exitoso de `staging` **para el
  mismo SHA**, pero `staging` dispara por `paths`: un commit que no toca esos archivos nunca genera run y `promover-todo-a-produccion`
  fallaba casi siempre. Ahora valida lo que corresponde: (1) run exitoso para el mismo SHA → autoriza; (2) si no, el run exitoso más
  reciente cuyo SHA sea **ancestro** del que se promueve y **ningún archivo de `on.push.paths` del workflow** (se lee del propio
  archivo) cambió desde entonces → autoriza («staging ya validó el último estado relevante»); (3) cambios relevantes posteriores,
  comparación truncada (≥ 300 archivos o más commits que los listados) o ningún ancestro → rechaza y nombra los archivos. Decisión
  de proceso (documentada en `docs/deployment.md`): **STG va un paso adelante de PRD y se sincroniza STG con `dokploy` ANTES de
  promover**. No se promovió nada ni se tocó ningún secret.
- **MSF-916 · dependencias con avisos HIGH.** `pnpm audit --prod` bajó de 12 a 0 avisos de severidad alta con overrides en
  `pnpm-workspace.yaml` con versiones EXACTAS (`axios` 1.20.0, `follow-redirects` 1.16.2, `body-parser` 2.4.0, `zod` 4.6.6; todas con más de dos semanas
  de publicadas al 2026-11-17). Verificado: `pnpm test:ia` (incluye `@platform/mcp-server`), `tsc -b` y el build de `apps/web`; no existen tests de nango (su único consumidor es `providers/nango/index.ts`). Quedan 3 bajos y 10 moderados.

**Modo transicional por entorno (MSF-705/706/712).** Los tres controles que fallan cerrado (credenciales obligatorias, imágenes de workers
inmutables y clave de host fijada) bloquean siempre en `staging` y `production`; en `dev` solo **advierten** (mensaje con la lista exacta de lo que
falta) hasta que se cargue todo y se active `VPS_ESTRICTO=1`. Así un faltante no frena el despliegue de todo lo que se mergea a `dokploy`. Los
despliegues del VPS (`deploy-infraestructura-vps.yml`) corren en push a `main` (staging) y a mano (production), no en `dokploy`. Procedimiento
para pasar dev a estricto: `docs/deployment.md`, «Pasar dev a modo estricto». Cubierto por `scripts/deploy-vps.test.mjs` y
`scripts/preparar-known-hosts-vps.test.mjs`.

### Pendientes del lote 36 que necesitan acción de Nicolás (no son código del repo)

Propuestas exactas; ninguna se aplicó.

- **MSF-755 · cola de merge del ruleset `dokploy-integracion-protegida`.** Activar la regla «Merge queue» del ruleset
  (`dokploy-integracion-protegida`, id `25358575`): es la alternativa a exigir «rama al día» y la única que no deja la ventana de dos
  PRs verdes por separado. GitHub no expone `merge_queue` por API para este repo, así que se activa desde la UI
  (Settings → Rules → Rulesets → `dokploy-integracion-protegida` → «Merge queue»). El repo no se toca: `validate.yml` ya tiene el
  trigger `merge_group`. Para ver el estado antes y después: `pnpm ci:gate`.

- **MSF-648 · puertos publicados a Internet (Postgres, Studio, Kong, Inbucket, Dokploy).** Acción en el servidor: (1) en el firewall del
  VPS (`ufw`/grupo de seguridad) permitir entrada solo a 22, 80 y 443 y a la red de Tailscale; (2) en Dokploy, quitar los «Published
  Ports» de los servicios de Supabase y publicar solo por Traefik con TLS; (3) enlazar los puertos que deban quedar en el host a
  `127.0.0.1` o a la IP de Tailscale (`127.0.0.1:PUERTO:PUERTO`); (4) el panel de Dokploy detrás de Tailscale o con acceso por IP.
  Verificar desde fuera de la VPN con `nmap -Pn <ip-publica>`: solo 22/80/443.
- **MSF-649 · secreto JWT / contraseña por defecto del DEV vivo.** Acción: generar un `JWT_SECRET` nuevo (≥ 32 bytes aleatorios) y
  contraseñas nuevas de Postgres/dashboard, regenerar `ANON_KEY` y `SERVICE_ROLE_KEY` firmadas con el secreto nuevo, cargarlas en
  Dokploy (nunca en git) y reiniciar el stack; luego rotar los secrets del Environment que las usen (`SUPABASE_SERVICE_ROLE_KEY`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`) y los de las Edge Functions. Todas las sesiones activas se invalidan.
- **MSF-703 / MSF-704 · runners self-hosted con root y `docker.sock` en un repo público, y store de pnpm compartido.** Propuesta:
  (1) pasar el repo a privado o, si debe ser público, **no correr PRs de forks** en self-hosted (ya se rechazan en `validacion`; agregar en
  Settings → Actions → General «Require approval for all outside collaborators»); (2) usar runners efímeros (`--ephemeral`) sin el socket
  del host (Docker rootless o `sysbox`) y con usuario no root; (3) un store de pnpm por runner o de solo lectura para los jobs de PR
  (hoy `infra/runner/compose.yaml` comparte `pnpm-store` entre réplicas y repos), para que un PR no pueda envenenar paquetes de otro job.
  Es un cambio de infraestructura que rompe el CI actual si se aplica a medias: planificarlo con una ventana.
- **MSF-680 · `release-please` y la rama `main`.** Solo documentación: ver «Decisiones pendientes del lote 26» (habilitar «Allow
  GitHub Actions to create and approve pull requests» o pasar `token:` de un PAT/GitHub App a `release-please-action`; revisar el
  secret `SUPABASE_DB_URL` del Environment `staging`; alerta cuando falle el job `staging`). Con el gate de MSF-674 ya no hace falta
  un run de staging por cada SHA para promover.
- **MSF-706 · secret `VPS_SSH_KNOWN_HOSTS`** (o, creando `infra/vps/`, versionar `known_hosts.<entorno>`: hoy no existe): obtener la línea del host por un canal
  de confianza (consola del proveedor o `ssh-keygen -lf` contra la huella publicada) y cargarla; ver `docs/deployment.md`.
- **MSF-705 · variables obligatorias en el VPS.** Antes de mergear a `main` o promover, comprobar que `VPS_DEPLOY_ENV` de staging y
  producción trae las 14 credenciales nuevas (`KESTRA_*`, `SUPERSET_*`, `NANGO_*`) y las 5 `*_IMAGEN` de workers por digest (MSF-712);
  el preflight del deploy lo reclama con un mensaje que nombra cada una.
- **MSF-903 · tope de ramas con CI en vuelo del orquestador (`CI_RANAS_MAXIMAS`).** Son dos ámbitos distintos:
  `CI_LANES` y `CI_LOAD_MAX` son **variables de repo** de este producto que lee `scripts/ci-lane.mjs` (admisión por
  carriles y cortacircuitos por carga del CI); `CI_RANAS_MAXIMAS` es una variable de entorno del **orquestador**
  (`/opt/ai-dev-orchestrator/.env`, `packages/core/ci.js`) que sólo cuenta sus runners self-hosted. El `.env` de VPS2 no
  la define, así que el poller usa el default **2** (`RAMAS_CI_MAXIMAS_POR_DEFECTO`) y frena ítems nuevos con
  «el CI del repo está saturado: N rama(s) con CI en vuelo (límite 2)» aunque hoy el repo tiene `CI_LANES=15` y **5**
  runners self-hosted online (`gh variable list` y `gh api .../actions/runners`, 2026-11-20). El tope efectivo es
  `min(CI_RANAS_MAXIMAS, runners online)`; con los jobs pesados en `ubuntu-latest` (`CI_RUNS_ON_PESADO`), los
  self-hosted sólo atienden los livianos (`changes`, `liberar`, `validacion`, `infrastructure`).
  **Este cambio NO resuelve `CI_RANAS_MAXIMAS`**: sólo documenta el diagnóstico. **Acción de Nicolás (pendiente, fuera del
  repo):** editar `/opt/ai-dev-orchestrator/.env` y reiniciar el gateway. Hasta que lo haga, el tope sigue en 2.
  Acción en el servidor: agregar `CI_RANAS_MAXIMAS=4` al `/opt/ai-dev-orchestrator/.env` y **reiniciar**
  `systemctl restart ai-dev-gateway` (el `.env` se lee al arrancar); el tope efectivo pasa a `min(4, 5) = 4`.
  Criterio del 4 (no 5): deja un runner self-hosted de holgura para `liberar`, que también necesita runner, sin volver
  al cuello de 2. No se toca `CI_LANES` (15) ni `CI_LOAD_MAX` (2.5, variable de repo del producto). Como
  `CI_RANAS_MAXIMAS` no está en el `.env.example` del repo `ai-dev-orchestrator`, un nodo nuevo vuelve al default 2:
  hay que agregarla a ese `.env.example` (cambio en ese repo; el `.env.example` de este repo es el de la app y no lleva la variable: propuesto en el PR nicolasjones/ai-dev-orchestrator#876, lote 44, a la espera de su merge) para que el valor no dependa de este servidor. El modelo
  de capacidad del orquestador sigue contando sólo runners self-hosted cuando los jobs pesados ya corren en hosted:
  revisarlo es deuda aparte, no de este cambio. Verificación: `grep CI_RANAS_MAXIMAS /opt/ai-dev-orchestrator/.env` y,
  tras el reinicio, que el poller admita hasta 4 ramas en vuelo (deja de frenar con «límite 2»).
- **MSF-902 · PRs abiertos en conflicto: procedimiento (no se cerró ningún PR).** (1) Listar: `gh pr list --state open --json
  number,title,headRefName,mergeable,updatedAt --jq '.[] | select(.mergeable=="CONFLICTING")'`. (2) Por cada uno: avisar al
  responsable y, si la rama es de un agente/SDLC, correr `git fetch origin && git merge origin/dokploy` en un worktree propio (en
  conflictos de `docs/manifest.json` y `docs/_generated/*` quedarse con `--theirs` y regenerar con `pnpm docs:wiki:check`; renumerar
  migraciones con el skill `desarrollo-manual`), empujar y esperar el CI. (3) Si la rama lleva más de 14 días sin actividad y el
  conflicto toca archivos que `dokploy` ya cambió a fondo, dejar un comentario con el diff de conflictos y pedir decisión de Nicolás:
  rebasar, rehacer o cerrar. No cerrar PRs automáticamente: cada cierre es una decisión de Nicolás.

## Integración protegida de `dokploy`

`dokploy` tiene un **ruleset activo** (`dokploy-integracion-protegida`, id `25358575`) con:

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

Esto reemplaza a la cola de merge; si se activa más adelante, el procedimiento y el motivo están una sola vez en «Pendientes del lote 36 que
necesitan acción de Nicolás» (MSF-755), arriba.

### El gate se lee por rulesets, no por `/branches/<rama>/protection` (MSF-755)

`GET /repos/<owner>/<repo>/branches/dokploy/protection` devuelve **404 «Branch not
protected»** aunque el ruleset esté activo: ese endpoint es el de la *branch
protection* clásica y no ve los rulesets. Tomar ese 404 por «no hay protección»
es lo que produce el ciclo infinito de `BEHIND`: se concluye que se puede
mergear aunque la rama no esté al día, el merge falla con *«head branch is not up
to date»*, se resincroniza la rama, el CI vuelve a arrancar y, si la base avanza
más rápido que el CI, la rama queda atrás otra vez.

El estado real se lee por la API de rulesets:

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[] | "\(.id) \(.name) \(.enforcement)"'
gh api repos/<owner>/<repo>/rulesets/25358575 --jq '.rules[] | {type, parameters}'
gh api --method PUT repos/<owner>/<repo>/rulesets/<id> -f enforcement=disabled   # desactivar (DELETE lo borra)
```

El repo trae el diagnóstico que ya consulta el endpoint correcto, avisa de la
trampa del 404 y da el veredicto (sólo lectura; sale con código 1 si el merge
está bloqueado):

```bash
pnpm ci:gate                 # estado del gate de «dokploy»
pnpm ci:gate -- --pr 1234    # además: cuántos commits está atrás la rama del PR
```

Opciones: `--base <rama>` informa el gate de otra rama (por defecto `dokploy`, la
rama de integración; `GITHUB_BASE_REF` **no** se usa a propósito, porque en un
job de CI de un PR a `main` apuntaría al gate de `main`, que no es el de
integración), `--repo <owner/nombre>` elige el repo (por defecto
`GITHUB_REPOSITORY` o el del repo) y `--json` imprime el informe en JSON.

Códigos de salida: `0` = el merge no se rechaza por desfasaje · `1` =
**BLOQUEADO** (el gate exige «rama al día» y la rama del PR está atrás) · `2` =
no se pudo determinar el veredicto (no se pudo leer el gate, el PR ni la
comparación). En el `2` el script **falla en voz alta** en vez de informar «no
hay gate»: un diagnóstico a medias es peor que no tener diagnóstico.

El diagnóstico lee **las dos** capas del gate: los rulesets y la protección
clásica de la rama (`/branches/<rama>/protection`). Según GitHub, ambas se
acumulan y se exigen todas las reglas aplicables, así que un **200** en el
endpoint clásico también es un gate; un 404 sólo dice «no hay protección
clásica», no «no hay gate». Los `include`/`exclude` de `conditions.ref_name` se
interpretan como patrones fnmatch —los de GitHub (`File.fnmatch` con
`FNM_PATHNAME`): `*` no cruza `/`, `?` matchea un carácter, `[]` es un juego de
caracteres, `**/` matchea cero o más niveles de directorio y un `**` suelto
equivale a `*`— y no como nombres exactos. Respetan los dos límites que GitHub
documenta: `^` no complementa un juego (sólo `!`; en `[^0-9]` el `^` es un
miembro más) y `\` no es carácter de citación (es literal dentro y fuera de
`[]`, y un patrón terminado en `\` no aborta). Y si algo no se puede leer (el
detalle de un ruleset, la protección clásica) o si un patrón no se puede
interpretar, el script **falla** en vez de informar «no hay gate»: un falso
verde en el diagnóstico es peor que no tener diagnóstico.

### Consecuencia operativa

Con «rama al día» **desactivada** (el estado actual), `gh pr merge --merge` no
se rechaza por desfasaje: un PR que quedó atrás mergea igual, con `validacion`
en verde. Si el merge falla con *«head branch is not up to date»*, primero mirá
el gate con `pnpm ci:gate`: si «rama al día» está desactivada, ese error no viene
del gate y hay que buscar la causa real; **resincronizar la rama a ciegas
reinicia el CI y vuelve a dejar la rama atrás**.

Si «rama al día» vuelve a activarse (`strict_required_status_checks_policy: true`),
el merge se rechaza mientras la rama esté atrás y actualizar la rama reinicia el
CI: con la base avanzando más rápido que el CI, ese ciclo no termina. Las dos
salidas son desactivar «rama al día» o activar la cola de merge (decisión de
Nicolás, ver «Pendientes del lote 36 que necesitan acción de Nicolás»).

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

**Lote 36 (MSF-736).** `init: true` (tini como PID 1) ya estaba en el `runner` y en `playwright`; faltaba en los contenedores que lanzan
Chromium por otro camino. Ahora todo `docker run` de un worker (7 flows de despacho de Kestra) lleva `--init` y
`--pids-limit "${WORKER_PIDS:-1024}"` (tope de procesos: un worker no puede agotar los PID del servidor), y `kestra`, `superset` y
`nango-server` también tienen `init: true`. Lo verifica `infra/kestra/validar-robustez-flows.test.mjs` y
`infra/kestra/validar-workers-runtime.mjs`. Los zombis que ya existen en los runners se limpian recreándolos con el compose actual
(`docker compose -f infra/runner/compose.yaml up -d --force-recreate`, **acción de Nicolás** en el host; el `limpiar-ci` los cuenta
pero no puede matar un zombi: solo el PID 1 los cosecha).

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
  completo al integrar), así que sigue siendo decisión de Nicolás (MSF-755): el procedimiento exacto y el estado están en
  «Pendientes del lote 36 que necesitan acción de Nicolás», arriba. El repo no se toca: `validate.yml` ya tiene el trigger `merge_group`.

## E2E con sesión (`e2e-visible-sesion`): arranque del stack

El job manual `e2e-visible-sesion` (`workflow_dispatch` con `e2e_sesion`) levanta el Supabase del CI con `kong` y `postgrest`. PostgREST arranca antes de que las migraciones creen el esquema `dominio` y no queda sano hasta que `pnpm db:reset:ci` las aplica, así que `supabase start` falla su chequeo de salud en una ranura sin migraciones. Igual que `e2e-tienda`, el job baja antes el stack de la ranura, arranca con `--ignore-health-check` y reinicia el contenedor de PostgREST después de `db:reset:ci`. Sin esto la corrida moría en «Levantar el stack de Supabase del CI» y ningún E2E con sesión llegaba a ejecutarse (corrida del 2026-11-15).

La API del stack se expone a los specs y al build por `host.docker.internal` (no `127.0.0.1`): el puente de arranque muere al terminar su paso y, dentro del contenedor del runner, `127.0.0.1` es el propio contenedor. Antes de eso el único test con sesión (`permisos-por-empresa.e2e.ts`) fallaba con `ECONNREFUSED 127.0.0.1:29300`.

Para elegir qué specs corre el job manual `e2e-visible-sesion`, el workflow tiene el input `e2e_archivos` (nombres de archivo de `apps/web/e2e` separados por espacio; por defecto `permisos-por-empresa.e2e.ts`): `gh workflow run validate.yml --ref <rama> -f e2e_sesion=true -f "e2e_archivos=inicio.e2e.ts clientes-recorrido.e2e.ts"`. Antes el archivo estaba fijo en el workflow y el input `e2e_grep` («vacío = toda la suite») solo filtraba dentro de ese único spec.
