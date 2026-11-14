-- F-REP-07 (MSF-265, spec 20261114-100000-analitica-avanzada-y-resumen-por-correo, RF-REP-07-4, RF-REP-07-5):
-- dos vistas de lectura del esquema `analitica` para los tableros «Analítica · Ventas por tienda y categoría» y
-- «Analítica · Margen real por tienda, categoría y producto» (cruces que las vistas existentes no traen: la
-- categoría del producto junto a la tienda y la fecha).
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   analitica.ventas_empresa_categoria   analitica (nueva)  vista de lectura, SIN tablas nuevas.
--   analitica.margen_real_categoria      analitica (nueva)  vista de lectura, SIN tablas nuevas.
--   dominio.comprobantes_venta (+líneas), dominio.empresas, dominio.productos, dominio.categorias:
--                                        dominio (existentes): solo se leen.
--   analitica.rentabilidad_ventas_real   analitica (existente): se reutiliza, NO se reimplementa su cálculo.
-- `analitica` no tiene tablas → `rls_en_toda_tabla` (public + dominio) sigue verde.
--
-- Aislamiento: igual que `analitica.ventas_periodo_canal` y `analitica.rentabilidad_ventas_real`, las vistas NO son
-- `security_invoker` y no tienen ningún privilegio para `anon`, `authenticated` ni `public`: las lee SOLO el rol de
-- solo lectura `superset_analitica` y la separación por organización Y por empresa la fuerza la cláusula `rls` del
-- guest token (`organizacion_id` y `empresa_id`, que `emitir-acceso-reporte` arma en el servidor). Por eso cada fila
-- expone `organizacion_id`, `empresa_id` y `empresa_nombre`.
--
-- `analitica.ventas_empresa_categoria` (una fila por empresa × categoría × producto × fecha):
--   · mismo predicado y mismo signo que «Más vendidos» y «Ventas por período y canal»:
--     `analitica.comprobante_cuenta_como_facturado` y `analitica.signo_comprobante` (la nota de crédito resta).
--   · `unidades` = Σ signo × cantidad; `facturado` = Σ signo × (subtotal_sin_iva + iva) de la línea (con IVA, el mismo
--     número que el listado y «Más vendidos»).
--   · NO expone costo ni margen (eso es de la otra vista, con otra sección de permisos) ni datos del cliente.
--   · un producto sin categoría cuenta como «Sin categoría» (no se pierde del cruce).
--
-- `analitica.margen_real_categoria` (una fila por empresa × producto × fecha, como `rentabilidad_ventas_real`):
--   · agrega SOLO la categoría del producto a las columnas de `rentabilidad_ventas_real`; el cálculo del margen real
--     (costo guardado en la línea, costos adicionales, estado por umbral) vive en un único lugar.
--   · expone costo y margen: el tablero se registra con la sección `rentabilidad`, igual que los de Rentabilidad.
--
-- Rendimiento: `organizacion_id` y `empresa_id` son columnas del GROUP BY de la primera vista y de la vista base de la
-- segunda, así que el filtro del guest token se empuja al escaneo de `comprobantes_venta`.
--
-- Migración aditiva e idempotente (`create or replace`). Reversión (migración posterior; las vistas no guardan datos):
--   drop view if exists analitica.margen_real_categoria;
--   drop view if exists analitica.ventas_empresa_categoria;

create or replace view analitica.ventas_empresa_categoria as
select
  v.organizacion_id,
  v.empresa_id,
  e.nombre as empresa_nombre,
  coalesce(cat.nombre, 'Sin categoría') as categoria,
  l.producto_id,
  p.nombre as producto_nombre,
  p.sku,
  v.fecha,
  sum(analitica.signo_comprobante(v.tipo) * l.cantidad)::bigint as unidades,
  sum(analitica.signo_comprobante(v.tipo) * (l.subtotal_sin_iva + l.iva))::numeric as facturado
from dominio.comprobantes_venta v
join dominio.comprobantes_venta_lineas l
  on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
join dominio.empresas e
  on e.id = v.empresa_id and e.organizacion_id = v.organizacion_id
join dominio.productos p
  on p.id = l.producto_id and p.organizacion_id = v.organizacion_id
left join dominio.categorias cat
  on cat.id = p.categoria_id and cat.organizacion_id = v.organizacion_id
where analitica.comprobante_cuenta_como_facturado(v.tipo, v.estado)
group by
  v.organizacion_id, v.empresa_id, e.nombre, coalesce(cat.nombre, 'Sin categoría'),
  l.producto_id, p.nombre, p.sku, v.fecha;

comment on view analitica.ventas_empresa_categoria is
  'F-REP-07: unidades y facturado neto con IVA por empresa × categoría × producto × fecha (la nota de crédito resta; sin categoría = «Sin categoría»). Sin costo, margen ni datos de clientes. Contrato en specs/20261114-100000-analitica-avanzada-y-resumen-por-correo/contracts/tableros-analiticos.md.';

create or replace view analitica.margen_real_categoria as
select
  r.organizacion_id,
  r.empresa_id,
  r.empresa_nombre,
  coalesce(cat.nombre, 'Sin categoría') as categoria,
  r.producto_id,
  r.producto_nombre,
  r.sku,
  r.fecha,
  r.unidades,
  r.vendido,
  r.costo,
  r.costos_adicionales,
  r.margen,
  r.margen_pct,
  r.estado,
  r.umbral_margen_bajo
from analitica.rentabilidad_ventas_real r
join dominio.productos p
  on p.id = r.producto_id and p.organizacion_id = r.organizacion_id
left join dominio.categorias cat
  on cat.id = p.categoria_id and cat.organizacion_id = r.organizacion_id;

comment on view analitica.margen_real_categoria is
  'F-REP-07: margen real de lo vendido (analitica.rentabilidad_ventas_real) con la categoría del producto, por empresa × producto × fecha. Expone costo y margen: solo el tablero registrado con la sección rentabilidad. Contrato en specs/20261114-100000-analitica-avanzada-y-resumen-por-correo/contracts/tableros-analiticos.md.';

revoke all on analitica.ventas_empresa_categoria from public, anon, authenticated;
revoke all on analitica.margen_real_categoria from public, anon, authenticated;
grant select on analitica.ventas_empresa_categoria to superset_analitica;
grant select on analitica.margen_real_categoria to superset_analitica;
