# Tasks: Observabilidad de plataforma para workers de navegador

**Input**: Design documents from `specs/20260925-133820-observabilidad-workers-navegador/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: requeridos por FR-012 (contrato estático + ejecución real en el
Kestra local del template). Cargar la skill `pruebas-plataforma`.

**Stack local**: usar solo `automation-platform-template-*` (Kestra en
127.0.0.1:8082, Supabase DB en 5434). No tocar contenedores de otros
proyectos.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 [P] Agregar `ENV_EVIDENCIA_VISUAL` (`${EVIDENCIA_VISUAL:-false}`), `ENV_EVIDENCIA_RETENCION_DIAS` (`${EVIDENCIA_RETENCION_DIAS:-30}`) y `ENV_EVIDENCIA_DIR_HOST` (`${EVIDENCIA_DIR_HOST:-/var/lib/automation-platform/evidencia}`) con comentario de spec en `infra/kestra/compose.yaml`, y documentarlas en `.env.example`
- [X] T002 [P] Extraer a `infra/kestra/e2e-comun.mjs` los helpers de `infra/kestra/validar-secretos-e2e.mjs` (docker/compose/db/request/publish/start/waitExecution/basicHeader/aprovisionamiento de organizaciones y hosts SSH fixture/limpieza) sin cambiar su comportamiento; el host fixture acepta montajes extra (base de evidencia con la misma ruta absoluta del daemon)
- [X] T003 Verificar que `pnpm test:kestra:secretos:e2e` sigue pasando tras T002 (Kestra del template recreado con T001: `pnpm dev:kestra`)

**Checkpoint**: configuración disponible y E2E existente sin regresión.

## Phase 2: Foundational

- [X] T004 Agregar a `workers/CONTRATO.md` la sección "Observabilidad y evidencia visual" según `contracts/observabilidad-workers.md` y `data-model.md` (evento, estados, sanitización, `EVIDENCIA_VISUAL`, `EVIDENCIA_DIR`, `EVIDENCIA_RETENCION_DIAS` de plataforma, capturas solo en hitos y separadas de datos, fallo de captura no cambia el resultado)
- [X] T005 Extender el worker fixture `infra/kestra/fixtures/worker/entrypoint.sh` para emitir eventos del contrato por stdout (`inicio`, `proceso`, `fin` / `fallida`) y, con `EVIDENCIA_VISUAL=true` y `EVIDENCIA_DIR`, escribir capturas PNG mínimas por hito; nuevo `SISTEMA_EXTERNO=fixture-captura-fallida` que simula fallo de captura (evento `evidencia/fallida`) y termina bien

**Checkpoint**: contrato escrito y fixture capaz de ejercitarlo.

## Phase 3: User Story 1 - Seguir y diagnosticar una ejecución desde Kestra (P1) 🎯 MVP

**Goal**: eventos visibles y logs del despacho publicados como output en éxito y error.

**Independent Test**: ejecución real de ambas plantillas con éxito y falla; output `publicar_logs` presente y sin centinela.

- [X] T006 [P] [US1] Test estático `infra/kestra/validar-evidencia-flows.test.mjs` (`node --test`): ambas plantillas pasan `KESTRA_EJECUCION_ID`, tienen `publicar_logs` (`log.Fetch`, `tasksId: [despacho_ssh]`) en `finally` de flow con `allowFailure`/`allowWarning`; script `test:kestra:evidencia` en `package.json`
- [X] T007 [P] [US1] `infra/kestra/flows/plantilla-dedicado.yml`: `-e KESTRA_EJECUCION_ID` en `docker run` y `finally` de flow con `publicar_logs`
- [X] T008 [P] [US1] `infra/kestra/flows/plantilla-generico.yml`: idem, un único `publicar_logs` en `finally` de flow
- [X] T009 [US1] `infra/kestra/validar-evidencia-e2e.mjs` (script `test:kestra:evidencia:e2e`) con escenarios de logs: genérico éxito (2 organizaciones) y dedicado falla técnica; verifica eventos en logs, `publicar_logs.uri` descargable, clasificación de alertas intacta y centinela ausente en logs y outputs; ejecutarlo

**Checkpoint**: operador ve etapas y descarga logs de cada ejecución. Parar para `/clear`.

## Phase 4: User Story 2 - Consultar capturas de hitos (P1)

**Goal**: capturas publicadas como outputs por organización, borradas del host, sin alterar el estado de negocio.

**Independent Test**: E2E con evidencia por input en éxito, falla técnica, falla de captura y evidencia deshabilitada.

- [X] T010 [P] [US2] Ampliar `infra/kestra/validar-evidencia-flows.test.mjs`: input opcional `evidencia_visual`; montaje `/evidencia` solo dentro de la rama habilitada; nada de evidencia a stderr; poda `find -mtime +N` del host; `publicar_evidencia` (`sftp.Downloads`, `rootDir: false`, `action: DELETE`, `maxFiles: 50`, `runIf`, `allowFailure`/`allowWarning`) en `finally` de la secuencia de despacho; se mantiene el contrato de `validar-workers-runtime.mjs`
- [X] T011 [P] [US2] `infra/kestra/flows/plantilla-dedicado.yml`: input `evidencia_visual` (BOOLEAN opcional), preparación de carpeta `<base>/<execution.id>/<organizacion_id>` con fallback a evento `evidencia/fallida` en stdout, poda de residuos, `-v …:/evidencia:rw` + `EVIDENCIA_VISUAL`/`EVIDENCIA_DIR`, y `publicar_evidencia` en `finally` de `procesar_despacho`
- [X] T012 [P] [US2] `infra/kestra/flows/plantilla-generico.yml`: idem por iteración (`parent.taskrun.value`), `publicar_evidencia` en `finally` de `ejecutar_despacho`
- [X] T013 [US2] Ampliar `infra/kestra/validar-evidencia-e2e.mjs`: host fixture con la base de evidencia montada; escenarios genérico con evidencia (capturas separadas por organización, host sin archivos), dedicado falla técnica con evidencia (alerta técnica igual + captura), `fixture-captura-fallida` (`SUCCESS`) y dedicado sin evidencia (`SUCCESS`, `publicar_evidencia` omitida); centinela ausente también en las capturas descargadas; ejecutarlo junto con `pnpm test:kestra:secretos:e2e` y `pnpm test:kestra:runtime`

**Checkpoint**: capturas visibles desde Kestra sin cambiar resultados. Parar para `/clear`.

## Phase 5: User Story 3 - Limpiar capturas vencidas (P2)

**Goal**: limpieza programada, idempotente, solo storage.

**Independent Test**: retención 30 no borra; retención 0 borra; segunda corrida 0 archivos; ejecuciones y logs intactos.

- [X] T014 [P] [US3] Ampliar `infra/kestra/validar-evidencia-flows.test.mjs`: `limpieza-evidencia` con `Schedule` diario, `PurgeExecutions` con `purgeExecution`/`purgeLog`/`purgeMetric: false`, `purgeStorage: true`, estados terminales, validación de retención entera ≥ 0 antes de purgar, sin tareas JDBC ni SSH
- [X] T015 [US3] Crear `infra/kestra/flows/limpieza-evidencia.yml` (namespace `platform.orquestacion`, inputs opcionales `retencion_dias` y `namespace` con default del entorno / `platform.orquestacion`)
- [X] T016 [US3] Ampliar `infra/kestra/validar-evidencia-e2e.mjs` con el escenario de limpieza (30 → nada; 0 → evidencia previa 404; segunda corrida `storagesCount` 0; ejecuciones y logs consultables; retención inválida falla sin purgar) y ejecutarlo

**Checkpoint**: la limpieza elimina solo evidencia vencida. Parar para `/clear`.

## Phase 6: User Story 4 - Adoptar la capacidad (P3)

- [X] T017 [US4] `template-capabilities.json`: `worker-execution-cycle` 1.1.0 con `infra/kestra/flows/limpieza-evidencia.yml`; `worker-image-security` 1.0.1; actualizar `template-adoption.json`; `pnpm template:capabilities:check --base origin/main` y `pnpm test:template:adoption`
- [X] T018 [P] [US4] Sección "Observabilidad y evidencia visual" en `docs/adoptar-ciclo-ejecuciones.md` (provisión de `EVIDENCIA_DIR_HOST` en hosts, variables, copia de `limpieza-evidencia` al namespace del producto, regla de no guardar datos de negocio en el storage interno, diferencias con el contrato de origen de `research.md` R8)

**Checkpoint**: capacidad publicada y adoptable.

## Phase 7: Polish

- [X] T019 `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`, `pnpm docs:check`; marcar tareas y registrar desvíos cortos con `ver commit <hash>`

## Dependencies

- Setup → Foundational → US1 → US2 → US3 → US4 → Polish. US2 y US3
  reutilizan el E2E y el test estático de US1; US3 necesita ejecuciones con
  evidencia de US2 para demostrar la purga.
- [P] dentro de cada fase: archivos distintos (test estático y cada plantilla).

## Implementation Strategy

MVP = US1 (logs y eventos). Cada fase termina en su Checkpoint con commit y
push al PR; `/speckit-implement` se invoca fase por fase con `/clear` entre
fases.

## Desvíos

- Por pedido del usuario las fases se corrieron seguidas, sin `/clear`.
- T017 se adelantó para que el CI del PR no falle por versiones de
  capacidades (ver commit 72a98c0).
- `limpieza-evidencia` valida el plazo sin regex porque Pebble no soporta
  `matches`; `retencion_dias` es STRING para poder rechazar valores inválidos
  en el propio flow (ver commit 72a98c0).
- El E2E publica las plantillas y la limpieza en un namespace propio de la
  corrida para que la purga con plazo 0 no toque otras ejecuciones locales.
- La corrida real se vio interrumpida porque el CI de un producto derivado
  resetea el Supabase local del template (puerto 5434 por defecto); se corrió
  en una ventana sin CI activo.
- Validación final (2026-09-25, ventana sin CI): `test:kestra:evidencia:e2e`
  (13 escenarios reales), `test:kestra:secretos:e2e`, `pnpm test`, lint,
  build, `infra:config`, `docs:check` y chequeos de capacidades en verde.
