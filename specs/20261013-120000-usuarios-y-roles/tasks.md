# Tasks: Acceso, organización y permisos · Usuarios y roles

**Input**: `specs/20261013-120000-usuarios-y-roles/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`. `F-XXX-NN` es el marcador de la historia Jira por crear; reemplazar por la clave real (MSF-N). Épica: MSF-125.

**Delivery scope**: `refine`, `supabase`

**Orden**: por bloqueos, F-ROL-01 → F-ROL-03 → F-USR-01 → F-USR-02 → F-ROL-02. `/speckit-implement` fase por fase con `/clear` entre fases.

## Phase 1: US1 — Roles básicos y permisos por organización (F-ROL-01, P0) 🎯 MVP

**Goal**: seis roles y permisos por sección/acción por organización, en RLS y en el panel.

**Independent Test**: pgTAP por rol + UI de menú/rutas.

- [x] T001 [F-ROL-01][US1] Migración aditiva: filas `operador`, `consulta`, `mostrador`, `deposito`, `administracion` en `roles_organizacion` (FR-001)
- [x] T002 [F-ROL-01][US1] Migración: tabla `permisos_rol` (`public`) con RLS por organización y check de Administrador siempre `edicion` (FR-002, FR-003, FR-016)
- [x] T003 [F-ROL-01][US1] Migración: tabla `permisos_rol_accion` (`public`) con RLS por organización (FR-006, FR-016)
- [x] T004 [F-ROL-01][US1] Función `private.sembrar_permisos(organizacion_id)` con la matriz de `Roles.dc.html`, llamada al crear organización y backfill de las existentes (FR-002)
- [x] T005 [F-ROL-01][US1] Funciones `private.nivel_seccion(seccion)` y `private.puede_accion(seccion, accion)` con GRANT explícito; excluyen Suspendido; superadmin con organización activa = administrador (FR-004, FR-006)
  - Desvío: `estado` (MSF-119) aún no existe en esta rama; `nivel_seccion` no puede excluir Suspendido todavía — queda anotado en la migración y en `docs/permisos-por-rol.md` (ver commit 7f0050e).
- [x] T006 [F-ROL-01][US1] Documentar camino de reversión de las migraciones en el plan/migración (FR-016)
- [x] T007 [F-ROL-01][US1] pgTAP `permisos_por_rol.test.sql`: cada uno de los seis roles ve/escribe solo lo que su matriz permite (SC-002)
- [x] T008 [F-ROL-01][US1] pgTAP: aislamiento entre organizaciones de `permisos_rol`/`permisos_rol_accion`; el test de RLS recorre las tablas nuevas (FR-016)
- [x] T009 [F-ROL-01][US1] pgTAP de regresión: tablas que usan `private.puede_escribir()` conservan su comportamiento (escenario 9)
- [x] T010 [F-ROL-01][US1] Revisar `GrillaPermisosPorRol.tsx`, `accessControlProvider` y `usePuedeEscribir` del template; decidir reutilizar/reemplazar sin romper sus tests; revisar además `pages/miembros` para absorberla en Usuarios (FR-019)
  - Decisión: `GrillaPermisosPorRol` (reportes × roles) y `usePuedeEscribir` se conservan sin cambios; `pages/miembros` se absorbe en Usuarios en F-USR-01/02, no acá (ver commit 1edaeff).
- [x] T011 [F-ROL-01][US1] Hooks `useNivelSeccion` y `usePuedeAccion` y extensión del `accessControlProvider` por sección y acción (FR-005)
- [x] T012 [F-ROL-01][US1] Menú lateral: ocultar secciones sin acceso (FR-005)
- [x] T013 [F-ROL-01][US1] Tests Vitest de menú y rutas por nivel (edición / solo lectura / sin acceso)
- [x] T014 [F-ROL-01][US1] Redactar `docs/permisos-por-rol.md`: contrato `private.nivel_seccion`/`puede_accion` para las demás épicas (FR-007)

**Checkpoint**: `pnpm lint`, `pnpm build`, `pnpm test` (con `pnpm dev:supabase`) verdes.

## Phase 2: US2 — Pantalla de acceso restringido (F-ROL-03, P0)

**Goal**: pantalla clara cuando el control de acceso niega la sección.

**Independent Test**: E2E: Operador abre Rentabilidad por URL.

- [x] T015 [F-ROL-03][US2] Pantalla de acceso restringido con componentes del sistema de diseño, según `AccesoRestringido.dc.html` (FR-008)
- [x] T016 [F-ROL-03][US2] Mostrarla desde el `accessControlProvider` en lugar de la sección denegada, con rol y sección reales, sin cargar datos (FR-008) — guard `RequiereAccesoSeccion` sobre las rutas de clientes y miembros (ver commit b12ba10), con la matriz de MSF-258 (el provider sigue ocultando el menú); tests Vitest
- [ ] T017 [F-ROL-03][US2] «Volver al inicio» y «Solicitar acceso» con confirmación «Solicitud enviada al administrador» (FR-008) — «Volver al inicio» hecho; «Solicitar acceso» fuera de alcance por decisión del orquestador
- [ ] T018 [F-ROL-03][US2] Accesibilidad (teclado, lector de pantalla, 320/768/1440 px) y tests Vitest (FR-017) — hecho: tests Vitest y enlace operable por teclado; el motivo se anuncia por `role="alert"` de `EstadoVacio` (test); PENDIENTE: verificación a 320/768/1440 px y lector de pantalla manual y criterio 1 «Rentabilidad» (no hay ruta `/rentabilidad`): se cubren con el E2E T019, historia aparte
- [ ] T019 [F-ROL-03][US2] E2E: un Operador abre Rentabilidad por URL y ve la pantalla (insumo para verificar CA-EMP-01-4 de MSF-138)

**Checkpoint**: tests verdes.

## Phase 3: US3 — Invitar usuarios (F-USR-01, P0)

**Goal**: invitar con seis roles, vencimiento a 7 días, reenvío y cancelación; definir contraseña.

**Independent Test**: E2E de invitar y definir contraseña; pgTAP de vencimiento.

- [X] T020 [F-USR-01][US3] Migración: tabla `invitaciones_organizacion` (`public`) con RLS por organización y vencimiento de 7 días (FR-009, FR-016)
- [X] T021 [F-USR-01][US3] Extender la Edge Function `invitar-miembro` a los seis roles, correo ya en otra organización rechazado, reenvío y cancelación, con verificación de rol en servidor (FR-009, FR-018)
- [X] T022 [F-USR-01][US3] Emitir `usuario.invitado` (reutilizando `eventos_membresia` hasta F-AUD-01) (FR-012)
- [X] T023 [F-USR-01][US3] pgTAP/integración: vencimiento, cancelación, no-Administrador rechazado, aislamiento (escenarios 3, 4, 7, 8) — más endurecimiento (correo de la cuenta, agregar directo, auditoría) y pruebas node de la Edge Function (ver commit ceaf52a); cambiar_rol_miembro a 6 roles + test pgTAP (ver commit 280206a)
- [X] T024 [F-USR-01][US3] Diálogo «Invitar usuario» (correo, seis roles con descripción y «Ver permisos de este rol →», «Enviar invitación») según `Usuarios.dc.html` (FR-009)
  - Desvío: «Ver permisos de este rol →» queda oculto (`PERMISOS_POR_ROL_DISPONIBLE=false`) hasta que exista la pantalla de permisos (ver commit def37f9).
- [X] T025 [F-USR-01][US3] Reenviar y cancelar invitación en el listado (FR-009)
- [X] T026 [F-USR-01][US3] Ajustar `pages/acceso/definir-contrasena.tsx` a `DefinirContrasena.dc.html` («Fuiste invitado como <rol>», política de contraseña, confirmación) conservando sus tests (FR-010)
- [X] T027 [F-USR-01][US3] Estados de carga, vacío, error y éxito («Invitación enviada») y accesibilidad (FR-017)
- [X] T028 [F-USR-01][US3] Integración de invitar y definir contraseña hasta entrar con el rol (SC-001): sin suite Playwright en el repo, la cadena corre en CI en tres tramos — Edge Function (`handler.test.ts`), pgTAP aceptar→rol→organización y la página `definir-contrasena.test.tsx`, incl. reintento y P0002 (ver commit 7fe9f6e)

**Checkpoint**: tests verdes.

## Phase 4: US4 — Listado, edición y suspensión de usuarios (F-USR-02, P0)

**Goal**: ver, editar, suspender y reactivar personas; requiere `usuarios_organizacion.estado` de MSF-119.

**Independent Test**: E2E editar rol, suspender, reactivar; pgTAP suspendido sin acceso.

- [ ] T029 [F-USR-02][US4] Verificar que MSF-119 (F-ACC-01) dejó `usuarios_organizacion.estado`; si no, bloquear y avisar (dependencia)
- [ ] T030 [F-USR-02][US4] RPC/Edge Function para cambiar rol, suspender y reactivar con verificación de Administrador y regla «al menos un Administrador» (FR-011, FR-018)
- [ ] T031 [F-USR-02][US4] Emitir `usuario.rol_cambiado`, `usuario.suspendido`, `usuario.reactivado` (FR-012)
- [ ] T032 [F-USR-02][US4] pgTAP: un suspendido pierde acceso en la base de datos; reactivar lo restituye; último Administrador protegido (escenarios 6, 7; SC-003)
- [ ] T033 [F-USR-02][US4] Pantalla Usuarios construida sobre `pages/miembros/list.tsx` (reutiliza RPC y componentes, FR-019): listado (usuario, tiendas y rol, último acceso, estado) según `Usuarios.dc.html` (FR-011)
- [ ] T034 [F-USR-02][US4] Diálogo «Editar usuario» (rol entre los seis, «Restablecer contraseña», «Guardar») sin la asignación por tienda (es de MSF-121) (FR-011)
- [ ] T035 [F-USR-02][US4] Diálogo «Suspender usuario» y acción «Reactivar» con los mensajes del prototipo (FR-011)
- [ ] T036 [F-USR-02][US4] Tests Vitest y E2E de editar, suspender y reactivar; pantalla Usuarios con acceso restringido para quien no tenga permiso (escenario 8)
- [ ] T046 [F-USR-02][US4] Unificar Usuarios y Miembros (FR-019): quitar el ítem «Miembros» del menú, redirigir `/miembros` y `/miembros/create` a `/usuarios`, migrar los tests de `pages/miembros` a Usuarios y retirar el código duplicado

**Checkpoint**: tests verdes.

## Phase 5: US5 — Matriz de permisos editable por rol (F-ROL-02, P0)

**Goal**: el Administrador de cada organización edita su matriz.

**Independent Test**: E2E de cambiar una celda y guardar; pgTAP de alcance por organización.

- [ ] T037 [F-ROL-02][US5] RPC de guardado de la matriz (secciones y acciones) restringida al Administrador de la organización (FR-013)
- [ ] T038 [F-ROL-02][US5] RPC «restablecer valores iniciales» reutilizando `private.sembrar_permisos` (FR-015)
- [ ] T039 [F-ROL-02][US5] pgTAP: solo el Administrador edita; el cambio no afecta a otra organización; Administrador no restringible (FR-003, FR-013)
- [ ] T040 [F-ROL-02][US5] Pantalla Roles y permisos: 6 roles con descripción y cantidad de usuarios, grilla 16×6, rotación Edición → Solo lectura → Sin acceso, columna Administrador bloqueada, «Guardar cambios» según cambios pendientes, según `Roles.dc.html` (FR-014)
- [ ] T041 [F-ROL-02][US5] Edición de acciones (eliminar, exportar, ver costos) con valores iniciales propuestos; marcar en el PR que no está dibujada (FR-006)
- [ ] T042 [F-ROL-02][US5] «Restablecer valores iniciales» y diálogos de confirmación; marcar en el PR que no están dibujados (FR-015)
- [ ] T043 [F-ROL-02][US5] Tests Vitest y E2E de editar y guardar; verificar que el cambio se refleja en menú y políticas (SC-004)

**Checkpoint**: tests verdes.

## Phase 6: Cierre

- [ ] T044 [F-ROL-01][US1] Ejecutar `pnpm lint && pnpm build && pnpm test` y `pnpm docs:check`; dejar evidencia de verificación local en el PR (SC-005)
  - Parcial: lint, build, Vitest de área y `docs:check` corridos localmente; pgTAP (`test:db`) y suite completa quedan para el CI del PR, sin Docker en este entorno (ver commit 0c4a466).
- [x] T047 [F-ROL-01][US1] Verificación de esquemas de punta a punta (Principio VII): confirmar que cada tabla de las migraciones coincide con *Esquemas de datos* de la spec (genérico → `public`, dominio de producto → `dominio`), que todas tienen RLS y que el pgTAP de aislamiento las recorre
- [ ] T045 [F-ROL-01][US1] Al mergear el PR (merge commit, sin squash), actualizar la fila de la spec en `docs/roadmap-template.md` (paso manual)

> Notas de desvío: agregar aquí, cortas y con `ver commit <hash>`.
- Devolución del Revisor (PR #35): `ETIQUETA_ROL` pasó a `lib/permisos.ts` y `App.guard.test.ts` hace valer el guard por ruta; `inicio` queda fuera a propósito (ver commit 1067c67).

## Matriz de trazabilidad Jira ↔ US ↔ tareas

| Jira | US | Tareas | FR |
|---|---|---|---|
| F-ROL-01 (MSF-N por crear) | US1 | T001–T014, T044–T045, T047 | FR-001…FR-007, FR-016, FR-017 |
| F-ROL-03 (MSF-N por crear) | US2 | T015–T019 | FR-008, FR-017 |
| F-USR-01 (MSF-N por crear) | US3 | T020–T028 | FR-009, FR-010, FR-012, FR-018 |
| F-USR-02 (MSF-N por crear) | US4 | T029–T036, T046 | FR-011, FR-012, FR-018, FR-019 |
| F-ROL-02 (MSF-N por crear) | US5 | T037–T043 | FR-006, FR-013…FR-015 |
| MSF-125 (épica) | todas | T001–T047 | FR-001…FR-019 |
- Desvío (devolución PR #34): la cuenta «creada por la invitación» se reconoce por `auth.users.invited_at` y no por `created_at` (ver commit df3c6c5, migración `20261013190000`).
