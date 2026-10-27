# Contrato: analítica de ventas (reportes básicos)

Épica MSF-338 · Spec `ventas-reportes-basicos`. Contrato de lectura para Superset
y para la exportación a Excel. Sin tablas nuevas; solo vistas del esquema `analitica`
y una RPC pública de lectura.

## Vistas `analitica` (esquema `analitica`, solo vistas; sin acceso para `anon`/`authenticated`)

### `analitica.ventas_producto_mas_vendido`

Productos más vendidos (F-VTA-22, FR-001/FR-002). Una fila por producto con ventas que
cuentan en el rango. Los presupuestos y anulados no cuentan y las notas de crédito restan
(`private.comprobante_cuenta_como_facturado` + `private.signo_comprobante`).

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
  stock_estado text
)
```

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
