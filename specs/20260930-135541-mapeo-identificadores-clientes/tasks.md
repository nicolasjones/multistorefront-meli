---

description: "Task list template for feature implementation"
---

# Tasks: Mapeo de identificadores externos de clientes

**Input**: Design documents from `specs/20260930-135541-mapeo-identificadores-clientes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/mapeo-identificadores-externos.md, quickstart.md

**Tests**: incluidos y no opcionales — la constitución de este repo exige
prueba pgTAP de aislamiento para todo cambio sensible de RLS ("Technology
and Quality Gates"), y esta spec es justamente eso.

**Desvío post-implementación**: code review (skill `code-review`) encontró
que T003 no había agregado las policies de insert/delete "cinturón de
seguridad" que `data-model.md`/`research.md` ya describían, y que faltaban
casos de prueba de FR-003/FR-008 — ver commit 14ff74f.

**Organization**: toda la spec vive en un único archivo de migración
(mismo patrón que las specs 003 y 013 de este repo: tabla + RLS + funciones
en un solo `.sql`), así que las tareas de distintas historias comparten
archivo y se marcan sin `[P]` cuando tocan el mismo archivo en secuencia.
El único archivo de test pgTAP también es compartido y se completa de forma
incremental, historia por historia.

## Path Conventions

- Migración: `supabase/migrations/20260930140000_mapeo_identificadores_clientes.sql`
- Test pgTAP: `supabase/tests/database/mapeo_identificadores_clientes.test.sql`

---

## Phase 1: Setup

**Purpose**: crear el archivo de migración con el encabezado de convención de este repo.

- [X] T001 Crear `supabase/migrations/20260930140000_mapeo_identificadores_clientes.sql` con el comentario de encabezado (spec, qué agrega, referencia a `specs/20260930-135541-mapeo-identificadores-clientes/`), siguiendo el estilo de `supabase/migrations/20260908172920_fundacion_multitenant.sql`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: la tabla, sus restricciones y la lectura por RLS — todo lo que las tres historias necesitan antes de poder vincular, consultar o desvincular nada.

**⚠️ CRITICAL**: ninguna historia puede empezar hasta terminar esta fase.

- [X] T002 En la migración de T001, crear la tabla `clientes_identificadores_externos` (`id uuid` PK default `gen_random_uuid()`, `cliente_id uuid not null references public.clientes(id) on delete cascade`, `sistema text not null`, `identificador_externo text not null`, `created_at timestamptz not null default now()`), con `unique (sistema, identificador_externo)`, `check (btrim(sistema) <> '' and btrim(identificador_externo) <> '')` y el índice `clientes_identificadores_externos_cliente_id_idx` sobre `cliente_id` — todo según `data-model.md`.
- [X] T003 En la misma migración, `alter table clientes_identificadores_externos enable row level security;` y crear la policy `clientes_identificadores_externos_select` (`for select to authenticated using (exists (select 1 from public.clientes c where c.id = clientes_identificadores_externos.cliente_id and c.organizacion_id = private.organizacion_id()))`), según `data-model.md` § RLS.
- [X] T004 En la misma migración, agregar los `grant` de la sección de grants (`grant select on clientes_identificadores_externos to authenticated;` — sin `insert`/`update`/`delete` a `authenticated`, ver `research.md` Decisión 1), junto al resto de grants ya existentes en el archivo.
- [X] T005 Crear `supabase/tests/database/mapeo_identificadores_clientes.test.sql` con el `plan()` inicial y los fixtures compartidos (dos organizaciones, un administrador y un miembro por organización, un cliente por organización), siguiendo el estilo de `supabase/tests/database/aislamiento_organizaciones.test.sql` y `orquestacion_multi_organizacion.test.sql`.

**Checkpoint**: tabla, RLS de lectura y fixtures de test listos — las historias pueden empezar.

---

## Phase 3: User Story 1 - Vincular un identificador externo a un cliente (Priority: P1) 🎯 MVP

**Goal**: un administrador (o quien actúa en su nombre) puede vincular el identificador de un cliente en un sistema externo a la fila de `clientes` correspondiente, sin que el mismo identificador termine en dos clientes.

**Independent Test**: vincular un identificador de un sistema ficticio a un cliente existente y confirmar que el vínculo queda creado y es rechazado si se repite contra otro cliente (quickstart.md pasos 1-3).

### Implementation for User Story 1

- [X] T006 [US1] En la migración de T001, crear `public.vincular_identificador_externo(p_cliente_id uuid, p_sistema text, p_identificador_externo text) returns public.clientes_identificadores_externos` (`language plpgsql security definer set search_path = ''`): resuelve `v_organizacion_id` desde `clientes` por `p_cliente_id` (si no existe, `raise exception ... errcode = 'P0002'`), valida `private.es_administrador_de(v_organizacion_id)` (si no, `errcode = '42501'`), hace `insert ... on conflict (sistema, identificador_externo) do nothing returning *` y si la fila resultante no es de `p_cliente_id` hace `raise exception ... errcode = '23505'` con mensaje explícito — según `data-model.md` § Funciones y `contracts/mapeo-identificadores-externos.md` punto 1.
- [X] T007 [US1] En la misma migración, agregar `comment on function public.vincular_identificador_externo(...)` (referenciando el contrato), `revoke execute ... from public;` y `grant execute ... to authenticated;` — mismo patrón que `crear_conexion` en `20260914150000_orquestacion_multi_organizacion.sql`.
- [X] T008 [US1] En `supabase/tests/database/mapeo_identificadores_clientes.test.sql`, agregar los casos de esta historia: un administrador vincula un identificador nuevo y la fila queda creada; re-vincular el mismo par al mismo cliente no crea una segunda fila ni falla (FR-004); vincular un identificador ya usado por otro cliente falla y no altera el vínculo original (FR-002, FR-010); vincular a un cliente de otra organización falla; vincular con `sistema` o `identificador_externo` vacíos falla (FR-011); un miembro sin rol de administrador no puede vincular (FR-009).

**Checkpoint**: la Historia 1 es funcional y probable de forma independiente — vincular funciona y respeta la unicidad y el aislamiento.

---

## Phase 4: User Story 2 - Resolver el cliente a partir de un identificador externo, o los identificadores de un cliente (Priority: P2)

**Goal**: consultar el mapeo en ambos sentidos (por cliente, y por sistema+identificador), acotado a la organización de quien consulta.

**Independent Test**: con vínculos ya creados por la Historia 1, listarlos por cliente y resolverlos por identificador, y confirmar que un usuario de otra organización no ve nada (quickstart.md pasos 4-5).

### Implementation for User Story 2

- [X] T009 [US2] En `supabase/tests/database/mapeo_identificadores_clientes.test.sql`, agregar los casos de esta historia sobre la policy de lectura ya creada en T003: un miembro (sin rol de administrador) de la organización dueña puede listar los identificadores de un cliente y resolver un cliente por `(sistema, identificador_externo)`; un usuario de otra organización no obtiene ninguna fila en ninguna de las dos consultas, aunque conozca el `cliente_id` o el par exacto (FR-005, FR-006, FR-008, SC-003).

**Checkpoint**: las Historias 1 y 2 funcionan juntas — vincular y consultar de punta a punta.

---

## Phase 5: User Story 3 - Desvincular un identificador externo (Priority: P3)

**Goal**: eliminar un vínculo existente, liberando el identificador para que pueda vincularse a otro cliente.

**Independent Test**: crear un vínculo con la Historia 1, eliminarlo, confirmar que ya no aparece en las consultas de la Historia 2 y que el identificador queda libre (quickstart.md paso 6).

### Implementation for User Story 3

- [X] T010 [US3] En la migración de T001, crear `public.desvincular_identificador_externo(p_id uuid) returns void` (`language plpgsql security definer set search_path = ''`): resuelve `v_organizacion_id` con un join de `clientes_identificadores_externos` a `clientes` por `p_id` (si no existe la fila, retorna sin error — no-op, FR-007), valida `private.es_administrador_de(v_organizacion_id)` (si no, `errcode = '42501'`), y `delete from public.clientes_identificadores_externos where id = p_id` — según `data-model.md` § Funciones y `contracts/mapeo-identificadores-externos.md` punto 4.
- [X] T011 [US3] En la misma migración, agregar `comment on function public.desvincular_identificador_externo(uuid)`, `revoke execute ... from public;` y `grant execute ... to authenticated;`.
- [X] T012 [US3] En `supabase/tests/database/mapeo_identificadores_clientes.test.sql`, agregar los casos de esta historia: un administrador desvincula un identificador propio y deja de aparecer en las consultas de la Historia 2, y el mismo par vuelve a estar disponible para vincularse a otro cliente; desvincular un `id` inexistente no falla (FR-007); un miembro sin rol de administrador no puede desvincular; un usuario de otra organización no puede desvincular un vínculo ajeno (FR-009).

**Checkpoint**: las tres historias funcionan juntas — vincular, consultar y desvincular.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: validar los invariantes que cruzan las tres historias y cerrar la spec.

- [X] T013 [P] En `supabase/tests/database/mapeo_identificadores_clientes.test.sql`, agregar el caso de eliminación en cascada: al eliminar un `cliente`, sus filas en `clientes_identificadores_externos` desaparecen solas, sin necesidad de desvincularlas antes (FR-010, SC-004).
- [X] T014 Correr `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test` (con `pnpm dev:supabase` corriendo) hasta que los cuatro pasen en verde.
- [X] T015 Ejecutar manualmente los pasos de `quickstart.md` y registrar el resultado en una sección "Ejecución registrada" al final de ese archivo, siguiendo el formato ya usado en `specs/013-orquestacion-multi-organizacion/quickstart.md`.

**Checkpoint**: spec completa, migración y tests en verde, quickstart validado y documentado.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Phase 1 — bloquea las tres historias.
- **User Story 1 (Phase 3)**: depende de Foundational. Es la única con dependencias de implementación reales hacia las demás (US2 y US3 consultan/eliminan filas que US1 crea), pero es probable de forma independiente por sí sola.
- **User Story 2 (Phase 4)**: depende de Foundational (la policy de T003) y usa datos creados por US1 para su prueba, pero no depende de ningún código nuevo de US1 — solo de la tabla y la policy.
- **User Story 3 (Phase 5)**: depende de Foundational; su prueba usa un vínculo creado con la función de US1.
- **Polish (Phase 6)**: depende de que las tres historias estén completas.

### Dentro de cada historia

- Todas las tareas de una misma historia tocan el mismo archivo de migración y/o el mismo archivo de test → se ejecutan en el orden listado, sin `[P]`.
- Las únicas tareas paralelizables son T013 respecto de tareas de otras fases que no toquen el mismo archivo al mismo tiempo (marcada `[P]` porque es un caso de prueba independiente que puede escribirse sin esperar a T014/T015).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Fase 1 (Setup) + Fase 2 (Foundational).
2. Fase 3 (Historia 1 — vincular). En este punto ya hay valor: un cliente puede tener un identificador externo vinculado con unicidad garantizada.
3. Validar la Historia 1 de forma independiente (quickstart.md pasos 1-3) antes de seguir.

### Incremental Delivery

1. Setup + Foundational → base lista.
2. Historia 1 (vincular) → validar → MVP.
3. Historia 2 (consultar) → validar → el mapeo ya es útil de punta a punta.
4. Historia 3 (desvincular) → validar → mecanismo completo.
5. Polish (cascada, `pnpm lint`/`build`/`infra:config`/`test`, quickstart documentado) → cierre.
