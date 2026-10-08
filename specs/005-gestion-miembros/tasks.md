---
description: "Task list for management of organization members"
---

# Tasks: Gestión de miembros de organización

**Input**: Documentos de diseño de `specs/005-gestion-miembros/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: La constitución exige pgTAP para cambios sensibles de RLS. Cada historia incorpora primero sus aserciones de aislamiento, autorización y auditoría en `supabase/tests/database/aislamiento_organizaciones.test.sql`; no se agrega una suite nueva de Edge Functions porque el proyecto aún no tiene runner de Deno configurado. Los recorridos de la función se validan manualmente en `quickstart.md` con Supabase local y Mailpit.

**Organización**: por historia de usuario y prioridad. La migración única se construye aditivamente a través de las fases, antes de aplicarla; no se crea una migración nueva por cada tarea.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias)
- **[Story]**: US1, US2, US3

## Phase 1: Setup

- [X] T001 Confirmar `pnpm dev:supabase` corriendo, que `supabase/migrations/20260908221453_contexto_organizacion_activa.sql` está aplicada y que `git status` está limpio antes de implementar.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: preparar las primitivas compartidas de autorización y auditoría sin exponer escrituras directas de membresías al navegador.

**⚠️ CRITICAL**: ninguna historia empieza hasta cerrar esta fase.

- [X] T002 Crear `supabase/migrations/<timestamp>_gestion_miembros.sql` con la tabla append-only `eventos_membresia`, sus índices, RLS y grants explícitos; agregar `private.puede_gestionar_membresias(organizacion_id uuid)` sin exponer funciones `security definer` de búsqueda de `auth.users` (research.md, data-model.md).
- [X] T003 Extender el fixture base y el `plan()` de `supabase/tests/database/aislamiento_organizaciones.test.sql` con dos administradores en la organización Uno y cuentas existentes sin/ con membresía para las tres historias (depende de T002).
- [X] T004 [P] Crear `apps/web/src/hooks/usePuedeGestionarMembresias.ts` para resolver solo los controles de UI de administrador o superadmin con organización activa, sin sustituir la autorización del servidor (depende de T002).

**Checkpoint**: existe auditoría, helper de autorización por organización y fixture determinístico; aún no hay pantalla ni mutaciones disponibles.

---

## Phase 3: User Story 1 - Consultar e invitar miembros (Priority: P1) 🎯 MVP

**Goal**: un administrador lista miembros de su propia organización e incorpora una cuenta nueva por correo o una cuenta existente sin membresía, manteniendo aislamiento y auditoría.

**Independent Test**: como administrador de la organización Uno, abrir Miembros, ver solo sus miembros, sumar una cuenta nueva y una existente sin membresía; un miembro, un administrador de Dos y un superadmin sin contexto no pueden listar ni incorporar en Uno.

### Tests for User Story 1

- [X] T005 [US1] Agregar primero aserciones pgTAP de lectura de `usuarios_organizacion` para administrador, miembro, otra organización y superadmin sin/con organización activa en `supabase/tests/database/aislamiento_organizaciones.test.sql` (FR-001, FR-007, FR-008, FR-009).
- [X] T006 [US1] Agregar aserciones pgTAP de incorporación autorizada por administrador y superadmin con organización activa, duplicado, pertenencia cruzada y eventos `invitacion_enviada`/`miembro_agregado` en `supabase/tests/database/aislamiento_organizaciones.test.sql` (FR-002, FR-003, FR-008, FR-010).

### Implementation for User Story 1

- [X] T007 [US1] Completar `supabase/migrations/<timestamp>_gestion_miembros.sql` con la policy de lectura limitada a membresía propia o a organización gestionable y la operación transaccional que inserta la membresía y su auditoría, sin grants `insert/update/delete` a `authenticated` (depende de T005, T006).
- [X] T008 [US1] Crear `supabase/functions/invitar-miembro/index.ts` según `contracts/invitar-miembro.md`: validar JWT y contexto, invitar cuentas nuevas con service-role, vincular cuentas existentes sin membresía sin correo, y compensar cualquier alta incompleta sin registrar auditoría efectiva (depende de T007).
- [X] T009 [P] [US1] Crear `apps/web/src/pages/miembros/list.tsx` y `apps/web/src/pages/miembros/create.tsx` con listado aislado, formulario email/rol, estados de carga/error y mensajes de rechazo del contrato (depende de T004, T008).
- [X] T010 [US1] Agregar `miembros` a `apps/web/src/lib/recursosDependientesDeOrganizacion.ts`, registrar recurso/rutas protegidas en `apps/web/src/App.tsx` y extender `apps/web/src/providers/accessControlProvider.ts` para que miembro no vea la gestión aunque conserve su lectura propia (depende de T009).
- [X] T011 [US1] Aplicar la migración y ejecutar `pnpm test:db`; validar la invitación nueva en Mailpit y la vinculación de cuenta existente con los bloques 1 a 3 de `specs/005-gestion-miembros/quickstart.md` (depende de T010).

**Checkpoint**: US1 es usable y verificable de forma independiente; una organización puede consultar e incorporar miembros sin intervención del superadmin.

---

## Phase 4: User Story 2 - Cambiar el rol de un miembro (Priority: P2)

**Goal**: el administrador puede promover/degradar a otra persona de su organización sin que una carrera o una acción directa deje la organización sin administrador.

**Independent Test**: con dos administradores y un miembro en Uno, promover al miembro y degradar al otro administrador; intentar degradar al último administrador y confirmar que no cambia ni queda auditado.

### Tests for User Story 2

- [X] T012 [US2] Agregar antes las aserciones pgTAP para promover/degradar dentro de la organización, rechazar actor/objetivo cruzado o auto-modificación, proteger el último administrador y registrar `rol_cambiado` en `supabase/tests/database/aislamiento_organizaciones.test.sql` (FR-004, FR-006, FR-007, FR-010).

### Implementation for User Story 2

- [X] T013 [US2] Completar `supabase/migrations/<timestamp>_gestion_miembros.sql` con `cambiar_rol_miembro(target_user_id uuid, nuevo_rol text)`, que bloquea la organización antes de contar administradores, valida el helper y escribe el evento en la misma transacción; otorgar solo `execute` a `authenticated` (depende de T012).
- [X] T014 [US2] Extender `apps/web/src/pages/miembros/list.tsx` con control de cambio de rol, confirmación, estados de error y recarga del listado tras una respuesta exitosa según `contracts/cambiar-rol-miembro.md` (depende de T013).
- [X] T015 [US2] Aplicar la versión final de la migración, correr `pnpm test:db` y validar el bloque 4 de `specs/005-gestion-miembros/quickstart.md` para promoción, degradación y último administrador (depende de T014).

**Checkpoint**: US1 y US2 funcionan; los administradores delegan o revocan rol sin vulnerar aislamiento ni perder el último administrador.

---

## Phase 5: User Story 3 - Remover un miembro (Priority: P3)

**Goal**: el administrador revoca de forma inmediata la membresía de otra persona, preservando al menos un administrador y la auditoría.

**Independent Test**: remover a un miembro de Uno y confirmar que pierde acceso; remover un administrador cuando queda otro; intentar remover al último administrador y confirmar rechazo sin efectos.

### Tests for User Story 3

- [X] T016 [US3] Agregar antes las aserciones pgTAP de remoción autorizada, intento cruzado, auto-remoción, último administrador, pérdida de acceso y evento `miembro_removido` en `supabase/tests/database/aislamiento_organizaciones.test.sql` (FR-005, FR-006, FR-007, FR-010).

### Implementation for User Story 3

- [X] T017 [US3] Completar `supabase/migrations/<timestamp>_gestion_miembros.sql` con `remover_miembro(target_user_id uuid)`, que bloquea la organización, impide auto-remoción/último administrador, elimina solo la membresía y audita en la misma transacción; otorgar solo `execute` a `authenticated` (depende de T016).
- [X] T018 [US3] Extender `apps/web/src/pages/miembros/list.tsx` con la acción de remoción, confirmación, mensajes de rechazo y actualización del listado según `contracts/remover-miembro.md` (depende de T017).
- [X] T019 [US3] Aplicar la versión final de la migración, correr `pnpm test:db` y repetir el bloque 4 de `specs/005-gestion-miembros/quickstart.md` para confirmar pérdida de acceso y protección del último administrador (depende de T018).

**Checkpoint**: todas las historias son funcionales e independientes; una remoción efectiva revoca acceso y deja auditoría.

---

## Phase Final: Polish & Cross-Cutting Concerns

- [X] T020 [P] Revisar `supabase/functions/invitar-miembro/index.ts` y `supabase/migrations/<timestamp>_gestion_miembros.sql` para que no haya service-role en el navegador, grants implícitos ni escritura directa de auditoría; documentar cualquier desvío en `specs/005-gestion-miembros/tasks.md` con el commit correspondiente.
- [X] T021 Ejecutar los cinco bloques de `specs/005-gestion-miembros/quickstart.md` completos con al menos dos organizaciones, Mailpit y una cuenta existente sin membresía; cronometrar la incorporación nueva y confirmar que tarda menos de 2 minutos (SC-002).
- [X] T022 Ejecutar `pnpm lint`, `pnpm build`, `pnpm test` y `pnpm infra:config`, y registrar resultados en `specs/005-gestion-miembros/tasks.md`.
- [X] T023 Marcar las tareas completadas y anotar en `specs/005-gestion-miembros/tasks.md` únicamente desvíos concisos con referencia al commit que los justifica.

## Validación de cierre

- 2026-09-09: bloques 1 a 4 verificados durante T011, T015 y T019 en dos organizaciones; la incorporación nueva de cierre apareció en el listado y Mailpit en menos de 15 segundos, con evento `invitacion_enviada` en la organización activa.
- 2026-09-09: `pnpm test:db` (63 pruebas), `pnpm lint`, `pnpm build`, `pnpm test` y `pnpm infra:config` finalizaron correctamente. Build conserva solo la advertencia no bloqueante por tamaño de bundle; infraestructura advierte que `GH_RUNNER_PAT` no está definido en local.

## Desvío

- Los RPCs de rol y remoción se entregaron en migraciones aditivas separadas porque la de US1 ya estaba aplicada; ver commits `c49f873` y `ef0b216`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de Setup y bloquea todas las historias.
- **US1 (Fase 3)**: depende de Foundational; entrega el MVP de listado e incorporación.
- **US2 (Fase 4)**: depende de Foundational y reutiliza el listado de US1 para su UI.
- **US3 (Fase 5)**: depende de Foundational y reutiliza el listado de US1 para su UI.
- **Polish (Final)**: depende de US1, US2 y US3.

### User Story Dependencies

- **US1 (P1)**: puede cerrarse sola después de Foundational.
- **US2 (P2)**: la operación de base es independiente de US1, pero su control visible se monta sobre el listado creado por US1; implementar secuencialmente para evitar conflicto en `apps/web/src/pages/miembros/list.tsx`.
- **US3 (P3)**: igual que US2; su RPC puede diseñarse tras Foundational, pero su UI espera el listado de US1.

### Parallel Opportunities

- T004 puede correr en paralelo con T003 una vez creada la migración de Foundation.
- T005 y T006 pueden escribirse en paralelo si se coordinan sobre bloques distintos del mismo archivo de tests; de lo contrario, hacerlas secuencialmente para evitar conflicto.
- T008 (Edge Function) y T009 (pantallas) pueden comenzar en paralelo una vez T007 deja definido el contrato de incorporación.
- T012 y T016 pueden preparar sus aserciones pgTAP en paralelo después de T011, aunque sus implementaciones de migración/UI se ejecutan por fase.
- T020 puede realizarse en paralelo con la validación manual T021.

---

## Implementation Strategy

### MVP First (US1)

1. Completar Fase 1 y Fase 2.
2. Completar T005 a T011: listado aislado e incorporación segura.
3. **Parar y validar** US1 con pgTAP, Refine y Mailpit.

### Incremental Delivery

1. Foundation → autorización/auditoría reutilizable.
2. US1 → listado e incorporación; commit propio.
3. US2 → cambio de rol y último administrador; commit propio.
4. US3 → remoción y revocación de acceso; commit propio.
5. Polish → validación integral y cierre de la spec.
