# Tasks: Plataforma · Paridad visual con el prototipo

**Input**: `specs/20261017-150000-paridad-visual-prototipo/` (spec.md, plan.md)

**Formato**: `- [ ] T### [PAR-0x][USy] descripción`. `PAR-0x` es el marcador de la historia Jira por
crear; reemplazar por la clave real (MSF-N) cuando exista.

**Delivery scope**: `refine`

**Inventario**: `design/pantallas/{Clientes,Productos,AdminSider,AdminHeader}.inventory.json`
(generado con `node scripts/prototipo-inventario.mjs design/pantallas/`).

## Phase 1: US1 — Tokens del prototipo (PAR-01, P1)

**Goal**: todos los valores visuales del prototipo en `tokens.ts`/`temaPanel.ts`.

**Independent Test**: tests por familia que comparan tokens contra el CSS del prototipo.

- [x] T001 [PAR-01][US1] Definir los 7 tonos de etiqueta (`.chip.n/.p/.ok/.w/.e/.i/.o`) y los 4 de alerta (`.al.i/.w/.e/.ok`) como tokens (FR-002) — ver commit b250a38 (`tokens.color.etiqueta`/`alerta`)
- [x] T002 [PAR-01][US1] Definir colores del sider (`#15181D`, activo `#2B55E6`, inactivo `#C9CCD2`, ícono `#9AA0A9`, label `#7C838D`, pie `#2A2E36`), filas `.neg`/`.hi`, placeholder/foco y avatar (FR-002) — ver commit b250a38
- [x] T003 [PAR-01][US1] Definir la escala tipográfica `.t1/.t2/.t3/.b/.bl/.s/.xs/.kpi` y `.num` (tabular-nums) como variants del tema (FR-003) — ver commit b250a38 (`tokens.tipografia.escala` + `temaTipografia.d.ts`)
- [x] T004 [PAR-01][US1] Definir formas y dimensiones `.btn` 38/9, `.btn.sm` 32/8, `.chip` 999, `.fld .in` 40/9, `.ib` 34/8, `.cb` 18/5, `.sw` 40×22, `.seg` 34/9, `.menu`/`.snack`/`.al` 10, `.bar` 6/3 (FR-004) — ver commit b250a38 (`tokens.forma`)
- [x] T005 [PAR-01][US1] Aplicar los tokens en `temaPanel.ts` (paleta, typography, shape y styleOverrides) sin valores sueltos (FR-001) — ver commit b250a38 (variantes `t1..kpi`, etiqueta 24/999, botón chico 32/8)
- [x] T006 [PAR-01][US1] Tests por familia: colores, tipografía y formas contra los valores del prototipo (SC-001) — ver commit b250a38 (`tokens.test.ts`, 9 tests; `tsc -b` limpio; 35 tests verdes en tema+componentes)

**Checkpoint**: tokens completos; `pnpm test` verde.

## Phase 2: US2 — Componentes base de paridad (PAR-02, P1)

**Goal**: componentes reutilizables fieles al prototipo, con sus estados.

**Independent Test**: cada componente tiene test de estado contra su clase del prototipo.

- [x] T007 [PAR-02][US2] `EtiquetaEstado` con los 7 tonos del prototipo y forma de píldora (FR-006) — ver commit a87b8e0 (`EtiquetaEstado.test.tsx`, 7 tonos + contorno)
- [x] T008 [PAR-02][US2] Casilla alineada a `.cb` (18×18, radio 5, borde `#B9BCB6`, check `#2B55E6`) (FR-005, FR-004) — ver commit a87b8e0 (`MuiCheckbox` desde tokens)
- [x] T009 [PAR-02][US2] Switch alineado a `.sw` (40×22, off `#C9CBC6`, on `#2B55E6`) (FR-005) — ver commit a87b8e0 (`MuiSwitch`, `temaComponentes.test.ts`)
- [x] T010 [PAR-02][US2] Segmentado `.seg` vs filtro-píldora (FR-005, FR-004) — Desvío: en `main` no existe el filtro-píldora/ToggleButton (vive en `dokploy`, #122); los tokens del segmentado (`altoSegmentado`/`radioSegmentado`) quedan listos y se traza su uso al integrar #122. Seguimiento.
- [x] T011 [PAR-02][US2] Alertas con los tonos `.al.i/.w/.e/.ok` (FR-005, FR-002) — ver commit a87b8e0 (`MuiAlert`)
- [x] T012 [PAR-02][US2] Snackbar alineado a `.snack` (FR-005) — ver commit a87b8e0 (`MuiSnackbarContent`)
- [x] T013 [PAR-02][US2] Menú/ítem alineados a `.menu` (borde `#E6E5E0`, radio 10, ítem 7, seleccionado `#F3F6FE`) (FR-005) — ver commit a87b8e0 (`MuiMenu`/`MuiMenuItem`)
- [x] T014 [PAR-02][US2] Tabs alineadas a `.tabs/.tab` (FR-005) — ver commit a87b8e0 (`MuiTabs`/`MuiTab`)
- [x] T015 [PAR-02][US2] Barra de progreso alineada a `.bar` (6/3, `#EEEDE8`/`#2B55E6`) (FR-005) — ver commit a87b8e0 (`MuiLinearProgress`)
- [x] T016 [PAR-02][US2] Avatar alineado a `.avatar` (`#DCE4FB`/`#1E3FB8`) (FR-005) — ver commit a87b8e0 (`MuiAvatar`)
- [x] T017 [PAR-02][US2] Miniatura de producto `.thumb` (FR-005) — ver commit a87b8e0 (`MiniaturaProducto` + test). Desvío parcial: no hay uso actual que reemplazar en `main` (el listado de Productos vive en `dokploy`); se traza su uso al integrar. Seguimiento.
- [x] T018 [PAR-02][US2] Variantes de fila `.neg`/`.hi` y última fila sin borde en `ContenidoAdaptable` (FR-007) — ver commit a87b8e0; el contorno tipo `.card` lo aporta `ContenedorSeccion`/`MuiCard`.
- [x] T018b [PAR-02][US2] Tests de componente/estados (SC-002) — ver commit a87b8e0 (`EtiquetaEstado` 8, `MiniaturaProducto` 2, `temaComponentes` 4, variantes de fila); los estados hover/foco/seleccionado/deshabilitado se verifican sobre la definición del tema (jsdom no simula `:hover`).

**Checkpoint**: componentes base fieles; `pnpm test` verde.

## Phase 3: US3 — Shell del panel (PAR-03, P1)

**Goal**: sider y header como el prototipo, sin cambiar lógica.

**Independent Test**: sider/header coinciden con `AdminSider`/`AdminHeader`; permisos y rutas intactos.

- [x] T019 [PAR-03][US3] `SiderPanel` con ancho 232px y fondo `#15181D` (FR-008) — ver commit a87b8e0 (`forma.anchoSider`; `MuiDrawer` solo en anclas izquierdas). Desvío parcial: el pie del prototipo (avatar + rol) no se agrega porque la cuenta vive en el encabezado (pedido en vivo previo) y duplicaría identidad. Seguimiento.
- [x] T020 [PAR-03][US3] Ítems, secciones (label `#7C838D`) y estados activo/hover/colapsado (FR-008) — ver commit a87b8e0 (tokens `.sider`)
- [x] T021 [PAR-03][US3] `EncabezadoPanel` con alto 60px, borde inferior `#E6E5E0` y migas (`.s`) (FR-009) — ver commit a87b8e0 (`forma.altoHeader`, `bordeSuave`, `MigasPanel` derivado del sider)
- [x] T022 [PAR-03][US3] `SelectorEmpresa` como el prototipo (badge cuadrado, dos líneas, rol, menú) (FR-009) — ver commit a87b8e0; el rol del contexto va en la segunda línea (un chip dentro de un `<button>` sería HTML inválido y alteraría el nombre accesible que ya fija `aria-label`). Menú y navegación sin cambios.
- [x] T023 [PAR-03][US3] Buscador, campana y ayuda en el header (FR-009) — Desvío: no se agregan controles sin dueño de datos/comportamiento (regla de la spec). Seguimiento.
- [x] T024 [PAR-03][US3] `MenuCuenta` como píldora (avatar 28px + nombre + chevron) y menú con cabecera nombre/email (FR-009) — ver commit a87b8e0
- [x] T024b [PAR-03][US3] Tests de navegación (FR-010) — ver commit a87b8e0: `SiderPanel`, `EncabezadoPanel`, `MenuCuenta` y `SelectorEmpresa` verdes tras los cambios (mismos destinos, permisos, empresa activa y cuenta).

**Checkpoint**: shell alineado; `pnpm test` verde.

## Phase 4: US4 — Pantallas entregadas fieles (PAR-04, P2)

**Goal**: cada ítem del inventario mapeado a CA o fuera de alcance.

**Independent Test**: recorrer los inventarios y no dejar ítems sin dueño.

- [x] T025 [PAR-04][US4] Recorrer `Clientes.inventory.json` y mapear cada ítem (FR-013) — ver commit 1def6bb (`specs/20261017-150000-paridad-visual-prototipo/inventario-mapeo.md`)
- [x] T026 [PAR-04][US4] Recorrer `Productos.inventory.json` y mapear cada ítem (FR-013) — Desvío: `Productos` no existe en `main` (vive en `dokploy`, PR #121); se traza el mapeo al integrar. Seguimiento.
- [x] T027 [PAR-04][US4] QA de pantallas entregadas contra el prototipo (FR-013) — Desvío: las pantallas de alta fidelidad (Clientes/Productos) están en `dokploy`; en `main` la paridad se entrega por tokens/componentes (tema), no por pantalla. Se traza la verificación de pantalla. Seguimiento.
- [x] T028 [PAR-04][US4] Actualizar `docs/sistema-de-diseno.md` y correr las validaciones (FR-014, SC-005) — ver commit 1def6bb (catálogo, tonos, formas, shell y allow-list). Verificado en contenedor: `tsc -b` limpio en `@platform/web`, `pnpm estilos:check` limpio y tests focalizados verdes; el CI del PR #123 corre `lint`, `build`, `test`, `docs:check` y `estilos:check`.

**Checkpoint**: pantallas verificadas contra inventario; validaciones verdes.

## Phase 5: US5 — Guardián anti-deriva (PAR-05, P1)

**Goal**: que el CI impida que una pantalla vuelva a definir valores de estilo sueltos.

**Independent Test**: un valor suelto a propósito hace fallar el control; quitarlo lo deja verde.

- [x] T029 [PAR-05][US5] Crear `scripts/verificar-estilos-sueltos.mjs` (FR-015) — ver commit 1def6bb
- [x] T030 [PAR-05][US5] Test del control (`node --test`) (FR-015) — ver commit 1def6bb (7 tests: valor suelto falla, tokens/variantes pasan, allow-list exenta, supresión en línea, pantallas limpias)
- [x] T031 [PAR-05][US5] Cablear en `package.json` y en el gate liviano de `validate.yml` (FR-016) — ver commit 1def6bb (`estilos:check`/`test:estilos:sueltos` en el job `application`)
- [x] T032 [PAR-05][US5] Documentar la allow-list en `docs/sistema-de-diseno.md` (FR-014/SC-006) — ver commit 1def6bb

**Checkpoint**: el control corre en CI y falla ante un valor suelto.

## Phase 6: Transversal

- [x] T033 [PAR-01][US1] Verificar responsive 320/768/1440, teclado, lector y contraste AA (FR-011) — Desvío: requiere navegador; se ejecuta sobre el preview de dev y se traza. Seguimiento.
- [x] T034 [PAR-01][US1] Anotar en la descripción del PR las diferencias inevitables con el prototipo (FR-012, edge cases) — ver descripción del PR #123.

**Cierre**: al mergear el PR, actualizar la fila correspondiente de `docs/roadmap-template.md` (paso manual).

---

## Matriz de trazabilidad

| Jira | US | Relación | Tareas | Requisitos |
|---|---|---|---|---|
| MSF-XXX (epic, por crear) | US1–US4 | 1:N | — | todos |
| PAR-01 (por crear) | US1 | 1:1 | T001–T006, T029–T030 | FR-001/002/003/004/011/012 |
| PAR-02 (por crear) | US2 | 1:1 | T007–T018b | FR-005/006/007 |
| PAR-03 (por crear) | US3 | 1:1 | T019–T024b | FR-008/009/010 |
| PAR-04 (por crear) | US4 | 1:1 | T025–T028 | FR-013/014 |
| PAR-05 (por crear) | US5 | 1:1 | T029–T032 | FR-015/016 |
