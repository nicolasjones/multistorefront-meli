# Tasks: Acceso, organización y permisos · Empresas

**Input**: `specs/20261012-140000-empresas/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`.

**Delivery scope**: `refine`, `supabase`

## Matriz de trazabilidad Jira ↔ US ↔ tasks

| Jira | Historia | Tasks |
|------|----------|-------|
| MSF-138 (base) | Fundación datos / multitenant | T001–T004 |
| F-EMP-01 | US1 Listado de empresas | T005–T011 |
| F-EMP-02 | US2 Datos generales | T012–T017 |
| F-EMP-04 | US3 Activar/desactivar tienda | T018–T021 |
| F-EMP-05 | US4 Cambio rápido de empresa | T022–T025 |
| MSF-138 (cierre) | Docs y cierre | T026–T028 |

## Phase 1: Fundación — tabla `empresas` (F-EMP-01, P0)

**Goal**: tabla `dominio.empresas` con RLS por organización, N por organización.

- [x] T001 [F-EMP-01][US1] Verificar cómo accede el data provider/cliente Supabase al esquema `dominio` y decidir esquema por consulta o vista/RPC con RLS efectiva; anotarlo en plan.md (FR-001)
- [x] T002 [F-EMP-01][US1] Migración aditiva `supabase/migrations/<ts>_empresas.sql`: `dominio.empresas`, índice, RLS (select por organización; update con `puede_escribir()`), grants mínimos; sin insert/delete (FR-001, FR-002)
- [x] T003 [F-EMP-01][US1] pgTAP `supabase/tests/database/empresas.test.sql`: aislamiento entre organizaciones, escritura solo con `puede_escribir()`, sin insert/delete para `authenticated`, y 1/2/3 empresas por organización (FR-002, FR-003, SC-005) — escrito; pgTAP no ejecutado localmente (sin Docker/Supabase CLI), corre en CI
- [x] T004 [F-EMP-01][US1] Confirmar que la prueba de aislamiento (`aislamiento_organizaciones`) recorre `public` + `dominio` y falla sin RLS; ajustarla si no cubre `dominio` (FR-002)

**Checkpoint**: `pnpm test` (pgTAP) verde sobre `empresas`.

## Phase 2: US1 — Listado de empresas (F-EMP-01, P0) 🎯 MVP

**Goal**: el administrador ve todas las empresas de su organización.

**Independent Test**: con 2 y con 3 empresas se listan todas; otra organización no aparece; miembro sin acceso.

- [x] T005 [F-EMP-01][US1] Hook `useEmpresas` (lista de la organización activa) y tipo `Empresa` (FR-001, FR-003)
- [x] T006 [F-EMP-01][US1] Recurso Refine `empresas` (`/empresas`, `/empresas/edit/:id`, sin create) en `App.tsx` (FR-004)
- [x] T007 [F-EMP-01][US1] Destino «Empresas» en `destinosPanel.ts` (icono, audiencia `administrador`) + test de visibilidad (FR-004)
- [x] T008 [F-EMP-01][US1] `pages/empresas/list.tsx`: columnas nombre, tienda web, Mercado Libre, precio, moneda ARS, productos visibles; «Sin configurar» donde no hay fuente; `ContenidoAdaptable` 320/768/1440 px (FR-005, FR-011, FR-012)
- [x] T009 [F-EMP-01][US1] Estados carga / vacío / error con reintento y acceso restringido para miembro en ruta directa (CA-EMP-01-4, FR-004)
- [x] T010 [F-EMP-01][US1] Tests Vitest del listado: 1, 2 y 3 empresas, estados, «Sin configurar», audiencia (SC-001, SC-005)
- [ ] T011 [F-EMP-01][US1] E2E «listar empresas» como administrador y acceso restringido como miembro (SC-001) — pendiente: no hay suite Playwright E2E en el repo (solo `infra/playwright`)

**Checkpoint**: listado operativo; `pnpm lint`, `pnpm build`, `pnpm test` verdes.

## Phase 3: US2 — Datos generales (F-EMP-02, P0)

**Goal**: editar y persistir los datos generales de una empresa.

**Independent Test**: editar Mundo JC, guardar, recargar y ver los cambios.

- [x] T012 [F-EMP-02][US2] `pages/empresas/edit.tsx` (General): nombre, dominio solo lectura («Sin configurar»), idioma y moneda fijos, WhatsApp, correo, Instagram, dirección opcional (FR-006)
- [x] T013 [F-EMP-02][US2] Validación (nombre obligatorio, formato de correo), éxito/error con patrones compartidos y aviso de cambios sin guardar (FR-007)
- [x] T014 [F-EMP-02][US2] Contrato y función de emisión de eventos de actividad `empresa.actualizada` hacia F-AUD-01 (FR-010) — contrato + `emitirEventoActividad` con destino enchufable (`lib/eventosActividad.ts`); F-AUD-01 aún no existe, sin destino registrado no hace nada
- [x] T015 [F-EMP-02][US2] Vitest de formulario: validaciones, guardado, solo lectura para sin permiso (FR-007)
- [x] T016 [F-EMP-02][US2] pgTAP: rechazo de update por miembro y de empresa ajena (FR-002) — ya cubierto por `empresas.test.sql` (T003); sin cambios
- [ ] T017 [F-EMP-02][US2] E2E «editar empresa» y reflejo en listado (SC-002) — pendiente: no hay suite Playwright E2E en el repo (igual que T011)

**Checkpoint**: edición persistida; suite verde.

## Phase 4: US3 — Activar y desactivar la tienda (F-EMP-04, P0)

**Goal**: pausar/reactivar una empresa sin afectar a las demás.

**Independent Test**: pausar Mundo JC; San Javucho sigue activa; reactivar.

- [x] T018 [F-EMP-04][US3] Control de estado activa/pausada en General y etiqueta de estado en el listado, con aclaración del efecto (FR-008) — acción inmediata, independiente del formulario (ver commit 081c9fb)
- [x] T019 [F-EMP-04][US3] Evento `empresa.pausada` / `empresa.reactivada` hacia F-AUD-01 (FR-010)
- [x] T020 [F-EMP-04][US3] Tests Vitest y pgTAP: alterna solo la empresa elegida, sin permiso no se puede (FR-008, SC-003) — pgTAP escrito, no ejecutado localmente (sin Supabase CLI), corre en CI; devolución QA PR #23 (ver commit e06666b y b897945)
- [ ] T021 [F-EMP-04][US3] E2E «pausar y reactivar» (SC-003) — pendiente: no hay suite Playwright E2E en el repo (igual que T011 y T017)

**Checkpoint**: estado persistido y aislado por empresa; suite verde.

## Phase 5: US4 — Cambio rápido de empresa (F-EMP-05, P0)

**Goal**: saltar de una empresa a otra conservando la sección y sin perder cambios.

**Independent Test**: desde General de una empresa, cambiar a otra y quedar en su General; con cambios sin guardar, se pide confirmación.

- [x] T022 [F-EMP-05][US4] Alimentar `SelectorEmpresa` con las empresas de la organización (cualquier cantidad), marcar la actual; con una sola, etiqueta fija (FR-009) — la actual sale de la ruta `/empresas/edit/:id`; fuera de esas pantallas queda la etiqueta de la organización
- [x] T023 [F-EMP-05][US4] Navegar a la misma sección de la empresa elegida y respetar el aviso de cambios sin guardar (FR-009) — el bloqueo lo da el `UnsavedChangesNotifier` al navegar
- [x] T024 [F-EMP-05][US4] Vitest del selector con 1, 2 y 3 empresas y con cambios sin guardar (SC-004, SC-005) — devolución QA: también confirmar el aviso, empresas pausadas e id fuera del listado; `EmpresaEdit` reinicia el estado al cambiar de empresa e ignora respuestas tardías de guardado (ver commit ff956eb). Decisión de UX: si falla el guardado de la empresa anterior ya abandonada, solo se registra en consola (no hay mecanismo de aviso global en la app; el aviso de cambios sin guardar ya advierte antes de cambiar) — seguimiento si se agrega uno. Devolución 2: test del fallo tardío y espera sobre la actividad de e-2 (ver commit cddd3d4). `operable-refine-panel` sube a 1.4.0 (minor: selector nuevo en la capability)
- [ ] T025 [F-EMP-05][US4] E2E «cambiar de empresa» (SC-004) — pendiente: no hay suite Playwright E2E en el repo (igual que T011, T017 y T021)

**Checkpoint**: las cuatro historias operativas.

## Phase 6: Cierre

- [ ] T026 [MSF-138] `docs/empresas.md`: modelo, esquema/RLS, carga inicial de San Javucho y Mundo JC como dato, eventos hacia F-AUD-01, reversión de la migración (Principio VIII)
- [ ] T027 [MSF-138] Validación final: `pnpm lint && pnpm build && pnpm test`, `pnpm docs:check`; anotar diferencias contra el prototipo en el PR
- [ ] T028 [MSF-138] Al merge del PR (merge commit `--no-ff`): actualizar la fila de `docs/roadmap-template.md` (paso manual)

## Dependencias

Phase 1 → Phase 2 (F-EMP-01 bloquea a F-EMP-02, F-EMP-04, F-EMP-05) → Phases 3, 4 y 5 (independientes entre sí tras la 2; US4 usa la ruta de edición de US2) → Phase 6.
