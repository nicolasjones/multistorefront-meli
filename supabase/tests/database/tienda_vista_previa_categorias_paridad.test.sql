-- MSF-846 (hallazgo QA 4): public.vista_previa_tienda cuenta el árbol y omite las categorías vacías, igual que
-- publico.categorias_por_dominio; con borrador (producto oculto, subcategoría oculta) sigue la visibilidad del borrador.
begin;

select plan(8);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'admin-par@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'par.ejemplo.com');

-- Raíz (sin productos propios) > Hija (2 productos); Vacía (sin productos).
insert into dominio.categorias (id, organizacion_id, nombre, posicion, padre_id) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Raíz', 1, null),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Hija', 2, 'ca000000-0000-0000-0000-000000000001'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Vacía', 3, null);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno', 'PAR-1', 10, 'ARS', true, 'ca000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Dos', 'PAR-2', 10, 'ARS', true, 'ca000000-0000-0000-0000-000000000002');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id from dominio.productos p
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';

create function pg_temp.vista() returns jsonb language sql as $$
  select public.vista_previa_tienda('e1000000-0000-0000-0000-000000000001') -> 'categorias';
$$;
create function pg_temp.n(p_cat jsonb, p_id text) returns text language sql as $$
  select c ->> 'productos' from jsonb_array_elements(p_cat) c where c ->> 'id' = p_id;
$$;

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(pg_temp.n(pg_temp.vista(), 'ca000000-0000-0000-0000-000000000001'), '2', 'la categoría padre cuenta el árbol (no 0)');
select is(pg_temp.n(pg_temp.vista(), 'ca000000-0000-0000-0000-000000000002'), '2', 'la hija cuenta sus productos');
select is(pg_temp.n(pg_temp.vista(), 'ca000000-0000-0000-0000-000000000003'), null, 'una categoría vacía se omite');
select is(
  (select jsonb_agg(jsonb_build_object('id', c -> 'id', 'productos', c -> 'productos') order by ord)
     from jsonb_array_elements(pg_temp.vista()) with ordinality as t(c, ord)),
  (select jsonb_agg(jsonb_build_object('id', c -> 'id', 'productos', c -> 'productos') order by ord)
     from jsonb_array_elements(publico.categorias_por_dominio('par.ejemplo.com') -> 'categorias') with ordinality as t(c, ord)),
  'sin borrador: mismas categorías, conteos y orden que la tienda pública'
);

select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'catalogo',
  '{"categorias":[],"productos":[{"id":"a1000000-0000-0000-0000-000000000001","visible":false,"destacado":false}]}'::jsonb);
select is(pg_temp.n(pg_temp.vista(), 'ca000000-0000-0000-0000-000000000001'), '1', 'borrador: ocultar un producto baja el conteo del árbol');

select public.guardar_borrador_tienda('e1000000-0000-0000-0000-000000000001', 'catalogo',
  '{"categorias":[{"id":"ca000000-0000-0000-0000-000000000002","visible":false}],"productos":[]}'::jsonb);
select is(pg_temp.n(pg_temp.vista(), 'ca000000-0000-0000-0000-000000000002'), null, 'borrador: subcategoría oculta no aparece');
select is(pg_temp.n(pg_temp.vista(), 'ca000000-0000-0000-0000-000000000001'), null, 'borrador: la raíz sin productos visibles se omite');

reset role;
select is(has_function_privilege('anon', 'public.vista_previa_tienda(uuid)', 'execute'), false, 'anon sigue sin ejecutar vista_previa_tienda');

select * from finish();
rollback;
