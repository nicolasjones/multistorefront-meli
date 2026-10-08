---

description: "Task list template for feature implementation"
---

# Tasks: Catálogo real para sistema_externo en conexiones

**Input**: Design documents from `specs/20260930-165358-catalogo-sistemas-externos/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Sí se incluyen — este repo prueba comportamiento de base de datos
con pgTAP (`pnpm test`) y la constitución exige prueba de aislamiento/RLS
para cambios sensibles de esquema (Technology and Quality Gates).

**Organización**: una sola migración SQL atómica (tabla + RLS + grants + FK)
en Foundational, porque las 3 historias de usuario de `spec.md` son 3
ángulos de validación sobre el mismo cambio de esquema, no 3 piezas
independientes de código. Cada fase de historia agrega y verifica la prueba
correspondiente a su ángulo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias)
- **[Story]**: Historia de usuario a la que pertenece (US1, US2, US3)
- Todas las rutas son relativas a la raíz del repo

---

## Phase 1: Setup

**Purpose**: elegir el nombre del archivo de migración, sin contenido aún.

- [X] T001 Elegir el timestamp de la migración siguiendo la convención de
  `supabase/migrations/` (mayor que el último archivo existente,
  `20260925210000_destrabar_conexion_invalida.sql`) y crear el archivo vacío
  `supabase/migrations/<timestamp>_catalogo_sistemas_externos.sql` con el
  comentario de cabecera de reversión (ver `data-model.md`): reversión =
  `alter table conexiones drop constraint conexiones_sistema_externo_fkey;`
  seguido de `drop table sistemas_externos;` — sin mencionar ningún `drop
  column` sobre `conexiones.sistema_externo`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: la migración completa — tabla catálogo, RLS, grants y la FK
sobre `conexiones`. Bloquea las 3 historias: ninguna se puede probar sin
esto aplicado.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 En `supabase/migrations/<timestamp>_catalogo_sistemas_externos.sql`
  (de T001), crear la tabla `sistemas_externos` (`id text primary key`,
  `descripcion text not null`) con `comment on table` explicando el patrón
  "agregar un sistema externo es una fila nueva, no un check fijo" — mismo
  texto que `roles_organizacion` en
  `supabase/migrations/20260908172920_fundacion_multitenant.sql:18-19`, sin
  ningún `insert` de datos (FR-002 de `spec.md`: la tabla queda vacía).
- [X] T003 En el mismo archivo, habilitar RLS sobre `sistemas_externos` y
  crear la policy `sistemas_externos_select` (`for select to authenticated
  using (true)`), sin policy de escritura — ver `data-model.md`.
- [X] T004 En el mismo archivo, agregar
  `grant select on sistemas_externos to authenticated;` (el proyecto tiene
  `auto_expose_new_tables = false`, hace falta explícito).
- [X] T005 En el mismo archivo, agregar la constraint
  `conexiones_sistema_externo_fkey` sobre `conexiones.sistema_externo`
  referenciando `sistemas_externos (id)` con `not valid` — sin
  `validate constraint` en esta migración (research.md, R2). Comentario
  inline explicando por qué `not valid` (tolerar datos preexistentes de
  forks al hacer `git merge upstream/main`, FR-005/FR-006 de `spec.md`).

**Checkpoint**: migración completa y aplicable con `pnpm dev:supabase` /
`supabase migration up`, sin datos de negocio cargados.

---

## Phase 3: User Story 1 - Integridad referencial de sistema_externo (Priority: P1) 🎯 MVP

**Goal**: `crear_conexion` y cualquier insert directo sobre `conexiones`
solo aceptan un `sistema_externo` que exista en el catálogo; el catálogo es
de solo lectura para cualquier autenticado.

**Independent Test**: Validaciones 1 a 4 de `quickstart.md`.

### Tests for User Story 1

> **NOTE**: escribir el test primero, confirmar que falla contra el estado
> anterior a Foundational (o, más simple acá, correrlo recién después de
> Foundational y confirmar que cada assert individual tiene sentido contra
> el comportamiento esperado — la migración y el test se escriben en el
> mismo PR).

- [X] T006 [US1] Crear `supabase/tests/database/catalogo_sistemas_externos.test.sql`
  con: (a) `sistemas_externos` empieza vacía (`count(*) = 0`); (b)
  `throws_ok` con errcode `23503` al llamar `crear_conexion` con un
  `sistema_externo` inexistente; (c) insertar una fila de fixture en
  `sistemas_externos` y confirmar que `crear_conexion` con ese `id`
  funciona igual que antes de esta spec (mismo patrón de fixture que
  `analitica_embebida.test.sql:35-36` para `roles_organizacion`); (d)
  `select` sobre `sistemas_externos` funciona para `authenticated`; (e)
  `throws_ok` con errcode `42501` al intentar `insert` sobre
  `sistemas_externos` como `authenticated` (sin grant de escritura).

### Implementation for User Story 1

- [X] T007 [US1] Actualizar el fixture de
  `supabase/tests/database/orquestacion_multi_organizacion.test.sql`:
  agregar `insert into sistemas_externos (id, descripcion) values
  ('sistema-de-prueba', '...')` junto al resto del fixture inicial (cerca
  de la línea 27, antes del primer uso en línea 332), para que los
  `crear_conexion(..., 'sistema-de-prueba', ...)` existentes sigan
  funcionando con la FK nueva.

**Checkpoint**: User Story 1 funciona y es verificable de forma
independiente corriendo `catalogo_sistemas_externos.test.sql` y
`orquestacion_multi_organizacion.test.sql`.

---

## Phase 4: User Story 2 - Migración aplicable sin datos de negocio previos (Priority: P2)

**Goal**: ningún flujo existente que inserta `conexiones` directo por SQL
(sin pasar por `crear_conexion`) se rompe por la FK nueva — confirma que la
tolerancia de la constraint `not valid` (Foundational) no afecta los tests
que ya cubren otras specs (016, 019, conexión trabada).

**Independent Test**: Validación 5 de `quickstart.md` — `pnpm test` en
verde para los 4 archivos de abajo, sin tocar sus asserts existentes.

### Implementation for User Story 2

- [X] T008 [P] [US2] Actualizar el fixture de
  `supabase/tests/database/ciclo_ejecuciones_workers.test.sql`: agregar
  `insert into sistemas_externos (id, descripcion) values ('sistema-x',
  '...'), ('sistema-y', '...'), ('sistema-x-inactivo', '...')` antes de los
  `insert into conexiones` en las líneas 35 y 174.
- [X] T009 [P] [US2] Actualizar el fixture de
  `supabase/tests/database/conexion_invalida_trabada.test.sql`: agregar
  `insert into sistemas_externos (id, descripcion) values
  ('sistema-trabado', '...')` antes del `insert into conexiones` en la
  línea 21.
- [X] T010 [P] [US2] Actualizar el fixture de
  `supabase/tests/database/ejecucion_en_curso_worker.test.sql`: agregar
  `insert into sistemas_externos (id, descripcion) values
  ('sistema-en-curso', '...')` antes del `insert into conexiones` en la
  línea 17.
- [X] T011 [P] [US2] Actualizar el fixture de
  `supabase/tests/database/outbox_ejecuciones.test.sql`: agregar
  `insert into sistemas_externos (id, descripcion) values ('outbox-x',
  '...'), ('outbox-y', '...')` antes del `insert into conexiones` en la
  línea 26.

**Checkpoint**: toda la suite pgTAP existente de `conexiones` (specs 013,
016, 019 y la de conexión trabada) sigue en verde con la FK nueva activa.

---

## Phase 5: User Story 3 - Reversión documentada sin destruir en el mismo PR (Priority: P3)

**Goal**: confirmar por escrito que esta spec tiene un camino de reversión
explícito y que no destruye ningún objeto existente — gate de la
constitución (Technology and Quality Gates), no cambia comportamiento.

**Independent Test**: revisar el comentario de cabecera de la migración
(T001) contra `data-model.md`.

### Implementation for User Story 3

- [X] T012 [US3] Revisar
  `supabase/migrations/<timestamp>_catalogo_sistemas_externos.sql`
  completa y confirmar que el comentario de cabecera (T001) lista, en
  orden inverso a su creación: `drop constraint
  conexiones_sistema_externo_fkey` y `drop table sistemas_externos`; y que
  ningún `DROP COLUMN` ni `DROP TABLE` sobre objetos preexistentes
  (`conexiones`, cualquier tabla de spec 013) aparece en el archivo.

**Checkpoint**: las 3 historias de usuario de `spec.md` están implementadas
y verificadas de forma independiente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: gates de validación del repo y cierre del PR (sin mergear).

- [X] T013 Correr `pnpm lint`, `pnpm build` e `pnpm infra:config` en verde.
- [X] T014 Con `pnpm dev:supabase` corriendo, correr `pnpm test` completo y
  confirmar que toda la suite pgTAP pasa, incluida
  `catalogo_sistemas_externos.test.sql` (T006) y los 5 archivos con
  fixtures actualizados (T007-T011).
- [X] T015 Ejecutar manualmente contra el stack local las Validaciones 1-4
  de `quickstart.md` (además de que ya estén cubiertas por pgTAP, para
  confirmar el comportamiento end-to-end vía `psql`/SQL Editor, no solo vía
  test).
- [X] T016 Code review real (skill `code-review`) del diff completo de esta
  spec contra `main` antes de avisar "lista para mergear" — instrucción
  explícita del coordinador; esta sesión nunca mergea su propio PR.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Phase 1 (el archivo de migración
  debe existir) — bloquea las 3 historias.
- **User Story 1 (Phase 3, P1)**: depende de Foundational. MVP de esta
  spec.
- **User Story 2 (Phase 4, P2)**: depende de Foundational. Independiente de
  US1 (archivos de test distintos).
- **User Story 3 (Phase 5, P3)**: depende de Foundational (T001 en
  particular). Independiente de US1 y US2 — es solo revisión documental.
- **Polish (Phase 6)**: depende de que las 3 historias estén completas.

### Parallel Opportunities

- T008, T009, T010 y T011 (Phase 4) tocan 4 archivos de test distintos —
  paralelizables entre sí.
- T006 (Phase 3) y T008-T011 (Phase 4) son independientes entre sí (no
  comparten archivo) y pueden correr en paralelo una vez completado
  Foundational.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) + Phase 2 (Foundational): migración completa.
2. Phase 3 (US1): test nuevo + fixture de `orquestacion_multi_organizacion`.
3. **STOP and VALIDATE**: correr `catalogo_sistemas_externos.test.sql` y
   `orquestacion_multi_organizacion.test.sql` — si pasan, el mecanismo de
   integridad referencial (el corazón de esta spec) ya funciona.

### Incremental Delivery

1. Setup + Foundational → migración aplicada localmente.
2. US1 → validar → esto ya es el MVP (FR-001 a FR-004 cubiertos).
3. US2 → validar → confirma que nada de spec 013/016/019 se rompió.
4. US3 → validar → cierra el gate de reversión de la constitución.
5. Polish → gates de CI + code review → avisar al coordinador, sin mergear.

---

## Notes

- Ninguna tarea toca `apps/web` ni `workers/` (Delivery scope: `supabase`).
- Ningún `insert` de valores de negocio (nombres reales de sistemas
  externos) en ninguna tarea — los `id` usados en tests (`'sistema-x'`,
  `'demo'`, etc.) son fixtures de prueba de este template, no datos de
  producto derivado.
- Cortar con `/clear` entre fases si se implementa fase por fase (regla de
  CLAUDE.md) — dado el tamaño acotado de esta spec, también es razonable
  correr Foundational + US1 + US2 + US3 en una sola pasada de
  `/speckit-implement` y revisar en los checkpoints marcados arriba.
