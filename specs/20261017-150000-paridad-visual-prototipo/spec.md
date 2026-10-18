# Feature Specification: Plataforma · Paridad visual con el prototipo

**Feature Branch**: `epic/MSF-XXX-paridad-visual-prototipo`

**Jira Epic**: MSF-XXX (por crear) — placeholder; reemplazar por la clave real cuando exista.

**Created**: 2026-10-17

**Status**: Ready for implementation — el inventario determinista está generado; la clave Jira queda por crear.

**Delivery scope**: `refine` (apps/web). Sin `supabase`, `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · afecta a todas las pantallas del panel · Bloqueada por: ninguna · Bloquea a: el cierre de fidelidad de las épicas con pantallas ya entregadas.

**Input**: Decisión de producto (2026-10-17): "espejar el sistema de diseño del prototipo del todo".
Se apoya en `docs/prototipos.md` — "los diseños de referencia mandan la UI: lo implementado debe
verse y comportarse como el prototipo" — y en el inventario determinista por pantalla.

**Relación con MSF-117 (DS-01…DS-04)**: aquella spec fijó los tokens y componentes base pero con una
regla de fidelidad laxa (el prototipo como referencia visual, sin exigir identidad). Después de entregar
las pantallas de Clientes y Productos, la deriva se ve. **Esta spec sube la fidelidad a la del prototipo
y reemplaza esa regla para el panel**: lo que se ve manda el prototipo; cómo se construye sigue
mandando el sistema (MUI/Refine + tokens), sin copiar HTML/CSS.

**Regla de fuentes**:

- Comportamiento, rutas, permisos y datos: no cambian (mandan los requisitos vigentes).
- Qué se ve: manda el prototipo `design/pantallas/*.dc.html` (validado).
- Cómo se construye: tokens + tema MUI/Refine + componentes base; **no se copia CSS del prototipo**.
- Si el prototipo pide algo sin dueño en la base (feature): se declara fuera de alcance en la
  [Matriz pantalla↔criterios](#matriz-pantallacriterios) con el epic que lo posee.
- Si algo no se puede igualar (responsive, accesibilidad): usar lo más cercano y anotarlo en el PR.

**Inventario (generado, no editar a mano)**: `design/pantallas/{Clientes,Productos,AdminSider,AdminHeader}.inventory.json`,
producido con `node scripts/prototipo-inventario.mjs design/pantallas/`. Es la base del alcance.

## Alcance

Cubre la **capa de lenguaje visual** compartida:

1. **Tokens** — colores, escala tipográfica, formas y dimensiones del prototipo.
2. **Componentes base** — etiquetas, casilla, switch, segmentado, alertas, snackbar, menú, tabs,
   barra de progreso, avatar, miniatura y el contenedor de tabla.
3. **Shell del panel** — barra lateral (`AdminSider`) y barra superior (`AdminHeader`).
4. **Aplicación y verificación** en las pantallas del panel ya implementadas (Clientes, Productos).
5. **Blindaje** — un guardián automático que impide que las pantallas futuras vuelvan a desalinearse.

**Fuera de alcance (features con otro dueño, no son diseño)**: correo masivo, importar, etiquetas,
ranking por facturación, cuenta web, tiendas por cliente, stock, categorías, "Visible en",
destacado, newsletter, ML, exportación masiva y borrado. Se listan en la matriz.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tokens del prototipo (P1, talla L)

Como desarrollador de una pantalla del panel, quiero que el tema exponga **todos** los valores del
prototipo (colores, tipografía, formas y dimensiones) en un único lugar, para que cualquier pantalla
los herede sin definir estilos sueltos.

**Why this priority**: es la base de las otras historias; sin esto, los componentes no pueden ser fieles.

**Independent Test**: renderizar el panel y comprobar por tests que cada color, tamaño de tipo y
radio/alto sale de `tokens.ts`/`temaPanel.ts` y coincide con el CSS del prototipo.

**Acceptance Scenarios**:

1. **Given** el CSS del prototipo, **When** se compara en tonos de etiqueta, **Then** existen los 7
   pares de `.chip.n/.p/.ok/.w/.e/.i/.o` (bg/fg) como tokens.
2. **Given** el prototipo, **When** se comparan las alertas, **Then** existen los tonos `.al.i/.w/.e/.ok`.
3. **Given** el prototipo, **When** se compara la tipografía, **Then** existen las escalas `.t1` (26/600),
   `.t2` (18/600), `.t3` (15/600), `.b` (14), `.bl` (15), `.s` (13), `.xs` (12), `.kpi` (30/600) y
   `.num` (tabular-nums), servidas como variants del tema.
4. **Given** el prototipo, **When** se comparan formas y dimensiones, **Then** existen `.btn` 38/9,
   `.btn.sm` 32/8, `.card` 12, `.chip` 999, `.fld .in` 40/9, `.ib` 34/8, `.cb` 18/5, `.sw` 40×22,
   `.seg` 34/9, `.menu`/`.snack`/`.al` 10 y `.bar` 6/3.
5. **Given** el prototipo, **When** se comparan fondos y textos del sider, **Then** están en tokens
   (fondo `#15181D`, activo `#2B55E6`, inactivo `#C9CCD2`, ícono `#9AA0A9`, label `#7C838D`, pie `#2A2E36`).

### User Story 2 - Componentes base de paridad (P1, talla L)

Como desarrollador, quiero componentes base reutilizables con el aspecto exacto del prototipo, para
armar pantallas sin re-estilar cada vez.

**Why this priority**: es el entregable que evita que cada épica reinterprete el prototipo.

**Independent Test**: renderizar cada componente en sus estados (normal, hover, foco, seleccionado,
deshabilitado) y comprobar que coincide con la clase del prototipo.

**Acceptance Scenarios**:

1. **Given** `EtiquetaEstado`, **When** se usa cada variante, **Then** muestra el par bg/fg del
   prototipo y forma de píldora (radio 999).
2. **Given** una `Checkbox`, **When** se ve, **Then** es 18×18, radio 5, borde 1.5 `#B9BCB6` y check
   azul `#2B55E6`.
3. **Given** un `Switch`, **When** se ve, **Then** es 40×22, apagado `#C9CBC6`, encendido `#2B55E6`.
4. **Given** un control segmentado (`.seg`), **When** se ve, **Then** borde `#D9D8D2`, radio 9, botón
   activo fondo `#15181D` texto blanco — **distinto** del filtro-píldora (`.chip.btn`, radio 999).
5. **Given** una alerta, **When** se muestra, **Then** usa los tonos `.al.i/.w/.e/.ok`.
6. **Given** el snackbar, **When** aparece, **Then** es fondo `#15181D`, texto blanco, radio 10.
7. **Given** un menú, **When** se abre, **Then** borde `#E6E5E0`, radio 10, padding 6, ítem radio 7 e
   ítem seleccionado `#F3F6FE`.
8. **Given** tabs, **When** se ven, **Then** borde inferior `#E6E5E0`, tab 14/600, activa borde
   inferior 2px `#15181D`.
9. **Given** la barra de progreso, **When** se ve, **Then** alto 6, radio 3, fondo `#EEEDE8`, relleno
   `#2B55E6`.
10. **Given** un avatar, **When** se ve, **Then** fondo `#DCE4FB` texto `#1E3FB8` 700.
11. **Given** la miniatura de producto (`.thumb`), **When** se ve, **Then** 40×40, radio 8, borde
    `#EEEDE8`, y placeholder fondo `#F5F5F2`.
12. **Given** una tabla, **When** se ve, **Then** está dentro del contenedor `.card` (borde `#E6E5E0`,
    radio 12) con las variantes de fila `.neg` `#FFF6F6` y `.hi` `#F3F6FE` y la última fila sin borde.

### User Story 3 - Shell del panel (P1, talla M)

Como usuario del panel, quiero que la barra lateral y la barra superior se vean como el prototipo,
para orientarme igual en todas las pantallas.

**Why this priority**: es el marco compartido; es lo que más pesa en "parece/no parece".

**Independent Test**: abrir el panel y comparar sider y header contra `AdminSider.dc.html` y
`AdminHeader.dc.html`, comprobando que la lógica (empresa activa, destinos, permisos, cuenta) no cambia.

**Acceptance Scenarios**:

1. **Given** el sider, **When** se ve en desktop, **Then** mide 232px y usa fondo `#15181D`, con ítem
   activo `#2B55E6`, ítem inactivo texto `#C9CCD2`/ícono `#9AA0A9`, labels de sección `#7C838D` y pie
   con borde `#2A2E36` (avatar + nombre + rol).
2. **Given** el header, **When** se ve en desktop, **Then** mide 60px con fondo blanco y borde inferior
   `#E6E5E0`.
3. **Given** el selector de empresa, **When** se ve, **Then** es un botón radio 10 con badge cuadrado de
   color, dos líneas (`.xs` "Empresa activa" + `.b` nombre) y chip de rol.
4. **Given** el header, **When** se ve, **Then** incluye breadcrumb (`.s`), buscador (`#F5F5F2`, 36px,
   placeholder `#8A9099`, atajo `⌘K`), campana `.ib` con punto `#C62828`, ayuda `.ib` y cuenta tipo
   píldora (avatar 28px + nombre + chevron) con menú de cabecera nombre/email.
5. **Given** el shell actual (empresa activa, destinos, permisos, menú de cuenta), **When** se aplica
   el nuevo aspecto, **Then** no cambia ninguna lógica, ruta ni permiso.

### User Story 4 - Pantallas entregadas fieles al inventario (P2, talla M)

Como responsable del producto, quiero que las pantallas ya entregadas (Clientes, Productos) queden
fieles a su prototipo **en lo que ya muestran**, para que la única diferencia restante sean features
con otro dueño.

**Why this priority**: es la verificación real; sin esto, la paridad es teórica.

**Independent Test**: recorrer el inventario de cada pantalla y comprobar que cada ítem existe o está
declarado fuera de alcance con su epic.

**Acceptance Scenarios**:

1. **Given** el inventario de `Clientes.dc.html`, **When** se recorre, **Then** cada columna, campo,
   botón, tab y diálogo mapea a un criterio de aceptación o a un epic fuera de alcance.
2. **Given** el inventario de `Productos.dc.html`, **When** se recorre, **Then** igual que el punto 1.
3. **Given** una pantalla con un ítem visible sin dueño, **When** se cierra la spec, **Then** no queda
   "sin mapear": o tiene CA o tiene epic declarado.

### User Story 5 - Guardián anti-deriva (P1, talla S)

Como equipo de producto, quiero que CI falle si una pantalla define valores de estilo sueltos, para que
la fidelidad al prototipo no dependa de que alguien se acuerde de usarlos.

**Why this priority**: es lo que hace que "queda para las que vienen" sea estructural y no una promesa;
sin esto, una pantalla nueva puede volver a divergir sin que nadie lo note.

**Independent Test**: introducir a propósito un color hex suelto en una pantalla y comprobar que el
control falla; quitar el valor suelto y comprobar que pasa.

**Acceptance Scenarios**:

1. **Given** una pantalla de `apps/web/src/pages/**` con un color hex/rgba, un radio, una altura o un
   `fontSize` sueltos, **When** corre el control, **Then** falla indicando archivo y línea, en castellano.
2. **Given** el tema (`apps/web/src/tema/**`) y los componentes base (`components/base/**`,
   `components/pagina/**`), **When** corre el control, **Then** están exentos (son los dueños de los valores).
3. **Given** una pantalla que usa tokens y componentes base, **When** corre el control, **Then** pasa.
4. **Given** el CI de validación, **When** corre, **Then** el control se ejecuta en el mismo gate liviano
   que `docs:check`/`lint` (sin depender de build ni tests pesados).

### Edge Cases

- El prototipo usa radios/altos en varios controles; si MUI no permite uno exacto, se usa el más
  cercano y se anota en el PR.
- El prototipo es desktop fijo de 1440px; la app es responsive. En xs (≤600px) la tabla pasa a tarjetas
  (decisión vigente, no se rompe); la fidelidad "al píxel" se mide en desktop.
- El sider oscuro puede afectar contraste de estados de foco/deshabilitado: se verifica AA.
- Los tonos pastel del prototipo pueden no cumplir contraste AA texto/fondo: si no, se ajusta el texto
  y se documenta la diferencia.
- `EtiquetaEstado` cambia de radio (6 → 999) y de tonos: sus consumidores actuales y tests deben seguir
  pasando.
- El guardián puede dar falsos positivos (un color dentro de un test, un SVG): la allow-list se documenta
  y se ajusta sin desactivar el control.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El tema DEBE exponer en `tokens.ts`/`temaPanel.ts` los colores, escala tipográfica,
  formas y dimensiones del prototipo; ninguna pantalla define valores de estilo sueltos.
- **FR-002**: DEBEN existir los tonos de etiqueta (`.chip.n/.p/.ok/.w/.e/.i/.o`) y de alerta
  (`.al.i/.w/.e/.ok`), más las filas `.neg`/`.hi`, como tokens.
- **FR-003**: DEBE existir la escala tipográfica `.t1/.t2/.t3/.b/.bl/.s/.xs/.kpi` y `.num`, mapeada a
  variants del tema (Sora para títulos, Instrument Sans para texto).
- **FR-004**: DEBEN existir las formas y dimensiones `.btn` 38/9, `.btn.sm` 32/8, `.card` 12, `.chip`
  999, `.fld .in` 40/9, `.ib` 34/8, `.cb` 18/5, `.sw` 40×22, `.seg` 34/9, `.menu`/`.snack`/`.al` 10 y
  `.bar` 6/3.
- **FR-005**: DEBEN existir/alinearse como piezas base: casilla, switch, segmentado, alerta, snackbar,
  menú, tabs, barra de progreso, avatar, miniatura y contenedor de tabla.
- **FR-006**: `EtiquetaEstado` DEBE exponer las variantes del prototipo con sus tonos y forma de píldora.
- **FR-007**: La tabla DEBE verse dentro de un contenedor tipo `.card`, admitir las variantes de fila
  `.neg`/`.hi` y no dibujar borde en la última fila.
- **FR-008**: La barra lateral DEBE verse como `AdminSider` (232px, fondo `#15181D`, activo `#2B55E6`,
  secciones, pie con avatar/rol).
- **FR-009**: La barra superior DEBE verse como `AdminHeader` (60px, selector de empresa, breadcrumb,
  buscador con atajo, campana, ayuda, cuenta) con borde inferior `#E6E5E0`.
- **FR-010**: NO DEBE cambiar el comportamiento: rutas canónicas, permisos, destinos del menú, empresa
  activa ni menú de cuenta.
- **FR-011**: El panel DEBE seguir funcionando con teclado y lector de pantalla y en anchos 320/768/1440;
  los contrastes DEBEN cumplir AA.
- **FR-012**: NO DEBE copiarse HTML ni CSS del prototipo; se implementa con el tema y componentes del
  template (MUI/Refine).
- **FR-013**: Cada ítem de los inventarios DEBE mapear a un criterio de aceptación o declararse fuera de
  alcance con su epic.
- **FR-014**: DEBE actualizarse `docs/sistema-de-diseno.md` (catálogo, variantes, tonos, shell) y
  `pnpm docs:check` DEBE quedar verde.
- **FR-015**: DEBE existir un control automático que falle si las pantallas (`apps/web/src/pages/**`)
  usan colores hex/rgba, radios, alturas o `fontSize` sueltos; el tema y los componentes base quedan
  exentos por ser los dueños de los valores.
- **FR-016**: El control DEBE ejecutarse en el gate liviano del CI de validación (junto a `docs:check`
  y `lint`) y reportar archivo, línea y motivo en castellano.

### Key Entities

- **Token de paridad**: valor de color, tipografía, forma o dimensión tomado del prototipo.
- **Componente base**: pieza reutilizable (etiqueta, casilla, switch, segmentado, alerta, snackbar,
  menú, tabs, barra, avatar, miniatura, contenedor de tabla).
- **Shell del panel**: barra lateral y barra superior compartidas.
- **Inventario de pantalla**: `.inventory.json` generado por `scripts/prototipo-inventario.mjs`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Existe un test por familia de tokens (colores, tipografía, formas) que falla si un valor
  deja de coincidir con el prototipo.
- **SC-002**: Cada componente base tiene test de sus estados contra el prototipo; `pnpm test` verde.
- **SC-003**: Sider y header coinciden con sus prototipos en estructura y estilos clave, y conservan
  rutas, permisos y lógica (`pnpm test` verde).
- **SC-004**: Los ítems de los 4 inventarios están mapeados (CA o fuera de alcance); ninguno sin dueño.
- **SC-005**: `pnpm lint`, `pnpm build`, `pnpm test` y `pnpm docs:check` verdes.
- **SC-006**: Existe un control que falla ante un valor de estilo suelto en una pantalla y pasa cuando
  la pantalla usa tokens/componentes; corre en el gate liviano del CI.

## Assumptions

- El prototipo `design/pantallas/*.dc.html` es la fuente de verdad visual del panel (por `docs/prototipos.md`).
- La fidelidad "al píxel" se mide en desktop (1440px); en xs rige la decisión responsive vigente.
- Las features sin dueño no se implementan acá; se listan con su epic en la matriz.
- Los valores del prototipo se confirman al llevarlos a tokens; si difieren, se documenta el final.
- Se construye sobre el tema MUI/Refine; no se copia CSS.
- La clave Jira del epic está por crear; se usa `MSF-XXX` y marcadores `PAR-01…PAR-04`.

## Matriz pantalla↔criterios

Los ítems salen de `design/pantallas/<Pantalla>.inventory.json`. "Diseño" = lo cubre esta spec
(tokens/componentes/shell). "Fuera de alcance" = feature con otro dueño.

### AdminSider (`AdminSider.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Botón "GC Gestión comercial" (logo) | Diseño | US3-CA1 / FR-008 (cabecera del sider) |
| Estructura de secciones e ítems | Diseño | US3-CA1 / FR-008 |
| Pie con avatar + rol | Diseño | US3-CA1 / FR-008 |

### AdminHeader (`AdminHeader.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| "Empresa activa · <nombre>" (selector) | Diseño | US3-CA3 / FR-009 |
| Avatar + "Administrador" (cuenta) | Diseño | US3-CA4 / FR-009 |
| "Mi cuenta" / "Usuarios" / "Cerrar sesión" | Diseño (estilo) · lógica vigente | US3-CA5 / FR-010 (no cambia comportamiento) |
| Breadcrumb, buscador `⌘K`, campana, ayuda | Diseño | US3-CA4 / FR-009 (el buscador solo se estiliza; su lógica de búsqueda es de otra épica si hiciera falta) |

### Clientes (`Clientes.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Tabla "Clientes": checkbox, Cliente, Tipo, Contacto, Localidad, Expreso preferido | Diseño | US4-CA1 + US2/FR-005/FR-007 |
| Columnas "Tiendas" y "Cuenta web" | Fuera de alcance | Tiendas/cuenta web por cliente (otro epic) |
| Tabla "Ranking": #, Cliente, Tipo, Comprobantes, Facturado, Participación | Fuera de alcance | Ranking por facturación (otro epic) |
| Buscador "Buscar por nombre, CUIT o número" | Diseño | Estilo del campo (US2/FR-004); lógica vigente |
| Botones "Nuevo cliente", "Ver ficha", "Editar" | Diseño | Estilo (US2) + US4-CA1 |
| Botón "Exportar" | Diseño | Estilo; ya existe lógica |
| "Importar", "Etiquetas", "Enviar correo…", "Exportar a Excel", "Aplicar", "Descargar plantilla CSV", "Importar N clientes" | Fuera de alcance | Importar / etiquetas / correo masivo / ranking (otros epics) |
| Campos de los diálogos (Número…Cuenta web; Asunto/Mensaje) | Diseño (estilo) / feature | Estilo del campo; los campos sin dueño (Cuenta web, Habilitado en) fuera de alcance |
| Diálogos "Editar/Nuevo cliente", "Eliminar cliente" | Diseño | Estilo del diálogo/menú/segmentado (US2) |
| Diálogo "Enviar correo" / "Importar clientes" | Fuera de alcance | Correo masivo / importar (otros epics) |

### Productos (`Productos.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Tabla "Productos": checkbox, Producto, Precio, Costo, Margen, Estado | Diseño | US4-CA2 + US2/FR-005/FR-007 |
| Columnas "Stock" y "Visible en" | Fuera de alcance | Stock / canales (otros epics) |
| Buscador "Buscar por nombre o SKU" | Diseño | Estilo; lógica ya existe |
| Botones "Nuevo producto", "Editar", activar/desactivar | Diseño | Estilo + lógica vigente |
| "Exportar", "Importar CSV", "Categoría", "Mover de categoría", "Marcar destacado", "Enviar al newsletter", "Borrar", "Quitar selección", "Limpiar filtros" | Fuera de alcance | Categorías / destacado / newsletter / export-import / borrado masivo (otros epics) |
| Diálogos "Exportar productos", "Mover de categoría", "Borrar productos" | Fuera de alcance | Export / categorías / borrado (otros epics) |

## Trazabilidad Jira ↔ Historias ↔ Tareas

| Jira | US | Relación | Tareas |
|---|---|---|---|
| MSF-XXX (epic, por crear) | US1–US4 | 1:N | — |
| PAR-01 (por crear) | US1 — Tokens del prototipo (P1) | 1:1 | T001–T006 |
| PAR-02 (por crear) | US2 — Componentes base de paridad (P1) | 1:1 | T007–T018 |
| PAR-03 (por crear) | US3 — Shell del panel (P1) | 1:1 | T019–T024 |
| PAR-04 (por crear) | US4 — Pantallas entregadas fieles (P2) | 1:1 | T025–T028 |
| PAR-05 (por crear) | US5 — Guardián anti-deriva (P1) | 1:1 | T029–T032 |

Cobertura: FR-001/002/003/004 → US1; FR-005/006/007 → US2; FR-008/009/010 → US3; FR-013 → US4;
FR-015/016 → US5; FR-011/012/014 → transversal.
