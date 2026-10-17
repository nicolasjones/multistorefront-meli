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

- [ ] T007 [PAR-02][US2] `EtiquetaEstado` con los 7 tonos del prototipo y forma de píldora (FR-006)
- [ ] T008 [PAR-02][US2] Casilla alineada a `.cb` (18×18, radio 5, borde `#B9BCB6`, check `#2B55E6`) (FR-005, FR-004)
- [ ] T009 [PAR-02][US2] Switch alineado a `.sw` (40×22, off `#C9CBC6`, on `#2B55E6`) (FR-005)
- [ ] T010 [PAR-02][US2] Separar el segmentado `.seg` (radio 9, activo `#15181D`) del filtro-píldora `.chip.btn` (radio 999) sin romper el test vigente (FR-005, FR-004)
- [ ] T011 [PAR-02][US2] Alertas con los tonos `.al.i/.w/.e/.ok` (FR-005, FR-002)
- [ ] T012 [PAR-02][US2] Snackbar alineado a `.snack` (FR-005)
- [ ] T013 [PAR-02][US2] Menú/ítem alineados a `.menu` (borde `#E6E5E0`, radio 10, ítem 7, seleccionado `#F3F6FE`) (FR-005)
- [ ] T014 [PAR-02][US2] Tabs alineadas a `.tabs/.tab` (FR-005)
- [ ] T015 [PAR-02][US2] Barra de progreso alineada a `.bar` (6/3, `#EEEDE8`/`#2B55E6`) (FR-005)
- [ ] T016 [PAR-02][US2] Avatar alineado a `.avatar` (`#DCE4FB`/`#1E3FB8`) (FR-005)
- [ ] T017 [PAR-02][US2] Miniatura de producto (`.thumb` 40×40, radio 8, borde `#EEEDE8`, placeholder `#F5F5F2`) y reemplazar el uso actual (FR-005)
- [ ] T018 [PAR-02][US2] Contenedor de tabla tipo `.card` + variantes de fila `.neg`/`.hi` + última fila sin borde en `ContenidoAdaptable`/página (FR-007)
- [ ] T018b [PAR-02][US2] Tests de cada componente en normal/hover/foco/seleccionado/deshabilitado (SC-002)

**Checkpoint**: componentes base fieles; `pnpm test` verde.

## Phase 3: US3 — Shell del panel (PAR-03, P1)

**Goal**: sider y header como el prototipo, sin cambiar lógica.

**Independent Test**: sider/header coinciden con `AdminSider`/`AdminHeader`; permisos y rutas intactos.

- [ ] T019 [PAR-03][US3] `SiderPanel` con ancho 232px, fondo `#15181D` y estructura de cabecera/pie (avatar + rol) (FR-008)
- [ ] T020 [PAR-03][US3] Ítems, secciones (label `#7C838D`) y estados activo/hover/colapsado/badge (FR-008)
- [ ] T021 [PAR-03][US3] `EncabezadoPanel` con alto 60px, borde inferior `#E6E5E0` y breadcrumb (`.s`) (FR-009)
- [ ] T022 [PAR-03][US3] `SelectorEmpresa` como el prototipo (badge cuadrado, dos líneas, chip de rol, menú) (FR-009)
- [ ] T023 [PAR-03][US3] Buscador (36px, `#F5F5F2`, atajo), campana con punto `#C62828` y ayuda en el header (FR-009) — solo aspecto; sin lógica nueva
- [ ] T024 [PAR-03][US3] `MenuCuenta` como píldora (avatar 28px + nombre + chevron) y menú con cabecera nombre/email (FR-009)
- [ ] T024b [PAR-03][US3] Tests de navegación: mismos destinos, permisos, empresa activa y cuenta (FR-010)

**Checkpoint**: shell alineado; `pnpm test` verde.

## Phase 4: US4 — Pantallas entregadas fieles (PAR-04, P2)

**Goal**: cada ítem del inventario mapeado a CA o fuera de alcance.

**Independent Test**: recorrer los inventarios y no dejar ítems sin dueño.

- [ ] T025 [PAR-04][US4] Recorrer `Clientes.inventory.json` y mapear cada columna/campo/botón/tab/diálogo (FR-013)
- [ ] T026 [PAR-04][US4] Recorrer `Productos.inventory.json` y mapear cada ítem (FR-013)
- [ ] T027 [PAR-04][US4] QA: ítem visible y ausente sin epic declarado → CAMBIOS (no cerrar la spec) (FR-013)
- [ ] T028 [PAR-04][US4] Actualizar `docs/sistema-de-diseno.md` (catálogo, variantes, tonos, shell) y correr `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm docs:check` (FR-014, SC-005)

**Checkpoint**: pantallas verificadas contra inventario; validaciones verdes.

## Phase 5: US5 — Guardián anti-deriva (PAR-05, P1)

**Goal**: que el CI impida que una pantalla vuelva a definir valores de estilo sueltos.

**Independent Test**: un valor suelto a propósito hace fallar el control; quitarlo lo deja verde.

- [ ] T029 [PAR-05][US5] Crear `scripts/verificar-estilos-sueltos.mjs`: escanea `apps/web/src/pages/**` y falla ante colores hex/rgba, radios, alturas o `fontSize` sueltos (FR-015)
- [ ] T030 [PAR-05][US5] Test del control (`node --test`): valor suelto falla, uso de tokens pasa, allow-list exenta (FR-015)
- [ ] T031 [PAR-05][US5] Cablear en `package.json` y en el gate liviano de `.github/workflows/validate.yml` (job `application`, junto a `docs:check`/`lint`) (FR-016)
- [ ] T032 [PAR-05][US5] Documentar la allow-list (tema, `components/base`, `components/pagina`, tests) en `docs/sistema-de-diseno.md` (FR-014/SC-006)

**Checkpoint**: el control corre en CI y falla ante un valor suelto.

## Phase 6: Transversal

- [ ] T033 [PAR-01][US1] Verificar responsive 320/768/1440, teclado, lector y contraste AA (FR-011)
- [ ] T034 [PAR-01][US1] Anotar en la descripción del PR las diferencias inevitables con el prototipo (FR-012, edge cases)

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
