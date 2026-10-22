-- F-CAT-17 (MSF-335) · SC-004: con 10 000 productos, el filtro por disponibilidad sobre
-- `public.v_productos_listado` devuelve la página en menos de 2 s. Corre como `authenticated` (con RLS y la
-- función `security definer` reales, no como postgres) y mide la MISMA consulta que arma la app:
-- filtro `disponibilidad = x`, orden por nombre con desempate por id, página de 25, conteo exacto.
-- Es una cota de humo en el entorno de pruebas (una sola ejecución por estado, no un p95): detecta una
-- degradación de órdenes de magnitud, p. ej. volver a una llamada de función por fila.
begin;

select plan(10);

insert into organizaciones (id, nombre) values ('19a0c000-0000-4000-8000-000000335001', 'Org MSF-335');
insert into auth.users (id, email) values ('d3350000-0000-0000-0000-000000000001', 'admin-335@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id)
values ('d3350000-0000-0000-0000-000000000001', '19a0c000-0000-4000-8000-000000335001', 'administrador');

-- 10 000 productos: ~1/4 con stock, ~1/4 A pedido, ~1/4 Stock entrante y el resto sin existencias.
insert into dominio.productos (organizacion_id, nombre, sku, precio_lista, disponibilidad_manual)
select '19a0c000-0000-4000-8000-000000335001',
       'Producto ' || (g % 97),
       'D335-' || lpad(g::text, 6, '0'),
       10,
       case g % 4 when 2 then 'a_pedido' when 3 then 'stock_entrante' else null end
  from generate_series(1, 10000) g;

-- Existencias simuladas (la fila nace por trigger al crear el producto).
update dominio.existencias e set cantidad = 5
  from dominio.productos p
 where p.id = e.producto_id and p.sku like 'D335-%' and right(p.sku, 1) in ('1', '5');

analyze dominio.productos;
analyze dominio.existencias;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d3350000-0000-0000-0000-000000000001');

select set_config('medicion.inicio', clock_timestamp()::text, true);
select is(
  (select count(*)::int from (
    select id from public.v_productos_listado where disponibilidad = 'stock' order by nombre, id limit 25) pagina),
  25, 'filtro stock: devuelve una página completa de 25');
select ok((select count(*) from public.v_productos_listado where disponibilidad = 'stock') > 25, 'filtro stock: el total exacto cuenta más de una página');
select cmp_ok(
  extract(epoch from clock_timestamp() - current_setting('medicion.inicio')::timestamptz)::numeric * 1000, '<', 2000::numeric,
  'filtro stock sobre 10 000 productos (página + total): < 2 s');

select set_config('medicion.inicio', clock_timestamp()::text, true);
select is(
  (select count(*)::int from (
    select id from public.v_productos_listado where disponibilidad = 'sin_stock' order by nombre, id limit 25) pagina),
  25, 'filtro sin_stock: devuelve una página completa de 25');
select ok((select count(*) from public.v_productos_listado where disponibilidad = 'sin_stock') > 25, 'filtro sin_stock: el total exacto cuenta más de una página');
select cmp_ok(
  extract(epoch from clock_timestamp() - current_setting('medicion.inicio')::timestamptz)::numeric * 1000, '<', 2000::numeric,
  'filtro sin_stock sobre 10 000 productos (página + total): < 2 s');

select set_config('medicion.inicio', clock_timestamp()::text, true);
select is(
  (select count(*)::int from (
    select id from public.v_productos_listado where disponibilidad = 'a_pedido' order by nombre, id limit 25) pagina),
  25, 'filtro a_pedido: devuelve una página completa de 25');
select ok((select count(*) from public.v_productos_listado where disponibilidad = 'a_pedido') > 25, 'filtro a_pedido: el total exacto cuenta más de una página');
select cmp_ok(
  extract(epoch from clock_timestamp() - current_setting('medicion.inicio')::timestamptz)::numeric * 1000, '<', 2000::numeric,
  'filtro a_pedido sobre 10 000 productos (página + total): < 2 s');

select is(
  (select count(*)::int from public.v_productos_listado where disponibilidad = 'stock')
  + (select count(*)::int from public.v_productos_listado where disponibilidad = 'sin_stock')
  + (select count(*)::int from public.v_productos_listado where disponibilidad in ('a_pedido', 'stock_entrante')),
  10000, 'los cuatro estados reparten exactamente los 10 000 productos');

select * from finish();
rollback;
