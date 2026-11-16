# Contrato: tableros analíticos (F-REP-07, MSF-265)

## Vistas de lectura (`analitica`, solo `superset_analitica`)

### `analitica.ventas_empresa_categoria`

Una fila por **empresa × categoría × producto × fecha**.

| Columna | Tipo | Nota |
|---|---|---|
| `organizacion_id` | uuid | Frontera del guest token (`rls`) |
| `empresa_id` | uuid | Frontera por tienda del guest token |
| `empresa_nombre` | text | Filtro nativo de empresa |
| `categoria` | text | «Sin categoría» si el producto no tiene |
| `producto_id`, `producto_nombre`, `sku` | uuid, text, text | El tablero agrupa por nombre + SKU |
| `fecha` | date | Fecha del comprobante (filtro de período) |
| `unidades` | bigint | Σ signo × cantidad (la nota de crédito resta) |
| `facturado` | numeric | Σ signo × (subtotal sin IVA + IVA): el número del listado de comprobantes |

Predicado y signo: `analitica.comprobante_cuenta_como_facturado` y `analitica.signo_comprobante` (los mismos que «Más vendidos»). Sin costo, margen ni datos de clientes.

### `analitica.margen_real_categoria`

`analitica.rentabilidad_ventas_real` (empresa × producto × fecha) más `categoria`. Columnas: `organizacion_id`, `empresa_id`, `empresa_nombre`, `categoria`, `producto_id`, `producto_nombre`, `sku`, `fecha`, `unidades`, `vendido`, `costo`, `costos_adicionales`, `margen`, `margen_pct`, `estado` (`ok`/`bajo`/`negativo`), `umbral_margen_bajo`. El cálculo del margen NO se reimplementa. Expone costo y margen: solo el reporte registrado con la sección `rentabilidad`.

## Tableros (YAML en `infra/superset/dashboards/analitica-avanzada/`)

| Reporte (`public.reportes.nombre`) | Slug | Sección | Cruces | Filtros nativos |
|---|---|---|---|---|
| Analítica · Ventas por tienda y categoría | `analitica-ventas-tienda-categoria` | `reportes` | tienda × categoría, período × categoría, producto × tienda | `NATIVE_FILTER-rango`, `NATIVE_FILTER-empresa`, `NATIVE_FILTER-categoria`, `NATIVE_FILTER-periodo` |
| Analítica · Margen real por tienda, categoría y producto | `analitica-margen-real` | `rentabilidad` | tienda × categoría, período × tienda, producto × tienda | los anteriores más `NATIVE_FILTER-estado` |

`filtro_empresa = true` en los dos: el token agrega `empresa_id IN (<empresas accesibles>)` a la cláusula `rls`. Los ids `NATIVE_FILTER-rango` y `NATIVE_FILTER-empresa` y la columna `empresa_nombre` son los que la pantalla preselecciona (`urlParamsReportes`).

## Catálogo del panel

`apps/web/src/lib/tablerosAnaliticos.ts` describe cada tablero (título, descripción, cruces, filtros, si muestra costos) y lo vincula al reporte por `nombreReporte`. Incluye los dos nuevos y dos existentes con los mismos filtros nativos («Reportes · Ventas por período y canal» y «Ventas · Más vendidos»). La galería muestra la **intersección** entre el catálogo y `reportes_visibles_para_mi()`.

## Alta y asignación

`20270324100100_reportes_tableros_analiticos.sql` registra los reportes con prefijo «Analítica · », roles por defecto `administracion` y los asigna a todas las organizaciones (disparadores en `public.reportes`, `public.organizaciones` y `public.reportes_roles_default`). El importador de dashboards actualiza la fila por nombre con el UUID de embebido real.

## Seguridad

- El navegador solo recibe el guest token; nunca credenciales de Superset.
- El administrador no entra a Superset (spec 007, FR-013): sin excepción.
- Un filtro manipulado en la URL no cruza organizaciones ni tiendas: la cláusula `rls` del token es del servidor.
