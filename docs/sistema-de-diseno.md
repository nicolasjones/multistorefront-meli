---
owner: tecnico
sources:
  - apps/web/src/tema
  - apps/web/src/components
  - scripts/verificar-estilos-sueltos.mjs
  - specs/20261012-130000-sistema-de-diseno
---

# Sistema de diseño: tokens, tema y catálogo (MSF-117)

**Épica:** MSF-117 · **Historias:** MSF-420 (DS-01), MSF-426 (DS-02), MSF-431 (DS-03) y MSF-435 (DS-04).
**Spec:** `specs/20261012-130000-sistema-de-diseno/` (`spec.md`, `plan.md`, `tasks.md`).
**Alcance de entrega:** `refine` (`apps/web`). Sin `supabase`, `kestra`, `superset` ni `workers`.
**Sin cambios de esquema:** la épica no crea tablas ni migraciones; el modelo de datos de
[Datos y DER](tecnico/datos.md) no cambia.

Vista de producto: [Sistema de diseño (MSF-117)](producto/sistema-de-diseno.md).

## Estado de entrega

Las cuatro historias de la épica están mergeadas en `main`:

| Historia | Qué entrega | Commit |
|---|---|---|
| MSF-420 (DS-01) | Tokens y tema del panel | `2c33d878` |
| MSF-426 (DS-02) | Componentes base y estados + catálogo | `01e0d0cc` |
| MSF-431 (DS-03) | Estructura del panel: encabezado, menú y selector de empresa | `4ce67038` |
| MSF-435 (DS-04) | Temas de las tiendas públicas por empresa | `a1cd746a` |

La épica se integró con los PR #13 y #14 (`4460acd9`, `9e634098`). Sobre el mismo sistema siguen dos
specs posteriores, todavía sin clave Jira: `specs/20261017-150000-paridad-visual-prototipo/` (paridad de
la capa visual) y `specs/20261017-193000-paridad-pantallas/` (paridad del layout de cada pantalla).

## Dónde vive

| Archivo | Qué define |
|---|---|
| `apps/web/src/tema/tokens.ts` | **Único lugar** con los valores de estilo: colores, tipografías, espaciado y formas. |
| `apps/web/src/tema/temaPanel.ts` | `temaPanel`: el tema MUI que aplica los tokens (paleta, tipografía, escala y `styleOverrides` de los componentes). |
| `apps/web/src/tema/temaTienda.ts` | Contrato `IdentidadTienda`, validación y `crearTemaTienda()` (tema por empresa de las tiendas). |
| `apps/web/src/tema/ProveedorTemaTienda.tsx` | `ThemeProvider` anidado que aplica el tema de tienda a un subárbol. |
| `apps/web/src/App.tsx:171` | `<ThemeProvider theme={temaPanel}>`: el tema único del panel. |
| `apps/web/src/main.tsx:3-4` | Carga de las tipografías (`@fontsource-variable/sora`, `@fontsource-variable/instrument-sans`; OFL, desde npm, sin CDN). |
| `apps/web/src/components/base/` | Componentes base propios: `EtiquetaEstado`, `TarjetaBase`, `MiniaturaProducto`, `TituloDialogo`. |
| `apps/web/src/components/pagina/` | Composición de pantalla: `EncabezadoPagina`, `ContenedorSeccion`, `ContenidoAdaptable`, `BarraHerramientas`, `MarcoAcceso`, `PanelMarca`, `PestanasPagina`. |
| `apps/web/src/components/estados/EstadosPagina.tsx` | Estados de página: `EstadoCargaPagina`, `EstadoVacio`, `EstadoExito`, `EstadoError`. |
| `apps/web/src/components/navegacion/` | Shell del panel: `EncabezadoPanel`, `SiderPanel`, `MenuCuenta`, `SelectorEmpresa`, `SelectorEmpresaActiva`, `TituloPanel`, destinos y permisos. |

## Tokens (DS-01)

`tokens.ts` es la fuente de verdad: una pantalla no escribe un color, un radio ni una altura.

### Color (`tokens.color`)

| Grupo | Valores |
|---|---|
| Acción | `accion: #2B55E6`, `accionHover: #1E3FB8` |
| Texto | `texto: #15181D`, `textoSecundario: #5F6670`, `textoTerciario: #3B4048`, `placeholder: #8A9099` |
| Bordes | `borde: #D9D8D2`, `bordeSuave: #E6E5E0` |
| Fondos | `fondo: #F5F5F2`, `fondoAlterno: #EEEDE8`, `superficie: #FFFFFF`, `backdrop: rgba(21, 24, 29, 0.5)` |
| Semánticos | `peligro: #C62828`, `exito: #2E7D32`, `aviso: #9A5B00`, `info: #0277BD` |
| Etiquetas | 7 tonos (`.chip.n/.p/.ok/.w/.e/.i/.o`): `neutral`, `primario`, `exito`, `aviso`, `error`, `info`, `contorno` |
| Alertas | 4 tonos (`.al.i/.w/.e/.ok`): `info`, `aviso`, `error`, `exito`, cada uno con fondo, texto e ícono |
| Filas | `negativa: #FFF6F6`, `destacada: #F3F6FE` (`.neg` / `.hi`) |
| Sider | `fondo: #15181D`, ítem `#C9CCD2`, ítem activo `#FFFFFF` sobre `#2B55E6`, hover `#232830`, label `#7C838D`, rol `#9AA0A9`, pie `#2A2E36` |
| Avatar | `fondo: #DCE4FB`, `texto: #1E3FB8` |
| Controles | `checkBorde: #B9BCB6`, `checkActivo: #2B55E6`, `switchApagado: #C9CBC6`, `switchEncendido: #2B55E6`, estrellas `#E9A23B` / `#C9CBC6` |

### Tipografía (`tokens.tipografia`)

- Títulos: `'Sora Variable', Sora, system-ui, sans-serif`.
- Texto: `'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif`.
- `pesoEnfasis: 600`.
- Escala del prototipo como **variantes propias** (no se remapean `h1..h6`): `hero` 38/600, `t1` 26/600,
  `t2` 18/600, `t3` 15/600, `b` 14/400, `bl` 15/400, `s` 13/400, `xs` 12/400, `kpi` 30/600,
  `etiqueta` 12.5/600. Cada una con su interlineado y espaciado.
- `numeros.tabular: 'tabular-nums'` para el `.num` del prototipo.

### Formas (`tokens.forma`)

Botón 38 px de alto y radio 9 (chico 32/8, grande 46); campo 40/9 y área 80; tarjeta 12; **modal 14** con
sombra alta; etiqueta 24 de alto y radio 999; ícono 34/8; casilla 18/5; switch 40×22 (radio 11);
segmentado 34/9; menú 10 (ítem 7); snackbar 10; alerta 10; barra 6/3; miniatura 40/8; **sider 232** de
ancho y **encabezado 60** de alto. `altoHeader` se aplica en `EncabezadoPanel` y `TituloPanel`;
`anchoSider` queda como valor de referencia (el ancho real lo aporta el `ThemedSider` de Refine).

## Tema del panel (DS-01)

`temaPanel` (`apps/web/src/tema/temaPanel.ts`) es un `createTheme` de MUI que **extiende** los valores por
defecto de MUI (los del template) con los tokens: no copia HTML ni CSS del prototipo (FR-008). Es el único
`ThemeProvider` del panel (`apps/web/src/App.tsx:171`); `@refinedev/mui` v8 no impone otro tema.

- **Paleta**: `primary.main = accion`, `primary.dark = accionHover`, `error = peligro`, `success`,
  `warning`, `info`, `text.primary/secondary/disabled`, `divider = borde`, `background.default = fondo`,
  `background.paper = superficie`; `spacing: 8`; `shape.borderRadius = 9`.
- **Tipografía**: `fontFamily` de texto, `h1..h6` y `subtitle1` con la familia de títulos, `button` sin
  transformación de mayúsculas, más las variantes de la escala.
- **Componentes personalizados** por `styleOverrides`: `MuiButton` (alto y radio por tamaño),
  `MuiOutlinedInput`, `MuiCard`, `MuiBackdrop`, `MuiDialog`, `MuiDialogTitle/Content/Actions`,
  `MuiChip`, `MuiToggleButton`, `MuiToggleButtonGroup`, `MuiCheckbox`, `MuiSwitch`, `MuiAlert`,
  `MuiSnackbarContent`, `MuiMenu`, `MuiMenuItem`, `MuiTabs`, `MuiTab`, `MuiLinearProgress`, `MuiAvatar`,
  `MuiDrawer`, `MuiTableCell`. `MuiTextField` usa `size: 'small'` por defecto.
- El **sider oscuro** se aplica solo a los drawers anclados a la izquierda (`paperAnchorDockedLeft`,
  `paperAnchorLeft`): el chat flotante, que se ancla a la derecha, no se ve afectado
  (`temaComponentes.test.ts`).
- Las **tipografías** se cargan desde npm (`apps/web/package.json`: `@fontsource-variable/sora`,
  `@fontsource-variable/instrument-sans`), no desde un CDN: no hay dependencia de red ni de terceros en
  runtime.

## Inventario de componentes (DS-02)

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

## Estructura del panel (DS-03)

Encabezado (`EncabezadoPanel`), sider (`SiderPanel`), menú de cuenta (`MenuCuenta`) y los selectores de
empresa usan tokens y tema; **permisos y destinos no cambian**
(`apps/web/src/components/navegacion/`, T013–T017).

- **Encabezado** (`EncabezadoPanel.tsx`): `AppBar` fijo arriba, `HamburgerMenu` de Refine, selector de
  empresa, migas derivadas del destino activo (`SECCIONES_PANEL`), menú de cuenta a la derecha. Alto 60 px
  (`tokens.forma.altoHeader`) y borde inferior `bordeSuave`.
- **Sider** (`SiderPanel.tsx`): se apoya en `ThemedSider` de Refine para el shell colapsable y responsive
  (drawer en mobile) y reemplaza su contenido con `SECCIONES_PANEL` filtrado por contexto y permisos.
  Ítem activo con `sider.itemFondoActivo` (#2B55E6), hover `sider.itemHover`; en modo colapsado el ítem
  muestra su etiqueta en tooltip.
- **Selector de empresa** (`SelectorEmpresa.tsx`): en `/empresas/edit/:id` lista las empresas de la
  organización (las filtra RLS), marca la de la ruta y al elegir otra navega a la misma sección con su id.
  Fuera de esas pantallas queda la etiqueta de la organización, sin cambio. Hoy solo existe la sección
  «General».
- **Empresa activa** (`SelectorEmpresaActiva.tsx`): es un control distinto del anterior — cambia la
  empresa activa persistida. Con **una sola empresa** se muestra como etiqueta fija, sin opción de
  cambio (`SelectorEmpresaActiva.tsx:54`); con varias, abre el listado con la activa marcada
  (`aria-current`) y pide confirmación si hay cambios sin guardar.

## Tema por empresa para tiendas públicas (DS-04)

Mecanismo en `apps/web/src/tema/temaTienda.ts` y `ProveedorTemaTienda.tsx` (T018–T021); **aislado** del
tema del panel.

- **Contrato** `IdentidadTienda`: `tipografiaTitulos`, `tipografiaTexto`, `colorPrimario`, `colorTexto`,
  `colorFondo`.
- `crearTemaTienda(identidad?)` devuelve un tema MUI claro. Cada campo ausente o inválido (color que no
  sea hex de 3/6 dígitos — `COLOR_HEX`, `temaTienda.ts:46`; tipografía fuera de letras/números/espacio/`_`/`-`,
  máx. 60 — `NOMBRE_TIPOGRAFIA`, `temaTienda.ts:47`) cae a `IDENTIDAD_TIENDA_POR_DEFECTO` (neutro, distinto
  del panel), para que una tienda sin configurar no se rompa y un valor malicioso no inyecte estilos.
- `ProveedorTemaTienda` es un `ThemeProvider` **anidado** (`ProveedorTemaTienda.tsx:16`): solo afecta a su
  subárbol y no altera el tema de `App.tsx`.
- `IDENTIDADES_EJEMPLO` (`mundoJc`: Barlow Condensed/Barlow; `sanJavucho`: Playfair Display/Lato) sirven
  solo para validar el mecanismo. Los colores de Mundo JC y todos los de San Javucho son de ejemplo, no
  confirmados con el prototipo (T020).

**Fuera de alcance / pendiente:**

- La configuración de la identidad por empresa (Empresa · Identidad visual) y su lectura desde BD son de
  otra épica; hoy el proveedor **no está montado en ninguna pantalla**, solo en tests. TODO (dueño: épica
  MSF-147, tienda dominio e identidad): conectarlo y cargar las fuentes de cada tienda.
- Cómo se comparten los tokens si el front público es otro repo: sin definir.
- Modo oscuro, búsqueda global (⌘K) y branding por organización: no incluidos.

## Guardián de valores sueltos

Lo introduce el spec `paridad-visual-prototipo` (FR-015/FR-016) sobre el mismo sistema:

`pnpm estilos:check` (`scripts/verificar-estilos-sueltos.mjs`) falla si `apps/web/src/pages/**` usa colores
hex/rgba/hsl o `borderRadius`/`height`/`minHeight`/`fontSize` con valores literales. Corre en el gate
liviano de `.github/workflows/validate.yml` (job `application`) junto a `docs:check` y `lint`.

Quedan exentos (allow-list) por ser los dueños de los valores:

- `apps/web/src/tema/**` (tokens y tema),
- `apps/web/src/components/base/**` y `apps/web/src/components/pagina/**`,
- los tests (`*.test.*`, `*.spec.*`) y las declaraciones (`.d.ts`).

Una línea puede acogerse a la excepción con el comentario `estilos-sueltos: ok: <motivo>` cuando el valor
no es del sistema de diseño (p. ej. `height: 1` de una utilidad de accesibilidad que oculta visualmente
sin quitar del lector).

## Paridad con el prototipo (`paridad-visual-prototipo`)

La escala del prototipo (`.t1`/`.t2`/`.t3`/`.kpi`/`.b`/`.bl`/`.s`/`.xs`) se expone como variantes propias
de tipografía (`variant="t1"`, etc.), no remapeando `h1..h6`, para no cambiar el significado de las
variantes estándar.

- **Tonos de etiqueta** (`.chip.n/.p/.ok/.w/.e/.i/.o`): fondos/textos en `tokens.color.etiqueta`;
  `EtiquetaEstado` es una píldora de 24 px.
- **Formas/dimensiones**: alturas de botón, casilla, switch, `MINIATURA`, sider (232 px) y encabezado
  (60 px) en `tokens.forma`; el sider oscuro se aplica solo a los drawers anclados a la izquierda (el chat
  flotante usa la derecha).
- **Alertas**: los cuatro tonos en `tokens.color.alerta` vía `MuiAlert`.
- **Filas de tabla**: `ContenidoAdaptable.varianteFila` pinta `.neg`/`.hi` y la última fila pierde el
  borde inferior.

## Paridad de pantallas (`paridad-pantallas`)

Cierra la brecha entre la capa de lenguaje visual (arriba) y el layout de cada pantalla. Comportamiento,
rutas, permisos y datos no cambian; lo que manda es el prototipo `design/pantallas/*.dc.html`.

- **Encabezado de pantalla** (`EncabezadoPagina`): título `.t1` (`h1`), descripción `.bl` y acciones a la
  derecha; pestañas opcionales debajo (`.tabs`). Es composición: no conoce datos ni permisos.
- **Barra de herramientas** (`BarraHerramientas`): la fila del listado con la búsqueda, las píldoras de
  filtro y el contador de resultados, más un texto de ayuda opcional. Recibe todo armado.
- **Píldoras de filtro** (`.chip.btn`): `MuiToggleButtonGroup` agrega separación y borde propio a cada
  píldora (no es un control segmentado); al seleccionar quedan oscuras (`MuiToggleButton`).
- **Ingreso**: layout de dos paneles del prototipo (panel de marca oscuro a la izquierda, oculto en
  pantallas angostas, y formulario a la derecha). El error de credenciales sigue anunciándose por la
  notificación de Refine, sin un `Alert` propio (decisión con test propio).

Aplicado en los listados de Clientes, Productos, Empresas, Usuarios, Roles y Actividad, y en la ficha de
perfil.

- **Diálogos**: velo oscuro `tokens.color.backdrop`, esquinas de 14 px (`forma.radioModal`), sombra alta,
  título `.t2` y paddings del modal; el botón «Cerrar» (X) sale de `TituloDialogo`.
- **Pantallas de acceso**: `MarcoAcceso` + `PanelMarca` reproducen el panel de marca oscuro del prototipo
  en Login, Definir contraseña y Recuperar acceso.
- **Marca del panel**: la barra lateral muestra «GC · Gestión comercial» (`TituloPanel`) y el título de la
  app queda como el prototipo.
- **Pestañas** (`.tabs`/`.tab`): `PestanasPagina` enlaza rutas hermanas ya existentes (Usuarios ↔ Roles y
  permisos), como los `<a href>` del diseño.

### Fuera de alcance (features con otro dueño)

No se muestran controles del prototipo que no tengan dueño de datos: correo masivo, importar, etiquetas,
ranking por facturación, cuenta web, tiendas por cliente, filtro por tienda, stock, categorías, «Visible
en», precio/costo/margen en el listado de productos, selección múltiple con acciones masivas y exportación
masiva (Mercado Libre, newsletter, destacado).

## Pruebas

| Archivo | Qué cubre |
|---|---|
| `apps/web/src/tema/tokens.test.ts` | Los tokens contra los valores del CSS del prototipo (etiquetas, alertas, sider, escala tipográfica, formas). |
| `apps/web/src/tema/temaPanel.test.ts` | Tipografías del tema, azul de acción y su hover, peligro, texto/bordes/fondos y botón de 38 px con esquinas de 9 px. |
| `apps/web/src/tema/temaComponentes.test.ts` | Que los `styleOverrides` de paridad toman los valores de los tokens (casilla, switch, alertas, menú, snackbar, tabs, barra, avatar) y que el sider oscuro se limita a la izquierda. |
| `apps/web/src/tema/temaTienda.test.tsx` | Dos temas de tienda independientes, el tema por defecto sin identidad y el panel intacto. |
| `apps/web/src/components/base/componentesBase.test.tsx` | Variantes de `EtiquetaEstado`, `TarjetaBase` y `MiniaturaProducto`. |
| `apps/web/src/components/estados/EstadosPagina.test.tsx` | Estados de carga, vacío, éxito y error. |
| `apps/web/src/components/pagina/*.test.tsx` | `EncabezadoPagina`, `ContenedorSeccion`, `ContenidoAdaptable`, `BarraHerramientas`. |
| `apps/web/src/components/navegacion/*.test.tsx` | Encabezado, sider, menú de cuenta y los dos selectores de empresa (incluye el caso de una sola empresa). |
| `apps/web/src/components/navegacion/destinosPanel.permisos.test.ts` | Que el menú no cambie permisos ni destinos. |
| `scripts/verificar-estilos-sueltos.test.mjs` | El guardián de valores sueltos. |

## Flujo: cómo adopta una pantalla nueva el sistema

1. **Estructura**: `EncabezadoPagina` (título, descripción, acciones, pestañas) + `ContenedorSeccion`
   para el contenido; `BarraHerramientas` para la fila de búsqueda y filtros del listado.
2. **Datos**: todo recurso asincrónico con `EstadoCargaPagina`, `EstadoVacio` y `EstadoError` (con
   `reintentar`); `EstadoExito` para confirmar.
3. **Listados**: `ContenidoAdaptable` para que la tabla de `sm+` y las tarjetas de `xs` compartan columnas
   y acciones; `EtiquetaEstado` para el estado de cada fila; `MiniaturaProducto` para imágenes de
   producto.
4. **Diálogos**: `TituloDialogo` para el encabezado y el botón «Cerrar»; el resto sale del tema.
5. **Estilos**: todo desde tokens y variantes del tema. `pnpm estilos:check` falla si aparece un valor
   suelto en `apps/web/src/pages/**`.
6. **Pruebas**: los estados del componente base se prueban en `components/base/`, no en la pantalla.

## Decisiones

- Los colores semánticos `exito`, `aviso` e `info` son tokens nuevos (`#2E7D32`, `#9A5B00`, `#0277BD`): el
  prototipo solo fija los de DS-01; se tomaron los más cercanos sin inventar identidad. `aviso` se
  oscureció de `#B26A00` a `#9A5B00` para cumplir contraste AA (≥4.5:1) con texto blanco en
  `EtiquetaEstado`.
- `components/estados` y `components/pagina` conservan API y tests; se alinean vía el tema (`MuiAlert`,
  `MuiCard`).
- Tablas: se personaliza vía tema, sin componente propio, para no duplicar `Table` de MUI.
- Prueba de alineación con el prototipo (rama `feat/diseno-alineado-prototipo`): botones con peso 600 y
  chicos de 32 px (`tokens.forma.altoBotonChico`), etiquetas chicas de 24 px, filtros como píldoras
  oscuras al seleccionar y encabezado de tabla transparente en mayúsculas de 12 px. Al aceptarse, el valor
  chico pasó a los tokens (`altoBotonChico: 32`, `radioBotonChico: 8`) y la tabla de variantes de arriba
  quedó actualizada.
- El sistema se construye **sobre** los componentes y el tema del template (MUI + Refine) en vez de
  reemplazarlos, y las tipografías se sirven desde npm (OFL) para no depender de un CDN en runtime.
