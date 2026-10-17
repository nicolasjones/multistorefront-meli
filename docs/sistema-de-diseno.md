# Sistema de diseño — catálogo de componentes base

Spec: `specs/20261012-130000-sistema-de-diseno/` (DS-02, FR-004/005/008).
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
| Tablas / listas | `Table*` de MUI | Tema (`MuiTableCell`) |
| Estados de página | `EstadoCargaPagina`, `EstadoVacio`, `EstadoExito`, `EstadoError` | `components/estados` |
| Encabezado de página | `EncabezadoPagina` | `components/pagina` |

## Variantes y estados

| Componente | Variantes | Estados cubiertos | Cuándo usarlo |
|---|---|---|---|
| Botón | `contained` (primario), `outlined` (secundario), `color="error"` (peligro); tamaños small 32 px, medium 38 px, large 46 px; esquinas 9 px (8 px el chico) | normal, hover (`#1E3FB8`), foco, deshabilitado, cargando (`loading`/`disabled` + texto) | Toda acción; una sola acción primaria por vista |
| Campo (`TextField`) | tamaño `small` por defecto | normal, hover, foco (borde azul), error (`error` + `helperText`), deshabilitado | Todo ingreso de datos |
| `TarjetaBase` | con o sin título | normal | Agrupar contenido relacionado |
| `EtiquetaEstado` | `neutral`, `primario`, `exito`, `aviso`, `error`, `info` | normal | Mostrar el estado de un registro |
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
