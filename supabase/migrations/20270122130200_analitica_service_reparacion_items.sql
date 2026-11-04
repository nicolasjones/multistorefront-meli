-- F-SVC-23 (MSF-168, épica MSF-124): vista `analitica.service_reparacion_items` para el tablero de Service.
-- Esquema (Principio VII): `analitica` (solo vistas; sin tablas ni RLS). Mismas garantías que
-- `analitica.service_reparaciones`: `organizacion_id` aislante vía guest token, solo `superset_analitica`,
-- sin costos internos (los ítems solo guardan precio de cara al cliente).
--
-- Una fila por ítem de reparación (mano de obra o repuesto), con la fecha de ingreso de su reparación.
--
-- Migración aditiva. Reversión (migración posterior; nada guarda datos):
--   drop view analitica.service_reparacion_items;

create or replace view analitica.service_reparacion_items as
select
  i.organizacion_id,
  r.empresa_id,
  e.nombre as empresa_nombre,
  i.reparacion_id,
  i.id as item_id,
  i.tipo,
  i.cantidad,
  i.subtotal,
  r.ingreso_en
from dominio.reparacion_items i
join dominio.reparaciones r on r.id = i.reparacion_id and r.organizacion_id = i.organizacion_id
join dominio.empresas e on e.id = r.empresa_id;

comment on view analitica.service_reparacion_items is
  'F-SVC-23: una fila por ítem (mano de obra o repuesto) con la tienda y el ingreso de su reparación. organizacion_id aislante. Sin costos internos. Solo lectura para superset_analitica.';

revoke all on analitica.service_reparacion_items from public, anon, authenticated;
grant select on analitica.service_reparacion_items to superset_analitica;
