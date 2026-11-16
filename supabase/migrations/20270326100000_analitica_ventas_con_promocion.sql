-- MSF-934 (seguimiento S3 de MSF-816): indicador «ventas con promoción» y aviso de promoción bajo el costo.
--
-- Esquema (Principio VII): SIN tablas nuevas; solo una vista de `analitica` (solo vistas y funciones de apoyo).
-- Lee `dominio.comprobantes_venta` y `dominio.comprobantes_venta_lineas` (columnas `precio_referencia` y
-- `promocion_id` de 20270310100000), `dominio.empresas` y `dominio.productos`.
-- Aislamiento: igual que `analitica.rentabilidad_ventas_real`: sin acceso para `anon` ni `authenticated`; la lee el rol
-- `superset_analitica` y la separación por organización la fuerza la cláusula `rls` del guest token. No expone el
-- costo en valor, solo cuántas unidades se vendieron bajo el costo: el tablero que la use se registra con la
-- sección `rentabilidad`.
--
-- Cálculo: mismo predicado y signo que la rentabilidad real (`analitica.comprobante_cuenta_como_facturado`,
-- `analitica.signo_comprobante`: la nota de crédito resta). Grano: empresa × producto × fecha.
--   · `unidades_con_promocion` / `vendido_con_promocion`: líneas con `promocion_id` (la promoción ganó al precio normal).
--   · `descuento_promocional` = Σ signo × cantidad × (precio_referencia − precio_unitario): lo que se dejó de cobrar
--     contra el precio normal del cliente.
--   · `unidades_bajo_costo`: unidades en promoción cuyo precio unitario es menor al costo guardado en la línea (la
--     promoción no se valida contra el costo; esto es el aviso). Las líneas sin costo guardado no cuentan.
--   · `pct_unidades_con_promocion` = con promoción / total (null si el total es 0).
-- Pendiente de decisión de producto (no se inventa): umbral/alerta automática de promoción bajo el costo y tablero
-- en Superset; esta vista es el dato que ese tablero consumiría.
--
-- Migración aditiva e idempotente (`create or replace view`).
-- Reversión (migración posterior; la vista no guarda datos):
--   drop view analitica.ventas_con_promocion;

create or replace view analitica.ventas_con_promocion as
select
  v.organizacion_id,
  v.empresa_id,
  e.nombre as empresa_nombre,
  l.producto_id,
  p.nombre as producto_nombre,
  p.sku,
  v.fecha,
  sum(analitica.signo_comprobante(v.tipo) * l.cantidad)::bigint as unidades,
  coalesce(sum(analitica.signo_comprobante(v.tipo) * l.cantidad) filter (where l.promocion_id is not null), 0)::bigint
    as unidades_con_promocion,
  sum(analitica.signo_comprobante(v.tipo) * l.subtotal_sin_iva)::numeric as vendido,
  coalesce(sum(analitica.signo_comprobante(v.tipo) * l.subtotal_sin_iva) filter (where l.promocion_id is not null), 0)::numeric
    as vendido_con_promocion,
  coalesce(sum(analitica.signo_comprobante(v.tipo) * l.cantidad * (l.precio_referencia - l.precio_unitario))
    filter (where l.promocion_id is not null), 0)::numeric as descuento_promocional,
  coalesce(sum(analitica.signo_comprobante(v.tipo) * l.cantidad)
    filter (where l.promocion_id is not null and l.costo_unitario is not null and l.precio_unitario < l.costo_unitario), 0)::bigint
    as unidades_bajo_costo,
  case when sum(analitica.signo_comprobante(v.tipo) * l.cantidad) > 0 then
    coalesce(sum(analitica.signo_comprobante(v.tipo) * l.cantidad) filter (where l.promocion_id is not null), 0)::numeric
      / sum(analitica.signo_comprobante(v.tipo) * l.cantidad)
  end as pct_unidades_con_promocion
from dominio.comprobantes_venta v
join dominio.comprobantes_venta_lineas l
  on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
join dominio.empresas e on e.id = v.empresa_id and e.organizacion_id = v.organizacion_id
join dominio.productos p on p.id = l.producto_id and p.organizacion_id = v.organizacion_id
where analitica.comprobante_cuenta_como_facturado(v.tipo, v.estado)
group by v.organizacion_id, v.empresa_id, e.nombre, l.producto_id, p.nombre, p.sku, v.fecha;

comment on view analitica.ventas_con_promocion is
  'MSF-934: unidades y ventas con promoción de precio (línea con promocion_id), descuento contra el precio normal y unidades de promociones bajo el costo, por empresa × producto × fecha; las notas de crédito restan.';

revoke all on analitica.ventas_con_promocion from public, anon, authenticated;
grant select on analitica.ventas_con_promocion to superset_analitica;
