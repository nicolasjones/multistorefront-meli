---
owner: tecnico
sources:
  - specs
---

# Sistema de diseño — catálogo de componentes base (MSF-117)

Épica **MSF-117** (historias DS-01..DS-04 = MSF-420, MSF-426, MSF-431, MSF-435). Versión de producto: [Sistema de diseño](producto/sistema-de-diseno.md).

Spec: `specs/20261012-130000-sistema-de-diseno/` (DS-02, FR-004/005/008) y
`specs/20261017-150000-paridad-visual-prototipo/` (paridad visual con el
prototipo `.dc.html`).
Los valores viven en `apps/web/src/tema/tokens.ts` y se aplican con
`apps/web/src/tema/temaPanel.ts` (extiende el tema MUI/Refine). Las pantallas
no repiten colores, radios ni alturas: usan el componente base o el tema.

## Inventario (T006)

| Prototipo | Componente en el código | Origen |
|---|---|---|
| Botones | `Button` de MUI | Tema (`MuiButton`) |
| Campos | `TextField` de MUI | Tema (`MuiTextField`, `MuiOutlinedInput`) |
| Tarjetas | `TarjetaBase`, `ContenedorSeccion` | `components/base`, `components/pagina` |
| Etiquetas de estado | `EtiquetaEstado` | `components/base` |
| Casilla / switch / alertas / snackbar / menú / tabs / barra / avatar | `Checkbox`, `Switch`, `Alert`, `SnackbarContent`, `Menu`/`MenuItem`, `Tabs`/`Tab`, `LinearProgress`, `Avatar` de MUI | Tema (`MuiCheckbox`, `MuiSwitch`, `MuiAlert`, `MuiSnackbarContent`, `MuiMenu`, `MuiMenuItem`, `MuiTabs`, `MuiTab`, `MuiLinearProgress`, `MuiAvatar`) |
| Miniatura de producto | `MiniaturaProducto` | `components/base` |
| Tablas / listas | `Table*` de MUI | Tema (`MuiTableCell`) |
| Tabla→tarjetas adaptable | `ContenidoAdaptable` | `components/pagina` |
| Estados de página | `EstadoCargaPagina`, `EstadoVacio`, `EstadoExito`, `EstadoError` | `components/estados` |
| Encabezado de página | `EncabezadoPagina` | `components/pagina` |
| Shell (sider/encabezado/cuenta/empresa) | `SiderPanel`, `EncabezadoPanel`, `MenuCuenta`, `SelectorEmpresa` | `components/navegacion` |

## Variantes y estados

| Componente | Variantes | Estados cubiertos | Cuándo usarlo |
|---|---|---|---|
| Botón | `contained` (primario), `outlined` (secundario), `color="error"` (peligro); tamaños small 32 px, medium 38 px, large 46 px; esquinas 9 px (8 px el chico) | normal, hover (`#1E3FB8`), foco, deshabilitado, cargando (`loading`/`disabled` + texto) | Toda acción; una sola acción primaria por vista |
| Campo (`TextField`) | tamaño `small` por defecto | normal, hover, foco (borde azul), error (`error` + `helperText`), deshabilitado | Todo ingreso de datos |
| `TarjetaBase` | con o sin título | normal | Agrupar contenido relacionado |
| `EtiquetaEstado` | `neutral`, `primario`, `exito`, `aviso`, `error`, `info`, `contorno` (`.chip.o`) | normal | Mostrar el estado de un registro |
| Casilla / switch | `.cb` (18 px, radio 5, borde `checkBorde`, activo `checkActivo`); `.sw` (40×22, apagado `switchApagado`) | normal, hover, foco, deshabilitado | Selección múltiple / activar-ajustar |
| Alertas | `.al` con tonos `info`/`aviso`/`error`/`exito` (fondo/texto/ícono por tono) | los cuatro | Avisos en el flujo |
| Snackbar / menú / tabs / barra | snackbar oscuro radio 10; menú borde `bordeSuave` radio 10, ítem radio 7 seleccionado `fila.destacada`; tab 14/600 con borde inferior; barra 6/3 | normal, activo/seleccionado | Feedback, navegación secundaria y progreso |
| `MiniaturaProducto` | con imagen / marcador decorativo | normal | Listado de productos |
| `ContenidoAdaptable` | variantes de fila `negativa` (`.neg`) y `destacada` (`.hi`); última fila sin borde | normal | Tabla en `sm+`, tarjetas en `xs` |
| Tabla | encabezado sobre `fondoAlterno`, bordes `bordeSuave` | normal, vacío (usar `EstadoVacio`), cargando (`EstadoCargaPagina`) | Listados de datos |
| Estados de página | carga, vacío, éxito, error (con `reintentar`) | los cuatro | Todo recurso que carga datos |

## Reglas de uso

1. Usar el componente base o el tema; no escribir colores, radios ni alturas sueltos en pantallas.
2. No copiar HTML ni CSS del prototipo: reproducir lo que muestra con estos componentes.
3. Todo listado o recurso asincrónico cubre cargando, vacío y error con los estados de página.
4. Una diferencia con el prototipo se anota en la descripción del PR, no se resuelve con valores sueltos.
5. Si falta un componente, se agrega en `components/base/` con tokens y tests antes de usarlo.

## Decisiones (DS-02)

- Los colores semánticos `exito`, `aviso` e `info` son tokens nuevos (`#2E7D32`, `#9A5B00`, `#0277BD`): el prototipo solo fija los de DS-01; se tomaron los más cercanos sin inventar identidad. `aviso` se oscureció de `#B26A00` a `#9A5B00` para cumplir contraste AA (≥4.5:1) con texto blanco en `EtiquetaEstado`.
- `components/estados` y `components/pagina` conservan API y tests; se alinean vía el tema (`MuiAlert`, `MuiCard`).
- Tablas: se personaliza vía tema, sin componente propio, para no duplicar `Table` de MUI.
- Prueba de alineación con el prototipo (rama `feat/diseno-alineado-prototipo`): botones con peso 600 y
  chicos de 32 px (`tokens.forma.altoBotonChico`), etiquetas chicas de 24 px, filtros como píldoras
  oscuras al seleccionar y encabezado de tabla transparente en mayúsculas de 12 px. Al aceptarse, el
  valor chico pasó a los tokens (`altoBotonChico: 32`, `radioBotonChico: 8`) y la tabla de variantes de
  arriba quedó actualizada.

## Paridad con el prototipo (`paridad-visual-prototipo`)

La escala del prototipo (`.t1`/`.t2`/`.t3`/`.kpi`/`.b`/`.bl`/`.s`/`.xs`) se
expone como variantes propias de tipografía (`variant="t1"`, etc.), no
remapeando `h1..h6`, para no cambiar el significado de las variantes estándar.

- **Tonos de etiqueta** (`.chip.n/.p/.ok/.w/.e/.i/.o`): fondos/textos en
  `tokens.color.etiqueta`; `EtiquetaEstado` es una píldora de 24 px.
- **Formas/dimensiones**: alturas de botón, casilla, switch, MINIATURA, sider
  (232 px) y encabezado (60 px) en `tokens.forma`; el sider oscuro se aplica
  solo a los drawers anclados a la izquierda (el chat flotante usa la derecha).
- **Alertas**: los cuatro tonos en `tokens.color.alerta` vía `MuiAlert`.
- **Filas de tabla**: `ContenidoAdaptable.varianteFila` pinta `.neg`/`.hi` y la
  última fila pierde el borde inferior.

### Guardián de valores sueltos (FR-015/FR-016)

`pnpm estilos:check` (`scripts/verificar-estilos-sueltos.mjs`) falla si
`apps/web/src/pages/**` usa colores hex/rgba/hsl o `borderRadius`/`height`/
`minHeight`/`fontSize` con valores literales. Corre en el gate liviano de
`.github/workflows/validate.yml` (job `application`) junto a `docs:check` y
`lint`.

Quedan exentos (allow-list) por ser los dueños de los valores:

- `apps/web/src/tema/**` (tokens y tema),
- `apps/web/src/components/base/**` y `apps/web/src/components/pagina/**`,
- los tests (`*.test.*`, `*.spec.*`) y las declaraciones (`.d.ts`).

Una línea puede acogerse a la excepción con el comentario
`estilos-sueltos: ok: <motivo>` cuando el valor no es del sistema de diseño
(p. ej. `height: 1` de una utilidad de accesibilidad que oculta visualmente sin
quitar del lector).

## Paridad de pantallas (`paridad-pantallas`)

Cierra la brecha entre la capa de lenguaje visual (arriba) y el layout de cada
pantalla. Comportamiento, rutas, permisos y datos no cambian; lo que manda es el
prototipo `design/pantallas/*.dc.html`.

- **Encabezado de pantalla** (`EncabezadoPagina`): título `.t1` (`h1`),
  descripción `.bl` y acciones a la derecha; pestañas opcionales debajo
  (`.tabs`). Es composición: no conoce datos ni permisos.
- **Barra de herramientas** (`BarraHerramientas`): la fila del listado con la
  búsqueda, las píldoras de filtro y el contador de resultados, más un texto de
  ayuda opcional. Recibe todo armado.
- **Píldoras de filtro** (`.chip.btn`): `MuiToggleButtonGroup` agrega separación
  y borde propio a cada píldora (no es un control segmentado); al seleccionar
  quedan oscuras (`MuiToggleButton`).
- **Ingreso**: layout de dos paneles del prototipo (panel de marca oscuro a la
  izquierda, oculto en pantallas angostas, y formulario a la derecha). El error
  de credenciales sigue anunciándose por la notificación de Refine, sin un
  `Alert` propio (decisión con test propio).

Aplicado en los listados de Clientes, Productos, Empresas, Usuarios, Roles y
Actividad, y en la ficha de perfil.

- **Diálogos**: velo oscuro `tokens.color.backdrop`, esquinas de 14 px
  (`forma.radioModal`), sombra alta, título `.t2` y paddings del modal; el botón
  «Cerrar» (X) sale de `TituloDialogo`.
- **Pantallas de acceso**: `MarcoAcceso` + `PanelMarca` reproducen el panel de
  marca oscuro del prototipo en Login, Definir contraseña y Recuperar acceso.
- **Marca del panel**: la barra lateral muestra «GC · Gestión comercial»
  (`TituloPanel`) y el título de la app queda como el prototipo.
- **Pestañas** (`.tabs`/`.tab`): `PestanasPagina` enlaza rutas hermanas ya
  existentes (Usuarios ↔ Roles y permisos), como los `<a href>` del diseño.

### Fuera de alcance (features con otro dueño)

No se muestran controles del prototipo que no tengan dueño de datos: correo
masivo, importar, etiquetas, ranking por facturación, cuenta web, tiendas por
cliente, filtro por tienda, stock, categorías, «Visible en», precio/costo/margen
en el listado de productos, selección múltiple con acciones masivas y
exportación masiva (Mercado Libre, newsletter, destacado).

## Estructura del panel (DS-03)

Encabezado (`EncabezadoPanel`), sider (`SiderPanel`), menú de cuenta
(`MenuCuenta`) y `SelectorEmpresa` usan tokens y tema; permisos y destinos no
cambian (`apps/web/src/components/navegacion/`, T013–T017).

- **Selector de empresa**: en `/empresas/edit/:id` lista las empresas de la
  organización (las filtra RLS), marca la de la ruta y al elegir otra navega a
  la misma sección con su id. Fuera de esas pantallas queda la etiqueta de la
  organización, sin cambio. Hoy solo existe la sección «General»
  (`SelectorEmpresa.tsx`).

## Tema por empresa para tiendas públicas (DS-04)

Mecanismo en `apps/web/src/tema/temaTienda.ts` y `ProveedorTemaTienda.tsx`
(T018–T021); aislado del tema del panel.

- **Contrato** `IdentidadTienda`: `tipografiaTitulos`, `tipografiaTexto`,
  `colorPrimario`, `colorTexto`, `colorFondo`.
- `crearTemaTienda(identidad?)` devuelve un tema MUI claro. Cada campo
  ausente o inválido (color que no sea hex de 3/6 dígitos; tipografía fuera de
  letras/números/espacio/`_`/`-`, máx. 60) cae a `IDENTIDAD_TIENDA_POR_DEFECTO`
  (neutro, distinto del panel), para que una tienda sin configurar no se rompa
  y un valor malicioso no inyecte estilos.
- `ProveedorTemaTienda` es un `ThemeProvider` anidado: solo afecta a su
  subárbol y no altera el tema de `App.tsx`.
- `IDENTIDADES_EJEMPLO` (`mundoJc`: Barlow Condensed/Barlow; `sanJavucho`)
  sirven solo para validar el mecanismo. Los colores de Mundo JC y todos los de
  San Javucho son de ejemplo, no confirmados con el prototipo (T020).

**Fuera de alcance / pendiente:**

- La configuración de la identidad por empresa (Empresa · Identidad visual) y
  su lectura desde BD son de otra épica; hoy el proveedor no está montado en
  ninguna pantalla, solo en tests. TODO (dueño: épica MSF-147, tienda
  dominio e identidad): conectarlo y cargar las fuentes de cada tienda.
- Cómo se comparten los tokens si el front público es otro repo: sin definir.
- Modo oscuro, búsqueda global (⌘K) y branding por organización: no incluidos.
