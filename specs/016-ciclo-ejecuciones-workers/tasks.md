# Tasks: Ciclo de Ejecuciones de Workers

**Input**: Design documents from `/specs/016-ciclo-ejecuciones-workers/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R7), data-model.md, contracts/ciclo-ejecuciones.md, contracts/adopcion-reconciliacion.md, quickstart.md

**Tests**: pgTAP en `supabase/tests/database/ciclo_ejecuciones_workers.test.sql` — exigido por Constitution (Technology Gates: prueba de aislamiento para cambios sensibles) y por SC-001–SC-004. Recorrido manual vía quickstart.md para contrato Kestra y pantallas Refine (patrón specs 011/013).

**Organization**: Tareas agrupadas por user story; cada historia es un incremento independiente y testeable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Migración y esqueleto de tests listos antes de cualquier lógica

- [X] T001 Crear migración con encabezado de reversión en `supabase/migrations/20260920000000_ciclo_ejecuciones_workers.sql`
- [X] T002 [P] Crear esqueleto pgTAP en `supabase/tests/database/ciclo_ejecuciones_workers.test.sql`
- [X] T003 [P] Verificar entorno local (`pnpm dev:supabase` + `pnpm infra:config`) contra `infra/kestra/compose.yaml`

**Checkpoint**: Migración vacía versionada, test vacío y entorno verificado — el trabajo de historias puede comenzar.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tablas de plataforma, RLS y bucket que bloquean a todas las historias

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Crear tablas `capacidades_ejecucion`, `ejecuciones_worker` y `adopciones_template` más índice único parcial de activa en `supabase/migrations/20260920000000_ciclo_ejecuciones_workers.sql`
- [X] T005 Habilitar RLS, policies admin/superadmin y revocar escritura directa de `authenticated` en `supabase/migrations/20260920000000_ciclo_ejecuciones_workers.sql`
- [X] T006 Crear bucket privado `evidencias-ejecuciones` y políticas de `storage.objects` por prefijo de organización en `supabase/migrations/20260920000000_ciclo_ejecuciones_workers.sql`
- [X] T007 Test pgTAP base de aislamiento RLS entre organizaciones en `supabase/tests/database/ciclo_ejecuciones_workers.test.sql`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Ejecutar sin duplicar (Priority: P1) ⭐ MVP

**Goal**: Una sola ejecución activa por organización y capacidad, con timeout auditable (FR-002, FR-003, FR-004)

**Independent Test**: Iniciar una ejecución autorizada la registra; un segundo intento concurrente se rechaza con `YA_EN_CURSO` sin fila nueva; una vencida se cierra como `timeout` y la nueva continúa (quickstart.md pasos 2–3)

- [X] T008 [US1] Implementar `iniciar_ejecucion_worker` (valida conexión activa + capacidad habilitada, cierra vencidas como `timeout`, errores `CAPACIDAD_NO_HABILITADA`/`YA_EN_CURSO`) en `supabase/migrations/20260920000000_ciclo_ejecuciones_workers.sql`
- [X] T009 [US1] Tests pgTAP de concurrencia, timeout y rechazo de capacidad deshabilitada en `supabase/tests/database/ciclo_ejecuciones_workers.test.sql`
- [X] T010 [US1] Documentar contrato de inicio para workers (variables `ORGANIZACION_ID`/`CONEXION_ID`/`CAPACIDAD`/`EJECUCION_ID`, sin `CREDENCIAL`) en `workers/README.md`
- [X] T011 [US1] Validar invocación JDBC de `iniciar_ejecucion_worker` con rol `kestra_orquestacion` según `specs/016-ciclo-ejecuciones-workers/contracts/ciclo-ejecuciones.md` (sin crear flows nuevos)

**Checkpoint**: US1 fully functional and testable independently — `YA_EN_CURSO` ante concurrente, `timeout` auditable ante vencida.

---

## Phase 4: User Story 2 - Resultado y evidencia aislada (Priority: P2)

**Goal**: Cierre auditable con motivo sanitizado, evidencia del último éxito preservada y consulta solo en alcance propio (FR-005–FR-009)

**Independent Test**: Admin consulta historial y descarga evidencia de su org; falla posterior no sustituye el último éxito; miembro sin permiso y otra organización reciben cero filas/archivos (quickstart.md pasos 4–5)

- [X] T012 [US2] Implementar `cerrar_ejecucion_worker` (solo desde `en_curso`, `YA_CERRADA` sin cambios, `SECRETO_DETECTADO` por forma, `NO_AUTORIZADO` por rol, evidencia solo si `exitosa`) en `supabase/migrations/20260920000000_ciclo_ejecuciones_workers.sql`
- [X] T013 [US2] Tests pgTAP de doble cierre, último éxito intacto tras falla, sanitización y aislamiento de lectura en `supabase/tests/database/ciclo_ejecuciones_workers.test.sql`
- [X] T014 [P] [US2] Crear página de historial de ejecuciones en `apps/web/src/pages/ejecuciones/list.tsx`
- [X] T015 [P] [US2] Crear página de detalle con descarga de evidencia por URL firmada en `apps/web/src/pages/ejecuciones/show.tsx`
- [X] T016 [US2] Registrar recurso y rutas `/ejecuciones` en `apps/web/src/App.tsx`
- [X] T017 [US2] Documentar contrato de cierre y subida de evidencia en `workers/README.md`

**Checkpoint**: US1 AND US2 both work independently — historial y evidencia visibles solo en alcance propio.

---

## Phase 5: User Story 3 - Adopción en producto existente (Priority: P3)

**Goal**: Adoptar el mecanismo sin duplicar objetos ni tocar dominio, con versión de origen verificable (FR-011, SC-005)

**Independent Test**: Sobre producto con historial compatible: cero tablas/historiales duplicados y `SELECT version FROM adopciones_template` devuelve la versión del template (quickstart.md paso 6)

- [X] T018 [US3] Implementar `registrar_adopcion_ciclo` idempotente (actualiza la versión existente mediante `ON CONFLICT`) en `supabase/migrations/20260920000000_ciclo_ejecuciones_workers.sql`
- [X] T019 [US3] Test pgTAP de idempotencia de adopción en `supabase/tests/database/ciclo_ejecuciones_workers.test.sql`
- [X] T020 [P] [US3] Escribir guía de adopción con reconciliación solo aditiva en `docs/adoptar-ciclo-ejecuciones.md`

**Checkpoint**: All user stories independently functional — adopción verificable sin recrear ni borrar.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Gates de calidad y validación end-to-end

- [X] T021 Ejecutar `pnpm lint` y corregir hallazgos en `apps/web/src/pages/ejecuciones/list.tsx`
- [X] T022 Ejecutar `pnpm build` y corregir hallazgos en `apps/web/src/pages/ejecuciones/show.tsx`
- [X] T023 Ejecutar `pnpm infra:config` y corregir hallazgos en `infra/kestra/compose.yaml`
- [X] T024 Ejecutar `pnpm test` (incluye pgTAP) y corregir hallazgos en `supabase/tests/database/ciclo_ejecuciones_workers.test.sql`
- [X] T025 Recorrido manual completo de `specs/016-ciclo-ejecuciones-workers/quickstart.md` pasos 1–6 (Supabase local, endpoints UI de Refine y API/UI de Kestra)
- [X] T026 Verificar que `.env.example` no requiere variables nuevas y documentar reutilización de `KESTRA_ORQUESTACION_*` en `specs/016-ciclo-ejecuciones-workers/tasks.md`

**Checkpoint**: Spec lista para PR contra `main` con CI verde y quickstart validado.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Tests (pgTAP) MUST be written and FAIL before implementation
- Migration functions before Refine pages
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T002 + T003 (different files, no dependencies)
- T014 + T015 (different Refine pages, no shared code)
- T020 (docs) alongside T018/T019 (different files)
- Once Foundational completes, US1/US2/US3 can start in parallel (if team capacity allows)

---

## Parallel Example: User Story 2

```bash
# Launch both Refine pages together (different files, no dependencies):
Task: "Crear página de historial de ejecuciones en apps/web/src/pages/ejecuciones/list.tsx"
Task: "Crear página de detalle con descarga de evidencia por URL firmada en apps/web/src/pages/ejecuciones/show.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test US1 independently (quickstart.md pasos 2–3)
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- Notas de desvío (Fase 1+2): sin CLI de Supabase en este entorno no se pudo
  correr `pnpm dev:supabase` / `pnpm test:db`; la migración y el pgTAP base se
  validaron contra Postgres transitorio `supabase/postgres:17.6.1.165` con
  stubs de esquema (12/12 ok). Resta `pnpm test` completo donde corra
  `dev:supabase` (ver T024/T025).
- Notas de desvío (implementación completa): corrida de punta a punta sin
  `/clear` entre fases, a pedido explícito (excepción a AGENTS.md).
  `registrar_adopcion_ciclo` hace upsert (actualiza versión) para que la
  re-adopción quede registrada. Embed FK tipa como array en TS (fix en
  `list.tsx`/`show.tsx`). Validación DB final: 59/59 pgTAP como rol
  no-superusuario + invocación real como `kestra_orquestacion`.
- T025 se validó con una transacción temporal de 11/11 checks (rollback),
  Refine `http://localhost:3100` y `/ejecuciones` respondiendo 200, y Kestra
  `http://localhost:8082/ui/` + `/api/v1/flows/platform.backups`
  respondiendo 200. No se dejó fixture ni dato de prueba persistente.

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify pgTAP tests fail before implementing functions
- Commit after each task or logical group (`ver commit <hash>` en notas de desvío, cortas)
- Stop at any checkpoint to validate story independently
- `/speckit-implement` fase por fase con `/clear` entre fases (AGENTS.md) — no la spec completa en una corrida
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
