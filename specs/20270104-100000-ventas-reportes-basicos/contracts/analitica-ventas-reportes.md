# Contrato: analítica de ventas (reportes básicos)

Épica MSF-338 · Spec `ventas-reportes-basicos`. Contrato de lectura para Superset
y para la exportación a Excel. Sin tablas nuevas; solo vistas del esquema `analitica`
y una RPC pública de lectura.

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
  comprobantes bigint,
  facturado numeric,
  participacion numeric,
  ultimo_comprador date
)
```

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
| Gráfico | Tabla (`table`, modo `aggregate`): agrupa por `producto_nombre` y suma. |
| Métricas | `posicion` (`ROW_NUMBER() OVER (ORDER BY SUM(unidades) DESC, producto_nombre)`), `unidades_total` (`SUM(unidades)`), `facturado_total` (`SUM(facturado)`) y `stock_hoy_texto` (estado del stock con las etiquetas de la app). |
| Columnas visibles | `Producto`, `#`, `Unidades`, `Facturado`, `Stock hoy` (el `#` va después de «Producto» porque el viz de tabla de Superset pone primero las columnas de agrupación). |
| Filtros nativos | `NATIVE_FILTER-rango` (rango de fechas, `fecha`), `NATIVE_FILTER-empresa` (`empresa_nombre`), `NATIVE_FILTER-categoria` (`categoria`), `NATIVE_FILTER-deposito` (`deposito_nombre`). |
| Reporte | `Ventas · Más vendidos`, `dashboard_slug: ventas-mas-vendidos`, `seccion: reportes`, roles por defecto `administracion` (la sección `reportes` no la tienen Operador ni Consulta). |

El filtro por empresa de la pantalla se aplica **adentro** del tablero (filtro nativo
`NATIVE_FILTER-empresa`); el token es el máximo alcanzable.

## Extensión del guest token (filtro por empresa, F-VTA-22, FR-004)

`emitir-acceso-reporte` agrega a la cláusula `rls` del guest token, además de
`organizacion_id = '<org>'`, una restricción `empresa_id IN ('<uuid>', …)` con las empresas
accesibles del usuario (resueltas vía `public.empresas_para_selector()`; UUIDs validados,
nunca texto libre). No cambia la firma de `resolver_organizacion_reporte` (sigue devolviendo
la organización); se agrega una resolución adicional para las empresas.

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

El filtro por empresa de la pantalla (`FiltroEmpresa`) se aplica **adentro** del tablero, como
filtro nativo (`NATIVE_FILTER-empresa`, columna `empresa_nombre`): el token es el máximo
alcanzable y el filtro lo acota.

> **BREAKING (comportamiento del token, no de firma):** el guest token deja de ver todas las
> empresas de la organización; pasa a ver solo las accesibles del usuario que llama. Los tableros
> de Ventas · Reportes son los primeros en usar esta extensión; los de Rentabilidad (sin empresas
> acotadas) no se ven afectados salvo que se les habilite el filtro.
