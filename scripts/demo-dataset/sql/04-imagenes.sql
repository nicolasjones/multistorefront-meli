-- Imágenes de los productos del catálogo (paso SQL, no vía API).
--
-- Por qué SQL: `dominio.producto_imagenes` no tiene RPC de escritura (la API solo sube archivos al bucket por otros
-- caminos), y con el catálogo real del cliente las imágenes son un archivo aparte que el módulo 02 deja escrito.
-- Es idempotente: si la imagen ya está, no se duplica.
--
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -v imagenes=/tmp/demo-imagenes.csv \
--        -f sql/04-imagenes.sql
\set ON_ERROR_STOP on
create temp table _img (sku text, posicion int, ruta text) on commit drop;
\copy _img from :'imagenes' with (format csv, header true, delimiter ',', quote '"')

insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta)
select p.id, p.organizacion_id, i.posicion, i.ruta
  from _img i
  join dominio.productos p on p.sku = i.sku
  join public.organizaciones o on o.id = p.organizacion_id
 where o.nombre = :'org'
on conflict do nothing;

select count(*) as imagenes_cargadas
  from dominio.producto_imagenes i
  join public.organizaciones o on o.id = i.organizacion_id
 where o.nombre = :'org';
