# Feature Specification: Plataforma · Paridad de pantallas con el prototipo

**Feature Branch**: `epic/MSF-XXX-paridad-pantallas`

**Jira Epic**: MSF-XXX (por crear) — placeholder; reemplazar por la clave real cuando exista.

**Created**: 2026-10-17

**Status**: Ready for implementation.

**Delivery scope**: `refine` (apps/web). Sin `supabase`, `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · afecta a todas las pantallas del panel.

**Input**: Cierre de
`specs/20261017-150000-paridad-visual-prototipo` (tokens, tema, componentes base, shell y
guardián). Aquella spec entregó la **capa de lenguaje visual**; el pedido en vivo es que
**las pantallas se vean como el prototipo**, no sólo que hereden el tema.

**Relación con la spec anterior**: NO reemplaza nada de la anterior. La anterior fijó tokens,
tema, shell y el guardián; esta **aplica** esa capa en el layout de cada pantalla (encabezado,
barra de herramientas, tarjetas, tablas, estados, pestañas y el ingreso).

**Regla de fuentes**:

- Comportamiento, rutas, permisos y datos: no cambian (mandan los requisitos vigentes).
- Qué se ve: manda el prototipo `design/pantallas/*.dc.html`.
- Cómo se construye: tokens + tema MUI/Refine + componentes de `components/pagina` y
  `components/base`; **no se copia CSS del prototipo** y las pantallas no declaran valores sueltos
  (lo impone el guardián `estilos:check` de la spec anterior).
- Lo que el prototipo pide y no tiene dueño de datos: queda **fuera de alcance** (abajo), sin
  inventar funciones ni mostrar controles que no hagan nada.

## Alcance

Aplica la paridad en las pantallas ya implementadas del panel:

1. **Piezas de página compartidas** — encabezado (`.t1` + `.bl` + acciones + pestañas) y barra de
   herramientas (búsqueda + píldoras de filtro + contador + texto de ayuda).
2. **Ingreso** (`Login`) — layout de dos paneles del prototipo (marca oscura + formulario).
3. **Clientes** — listado y ficha.
4. **Productos** — listado y alta/edición.
5. **Empresas** — listado.
6. **Usuarios y Roles** — listado.
7. **Actividad** — listado.
8. **Cuenta y acceso** — perfil y pantallas de contraseña.
9. **Blindaje** — tests de las piezas compartidas y de las pantallas intervenidas.

**Fuera de alcance (features con otro dueño, no son diseño)**: correo masivo, importar,
etiquetas, ranking por facturación, cuenta web, tiendas por cliente, filtro por tienda, stock,
categorías, "Visible en", precio/costo/margen en el listado de productos, destacado, newsletter,
ML, selección múltiple con acciones masivas y exportación masiva. Se documentan en el PR.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Encabezado y barra de herramientas fieles (P1, talla M)

Como persona que usa el panel, quiero que cada pantalla abra con el título, la descripción, las
acciones y los filtros como en el prototipo, para reconocerla de un vistazo.

**Independent Test**: renderizar una pantalla de listado y comprobar por test que el título es un
`h1` con la variante `.t1`, que la descripción usa `.bl`, que las acciones van a la derecha y que
la barra de herramientas muestra búsqueda, píldoras y contador.

### User Story 2 - Ingreso de dos paneles (P2, talla S)

Como persona del equipo, quiero que el ingreso muestre el panel de marca a la izquierda y el
formulario a la derecha, como el prototipo.

**Independent Test**: renderizar `Login` y comprobar el panel de marca, el título, los campos y el
botón; el error de credenciales se muestra en pantalla.

### User Story 3 - Listados con tarjeta, píldoras y contador (P1, talla L)

Como persona que administra clientes, productos, empresas, usuarios, roles o actividad, quiero que
el listado use la tarjeta, las píldoras de filtro, el contador y la tabla del prototipo.

**Independent Test**: renderizar cada listado y comprobar encabezado, barra de herramientas,
columnas y acciones.

### User Story 4 - Blindaje (P2, talla S)

Como equipo, queremos tests de las piezas compartidas y de las pantallas intervenidas para que la
paridad no se rompa sola.

## Requirements *(mandatory)*

- **FR-001**: `EncabezadoPagina` DEBE usar `.t1` para el título (`h1`) y `.bl` para la
  descripción, con las acciones a la derecha y las pestañas (opcionales) debajo.
- **FR-002**: DEBE existir una pieza de barra de herramientas reutilizable con búsqueda, píldoras
  de filtro, contador y texto de ayuda.
- **FR-003**: Las píldoras de filtro DEBEN verse como `.chip.btn` (blanco con borde; oscuro al
  seleccionar) y separadas entre sí.
- **FR-004**: `Login` DEBE usar el layout de dos paneles y mostrar el error de credenciales.
- **FR-005**: Los listados DEBEN envolver la barra de herramientas y la tabla en la tarjeta de
  sección, con el contador de resultados.
- **FR-006**: NO se agregan funciones sin dueño de datos; los controles del prototipo sin dueño no
  se muestran.
- **FR-007**: Las pantallas no declaran valores sueltos (`estilos:check` en verde).
- **FR-008**: Se mantiene la respuesta responsiva (tabla→tarjetas en `xs`) y la accesibilidad
  (roles, foco, contraste AA).

## Success Criteria *(measurable)*

- **SC-001**: `pnpm estilos:check` y `pnpm test:estilos:sueltos` en verde.
- **SC-002**: `tsc -b`, `pnpm lint` (0 errores) y los tests de las pantallas intervenidas en verde.
- **SC-003**: cada listado intervenido muestra encabezado `.t1`, barra de herramientas y contador.
- **SC-004**: `docs/sistema-de-diseno.md` documenta las piezas y el alcance.
