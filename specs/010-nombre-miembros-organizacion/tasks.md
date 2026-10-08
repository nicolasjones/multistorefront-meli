# Tasks: Nombre visible entre miembros de una organización

**Input**: Design documents from `/specs/010-nombre-miembros-organizacion/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/listar-miembros-organizacion.md, quickstart.md (todos presentes).

**Tests**: pgTAP es obligatorio para la función nueva y su aislamiento
multi-tenant (constitución, Principio I — cambio sensible de acceso
cross-fila). Se agrega además un Vitest puntual para el mapeo
nombre/apellido y el texto de fallback en la pantalla de miembros — ver
`plan.md`, sección Testing.

**Organization**: Una única historia de usuario (P1) — no hay fases
adicionales por historia.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (archivo distinto, sin dependencia de una tarea todavía incompleta)
- **[Story]**: a qué historia de usuario pertenece (US1)

---

## Phase 1: Setup

**Purpose**: preparar los archivos de edición y de prueba, sin lógica todavía.

- [X] T001 [P] Crear `supabase/migrations/20260911140000_nombre_miembros_organizacion.sql` con el comentario de reversión (`drop function public.listar_miembros_organizacion();`) y sin contenido más allá de eso todavía.
- [X] T002 [P] Crear el esqueleto de `supabase/tests/database/nombre_miembros_organizacion.test.sql` con el fixture multi-tenant (dos organizaciones; en la organización A una persona con perfil completo y otra sin completar) — mismo patrón que `supabase/tests/database/perfil_usuario.test.sql`.

**Checkpoint**: archivos listos para completar en la fase siguiente.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: la función RPC de la que dependen tanto los tests como la pantalla.

**⚠️ CRITICAL**: la historia de usuario no puede implementarse sin esta fase.

- [X] T003 En la migración de T001: crear `public.listar_miembros_organizacion()` (`stable`, `security definer`, `set search_path = ''`) según `contracts/listar-miembros-organizacion.md` — resuelve `v_organizacion_id := private.organizacion_id()`, devuelve conjunto vacío si es `null` o si `not private.puede_gestionar_membresias(v_organizacion_id)` (el chequeo de rol vive en la función, no solo en `accessControlProvider.ts`), y si pasa ambos hace `left join` de `usuarios_organizacion` (filtrado por `organizacion_id = v_organizacion_id`) a `perfiles_usuario` por `user_id`, retornando `(user_id, rol_id, created_at, nombre, apellido)`. El `left join` es obligatorio (FR-004): una persona sin fila en `perfiles_usuario` debe aparecer igual, con `nombre`/`apellido` en `null`.
- [X] T004 En el mismo archivo: `revoke execute on function public.listar_miembros_organizacion() from public; grant execute on function public.listar_miembros_organizacion() to authenticated;` — mismo patrón que `entrar_a_organizacion`/`salir_de_organizacion`.
- [X] T005 Completar `supabase/tests/database/nombre_miembros_organizacion.test.sql` (pgTAP) con los 7 casos de `quickstart.md`: (1) un administrador de la organización A recibe la fila de un compañero de A con nombre/apellido; (2) ese mismo llamador no recibe ninguna fila de la organización B; (3) un compañero sin perfil completado aparece con `nombre`/`apellido` en `null`, no ausente; (4) tras `remover_miembro` (spec 005) esa persona deja de aparecer; (5) `select nombre, apellido from perfiles_usuario` directo (sin pasar por la función) sigue devolviendo solo la fila propia — confirma que `perfiles_usuario_select_titular` no cambió; (6) un superadmin con esta organización activa (spec 003/004) recibe el mismo listado que un administrador de esa organización (FR-006); (7) un miembro no-administrador de A que llama `listar_miembros_organizacion()` directamente (sin pasar por la pantalla) recibe conjunto vacío — confirma que el chequeo de `puede_gestionar_membresias` vive en la función, no solo en el frontend. `pnpm test` en verde junto con `perfil_usuario.test.sql` sin modificar ese archivo.

**Checkpoint**: la función existe, está probada con pgTAP y aislada por organización — recién acá arranca la historia de usuario.

---

## Phase 3: User Story 1 - Identificar a un compañero por nombre en la pantalla de miembros (Priority: P1) 🎯 MVP

**Goal**: un administrador (o superadmin operando la organización) ve
nombre y apellido de cada persona en la pantalla de miembros en vez de su
`user_id` crudo.

**Independent Test**: con dos personas en la misma organización, una con
nombre y apellido cargados en su perfil, iniciar sesión como administrador
de esa organización y confirmar que la pantalla de miembros muestra
"Nombre Apellido" en vez del UUID de esa persona (spec.md, Acceptance
Scenario 1).

### Implementation for User Story 1

- [X] T006 [US1] En `apps/web/src/pages/miembros/list.tsx`: reemplazar `useTable<Miembro>({ resource: 'usuarios_organizacion' })` por una llamada directa a `supabaseClient.rpc('listar_miembros_organizacion')` en estado local (mismo patrón ya usado en el archivo para `FotoMiembro` y las RPCs de cambio de rol/remoción); ampliar el tipo `Miembro` a `{ user_id: string; rol_id: string; created_at: string; nombre: string | null; apellido: string | null }`.
- [X] T007 [US1] En el mismo archivo: dos columnas separadas "Apellido" y "Nombre" (en vez de una columna "Usuario" combinada — ajuste pedido por el usuario tras el `/speckit-converge`), cada una mostrando su valor o el texto explícito "Sin apellido completado" / "Sin nombre completado" cuando es `null` — nunca el `user_id` crudo ni un espacio vacío (FR-003, FR-004, SC-003).
- [X] T008 [US1] En el mismo archivo: reemplazar los `await tableQuery.refetch()` (tras `confirmarCambio` y `removerMiembro`) por una función propia que vuelve a invocar la RPC y actualiza el estado local con el resultado.
- [X] T009 [P] [US1] Actualizar `apps/web/src/pages/miembros/list.test.tsx`: reemplazar el mock de `useTable` por un mock de `supabaseClient.rpc('listar_miembros_organizacion', ...)` que devuelve filas con `nombre`/`apellido`; agregar un caso que confirme el texto "Sin nombre completado" cuando son `null` y otro que confirme que la columna "Usuario" ya no imprime el `user_id` crudo cuando hay nombre cargado.

**Checkpoint**: la pantalla de miembros muestra nombre/apellido de punta a punta, con aislamiento entre organizaciones y fallback explícito (quickstart.md, secciones 1-3).

---

## Phase 4: Polish & Cross-Cutting Concerns

- [X] T010 Correr `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test` (requiere `pnpm dev:supabase` corriendo) — comandos de validación de `CLAUDE.md` — con todo lo anterior aplicado.
- [X] T011 Ejecutar manualmente la sección "Validación manual end-to-end" de `quickstart.md` (pasos 1-5, tres cuentas administradoras en dos organizaciones) y anotar cualquier desvío en este archivo, con referencia al commit que lo resuelve.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — arranca de inmediato.
- **Foundational (Phase 2)**: depende de Setup — bloquea la historia de usuario.
- **User Story 1 (Phase 3)**: depende de Foundational (T003, T004) — la RPC debe existir antes de que la pantalla la consuma.
- **Polish (Phase 4)**: depende de que la Fase 3 esté completa.

### User Story Dependencies

- **US1 (P1)**: única historia de esta spec; solo depende de Foundational.

### Parallel Opportunities

- T001, T002 (Setup) — archivos distintos, en paralelo.
- T009 (Vitest) puede escribirse en paralelo con T006-T008 una vez exista el contrato de la RPC (T003) — archivo distinto (`list.test.tsx` vs `list.tsx`).

---

## Parallel Example: Setup

```bash
# T001 y T002 no dependen entre sí para poder escribirse:
Task: "Crear supabase/migrations/20260911140000_nombre_miembros_organizacion.sql (solo comentario de reversión)"
Task: "Crear el esqueleto de supabase/tests/database/nombre_miembros_organizacion.test.sql"
```

---

## Implementation Strategy

### MVP First (única historia)

1. Setup + Foundational (función `listar_miembros_organizacion()` probada con pgTAP).
2. User Story 1 completa (pantalla de miembros consumiendo la RPC).
3. Validar con `quickstart.md` de punta a punta.
4. Esta spec no tiene incremento posterior — US1 es el 100% del alcance de negocio (spec.md, "Why this priority").

### Incremental Delivery

1. Setup + Foundational → RPC lista y probada.
2. US1 → la pantalla de miembros identifica personas por nombre; listo para demo/deploy.

---

## Notes

- Sin tareas de contract test dedicadas (`tests/contract/`) — el contrato
  de la RPC se verifica con pgTAP (T005), igual que en specs anteriores
  (007, 009).
- Las notas de desvío respecto a este plan van acá, cortas, con
  referencia al commit (`ver commit <hash>`) — la razón completa vive en
  el mensaje de commit (regla de `CLAUDE.md`).
