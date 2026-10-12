# Tasks: Plataforma · Sistema de diseño

**Input**: `specs/20261012-130000-sistema-de-diseno/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`. `DS-0x` es el marcador de la historia Jira por crear; reemplazar por la clave real (MSF-N).

**Delivery scope**: `refine`

## Phase 1: US1 — Tokens y tema del panel (DS-01, P0) 🎯 MVP

**Goal**: tokens únicos aplicados como tema sobre el del template.

**Independent Test**: el panel renderiza con Sora/Instrument Sans, `#2B55E6`, botones 38 px/9 px.

- [x] T001 [DS-01][US1] Definir tokens (colores, tipografías, espaciados, formas, alto/radio de botón) en `apps/web/src/tema/tokens.ts` con los valores de la spec (FR-001, FR-003)
- [x] T002 [DS-01][US1] Incorporar las tipografías Sora e Instrument Sans con fallback de sistema (FR-002)
- [x] T003 [DS-01][US1] Crear el tema del panel extendiendo el tema MUI/Refine y reemplazar el `createTheme` inline de `App.tsx` (FR-001, FR-008)
- [x] T004 [DS-01][US1] Test de tema: tipografías, color primario/hover, peligro y botón 38/9 px (FR-002, FR-003)
- [x] T005 [DS-01][US1] Confirmar los valores contra el prototipo y anotar diferencias para el PR (FR-009)

**Checkpoint**: tema aplicado; `pnpm test`, `pnpm lint`, `pnpm build` verdes.

> Nota T002: fuentes OFL vía `@fontsource-variable` (sin CDN). T005: valores del prototipo confirmados, sin diferencias en los tokens de la spec.

## Phase 2: US2 — Componentes base y estados (DS-02, P0)

**Goal**: catálogo de componentes base con estados y reglas de uso.

**Independent Test**: cada componente del catálogo existe, usa tokens y cubre sus estados.

- [ ] T006 [DS-02][US2] Inventariar componentes base del prototipo (botones, campos, tarjetas, etiquetas, tablas, estados) vs. `components/` existente (FR-004)
- [ ] T007 [DS-02][US2] Personalizar vía tema MUI botones (primario/secundario/peligro/tamaños) y campos (FR-004)
- [ ] T008 [DS-02][US2] Crear/ajustar tarjeta y etiqueta de estado (variantes neutral, primario, éxito, aviso, error, info) en `components/base/` (FR-004)
- [ ] T009 [DS-02][US2] Alinear `components/estados` (carga, vacío, éxito, error) a los tokens conservando su API y tests (FR-004)
- [ ] T010 [DS-02][US2] Cubrir estados normal/hover/foco/deshabilitado/error/cargando/vacío con tests (FR-004)
- [ ] T011 [DS-02][US2] Alinear tabla/lista base y `components/pagina` (encabezado y contenedor de sección) a los tokens (FR-004)
- [ ] T012 [DS-02][US2] Escribir `docs/sistema-de-diseno.md`: catálogo, variantes, estados y reglas de uso para las demás épicas (FR-005)

**Checkpoint**: catálogo documentado; `pnpm docs:check` verde.

## Phase 3: US3 — Estructura del panel (DS-03, P0)

**Goal**: encabezado, menú lateral y selector de empresa con el sistema.

**Independent Test**: el panel conserva su comportamiento con el nuevo aspecto.

- [x] T013 [DS-03][US3] Restilizar `EncabezadoPanel` con tokens y componentes base (FR-006)
- [x] T014 [DS-03][US3] Restilizar `SiderPanel` (activo/hover/colapsado) (FR-006)
- [x] T015 [DS-03][US3] Selector de empresa en el encabezado: empresa activa, listado, marca de la activa; sin opción de cambio con una sola empresa (FR-006)
- [x] T016 [DS-03][US3] Ajustar `MenuCuenta` al sistema sin cambiar su lógica (FR-006)
- [x] T017 [DS-03][US3] Actualizar tests de navegación y verificar que no cambian permisos ni destinos (FR-006)

**Checkpoint**: estructura del panel alineada; tests verdes.

> Nota T013–T016: sin DS-02 (componentes base) se usan tokens y tema directo. T015: el contexto solo expone la empresa efectiva; el selector es etiqueta fija con una empresa y acepta un listado cuando exista (sin cambio de lógica).

## Phase 4: US4 — Temas de tiendas públicas por empresa (DS-04, P1)

**Goal**: aplicar un tema por empresa a las tiendas sin tocar el del panel.

**Independent Test**: dos temas distintos renderizan independientes y el panel no cambia.

- [x] T018 [DS-04][US4] Definir el contrato de tema de tienda (tipografías y colores por empresa) y un tema por defecto (FR-007)
- [x] T019 [DS-04][US4] Crear el proveedor de tema de tienda aislado del tema del panel (FR-007)
- [x] T020 [DS-04][US4] Definir las identidades de ejemplo Mundo JC (Barlow Condensed/Barlow) y San Javucho para validar el mecanismo (FR-007)
  - Desvío: Mundo JC usa Barlow Condensed/Barlow (spec); los colores y las fuentes de San Javucho son valores de ejemplo, no confirmados con el prototipo (FR-009).
- [x] T021 [DS-04][US4] Tests: dos temas independientes, tema por defecto sin identidad, panel intacto (FR-007)

**Checkpoint**: mecanismo listo para la épica de Tiendas online.

## Phase 5: Transversal

- [x] T022 [DS-01][US1] Redactar las notas de diferencias/contradicciones con el prototipo para la descripción del PR (FR-009)
- [ ] T023 [DS-02][US2] Correr `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm docs:check`; verificar que no se copió HTML/CSS del prototipo (FR-008)

**Cierre**: al mergear el PR, actualizar la fila correspondiente de `docs/roadmap-template.md` (paso manual).

---

## Matriz de trazabilidad

| Jira | US | Rel. Jira→US | Tareas | Rel. US→tareas | Requisitos |
|---|---|---|---|---|---|
| MSF-117 (epic) | US1–US4 | 1:N | — | — | todos |
| DS-01 (por crear) | US1 | 1:1 | T001–T005, T022 | 1:N | FR-001/002/003/009 |
| DS-02 (por crear) | US2 | 1:1 | T006–T012, T023 | 1:N | FR-004/005/008 |
| DS-03 (por crear) | US3 | 1:1 | T013–T017 | 1:N | FR-006 |
| DS-04 (por crear) | US4 | 1:1 | T018–T021 | 1:N | FR-007 |
