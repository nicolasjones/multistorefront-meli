-- F-CAT-09 (MSF-360, épica MSF-202). Cubre SC-001 / FR-002 / FR-005: columna `compatible_con` al final de
-- `v_productos_listado`, índice GIN sobre `dominio.productos(compatible_con)`, y `public.listar_compatibles()`
-- (distintos, ordenados, sin vacíos, aislamiento entre organizaciones, solo lectura, sin acceso de `anon`).
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated".
begin;

select plan(17);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, compatible_con) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90, array['Xbox', 'PS5']),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10, array['ps5', '', 'Switch']),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Funda', 'FUN-1', 5, '{}'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5, array['Otra consola']);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Estructura y privilegios
select is(
  (select attname::text from pg_attribute
    where attrelid = 'public.v_productos_listado'::regclass and attnum > 0 and not attisdropped
    order by attnum desc limit 1),
  'compatible_con', 'compatible_con es la última columna de v_productos_listado (aditiva)'
);
select is(
  (select format_type(atttypid, atttypmod) from pg_attribute
    where attrelid = 'public.v_productos_listado'::regclass and attname = 'compatible_con'),
  'text[]', 'compatible_con es text[]'
);
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'dominio' and tablename = 'productos' and indexname = 'productos_compatible_con_gin'
      and indexdef ilike '%using gin (compatible_con)%'),
  1, 'hay un índice GIN sobre dominio.productos(compatible_con)'
);
select is(has_table_privilege('anon', 'public.v_productos_listado', 'SELECT'), false, 'anon no lee v_productos_listado');
select is(has_function_privilege('anon', 'public.listar_compatibles()', 'EXECUTE'), false, 'anon no ejecuta listar_compatibles');
select is(has_function_privilege('authenticated', 'public.listar_compatibles()', 'EXECUTE'), true, 'authenticated ejecuta listar_compatibles');

-- Administrador de la organización Uno
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  public.listar_compatibles(),
  array['PS5', 'ps5', 'Switch', 'Xbox']::text[],
  'listar_compatibles: distintos tal como están guardados, ordenados sin distinguir mayúsculas y sin vacíos'
);
select is(
  (select count(*)::int from public.v_productos_listado where compatible_con && array['Xbox']),
  1, 'la vista filtra por compatible_con con &&'
);
select is(
  (select compatible_con from public.v_productos_listado where id = 'a1000000-0000-0000-0000-000000000001'),
  array['Xbox', 'PS5']::text[], 'la vista expone los valores del producto'
);
select is(
  (select count(*)::int from public.v_productos_listado where id = 'b2000000-0000-0000-0000-000000000001'),
  0, 'la vista no muestra productos de otra organización'
);
select ok(
  not ('Otra consola' = any (public.listar_compatibles())),
  'listar_compatibles no devuelve valores de otra organización'
);

-- Consulta (solo lectura) también lista
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(array_length(public.listar_compatibles(), 1), 4, 'Consulta con lectura en Productos ve los valores');

-- Organización Dos
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(public.listar_compatibles(), array['Otra consola']::text[], 'la otra organización solo ve los suyos');

-- Solo lectura: la función no modifica datos
reset role;
select is(
  (select provolatile::text from pg_proc where oid = 'public.listar_compatibles()'::regprocedure),
  's', 'listar_compatibles es stable (solo lectura)'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.listar_compatibles()'::regprocedure),
  true, 'listar_compatibles es security definer con search_path vacío'
);
select is(
  (select proconfig[1] from pg_proc where oid = 'public.listar_compatibles()'::regprocedure),
  'search_path=""', 'search_path fijado a vacío'
);

-- Sin sesión (anon) no ejecuta
set local role anon;
select throws_ok($$ select public.listar_compatibles() $$, '42501', null, 'anon recibe permiso denegado al llamar listar_compatibles');

select * from finish();
rollback;
