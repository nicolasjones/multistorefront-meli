# Bug Assessment: el job `database` del CI resetea el Supabase de desarrollo

- **Slug**: ci-supabase-desarrollo-compartido
- **Created**: 2026-09-25
- **Source**: pasted text (diagnóstico del coordinador, verificado en el repo y en el Docker del host)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> El job database de `.github/workflows/validate.yml` usa el Supabase de
> DESARROLLO de la máquina en vez de un stack propio. […] `supabase start` (si
> el stack con ese project_id ya corre, no hace nada) y después `pnpm
> db:reset:ci`, que dropea `public`/`private` y reaplica migraciones y seed en
> `host.docker.internal` con `SUPABASE_DB_PORT`, por defecto 5434. […] En esta
> máquina, 5434 es el Supabase local de DESARROLLO del template. El producto
> estudio-contable-automation tiene su stack de desarrollo en 6434, con datos
> reales, y su CI es copia de este: cada PR del producto también borra la base
> de desarrollo del template. […] Hoy mismo esto le rompió al agente del
> worktree observabilidad-plataforma su corrida E2E real a mitad de camino.

## Symptom

Cada corrida del job `database` (del template **y** del producto derivado,
que copió el workflow) borra `public`/`private` de la base de desarrollo del
template (`127.0.0.1:5434`) y resiembra el seed; lo que un desarrollador o
agente tenía cargado allí desaparece a mitad de trabajo. Lo esperado: el CI
levanta y usa un stack propio y descartable, y nunca puede apuntar a un stack
de desarrollo.

## Reproduction

1. Con el stack de desarrollo del template corriendo (`pnpm dev:supabase`,
   contenedor `supabase_db_automation-platform-template-supabase-de`, puerto
   5434), crear una fila o tabla en `public`.
2. Abrir un PR (en el template o en el producto): el runner self-hosted
   (`infra/runner/`, con `docker.sock` del host) ejecuta `supabase start` —
   no-op porque el project_id `automation-platform-template-supabase-dev` ya
   corre — y luego `pnpm db:reset:ci` contra `host.docker.internal:5434`.
3. La tabla/fila del paso 1 ya no existe.

Verificado en el host (`docker ps`): sólo existen los stacks
`automation-platform-template-supabase-de` (5434, 8100, 3101, 3102) y
`estudio-contable-automation-supabase-dev` (6434, 9100, 4101, 4102); no hay
ningún stack de CI.

## Suspected Code Paths

- `.github/workflows/validate.yml` (job `database`) — `supabase start` sin
  `--workdir` usa `supabase/config.toml`, es decir, el `project_id` y los
  puertos de desarrollo; como el stack ya corre, se reutiliza tal cual.
- `scripts/reset-db-ci.mjs:6` — `SUPABASE_DB_PORT ?? '5434'`: el default es el
  puerto de desarrollo y no hay ninguna comprobación de a qué stack apunta
  antes del `drop schema … cascade`.
- `package.json` (`test:db:ci`) — `${SUPABASE_DB_PORT:-5434}`: los pgTAP del CI
  corren contra la base de desarrollo (y en el producto, contra la del
  template, porque su CI no redefine el puerto).
- `supabase/config.toml` — los puertos son enteros sin soporte de `env()`
  (excepción FR-006 de la spec 015), por eso no alcanza con exportar variables
  para mover el stack del CI: hace falta otro `config.toml`.

## Root Cause Hypothesis

Confianza alta. El CI se diseñó pensando en runners efímeros y luego se movió
a runners self-hosted que comparten el Docker del host con los stacks de
desarrollo. El stack de Supabase del CI se identifica por el `project_id` de
`supabase/config.toml`, que es el de desarrollo, y el reset tiene como destino
por defecto el puerto de desarrollo. Nada distingue "stack del CI" de "stack
de desarrollo", así que el CI adopta el de desarrollo. El producto hereda el
mismo defecto y, al no cambiar el puerto, apunta a la base del template.

## Proposed Remediation

**Preferred**: stack de CI propio, derivado por repositorio, más una guarda
obligatoria.

1. `scripts/supabase-ci.mjs` (nuevo) con dos subcomandos:
   - `preparar`: genera `.supabase-ci/supabase/` (ignorado por Git) copiando
     `supabase/` y reescribiendo `config.toml`: `project_id = "ci-<repo>"`
     (nombre del repo tomado de `GITHUB_REPOSITORY`, recortado a los 40
     caracteres que usa el CLI para los nombres de contenedor) y cada puerto
     `p` reemplazado por `20000 + p % 10000`. Template → 25434/28100/…;
     producto (6434/9100/…) → 26434/29100/…. Como los stacks de desarrollo ya
     tienen que tener puertos distintos para convivir, los derivados del CI
     tampoco chocan entre sí, y quedan fuera del rango de desarrollo. Además
     desactiva migraciones/seed del `start` (las aplica el reset) y exporta
     `SUPABASE_CI_WORKDIR`, `SUPABASE_CI_PROJECT_ID` y `SUPABASE_DB_PORT` a
     `$GITHUB_ENV`.
   - `verificar`: guarda. Aborta si falta `SUPABASE_DB_PORT` o
     `SUPABASE_CI_PROJECT_ID`, si el project_id no empieza con `ci-` o coincide
     con el de desarrollo, si el puerto es uno de los de desarrollo de
     `supabase/config.toml` o no es el derivado, o si el contenedor que
     publica ese puerto en el Docker del host no es exactamente
     `supabase_db_<project_id del CI>`.
2. `scripts/reset-db-ci.mjs`: sin default 5434; invoca la guarda antes del
   `drop`. También dropea `dominio` (lo recrea la migración con `if not
   exists`), alineado con lo que hace el producto.
3. `package.json`: `test:db:ci` corre la guarda antes de `pg_prove` y sin
   default de puerto; nuevo `db:ci:preparar`.
4. `validate.yml` (job `database`): `pnpm db:ci:preparar` → `supabase start
   --workdir "$SUPABASE_CI_WORKDIR" -x <servicios innecesarios>` → reset →
   tests. `concurrency` por repositorio para que dos PR no compartan el stack
   del CI al mismo tiempo (hay 3 réplicas del runner).

**Ciclo de vida del stack del CI**: se mantiene entre corridas (arranque
rápido; el reset deja el esquema limpio en cada corrida y ya no hay datos
ajenos que proteger). Se excluyen los servicios que los pgTAP no usan
(studio, mailpit, imgproxy, logflare, vector, edge-runtime, supavisor,
realtime, postgres-meta) para reducir memoria y puertos. Limpieza manual
documentada: `supabase stop --project-id ci-<repo> --no-backup`.

**Alternatives**:
- `supabase stop --no-backup` al final de cada corrida: aísla también en el
  tiempo, pero agrega el arranque completo (~1–2 min) a cada PR y no resuelve
  la concurrencia entre réplicas; descartado por ahora.
- Reescribir `supabase/config.toml` in situ en el checkout: más simple, pero
  un desarrollador que corra el script a mano modificaría su config de
  desarrollo; el workdir separado lo evita.
- Puertos por hash del nombre del repo: posibles colisiones entre repos; la
  derivación desde los puertos de desarrollo hereda su unicidad.

**Files likely to change**:
- `scripts/supabase-ci.mjs` (nuevo), `scripts/supabase-ci.test.mjs` (nuevo)
- `scripts/reset-db-ci.mjs`
- `package.json`
- `.github/workflows/validate.yml`
- `.gitignore`
- `template-capabilities.json` (nueva capacidad `isolated-ci-database`;
  `portable-typescript-tooling` 1.0.1 porque cambia `reset-db-ci.mjs`)
- `docs/deployment.md`, `docs/adoptar-ci-base-aislada.md` (nuevo)

**Tests to add or update**:
- `node --test scripts/supabase-ci.test.mjs`: derivación de project_id y
  puertos (template y producto no chocan entre sí ni con desarrollo),
  reescritura del `config.toml`, y la guarda rechaza puerto de desarrollo,
  project_id de desarrollo, puerto no derivado y contenedor ajeno.
- Validación real: corrida del workflow en el PR con una tabla centinela en
  la base de desarrollo (5434) creada antes y verificada después.

## Risks & Considerations

- El primer `supabase start` del stack de CI corre desde dentro del contenedor
  del runner; si el CLI necesita conectarse a la base por `127.0.0.1` durante
  el arranque, fallaría. Mitigación: migraciones y seed desactivados en el
  config del CI (las aplica el reset por `host.docker.internal`). Se valida en
  la corrida real.
- Un stack más en la máquina (memoria). Mitigado excluyendo servicios.
- El stack persistente no toma cambios de `config.toml` hasta un `supabase
  stop` manual (mismo comportamiento que hoy); documentado.
- `concurrency` sin `cancel-in-progress`: si hay varias corridas en cola,
  GitHub cancela las pendientes más viejas en favor de la última.
- Producto derivado: debe adoptar la capacidad; mientras tanto, su CI sigue
  borrando la base de desarrollo del template. **No** cambiar su puerto a
  6434 (borraría datos reales del producto).

## Adopción en el producto (estudio-contable-automation)

Tras el merge, el producto debe traer la capacidad `isolated-ci-database`
(ver `docs/adoptar-ci-base-aislada.md`):

- Traer `scripts/supabase-ci.mjs`, `scripts/supabase-ci.test.mjs`, el nuevo
  `scripts/reset-db-ci.mjs` (conservando su drop de `dominio`), los scripts
  `db:ci:preparar`/`test:db:ci` de `package.json`, la entrada de `.gitignore`
  y el job `database` de `validate.yml`.
- No hay que tocar su `supabase/config.toml`: su stack de desarrollo sigue en
  `estudio-contable-automation-supabase-dev` / 6434. Su CI quedará en
  `ci-estudio-contable-automation` con base en 26434 (API 29100, etc.).
- Quitar cualquier `SUPABASE_DB_PORT` fijo del workflow del producto.
- Registrar la versión en su `template-adoption.json`.

## Open Questions

- Ninguna bloqueante.
