# Tasks: Acceso, organización y permisos · Administración de usuarios y organización

**Input**: `specs/20261014-140000-administracion-de-usuarios-y-organizacion/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`. `F-XXX-NN` es el marcador de la historia Jira por crear; reemplazar por la clave real (MSF-N). Épica: MSF-132.

**Delivery scope**: `refine`, `supabase`

**Orden**: US1 (F-ORG-03) → US2 (F-USR-03). `/speckit-implement` fase por fase con `/clear` entre fases. Requiere MSF-125 y MSF-138 integradas.

## Phase 1: US1 — Datos y configuración de la organización (F-ORG-03, P1)

**Goal**: el administrador edita nombre, logo y zona horaria de su organización y ve sus empresas.

**Independent Test**: pgTAP de RPC/RLS + Vitest + E2E editar/guardar.

- [x] T001 [F-ORG-03][US1] Migración aditiva: columnas `zona_horaria` (default `America/Argentina/Buenos_Aires`) y `logo_path` en `public.organizaciones`; reversión documentada en el encabezado (FR-001, FR-009)
- [x] T002 [F-ORG-03][US1] RPC `public.actualizar_organizacion` (security definer, validaciones, solo administrador activo, `revoke … from public, anon`, `grant … to authenticated`) (FR-002)
- [x] T003 [F-ORG-03][US1] Bucket `logos-organizacion` con políticas por organización, tipos y tamaño acotados; si Storage no está disponible, documentar y omitir el logo (FR-001, FR-004)
- [x] T004 [F-ORG-03][US1] pgTAP `organizacion_datos_y_configuracion.test.sql`: administrador edita; operador/consulta/suspendido rechazados; datos inválidos rechazados (SC-002, FR-002)
- [x] T005 [F-ORG-03][US1] pgTAP: aislamiento entre organizaciones y ejecutabilidad por `anon` (el test existente debe seguir verde); confirmar que `rls_en_toda_tabla` pasa (FR-004)
- [x] T006 [F-ORG-03][US1] Pantalla `pages/organizacion/edit.tsx` con formulario, estados de carga/vacío/error/éxito y accesibilidad (teclado, 320/768/1440 px) (FR-001, FR-008)
- [x] T007 [F-ORG-03][US1] Listado de empresas de la organización con enlace a editar, sin alta y sin asumir cantidad (FR-003)
- [x] T008 [F-ORG-03][US1] Ruta `/organizacion` en `App.tsx` con `RequiereOrganizacionActiva`, entrada de menú para administrador y acceso restringido al resto (FR-001; Principio VI)
- [x] T009 [F-ORG-03][US1] Vitest de la pantalla: carga, edición, validación, error, vacío de empresas (FR-001, FR-003)
- [x] T010 [F-ORG-03][US1] E2E (Playwright) del flujo editar/guardar y del acceso de un no administrador (SC-001, SC-002)
  - Desvío: sin E2E; el repo no tiene suite Playwright de la app (solo `infra/playwright`). Cubierto por Vitest (T009) y pgTAP (T004–T005); ver commit b1dc666. Deuda trazada en **MSF-499** (suite Playwright + recorridos críticos).
  - Desvío: sin E2E; el repo no tiene suite Playwright de la app (solo `infra/playwright`). Cubierto por Vitest (T009) y pgTAP (T004–T005); ver commit b1dc666.
- [x] T011 [F-ORG-03][US1] Documentar en `docs/administracion-organizacion.md` (campos, RPC, logo, reversión) (FR-010)
- [x] T012 [F-ORG-03][US1] Marcar en el PR que la pantalla no está dibujada y se construyó con el sistema de diseño

**Checkpoint**: F-ORG-03 verde con `pnpm lint && pnpm build && pnpm test`.

## Phase 2: US2 — Restablecer la contraseña de otro usuario (F-USR-03, P1)

**Goal**: completar y probar «Restablecer contraseña» en Usuarios, respetando Suspendido.

**Independent Test**: Vitest de `usuarios/list` + E2E hasta definir contraseña.

- [x] T013 [F-USR-03][US2] Revisar `usuarios/list.tsx` y sus tests: el botón ya existe (MSF-125); decidir qué falta sin duplicarlo (FR-005)
- [x] T014 [F-USR-03][US2] No ofrecer ni enviar el enlace a usuarios Suspendidos, con texto que indica reactivar primero (FR-006)
- [x] T015 [F-USR-03][US2] Mantener oculto para no administradores y para uno mismo; confirmar que el éxito y el error no revelan más datos (FR-007)
- [x] T016 [F-USR-03][US2] Vitest: envío a activo, bloqueo a suspendido, error dentro del diálogo (SC-003)
- [x] T017 [F-USR-03][US2] Cubierto por Vitest T016, sin E2E (el repo no tiene suite Playwright de la app); ver commit 40b99db (SC-003). Deuda trazada en **MSF-499**.
- [x] T017 [F-USR-03][US2] Cubierto por Vitest T016, sin E2E (el repo no tiene suite Playwright de la app); ver commit 40b99db (SC-003)
- [x] T018 [F-USR-03][US2] Documentar el flujo en `docs/invitar-usuarios.md` o `docs/acceso-ingreso.md` (FR-010)
- [x] T019 [F-USR-03][US2] Marcar en el PR que F-USR-03 no tiene artboard y reusa el diálogo «Editar usuario»

**Checkpoint**: F-USR-03 verde.

## Phase 3: Cierre

- [x] T020 [F-ORG-03][US1] `pnpm lint && pnpm build && pnpm test && pnpm docs:check` y `graphify update .`; dejar evidencia de verificación local (SC-004)
  - Evidencia (2026-10-14, node 24 / pnpm 11.19.0): `pnpm install --frozen-lockfile` OK · `pnpm lint` 0 errores (24 warnings preexistentes) · `pnpm build` OK · `pnpm --filter @platform/web test` 51 archivos / 415 tests ✔ · `pnpm test:ia` 85 tests ✔ · `pnpm test:auth:hook-bloqueo`, `pnpm test:template:adoption` y `pnpm test:ia:sincronizar-edge-functions` ✔ · `pnpm docs:check` OK. `graphify update .` no se ejecutó (no hay CLI de graphify en el entorno). `pnpm test:db` (pgTAP) corre en el CI del PR (requiere Supabase).
- [x] T021 [F-USR-03][US2] Al merge del PR (merge commit, sin squash) actualizar `docs/roadmap-template.md` (estado y link a la spec)
  - Hecho en este cambio: se agregó la fila de la spec a la tabla "Backlog entregado" (estado + link).

## Matriz de trazabilidad Jira ↔ US ↔ tareas

| Historia Jira | US | FR | Tareas |
|---------------|----|----|--------|
| F-ORG-03 | US1 | FR-001–FR-004, FR-008–FR-010 | T001–T012, T020 |
| F-USR-03 | US2 | FR-005–FR-010 | T013–T019, T021 |
