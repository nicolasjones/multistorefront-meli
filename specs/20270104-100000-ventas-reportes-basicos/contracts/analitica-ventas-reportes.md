# Contrato: analítica de ventas (reportes básicos)

Épica MSF-338 · Spec `ventas-reportes-basicos`. Contrato de lectura para Superset
y para la exportación a Excel. Sin tablas nuevas; solo vistas del esquema `analitica`
y RPCs públicas de lectura (`ventas_reportes_conteo` para el estado vacío de la pantalla
y `leer_ranking_ventas` para la exportación a Excel).

## Vistas `analitica` (esquema `analitica`, solo vistas; sin acceso para `anon`/`authenticated`)

### `analitica.ventas_producto_mas_vendido`

Productos más vendidos (F-VTA-22, FR-001/FR-002). Los presupuestos y anulados no cuentan y las
notas de crédito restan (`private.comprobante_cuenta_como_facturado` + `private.signo_comprobante`).

```sql
analitica.ventas_producto_mas_vendido (
  organizacion_id uuid,
  empresa_id uuid,
  empresa_nombre text,
  producto_id uuid,
  producto_nombre text,
  sku text,
  categoria text,
  deposito_id uuid,
  deposito_nombre text,
  unidades bigint,
  facturado numeric,
  stock_hoy numeric,
  stock_estado text,
  fecha date
)
```

**Grano**: una fila por empresa × producto × depósito × **fecha**. El tablero agrupa por producto y
suma; `fecha` está para que el filtro nativo de rango de fechas (FR-003) acote el período.

**Cálculo** (una sola fuente; el predicado y el signo no se reimplementan):

| Columna | Qué es |
|---|---|
| `unidades` | Σ `signo_comprobante(tipo)` × cantidad de las líneas del producto. La nota de crédito **resta** unidades. |
| `facturado` | Σ `signo_comprobante(tipo)` × (`subtotal_sin_iva` + `iva`) de las líneas: el total **con IVA**, el mismo número que muestra el listado y la exportación de comprobantes (`total_con_iva`), para que el reporte cuadre con lo exportado (CA-VTA-22-1). |
| `stock_hoy` | Stock vigente del producto en la organización (`public.stock_estados.cantidad`), no por depósito. |
| `stock_estado` | Estado del stock según `public.stock_estados` (`sin_stock` / `stock_bajo` / `disponible`). Ningún consumidor lo recalcula. |
| `categoria` | Nombre de la categoría del producto (`dominio.categorias.nombre`); null si el producto no tiene categoría. |

Un comprobante sin `empresa_id` no produce fila (no es atribuible a ninguna tienda). La vista no
trae filas de borradores, anuladas ni presupuestos.

**Funciones de apoyo** (`security definer` del esquema `analitica`, para que el rol de Superset no
necesite `private` ni `public`):

| Función | Envuelve |
|---|---|
| `analitica.comprobante_cuenta_como_facturado(text, text)` | `private.comprobante_cuenta_como_facturado` |
| `analitica.signo_comprobante(text)` | `private.signo_comprobante` |
| `analitica.stock_de_producto(uuid, uuid)` | `public.stock_estados` |

**Acceso**: `revoke all … from public, anon, authenticated`; `select` para `superset_analitica`
(además de `execute` sobre las tres funciones de apoyo). El aislamiento lo fuerza la cláusula `rls`
del guest token: `organizacion_id` + `empresa_id` (FR-004). Esas dos columnas son parte del `GROUP BY`,
así que PostgreSQL las empuja al escaneo de `dominio.comprobantes_venta`: la agregación solo procesa
las filas de esa organización y de esas empresas (verificado con `EXPLAIN`).

### `analitica.ventas_ranking_clientes`

Ranking de clientes por facturación neta (F-VTA-23, FR-006). `comprobantes` cuenta solo
facturas (las notas de crédito restan del importe pero no suman un comprobante).

```sql
analitica.ventas_ranking_clientes (
  organizacion_id uuid,
  empresa_id uuid,
  empresa_nombre text,
  posicion bigint,
  cliente_id uuid,
  numero integer,
  nombre text,
  tipo text,
  consumidor_final boolean,
  fecha date,
  comprobantes bigint,
  facturado numeric,
  participacion numeric,
  ultimo_comprador date
)
```

**Grano**: una fila por **empresa × cliente × fecha** (el día del comprobante que cuenta). El grano
es diario a propósito: la vista no materializa una fila por comprobante y `fecha` es la columna del
filtro nativo de rango de fechas (FR-008), que acota el período **antes** de agregar por cliente.

**Cálculo** (una sola fuente; el predicado y el signo no se reimplementan):

| Columna | Qué es |
|---|---|
| `comprobantes` | Σ de **facturas** que cuentan (la nota de crédito resta del importe pero NO suma un comprobante). |
| `facturado` | Σ `signo_comprobante(tipo)` × `total_con_iva` de la fila: la base **con IVA**, la misma que usa «Más vendidos» y que muestra el listado y la exportación de comprobantes (una sola base en las dos pestañas de «Ventas · Reportes»). El ranking de la solapa de Clientes (F-CLI-08) usa sin IVA con un interruptor propio: son dos pantallas distintas con su decisión. |
| `posicion` | Posición del cliente en el ranking: `row_number()` por facturación neta descendente, con desempate por nombre y número — el mismo criterio que `public.ranking_clientes`, para que los dos rankings coincidan. |
| `participacion` | Porcentaje (0–100, sin redondear) del cliente sobre el total del alcance visible; con total cero es 0. |
| `ultimo_comprador` | Fecha del comprobante más reciente que cuenta del cliente **en esa tienda** (con varias tiendas, el tablero toma el máximo: la última compra del cliente en el alcance filtrado). |
| `consumidor_final` | Marca del «Consumidor final» (`public.clientes.es_consumidor_final`). |

**«Consumidor final» (exclusión opcional)**: la vista **no excluye a nadie**: expone la marca
`consumidor_final` para que la exclusión sea opcional y se aplique donde se decide — filtro nativo
del tablero (FR-007/FR-008) y parámetro `p_incluir_consumidor_final` de la RPC de lectura
(FR-009). El valor inicial del tablero es «excluido» (FR-008). La vista tampoco puede excluir por
sí sola: no tiene período ni empresa.

**`posicion` y `participacion` se recalculan sobre el filtro** (importante): en la vista son del
cliente en **todo** el alcance visible (sus filas de todas las fechas y tiendas visibles). Cuando la
pantalla o la RPC filtran por período o por tienda, el filtro se aplica **antes** de agregar y la
posición y la participación se **recalculan** con la misma fórmula sobre el resultado filtrado. Por
eso el tablero no usa esas dos columnas y las calcula como métricas (como hace «Más vendidos»): si
usara las de la vista, mostraría la posición de todo el período con la facturación del período
filtrado.

**Un comprobante sin `empresa_id` no produce fila**: quedaría fuera del alcance del token del
tablero, que filtra por `empresa_id IN (…)`.

**Funciones de apoyo** (las de F-VTA-22, `security definer` de `analitica`; esta vista no
redefine el criterio):

| Función | Envuelve |
|---|---|
| `analitica.comprobante_cuenta_como_facturado(text, text)` | `private.comprobante_cuenta_como_facturado` |
| `analitica.signo_comprobante(text)` | `private.signo_comprobante` |

**Acceso**: `revoke all … from public, anon, authenticated`; `select` para `superset_analitica`
(además de `execute` sobre las dos funciones de apoyo). El aislamiento lo fuerza la cláusula `rls`
del guest token: `organizacion_id` + `empresa_id` (FR-004), que son columnas del `GROUP BY`, así que
PostgreSQL las empuja al escaneo de `dominio.comprobantes_venta`.

**Prueba**: `supabase/tests/database/ventas_reportes_ranking.test.sql` (pgTAP): contrato de columnas,
acceso, orden por facturación neta, participación sobre el total, exclusión del «Consumidor final» y
la facturación **negativa** del cliente que solo tiene notas de crédito en el período (SC-006).

## RPC pública de lectura (Excel, F-VTA-23, FR-009)

```ts
public.leer_ranking_ventas(
  p_desde date,
  p_hasta date,
  p_incluir_consumidor_final boolean default false,
  p_empresa_id uuid default null
) returns table (
  posicion bigint, cliente_id uuid, numero integer, nombre text, tipo text,
  comprobantes bigint, facturado numeric, participacion numeric, total_filas bigint
)
```

`security invoker`, `set search_path = ''`, organización de `private.organizacion_id()`,
empresas acotadas a `private.empresas_accesibles()`, sección `reportes` en `lectura`/`edicion`.
`revoke … from public, anon`; `grant execute … to authenticated`. Devuelve las **mismas** filas
y totales que `analitica.ventas_ranking_clientes` con los filtros del usuario (fuente única para
pantalla y Excel).

## Tablero «Más vendidos» (Superset, F-VTA-22, FR-003)

YAML versionados en `infra/superset/dashboards/ventas-reportes/` (dataset, gráfico, tablero y
`reportes.json`), importados con `infra/superset/importar-dashboards.mjs` y registrados en
`public.reportes` con `seccion = 'reportes'` (idempotente, por
`superset_dashboard_uuid`).

| Pieza | Qué es |
|---|---|
| Dataset | `analitica.ventas_producto_mas_vendido` (grano: empresa × producto × depósito × fecha). |
| Gráfico | Tabla (`table`, modo `aggregate`): agrupa por `producto_nombre` + `sku` y suma. |
| Métricas | `posicion` (`ROW_NUMBER() OVER (ORDER BY SUM(unidades) DESC, producto_nombre, sku)`), `unidades_total` (`SUM(unidades)`), `facturado_total` (`SUM(facturado)`) y `stock_hoy_texto` (estado del stock con las etiquetas de la app). |
| Columnas visibles | `Producto`, `SKU`, `#`, `Unidades`, `Facturado`, `Stock hoy` (las columnas de agrupación van primero: el `#` va después de «Producto» porque el viz de tabla de Superset pone primero las de agrupación). |
| Orden | Por unidades descendentes. En Superset 6.1.0 el viz de tabla **ignora `order_by_cols` en modo aggregate** (es un control solo-raw) y ordena por la métrica de `timeseries_limit_metric`, en descendente si `order_desc` está activo: el chart versiona `timeseries_limit_metric: unidades_total` + `order_desc: true`. `posicion` va primera en `metrics` solo para el orden de las columnas, nunca para ordenar (es un `ROW_NUMBER` ascendente: si fuera la primera métrica, el tablero mostraría los **menos** vendidos primero). |
| Filtros nativos | `NATIVE_FILTER-rango` (rango de fechas, `fecha`), `NATIVE_FILTER-empresa` (`empresa_nombre`), `NATIVE_FILTER-categoria` (`categoria`), `NATIVE_FILTER-deposito` (`deposito_nombre`). |
| Reporte | `Ventas · Más vendidos`, `dashboard_slug: ventas-mas-vendidos`, `seccion: reportes`, `filtro_empresa: true`, roles por defecto `administracion` (la sección `reportes` no la tienen Operador ni Consulta). |

**Por qué el grupo es `producto_nombre` + `sku`**: `dominio.productos` NO exige nombre único por
organización (el índice `productos_org_nombre_idx` no es único), así que agrupar solo por nombre
fusionaba dos productos homónimos en una fila y el «Stock hoy» del grupo (un `MAX` de textos) podía
no ser el de ninguno de los dos. El SKU sí es único por organización
(`productos_org_sku_uidx` sobre `(organizacion_id, lower(btrim(sku)))`), de modo que nombre + SKU
identifican un producto igual que su `id`, sin mostrar identificadores técnicos en la tabla
(Principio VI) y mostrando el SKU que el prototipo dibuja bajo el nombre.

El filtro por empresa de la pantalla se aplica **adentro** del tablero (filtro nativo
`NATIVE_FILTER-empresa`); el token es el máximo alcanzable.

## Pantalla «Reportes de ventas» (Refine, F-VTA-22, FR-005)

Ruta `/ventas/reportes` (menú «Reportes de ventas», junto a Ventas, con ícono propio), sección
`reportes` de la matriz de permisos: sin esa sección la ruta muestra el acceso restringido compartido
(SC-002) y no pide token.

| Pieza | Qué es |
|---|---|
| Marco | Título «Reportes de ventas», subtítulo «Más vendidos, avisos de «avisame cuando vuelva» y ranking de clientes por facturación.», pestañas «Más vendidos» / «Ranking de clientes» (la de ranking la completa F-VTA-23) y el contexto de organización. |
| Filtro de empresa | `FiltroEmpresa` (píldoras «Todas las tiendas» + una por tienda) sobre `useFiltroPorEmpresaActiva`: sigue a la empresa activa de la barra superior y, al cambiarla, reencuadra el tablero (Principio VIII). |
| Filtros de período | «Desde» / «Hasta» con los atajos «Hoy», «7 días», «Este mes» y «Mes anterior»; el «hoy» se calcula en la zona de la organización. Un rango inválido se avisa en el campo y no se aplica. |
| Transferencia al tablero | Los dos filtros se preseleccionan en el tablero con `dashboardUiConfig.urlParams.native_filters` (rison): `NATIVE_FILTER-rango` (rango de fechas) y `NATIVE_FILTER-empresa` (`empresa_nombre`). Cambiar un filtro remonta el tablero (nueva `key`): se repite el token y el montaje. |
| Estados | Carga compartida mientras se resuelve el conteo o el reporte; vacío compartido «No hay ventas en ese período»; error con `Reintentar`; acceso restringido ante un 403 del token. |
| Conteo de ventas | `public.ventas_reportes_conteo(p_desde, p_hasta, p_empresa_id)`: comprobantes que cuentan como venta en el período. Es lo que decide el estado vacío. |

### `public.ventas_reportes_conteo(date, date, uuid)`

```sql
public.ventas_reportes_conteo(
  p_desde date,
  p_hasta date,
  p_empresa_id uuid default null
) returns integer
```

`security definer`, `set search_path = ''`. Exige la organización activa (`private.organizacion_id()`)
y lectura o edición en la sección `reportes` (42501 si no); cuenta solo comprobantes de esa
organización y de las empresas accesibles del usuario (`private.empresas_accesibles()`), con el
mismo predicado del tablero (`private.comprobante_cuenta_como_facturado`: presupuestos, borradores y
anuladas no cuentan; las notas de crédito sí). `p_empresa_id` acota a una tienda y nunca amplía el
alcance (una empresa ajena cuenta 0). `revoke … from public, anon`; `grant execute … to authenticated`.

Es una RPC y no una consulta del navegador a propósito: el criterio de qué cuenta como venta vive
en un solo lugar y las vistas de `analitica` están cerradas para `authenticated` (las lee solo el rol
de Superset). Es el mismo patrón que `public.rentabilidad_conteo_margen` (F-REN-02).

## Extensión del guest token (filtro por empresa, F-VTA-22, FR-004)

`emitir-acceso-reporte` agrega a la cláusula `rls` del guest token, además de
`organizacion_id = '<org>'`, una restricción `empresa_id IN ('<uuid>', …)` con las empresas
accesibles del usuario (resueltas vía `public.empresas_para_selector()`; UUIDs validados,
nunca texto libre). No cambia la firma de `resolver_organizacion_reporte` (sigue devolviendo
la organización); se agrega una resolución adicional para las empresas.

La extensión es **opt-in por reporte**: la cláusula `rls` se aplica a todos los datasets del
tablero y un tablero por organización no expone `empresa_id`. Por eso `public.reportes` suma
`filtro_empresa boolean not null default false` (migración
`20270104090050_reportes_filtro_empresa.sql`, aditiva): el importador escribe el valor desde
`reportes.json`. «Ventas · Más vendidos» lo declara en `true`; los tableros de Rentabilidad,
en `false` (su cláusula sigue siendo solo `organizacion_id`).

Cláusula emitida (una sola, con las dos condiciones):

```sql
organizacion_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  AND empresa_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
```

| Caso | Cláusula | Por qué |
|---|---|---|
| Empresas accesibles | `… AND empresa_id IN ('<uuid>', …)` | El token no alcanza las empresas ajenas al usuario. «Todas las tiendas» sigue acotado a las accesibles. |
| Identificador que no es UUID | se descarta | La lista se interpola como texto SQL: lo que no es UUID no puede identificar una empresa y no se interpola. |
| Sin empresas accesibles | `… AND false` | Es un filtro de datos, no una decisión de autorización (la tomó `resolver_organizacion_reporte`): el token sale, pero sin filas. Un token sin ese filtro dejaría ver empresas ajenas. |
| No se pudieron resolver | `503 { "error": "alcance_no_resuelto" }` y **no** se pide token a Superset | Fallar abierto mostraría filas de empresas ajenas. |
| `reportes.filtro_empresa = false` | `organizacion_id = '<org>'` (sin `empresa_id`) y no se resuelven empresas | El tablero es por organización y sus vistas no exponen `empresa_id`; agregarla rompería la consulta. |

El filtro por empresa de la pantalla (`FiltroEmpresa`) se aplica **adentro** del tablero, como
filtro nativo (`NATIVE_FILTER-empresa`, columna `empresa_nombre`): el token es el máximo
alcanzable y el filtro lo acota.

> **BREAKING (comportamiento del token, no de firma):** el guest token de los reportes con
> `filtro_empresa = true` deja de ver todas las empresas de la organización; pasa a ver solo las
> accesibles del usuario que llama. Lo habilitan los tableros de Ventas · Reportes; los de
> Rentabilidad quedan en `false` y conservan la cláusula solo por organización.
