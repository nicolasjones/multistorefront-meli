-- F-VTA-22 (MSF-347, épica MSF-338, spec 20270104-100000-ventas-reportes-basicos, FR-001, FR-002):
-- vista `analitica.ventas_producto_mas_vendido` (Productos más vendidos) para el tablero de
-- «Ventas · Reportes».
--
-- Esquema (Principio VII): SIN tablas nuevas. Solo el esquema `analitica` (existente, SOLO vistas y
-- funciones de apoyo) y tres funciones de apoyo `security definer` de `analitica`. Lee
-- `dominio.comprobantes_venta` y `dominio.comprobantes_venta_lineas` (dominio del producto) y
-- `public.stock_estados` (vista de lectura ya existente). `analitica` no tiene tablas → la prueba
-- `rls_en_toda_tabla` (que recorre `public` + `dominio`) sigue verde.
--
-- Aislamiento: sin acceso para `anon` ni `authenticated` (la vista no es `security_invoker`: corre con
-- los privilegios de su dueño, como las vistas de rentabilidad). La lee el rol de solo lectura
-- `superset_analitica` y la separación por organización Y por empresa la fuerza la cláusula `rls` del
-- guest token: por eso cada fila expone `organizacion_id`, `empresa_id` y `empresa_nombre`.
--
-- Cálculo (FR-002): el predicado y el signo NO se reimplementan. La vista llama a
-- `private.comprobante_cuenta_como_facturado(tipo, estado)` (factura o nota de crédito; NO borrador ni
-- anulada) y a `private.signo_comprobante(tipo)` (nota de crédito = −1) a través de envoltorios
-- `security definer` de `analitica` (el rol de Superset no necesita acceso a `private`).
--   · `unidades`  = Σ signo × cantidad de las líneas (la nota de crédito resta unidades).
--   · `facturado` = Σ signo × (subtotal_sin_iva + iva) de las líneas: el total CON IVA, el mismo número
--     que muestra el listado y la exportación de comprobantes (`total_con_iva`), para que el reporte
--     cuadre con lo exportado.
--   · presupuestos, borradores y anuladas NO cuentan: no son filas de la vista.
--
-- Grano: una fila por empresa × producto × depósito × fecha. El tablero agrupa por producto y suma;
-- `fecha` está para que el filtro nativo de rango de fechas (FR-003) acote el período. `stock_hoy` y
-- `stock_estado` salen de `public.stock_estados` (stock vigente del producto en la organización, no por
-- depósito: es la única fuente del estado y ningún consumidor debe recalcularlo).
--
-- Migración aditiva. Reversión (migración posterior; las vistas no guardan datos):
--   drop view analitica.ventas_producto_mas_vendido;
--   drop function analitica.stock_de_producto(uuid, uuid);
--   drop function analitica.signo_comprobante(text);
--   drop function analitica.comprobante_cuenta_como_facturado(text, text);

-- ============================================================================
-- Funciones de apoyo (security definer): el rol de Superset no toca `private`
-- ============================================================================

create or replace function analitica.comprobante_cuenta_como_facturado(p_tipo text, p_estado text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select private.comprobante_cuenta_como_facturado(p_tipo, p_estado)
$$;

comment on function analitica.comprobante_cuenta_como_facturado(text, text) is
  'F-VTA-22: envoltorio SECURITY DEFINER de private.comprobante_cuenta_como_facturado para el rol de Superset. El criterio de qué cuenta como facturado vive en un solo lugar (private) y no se reimplementa.';

create or replace function analitica.signo_comprobante(p_tipo text)
returns integer
language sql
immutable
security definer
set search_path = ''
as $$
  select private.signo_comprobante(p_tipo)
$$;

comment on function analitica.signo_comprobante(text) is
  'F-VTA-22: envoltorio SECURITY DEFINER de private.signo_comprobante para el rol de Superset (nota de crédito = −1; el resto = +1).';

create or replace function analitica.stock_de_producto(p_producto_id uuid, p_organizacion_id uuid)
returns table (
  stock_hoy numeric,
  stock_estado text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.cantidad::numeric, s.estado
    from public.stock_estados s
   where s.producto_id = p_producto_id
     and s.organizacion_id = p_organizacion_id
$$;

comment on function analitica.stock_de_producto(uuid, uuid) is
  'F-VTA-22: envoltorio SECURITY DEFINER de public.stock_estados (stock vigente y estado del producto) para el rol de Superset: la vista es security_invoker y el rol no tiene sesión ni sección de Stock.';

-- `revoke … from public` va antes del `grant`: `public` incluye al rol de Superset.
revoke execute on function analitica.comprobante_cuenta_como_facturado(text, text) from public, anon, authenticated;
revoke execute on function analitica.signo_comprobante(text) from public, anon, authenticated;
revoke execute on function analitica.stock_de_producto(uuid, uuid) from public, anon, authenticated;
grant execute on function analitica.comprobante_cuenta_como_facturado(text, text) to superset_analitica;
grant execute on function analitica.signo_comprobante(text) to superset_analitica;
grant execute on function analitica.stock_de_producto(uuid, uuid) to superset_analitica;

-- ============================================================================
-- Vista: Productos más vendidos (FR-001)
-- ============================================================================

create or replace view analitica.ventas_producto_mas_vendido as
with ventas as (
  select
    v.organizacion_id,
    v.empresa_id,
    e.nombre as empresa_nombre,
    v.fecha,
    l.producto_id,
    p.nombre as producto_nombre,
    p.sku,
    cat.nombre as categoria,
    l.deposito_id,
    d.nombre as deposito_nombre,
    sum(analitica.signo_comprobante(v.tipo) * l.cantidad)::bigint as unidades,
    sum(analitica.signo_comprobante(v.tipo) * (l.subtotal_sin_iva + l.iva))::numeric as facturado
  from dominio.comprobantes_venta v
  join dominio.comprobantes_venta_lineas l
    on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
  join dominio.empresas e
    on e.id = v.empresa_id and e.organizacion_id = v.organizacion_id
  join dominio.productos p
    on p.id = l.producto_id and p.organizacion_id = v.organizacion_id
  join dominio.depositos d
    on d.id = l.deposito_id and d.organizacion_id = v.organizacion_id
  left join dominio.categorias cat
    on cat.id = p.categoria_id and cat.organizacion_id = v.organizacion_id
  where analitica.comprobante_cuenta_como_facturado(v.tipo, v.estado)
  group by
    v.organizacion_id, v.empresa_id, e.nombre, v.fecha, l.producto_id, p.nombre, p.sku,
    cat.nombre, l.deposito_id, d.nombre
)
select
  s.organizacion_id,
  s.empresa_id,
  s.empresa_nombre,
  s.producto_id,
  s.producto_nombre,
  s.sku,
  s.categoria,
  s.deposito_id,
  s.deposito_nombre,
  s.unidades,
  s.facturado,
  st.stock_hoy,
  st.stock_estado,
  s.fecha
from ventas s
left join lateral analitica.stock_de_producto(s.producto_id, s.organizacion_id) st on true;

comment on view analitica.ventas_producto_mas_vendido is
  'F-VTA-22: productos más vendidos. Una fila por empresa × producto × depósito × fecha: unidades y facturado neto (con IVA, como el listado de comprobantes) del período, con el stock vigente del producto y su estado. Cuentan solo los comprobantes que cumplen private.comprobante_cuenta_como_facturado; las notas de crédito restan. Contrato en specs/20270104-100000-ventas-reportes-basicos/contracts/analitica-ventas-reportes.md.';

revoke all on analitica.ventas_producto_mas_vendido from public, anon, authenticated;
grant select on analitica.ventas_producto_mas_vendido to superset_analitica;
