-- MSF-226 · F-CON-02 (épica MSF-130, FR-004): vista de lectura del interés por WhatsApp por producto.
--
-- Esquemas (Principio VII): no almacena datos.
--   * public.interes_whatsapp_por_producto -> `public` (superficie de lectura, SECURITY INVOKER: aplica la
--     RLS de dominio.intereses_whatsapp, de empresas y de productos del usuario que consulta).
--
-- Contrato de lectura para la pantalla de Consultas y para F-REP-04 (productos más consultados).
-- `anon` sin acceso.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.interes_whatsapp_por_producto;

create or replace view public.interes_whatsapp_por_producto
with (security_invoker = true) as
select i.organizacion_id,
       i.empresa_id,
       e.nombre as empresa_nombre,
       i.producto_id,
       p.nombre as producto_nombre,
       p.sku,
       count(*)::bigint as total,
       max(i.created_at) as ultimo_interes_at
  from dominio.intereses_whatsapp i
  join dominio.empresas e on e.id = i.empresa_id and e.organizacion_id = i.organizacion_id
  join dominio.productos p on p.id = i.producto_id and p.organizacion_id = i.organizacion_id
 group by i.organizacion_id, i.empresa_id, e.nombre, i.producto_id, p.nombre, p.sku;

revoke all on public.interes_whatsapp_por_producto from public, anon, authenticated;
grant select on public.interes_whatsapp_por_producto to authenticated;

comment on view public.interes_whatsapp_por_producto is
  'F-CON-02: veces y último interés por WhatsApp por empresa y producto. security_invoker: aplica la RLS de dominio.intereses_whatsapp (consultas ≥ lectura y empresa accesible). Contrato de lectura de F-REP-04.';
