-- Fecha de negocio de las notas de crédito del dataset demo (paso SQL, antes de 99-fechas.sql).
-- `emitir_nota_credito` no recibe fecha y la RPC la fija en `current_date`: todas las notas de crédito quedan con la fecha
-- de la siembra, aunque acrediten facturas de hace semanas, y encabezan el listado de comprobantes. Una nota de crédito
-- se emite DESPUÉS de la factura que acredita: acá se la pone entre 2 y 14 días después de esa factura (sin pasar de
-- hoy ni caer domingo). Determinista (deriva los días de md5(id)) e idempotente. 99-fechas.sql toma esta fecha para sus
-- marcas de tiempo.
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -f sql/98-notas-credito-fechas.sql
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
with nuevas as (
  select nc.id,
         least(
           current_date,
           f.fecha + 2 + (('x' || substr(md5(nc.id::text), 1, 6))::bit(24)::int % 13)
         ) as fecha_bruta
    from dominio.comprobantes_venta nc
    join dominio.comprobantes_venta f on f.id = nc.comprobante_origen_id and f.organizacion_id = nc.organizacion_id
    join public.organizaciones o on o.id = nc.organizacion_id
   where o.nombre = :'org' and nc.tipo = 'nota_credito'
)
update dominio.comprobantes_venta c
   set fecha = case when extract(dow from n.fecha_bruta) = 0 then n.fecha_bruta - 1 else n.fecha_bruta end
  from nuevas n
 where c.id = n.id;
commit;
select 'notas de crédito con fecha ajustada: ' || count(*) filter (where nc.fecha < current_date) || ' de ' || count(*)
  from dominio.comprobantes_venta nc
  join public.organizaciones o on o.id = nc.organizacion_id
 where o.nombre = :'org' and nc.tipo = 'nota_credito';
