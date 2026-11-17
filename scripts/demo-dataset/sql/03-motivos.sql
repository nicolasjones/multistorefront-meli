-- Motivos de movimiento de la organización demo (paso SQL, no vía API).
-- Por qué SQL: `dominio.motivos_movimiento` no tiene INSERT para `authenticated` ni para `service_role`: los motivos
-- los crea `private.sembrar_motivos_movimiento` (disparada al crear la organización). En los entornos compartidos esa
-- función puede haber quedado con la versión anterior —la que no incluía «Carga inicial de stock», motivo que exige la
-- RPC `aplicar_carga_inicial_stock`—, así que este paso completa los que falten. Idempotente.
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -f sql/03-motivos.sql
\set ON_ERROR_STOP on
insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
select o.id, m.nombre, m.aplica_a
  from public.organizaciones o
  cross join (values
      ('Compra a proveedor', '{entrada}'::text[]),
      ('Venta en local', '{salida}'::text[]),
      ('Conteo de inventario', '{ajuste}'::text[]),
      ('Devolución', '{entrada,salida}'::text[]),
      ('Rotura o pérdida', '{salida,ajuste}'::text[]),
      ('Anulación de ingreso de mercadería', '{salida}'::text[]),
      ('Toma de inventario', '{ajuste}'::text[]),
      ('Carga inicial de stock', '{ajuste}'::text[])
  ) as m(nombre, aplica_a)
 where o.nombre = :'org'
on conflict (organizacion_id, lower(btrim(nombre))) do nothing;

select m.nombre, m.aplica_a, m.activo
  from dominio.motivos_movimiento m
  join public.organizaciones o on o.id = m.organizacion_id
 where o.nombre = :'org'
 order by m.nombre;
