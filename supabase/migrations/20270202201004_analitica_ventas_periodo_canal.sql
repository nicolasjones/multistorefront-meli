-- F-REP-05 (MSF-248, épica MSF-192, spec 20270201-100000-rentabilidad-real-y-reportes-de-ventas, FR-012, FR-013):
-- vista `analitica.ventas_periodo_canal` (Ventas por período y canal) para el tablero de «Ventas · Reportes».
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   analitica.ventas_periodo_canal       analitica (nueva)  vista de lectura, SIN tablas nuevas.
--   dominio.comprobantes_venta (+líneas) dominio (existente): solo se leen.
--   dominio.empresas                     dominio (existente): la tienda = el canal. Solo se lee.
-- `analitica` no tiene tablas → `rls_en_toda_tabla` (public + dominio) sigue verde.
--
-- Aislamiento: la vista NO es `security_invoker`; no tiene acceso para `anon` ni `authenticated`. La lee el
-- rol de solo lectura `superset_analitica` y la separación por organización Y por empresa la fuerza la
-- cláusula `rls` del guest token: por eso cada fila expone `organizacion_id`, `empresa_id` y
-- `empresa_nombre`. NO expone costo ni margen (decisión 3 de la spec: solo cantidades y facturado).
--
-- Cálculo (FR-012): una fila por empresa (canal) × fecha. El predicado y el signo NO se reimplementan:
-- se usan `analitica.comprobante_cuenta_como_facturado(tipo, estado)` y `analitica.signo_comprobante(tipo)`
-- (F-VTA-22), los mismos de «Más vendidos» y del ranking de clientes.
--   · `comprobantes` = conteo de FACTURAS que cuentan (la nota de crédito resta importe y unidades pero
--     NO suma un comprobante; mismo criterio que el ranking de clientes).
--   · `unidades`     = Σ signo × cantidad de las líneas de esos comprobantes.
--   · `facturado`    = Σ signo × `total_con_iva` del comprobante: la base CON IVA que muestran el listado y
--     la exportación, y que usa «Más vendidos». Se agrega la CABECERA y las líneas por separado y se unen
--     por empresa × fecha, para que el total del comprobante no se multiplique por sus líneas.
--   · presupuestos, borradores y anuladas no son filas de la vista.
--   · Un comprobante sin `empresa_id` no produce fila (el token filtra por `empresa_id IN (…)`).
--   · Canal = tienda de la empresa. Mercado Libre (MSF-123) no existe todavía: no hay columna ni fila para
--     ese canal; cuando llegue, sus ventas se suman sin cambiar el contrato.
-- `fecha` es la del comprobante (`dominio.comprobantes_venta.fecha`, ya un día calendario, el mismo que usa
-- el listado). El tablero agrupa por día, semana o mes con el grano temporal de Superset sobre `fecha`.
--
-- Rendimiento: `organizacion_id` y `empresa_id` son columnas del GROUP BY de ambas agregaciones, así que los
-- filtros de la cláusula `rls` del guest token se empujan al escaneo de `comprobantes_venta` (índice
-- `comprobantes_venta_numero_uq`, que arranca por organización y empresa) y no se agrega el histórico
-- entero para después descartar. El grano es diario (una fila por tienda y día), no por comprobante.
--
-- Migración aditiva. Reversión (migración posterior; las vistas no guardan datos):
--   drop view analitica.ventas_periodo_canal;

-- Los helpers los creó F-VTA-22; se re-afirman sus permisos porque ESTA vista depende de ellos
-- (idempotente: no se redefine el cuerpo, el criterio de «qué cuenta» vive en un solo lugar).
revoke execute on function analitica.comprobante_cuenta_como_facturado(text, text) from public, anon, authenticated;
revoke execute on function analitica.signo_comprobante(text) from public, anon, authenticated;
grant execute on function analitica.comprobante_cuenta_como_facturado(text, text) to superset_analitica;
grant execute on function analitica.signo_comprobante(text) to superset_analitica;

create or replace view analitica.ventas_periodo_canal as
with cabecera as (
  select
    v.organizacion_id,
    v.empresa_id,
    v.fecha,
    count(*) filter (where v.tipo = 'factura')::bigint as comprobantes,
    sum(analitica.signo_comprobante(v.tipo) * v.total_con_iva)::numeric as facturado
  from dominio.comprobantes_venta v
  where analitica.comprobante_cuenta_como_facturado(v.tipo, v.estado)
  group by v.organizacion_id, v.empresa_id, v.fecha
),
lineas as (
  select
    v.organizacion_id,
    v.empresa_id,
    v.fecha,
    sum(analitica.signo_comprobante(v.tipo) * l.cantidad)::bigint as unidades
  from dominio.comprobantes_venta v
  join dominio.comprobantes_venta_lineas l
    on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
  where analitica.comprobante_cuenta_como_facturado(v.tipo, v.estado)
  group by v.organizacion_id, v.empresa_id, v.fecha
)
select
  c.organizacion_id,
  c.empresa_id,
  e.nombre as empresa_nombre,
  c.fecha,
  c.comprobantes,
  coalesce(l.unidades, 0)::bigint as unidades,
  c.facturado
from cabecera c
join dominio.empresas e
  on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
left join lineas l
  on l.organizacion_id = c.organizacion_id
 and l.empresa_id = c.empresa_id
 and l.fecha = c.fecha;

comment on view analitica.ventas_periodo_canal is
  'F-REP-05: ventas por período y canal. Una fila por empresa (canal) × fecha: comprobantes (solo facturas que cuentan), unidades y facturado neto con IVA (igual a total_con_iva; la nota de crédito resta). Sin costo ni margen. Contrato en specs/20270201-100000-rentabilidad-real-y-reportes-de-ventas/contracts/rentabilidad-real-y-reportes.md.';

revoke all on analitica.ventas_periodo_canal from public, anon, authenticated;
grant select on analitica.ventas_periodo_canal to superset_analitica;
