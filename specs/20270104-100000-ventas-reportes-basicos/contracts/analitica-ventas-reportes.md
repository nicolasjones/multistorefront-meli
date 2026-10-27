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
del guest token: `organizacion_id` + `empresa_id` (FR-004).

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

## Extensión del guest token (filtro por empresa, F-VTA-22, FR-004)

`emitir-acceso-reporte` agrega a la cláusula `rls` del guest token, además de
`organizacion_id = '<org>'`, una restricción `empresa_id IN ('<uuid>', …)` con las empresas
accesibles del usuario (resueltas vía `public.empresas_para_selector()`; UUIDs validados,
nunca texto libre). No cambia la firma de `resolver_organizacion_reporte` (sigue devolviendo la
organización); se agrega una resolución adicional para las empresas.

> **BREAKING (comportamiento del token, no de firma):** el guest token deja de ver todas las
> empresas de la organización; pasa a ver solo las accesibles del usuario que llama. Los tableros
> de Ventas · Reportes son los primeros en usar esta extensión; los de Rentabilidad (sin empresas
> acotadas) no se ven afectados salvo que se les habilite el filtro.
