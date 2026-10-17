# Sistema de diseño — catálogo de componentes base

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
| Botón | `contained` (primario), `outlined` (secundario), `color="error"` (peligro); tamaños small 30 px, medium 38 px, large 46 px; esquinas 9 px | normal, hover (`#1E3FB8`), foco, deshabilitado, cargando (`loading`/`disabled` + texto) | Toda acción; una sola acción primaria por vista |
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
