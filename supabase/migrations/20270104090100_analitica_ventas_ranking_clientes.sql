-- F-VTA-23 (MSF-358, épica MSF-338, spec 20270104-100000-ventas-reportes-basicos, FR-006):
-- vista `analitica.ventas_ranking_clientes` (Ranking de clientes) para el tablero de
-- «Ventas · Reportes».
--
-- Esquema (Principio VII): SIN tablas nuevas. Solo el esquema `analitica` (existente, SOLO vistas y
-- funciones de apoyo). Lee `dominio.comprobantes_venta` (dominio del producto), `public.clientes`
-- (ficha del cliente) y `dominio.empresas` (la tienda). `analitica` no tiene tablas → la prueba
-- `rls_en_toda_tabla` (que recorre `public` + `dominio`) sigue verde.
--
-- Aislamiento: sin acceso para `anon` ni `authenticated` (la vista no es `security_invoker`: corre con
-- los privilegios de su dueño, como las vistas de rentabilidad). La lee el rol de solo lectura
-- `superset_analitica` y la separación por organización Y por empresa la fuerza la cláusula `rls` del
-- guest token: por eso cada fila expone `organizacion_id`, `empresa_id` y `empresa_nombre`.
--
-- Cálculo (FR-006, mismo predicado y signo que FR-002): el predicado y el signo NO se reimplementan.
-- La vista llama a `analitica.comprobante_cuenta_como_facturado(tipo, estado)` (factura o nota de
-- crédito; NO borrador ni anulada) y a `analitica.signo_comprobante(tipo)` (nota de crédito = −1), que
-- son los envoltorios `security definer` de `private` creados por F-VTA-22 (el rol de Superset no
-- necesita acceso a `private`). Por eso NO se redefinen acá: el criterio vive en un solo lugar.
--   · `comprobantes` = conteo de FACTURAS que cuentan (la nota de crédito resta del importe pero NO
--     suma un comprobante).
--   · `facturado`   = Σ signo × `total_con_iva`: la base CON IVA, la misma que usa «Más vendidos» y
--     que muestra el listado y la exportación de comprobantes.
--   · presupuestos, borradores y anuladas NO cuentan: no son filas de la vista.
--   · Un comprobante sin `empresa_id` no produce fila: el token del tablero filtra por
--     `empresa_id IN (…)` y una fila sin empresa quedaría fuera de ese alcance.
--
-- Grano: una fila por empresa × cliente × fecha (el día del comprobante). El tablero agrupa por
-- cliente y suma (como «Más vendidos»); `fecha` está para que el filtro nativo de rango de fechas
-- (FR-008) acote el período. `posicion` y `participacion` son del CLIENTE (agregado sobre todo el
-- alcance visible de la vista): con un filtro de período o de tienda el tablero los RECALCULA sobre
-- el resultado filtrado (misma fórmula, filtro aplicado antes) — ver el contrato.
--
-- «Consumidor final» (FR-006): la vista NO excluye a nadie — expone la marca `consumidor_final` para
-- que la exclusión sea OPCIONAL y se aplique donde se decide (filtro nativo del tablero, parámetro
-- de la RPC de lectura del Excel). El valor inicial del tablero es «excluido» (FR-008).
--
-- Rendimiento: `organizacion_id` y `empresa_id` son columnas del GROUP BY, así que la cláusula `rls`
-- del guest token se empuja hacia el escaneo de `dominio.comprobantes_venta`: la agregación solo
-- procesa las filas de esa organización y de esas empresas (mismo criterio que «Más vendidos»). El
-- grano es diario (una fila por cliente y día), de modo que la vista no materializa una fila por
-- comprobante.
--
-- Migración aditiva. Reversión (migración posterior; las vistas no guardan datos):
--   drop view analitica.ventas_ranking_clientes;

-- ============================================================================
-- Permisos de los helpers que usa la vista (los creó F-VTA-22)
-- ============================================================================
--
-- `analitica.comprobante_cuenta_como_facturado` y `analitica.signo_comprobante` ya existen (F-VTA-22,
-- 20270104090000) con sus grants. Se re-afirman acá porque ESTA vista depende de ellos: el rol de
-- Superset necesita `execute` (las funciones de una vista se evalúan con los permisos de quien la
-- consulta) y `anon`/`authenticated` no deben poder llamarlas. Es idempotente: no se redefine el
-- cuerpo, así que el criterio de qué cuenta como facturado sigue viviendo en un solo lugar.

revoke execute on function analitica.comprobante_cuenta_como_facturado(text, text) from public, anon, authenticated;
revoke execute on function analitica.signo_comprobante(text) from public, anon, authenticated;
grant execute on function analitica.comprobante_cuenta_como_facturado(text, text) to superset_analitica;
grant execute on function analitica.signo_comprobante(text) to superset_analitica;

-- ============================================================================
-- Vista: Ranking de clientes (FR-006)
-- ============================================================================

create or replace view analitica.ventas_ranking_clientes as
with por_dia as (
  -- Una fila por empresa × cliente × fecha: el día del comprobante que cuenta.
  select
    v.organizacion_id,
    v.empresa_id,
    e.nombre as empresa_nombre,
    v.cliente_id,
    c.numero as numero,
    c.nombre as nombre,
    c.tipo as tipo,
    c.es_consumidor_final as consumidor_final,
    v.fecha,
    count(*) filter (where v.tipo = 'factura')::bigint as comprobantes,
    sum(analitica.signo_comprobante(v.tipo) * v.total_con_iva)::numeric as facturado
  from dominio.comprobantes_venta v
  join public.clientes c
    on c.id = v.cliente_id and c.organizacion_id = v.organizacion_id
  join dominio.empresas e
    on e.id = v.empresa_id and e.organizacion_id = v.organizacion_id
  where analitica.comprobante_cuenta_como_facturado(v.tipo, v.estado)
  group by
    v.organizacion_id, v.empresa_id, e.nombre, v.cliente_id, c.numero, c.nombre, c.tipo,
    c.es_consumidor_final, v.fecha
),
por_cliente as (
  -- El cliente en todo el alcance visible de la vista: su facturación neta y sus comprobantes.
  select
    p.organizacion_id,
    p.cliente_id,
    p.numero,
    p.nombre,
    p.tipo,
    p.consumidor_final,
    sum(p.comprobantes)::bigint as comprobantes,
    sum(p.facturado)::numeric as facturado
  from por_dia p
  group by p.organizacion_id, p.cliente_id, p.numero, p.nombre, p.tipo, p.consumidor_final
),
ranking as (
  -- Posición y total: el ranking del cliente (facturado desc, nombre, número — el mismo desempate
  -- que `public.ranking_clientes`, para que los dos rankings coincidan).
  select
    pc.*,
    row_number() over (order by pc.facturado desc, lower(pc.nombre), pc.numero) as posicion,
    sum(pc.facturado) over () as facturado_total
  from por_cliente pc
),
ultima_compra as (
  -- Fecha del comprobante más reciente que cuenta del cliente EN ESA TIENDA (con varias tiendas, el
  -- tablero toma el máximo: la última compra del cliente en el alcance filtrado).
  select
    organizacion_id,
    empresa_id,
    cliente_id,
    max(fecha) as ultimo_comprador
  from por_dia
  group by organizacion_id, empresa_id, cliente_id
)
select
  d.organizacion_id,
  d.empresa_id,
  d.empresa_nombre,
  r.posicion,
  d.cliente_id,
  d.numero,
  d.nombre,
  d.tipo,
  d.consumidor_final,
  d.fecha,
  d.comprobantes,
  d.facturado,
  -- Participación en porcentaje (0–100) sobre el total del alcance visible, sin redondear (la
  -- pantalla muestra una decimal). Con total cero (o negativo) la participación es 0.
  case when r.facturado_total = 0 then 0::numeric
       else r.facturado * 100 / r.facturado_total end as participacion,
  uc.ultimo_comprador
from por_dia d
join ranking r
  on r.organizacion_id = d.organizacion_id
 and r.cliente_id = d.cliente_id
join ultima_compra uc
  on uc.organizacion_id = d.organizacion_id
 and uc.empresa_id = d.empresa_id
 and uc.cliente_id = d.cliente_id;

comment on view analitica.ventas_ranking_clientes is
  'F-VTA-23: ranking de clientes por facturación neta. Una fila por empresa × cliente × fecha: comprobantes (solo facturas que cuentan), facturado neto con IVA (la nota de crédito resta), participación sobre el total y la fecha del último comprobante que cuenta. Cuentan solo los comprobantes que cumplen private.comprobante_cuenta_como_facturado; la marca consumidor_final permite excluir al Consumidor final. Contrato en specs/20270104-100000-ventas-reportes-basicos/contracts/analitica-ventas-reportes.md.';

revoke all on analitica.ventas_ranking_clientes from public, anon, authenticated;
grant select on analitica.ventas_ranking_clientes to superset_analitica;
