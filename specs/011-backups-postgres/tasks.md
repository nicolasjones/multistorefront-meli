# Tasks: Backups automáticos de la base de datos

**Input**: Design documents from `/specs/011-backups-postgres/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/respaldo-postgres.md, quickstart.md (todos presentes).

**Tests**: pgTAP es obligatorio para el esquema/RLS/funciones nuevas (constitución, Technology and Quality Gates — tabla con datos sensibles de todas las organizaciones a la vez, FR-011). Sin tests de frontend — esta spec no toca `apps/web` (Assumptions de spec.md). El flow de Kestra en sí no tiene test runner integrado al repo; su validación de punta a punta es manual, vía `quickstart.md`.

**Organization**: Tareas agrupadas por historia de usuario (spec.md), en orden de prioridad P1 → P2 → P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (archivo distinto, sin dependencia de una tarea todavía incompleta)
- **[Story]**: a qué historia de usuario pertenece (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: preparar los archivos que las fases siguientes van a completar, sin lógica todavía.

- [X] T001 [P] Crear `supabase/migrations/<timestamp>_backups_postgres.sql` con el comentario de reversión (data-model.md) y sin contenido más allá de eso todavía.
- [X] T002 [P] Crear el esqueleto de `supabase/tests/database/backups_postgres.test.sql` con el fixture (un superadmin de prueba, un administrador de organización de prueba) — mismo patrón que `panel_de_funcionalidades.test.sql`.
- [X] T003 [P] Crear `infra/kestra/flows/respaldo-postgres.yml` — primera carpeta `flows/` del repo — con namespace `platform.backups`, id `respaldo-postgres`, y solo el esqueleto (metadata, sin tareas todavía).
- [X] T004 [P] Agregar `KESTRA_BACKUPS_DB_PASSWORD` a `.env.example` (y a `infra/kestra/.env.example` si existe como archivo separado), con comentario explicando que protege al rol `kestra_backups` y se rota por entorno (research.md R8) — sin valor real.

**Checkpoint**: archivos listos para completar en las fases siguientes.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: la tabla, el rol y las funciones de las que dependen las tres historias — ninguna corre un backup real sin esto.

**⚠️ CRITICAL**: ninguna historia de usuario puede implementarse sin esta fase.

- [X] T005 En la migración de T001: crear la tabla `respaldos` (data-model.md) con el `check` de consistencia entre `estado` y el resto de los campos, y el índice único parcial `respaldos_un_solo_en_progreso` (FR-003).
- [X] T006 En el mismo archivo: crear el rol `kestra_backups` (`with login`, sin ningún otro privilegio por defecto) — contraseña placeholder claramente marcada para rotar por entorno, nunca un valor real (research.md R8).
- [X] T007 En el mismo archivo: agregar las 3 funciones `security definer` / `search_path = ''` de `contracts/respaldo-postgres.md` (`iniciar_respaldo`, `finalizar_respaldo_completado`, `finalizar_respaldo_error`), con el auto-sanado de filas `en_progreso` colgadas hace más de 3 horas dentro de `iniciar_respaldo` (research.md R5), y `revoke execute ... from public, authenticated, anon; grant execute ... to kestra_backups` en las 3.
- [X] T008 En el mismo archivo: activar RLS en `respaldos`, agregar la policy `respaldos_select` (`private.is_superadmin()`) — sin ninguna policy de `insert`/`update`/`delete` para `authenticated` ni `anon` (FR-011).
- [X] T009 Completar `supabase/tests/database/backups_postgres.test.sql` (pgTAP): el índice único bloquea un segundo `iniciar_respaldo` mientras el primero sigue `en_progreso` (FR-003); una fila `en_progreso` de más de 3 horas se auto-sana al llamar `iniciar_respaldo` de nuevo (research.md R5); el `check` de consistencia rechaza un `completado` sin archivo o un `error` sin motivo; `respaldos_select` no devuelve ninguna fila para un administrador ni un miembro de organización, solo para un superadmin (FR-011); `kestra_backups` puede ejecutar las 3 funciones y ningún otro rol (`authenticated`, `anon`) puede. `pnpm test:db` en verde junto con las suites existentes.

**Checkpoint**: mecanismo de base de datos completo y probado — recién acá el flow de Kestra tiene algo real que llamar.

---

## Phase 3: User Story 1 - El respaldo diario corre solo y deja un resultado verificable (Priority: P1) 🎯 MVP

**Goal**: todos los días, sin que nadie lo dispare, se genera un backup completo de la base y queda un registro de si salió bien o mal.

**Independent Test**: disparar el flow simulando el trigger programado (quickstart.md sección 1) y confirmar que la fila en `respaldos` pasa de `en_progreso` a `completado`, con tamaño y ubicación del archivo.

### Implementation for User Story 1

- [X] T010 [US1] Completar `infra/kestra/flows/respaldo-postgres.yml` (T003): trigger `Schedule` diario; primera tarea que llama `iniciar_respaldo('programado')` por JDBC con la credencial `kestra_backups` (dev: `host.docker.internal:5434`, research.md R4).
- [X] T011 [US1] En el mismo flow: tarea que ejecuta `pg_dump` contra la base vía task runner Docker (research.md R3), guardando el archivo en el storage interno de Kestra.
- [X] T012 [US1] En el mismo flow: tarea de verificación estructural del archivo — no vacío, formato esperado, no cortado a mitad de camino (FR-005); tarea siguiente que llama `finalizar_respaldo_completado` si las dos anteriores salieron bien.
- [X] T013 [US1] En el mismo flow: bloque `errors:` que llama `finalizar_respaldo_error` con el motivo real de la tarea que falló — nunca un genérico "algo salió mal" (FR-006, FR-008).
- [X] T014 [US1] Cargar el flow en el Kestra local vía su API/CLI (research.md R7 — nunca creado solo en la UI) y reemplazar el placeholder de `quickstart.md` § Prerrequisitos con el comando exacto usado.

**Checkpoint**: un backup programado corre de punta a punta y deja un resultado verificable (quickstart.md sección 1) — este es el MVP de la spec.

---

## Phase 4: User Story 2 - Disparar un respaldo bajo demanda (Priority: P2)

**Goal**: el superadmin puede pedir un backup ahora mismo, sin esperar el horario programado, con el mismo mecanismo — y nunca compiten dos backups a la vez.

**Independent Test**: disparar el flow manualmente (quickstart.md sección 2) y, mientras sigue corriendo, disparar un segundo (quickstart.md sección 3) — el segundo debe rechazarse antes de tocar `pg_dump`.

### Implementation for User Story 2

- [X] T015 [US2] Agregar un input `origen` al flow (`infra/kestra/flows/respaldo-postgres.yml`) con default `manual`; ajustar el trigger `Schedule` de T010 para pasar explícitamente `origen: programado`, sobreescribiendo ese default en las corridas automáticas.
- [X] T016 [US2] Validar manualmente quickstart.md secciones 2 (disparo manual, mismo ciclo que uno programado, distinguible por `origen`) y 3 (dos disparos simultáneos: el segundo falla en `iniciar_respaldo` con "Ya hay un respaldo en progreso", sin llegar a correr `pg_dump`).

**Checkpoint**: el superadmin puede disparar un backup a demanda desde la propia interfaz de Kestra, y el bloqueo de concurrencia (heredado de la Fase 2) queda validado en el flow real (quickstart.md secciones 2-3).

---

## Phase 5: User Story 3 - Auditar el historial de respaldos (Priority: P3)

**Goal**: el superadmin puede revisar el historial completo de respaldos pasados — no solo el último — incluidos los que fallaron, con su motivo.

**Independent Test**: con al menos un respaldo completado y uno con error, confirmar que ambos son consultables con su resultado/motivo (quickstart.md secciones 4-5), y que nadie fuera del superadmin puede leerlos (quickstart.md sección 6).

### Implementation for User Story 3

- [X] T017 [US3] Validar manualmente quickstart.md sección 4 (forzar un fallo real durante `pg_dump` o la verificación, confirmar que `motivo_error` queda legible y que el backup del día siguiente no queda bloqueado).
- [X] T018 [US3] Validar manualmente quickstart.md sección 5 (fila `en_progreso` colgada simulada a mano, confirmar que se auto-sana al disparar un backup nuevo) y sección 6 (una sesión de administrador/miembro de organización no ve ninguna fila de `respaldos`).

**Checkpoint**: el historial completo — éxitos y fallos — es auditable por el superadmin, y por nadie más (quickstart.md secciones 4-6).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T019 Correr `pnpm lint`, `pnpm build` y `pnpm infra:config` (comandos de validación de `CLAUDE.md`) con todo lo anterior aplicado — `pnpm test` ya quedó cubierto por T009.
- [X] T020 [P] Si `KESTRA_BACKUPS_DB_PASSWORD` u otra variable nueva de T004 lo requiere, sumarla a la tabla de "Usuarios y credenciales" de `README.md`.
- [X] T021 Ejecutar manualmente el resto de `quickstart.md` que no haya quedado cubierto por las fases anteriores, y anotar cualquier desvío en este archivo, con referencia al commit que lo resuelve (`ver commit <hash>`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — arranca de inmediato.
- **Foundational (Phase 2)**: depende de Setup — bloquea las tres historias.
- **User Stories (Phase 3-5)**: dependen de Foundational. US1 es la única con trabajo de implementación sustancial (el flow en sí); US2 y US3 extienden y validan ese mismo flow — no son código independiente que se pueda paralelizar entre sí sin pisarse el mismo archivo `respaldo-postgres.yml`.
- **Polish (Phase 6)**: depende de las historias que se hayan implementado.

### User Story Dependencies

- **US1 (P1)**: depende solo de Foundational. Es el MVP — sin esto no hay backups, punto.
- **US2 (P2)**: depende de Foundational **y** del flow creado en US1 (T010-T014) — agrega el input `origen` sobre el mismo archivo, no lo reemplaza.
- **US3 (P3)**: depende solo de Foundational (la policy de RLS y el historial ya existen desde la Fase 2) — no depende de código nuevo de US1/US2, solo de que haya al menos una ejecución real para auditar.

### Parallel Opportunities

- T001-T004 (Setup) — archivos distintos, en paralelo.
- Dentro de Foundational, T005-T008 son el mismo archivo de migración — secuenciales, no paralelos, pese a no llevar todos `[P]`.
- T009 (pgTAP) puede escribirse en paralelo con T005-T008 si se arranca por los `assert` que no dependen del contenido final (estructura del fixture), pero para correr en verde necesita la migración completa.
- T020 puede hacerse en paralelo con T017-T019.

---

## Parallel Example: Setup

```bash
# T001-T004 no dependen entre sí para poder escribirse:
Task: "Crear supabase/migrations/<timestamp>_backups_postgres.sql con el comentario de reversión"
Task: "Crear el esqueleto de supabase/tests/database/backups_postgres.test.sql"
Task: "Crear infra/kestra/flows/respaldo-postgres.yml con namespace/id, sin tareas todavía"
Task: "Agregar KESTRA_BACKUPS_DB_PASSWORD a .env.example"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Setup + Foundational.
2. User Story 1 completa (T010-T014).
3. Validar con quickstart.md sección 1.
4. En este punto ya hay backups diarios automáticos funcionando de punta
   a punta — es el problema real que motivó la spec. US2 (disparo manual)
   y US3 (auditoría) son valor incremental sobre esa base, no
   condiciones para tener backups reales.

### Incremental Delivery

1. Setup + Foundational → mecanismo de base de datos listo y probado.
2. US1 → backups diarios corriendo solos (MVP).
3. US2 → se puede pedir un backup fuera de horario, sin competir con el
   programado.
4. US3 → el historial completo (éxitos y fallos) queda auditable de
   punta a punta.

---

## Notes

- Sin tareas de frontend — esta spec no toca `apps/web` (Assumptions de
  spec.md, delivery scope `kestra | supabase`).
- El flow de Kestra (T010-T015) es un único archivo YAML que las tres
  historias van completando por capas — a diferencia de specs anteriores
  con pantallas de Refine, acá no hay forma real de que US2/US3 avancen
  en paralelo con US1 sin pisarse el mismo archivo.
- Las notas de desvío respecto a este plan van acá, cortas, con
  referencia al commit (`ver commit <hash>`) — la razón completa vive en
  el mensaje de commit (regla de `CLAUDE.md`).

---

## Phase 7: Convergence

- [X] T022 Parametrizar el `url` de las 3 tareas JDBC (`iniciar_respaldo`, `finalizar_respaldo_completado`, `finalizar_respaldo_error`) en `infra/kestra/flows/respaldo-postgres.yml` vía una variable de entorno nueva (agregada a `.env.example` y como `ENV_*` en `infra/kestra/compose.yaml`), en vez del literal `jdbc:postgresql://host.docker.internal:5434/postgres` — mismo patrón ya usado para `KESTRA_BACKUPS_PGDUMP_URL` en la tarea `pg_dump` del mismo flow per FR-009 / research.md R4 (partial)
