# Feature Specification: Control de concurrencia del CI (que no se vaya al diablo)

**Feature Branch**: `infra/control-ci-concurrencia`

**Created**: 2026-10-18

**Status**: Implementada (PR contra `dokploy`).

**Delivery scope**: workers (infraestructura de CI de plataforma: `infra/runner/`,
`scripts/`, `.github/workflows/`). No toca `refine`, `supabase`, `kestra` ni
`superset`, ni contiene lógica de negocio.

**Input** (pedido del usuario): «¿y qué pasa si tenemos muchos en CI? ¿cómo
podemos controlar todo esto para que no se vaya al diablo?» → «hacé todos».

**Origen**: al crecer la cantidad de PRs en paralelo, el pool **fijo** de
runners (5) se oversuscribe; el host (12 vCPU) llega a load > núcleos con 2–3
jobs activos, compitiendo con **Claude** y con los stacks de Supabase del CI.
Síntomas: jobs lentos, timeouts y flakiness (el browser del E2E sin `libglib`),
stacks/locks colgados y merges a `dokploy` que rompen la rama. Faltaba
**admisión**, **cortacircuitos**, **límites de recursos**, **integración segura**
(merge queue) y **limpieza**.

## Historias y criterios de aceptación

### US1 · Admisión: los PRs de más esperan, no oversuscriben

- **US1-CA1** Con la variable `CI_LANES` seteada, cada PR reserva un carril y lo
  libera al terminar; con más PRs que carriles, los demás **esperan**.
- **US1-CA2** Sin `CI_LANES`, la admisión queda apagada y el CI se comporta como
  antes (no-op).
- **US1-CA3** Un carril de un job muerto se recicla por TTL (no traba el CI).
- **US1-CA4** Agotada la espera (`CI_LANE_WAIT_MIN`) sin carril, el job sigue
  **sin admisión** y avisa (fail-open): nunca pone el PR en rojo por esperar.

### US2 · Cortacircuitos y kill switch

- **US2-CA1** `CI_PAUSED=true` frena lo pesado (application/web/database) sin
  tocar el repo.
- **US2-CA2** Con `CI_LOAD_MAX` seteado, la admisión **no arranca** trabajo
  pesado si el load del host supera núcleos × factor; espera y, agotado el
  plazo, falla con mensaje claro.
- **US2-CA3** Todos los jobs tienen `timeout-minutes` (nada queda colgado).

### US3 · Integración segura y demandas innecesarias

- **US3-CA1** El workflow corre también en `merge_group` (soporte listo para
  merge queue) y `dokploy` queda con un ruleset que exige los checks y la rama
  al día: el PR se prueba contra el base actualizado antes de entrar.
- **US3-CA2** Un PR en **borrador** no corre los jobs pesados; al pasar a Ready
  se corre.
- **US3-CA3** Los cambios a `infra/`/`scripts/` validan las nuevas herramientas.

### US4 · Aislamiento de recursos y limpieza

- **US4-CA1** Cada réplica de runner tiene un tope de **CPU** configurable
  (`RUNNER_CPU_LIMIT`), además del de memoria.
- **US4-CA2** `scripts/limpiar-ci.mjs` limpia locks/carriles vencidos y stacks
  de Supabase del CI **detenidos** (dry-run por defecto; nunca `Up` ni
  dev/stg/prd), y el workflow programado **CI janitor** lo corre cada 6 h.
- **US4-CA3** `scripts/estado-ci.mjs` da una foto de carriles, carga del host y
  runners ocupados.

## Requisitos funcionales

- **FR-001** `scripts/ci-lane.mjs` implementa la reserva atómica de carriles
  (`mkdir`, TTL, espera) reutilizando el patrón de `supabase-ci.mjs`; escribe
  `CI_LANE` en `$GITHUB_ENV` y `lane` en `$GITHUB_OUTPUT`. Agotada la espera,
  continúa sin carril (fail-open) con aviso.
- **FR-002** El job `changes` reserva el carril (si `CI_LANES`) y un job
  `liberar` (`if: always()`) lo suelta; los jobs pesados dependen del carril por
  `needs: changes`.
- **FR-003** Las variables de repo se pasan al job por `env:` (el contexto
  `vars` no llega solo al proceso).
- **FR-004** `RUNNER_CPU_LIMIT` (default `2`, `0` = sin tope) en
  `infra/runner/compose.yaml` y documentado en `.env.example`.
- **FR-005** `scripts/estado-ci.mjs` y `scripts/limpiar-ci.mjs` con núcleo puro
  y testeable (`node --test`).
- **FR-006** `pnpm test:ci` corre los tests de las tres herramientas y se
  ejecuta en el job `infrastructure`.
- **FR-007** `docs/control-ci.md` documenta activación y runbook.
- **FR-008** El job `validacion` agrega los resultados (`success`/`skipped` OK,
  `failure`/`cancelled` falla) y es el **único check requerido** del ruleset de
  `dokploy`; con `CI_PAUSED=true` falla a propósito.

## Fuera de alcance (explícito)

- No se implementa un autoscaler de runners (ARC): el pool sigue siendo fijo.
- No se cambia el límite de ranuras de Supabase (`SUPABASE_CI_RANURAS`).
- No se activa el merge queue: GitHub no lo expone por API para este repo (el
  ruleset lo rechaza). El workflow queda con `merge_group` listo y la
  integridad se cubre con checks requeridos + rama al día (ruleset
  `dokploy-integracion-protegida`, activado por API, fuera de git).

## Pruebas

- `node --test scripts/ci-lane.test.mjs scripts/estado-ci.test.mjs scripts/limpiar-ci.test.mjs`
  (admisión, TTL, cortacircuitos, parseo del janitor y del estado).
- Validación de YAML del workflow y `pnpm infra:config`.
- Corrida real del PR (el propio workflow modificado se ejecuta).

## Reversión

Sin migraciones ni datos. Reversión: quitar la variable `CI_LANES` (la admisión
queda apagada), `CI_PAUSED` (si estuviera) y `RUNNER_CPU_LIMIT`; el resto son
archivos versionados que se revierten con `git revert`.
