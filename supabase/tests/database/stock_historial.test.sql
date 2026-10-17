-- F-STK-03 (MSF-173, épica MSF-136): historial de movimientos inmodificable y paginado.
-- Cubre SC-003 (ningún update/delete/truncate prospera con ningún rol, ni el propietario),
-- el orden, la paginación y el total, el filtro por producto, el aislamiento entre dos
-- organizaciones, el rol sin acceso y `anon` sin acceso a la RPC.
-- Los movimientos se siembran como postgres con `creado_en` distintos (dentro de una misma
-- transacción `now()` es constante); se leen como "authenticated" (request.jwt.claims).
begin;

select plan(23);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000009', 'sinorg@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'JOY-1', 50),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable HDMI', 'CAB-1', 5),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado Dos', 'TEC-2', 30);

-- Fixture: 3 movimientos del Joystick, 1 del Cable (Uno) y 1 de Teclado (Dos).
insert into dominio.movimientos_stock
  (id, organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha, actor_nombre, creado_en)
select v.id::uuid, v.org::uuid, v.prod::uuid, v.tipo, v.cant, v.dif, v.saldo,
       (select m.id from dominio.motivos_movimiento m where m.organizacion_id = v.org::uuid order by m.nombre limit 1),
       current_date, 'operador@example.com', now() - v.hace
from (values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'entrada', 10, 10, 10, interval '3 hours'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'salida', 4, -4, 6, interval '2 hours'),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'ajuste', 3, -3, 3, interval '1 hour'),
  ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'entrada', 7, 7, 7, interval '30 minutes'),
  ('b0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'entrada', 9, 9, 9, interval '10 minutes')
) as v(id, org, prod, tipo, cant, dif, saldo, hace);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Inmutabilidad (FR-011, SC-003): el propietario (postgres) también es rechazado
-- ============================================================================

select throws_ok(
  $$update dominio.movimientos_stock set nota = 'x' where id = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501', 'Los movimientos de stock no se pueden modificar', 'el propietario no puede hacer update'
);
select throws_ok(
  $$delete from dominio.movimientos_stock where id = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501', 'Los movimientos de stock no se pueden modificar', 'el propietario no puede hacer delete'
);
select throws_ok(
  $$truncate dominio.movimientos_stock$$,
  '42501', 'Los movimientos de stock no se pueden modificar', 'el propietario no puede hacer truncate'
);

-- Ningún rol de la app conserva privilegios de escritura.
select is(
  (select bool_or(has_table_privilege(r, 'dominio.movimientos_stock', p))
     from unnest(array['anon', 'authenticated']) r, unnest(array['UPDATE', 'DELETE', 'TRUNCATE', 'INSERT']) p),
  false, 'anon y authenticated no tienen update/delete/truncate/insert sobre movimientos_stock'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$update dominio.movimientos_stock set cantidad = 99$$,
  '42501', null, 'Administrador: update rechazado'
);
select throws_ok(
  $$delete from dominio.movimientos_stock$$,
  '42501', null, 'Administrador: delete rechazado'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$update dominio.movimientos_stock set cantidad = 99$$,
  '42501', null, 'Operador: update rechazado'
);
select throws_ok(
  $$delete from dominio.movimientos_stock$$,
  '42501', null, 'Operador: delete rechazado'
);

reset role;
select is(
  (select cantidad from dominio.movimientos_stock where id = 'b0000000-0000-0000-0000-000000000001'),
  10, 'la fila quedó intacta'
);

-- ============================================================================
-- Listado (FR-010, FR-012)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is(
  (select string_agg(id::text, ',' order by creado_en desc, id desc) from public.listar_movimientos_stock()),
  'b0000000-0000-0000-0000-000000000004,b0000000-0000-0000-0000-000000000003,b0000000-0000-0000-0000-000000000002,b0000000-0000-0000-0000-000000000001',
  'Operador: ve solo los 4 movimientos de su organización, del más reciente al más antiguo'
);
select is(
  (select total from public.listar_movimientos_stock() limit 1), 4::bigint, 'el total acompaña al listado'
);
select is(
  (select producto_nombre || '|' || producto_sku || '|' || tipo || '|' || saldo || '|' || responsable
     from public.listar_movimientos_stock('a1000000-0000-0000-0000-000000000002')),
  'Cable HDMI|CAB-1|entrada|7|operador@example.com', 'trae nombre y SKU del producto, tipo, saldo y responsable'
);
select is(
  (select count(*)::int from public.listar_movimientos_stock('a1000000-0000-0000-0000-000000000001')),
  3, 'el filtro por producto deja solo sus movimientos'
);
select is(
  (select max(total) from public.listar_movimientos_stock('a1000000-0000-0000-0000-000000000001')),
  3::bigint, 'el total del filtro es el del producto'
);
select is(
  (select string_agg(id::text, ',' order by creado_en desc) from public.listar_movimientos_stock(null, 2, 2)),
  'b0000000-0000-0000-0000-000000000002,b0000000-0000-0000-0000-000000000001',
  'la segunda página de tamaño 2 trae los dos más antiguos'
);
select is(
  (select max(total) from public.listar_movimientos_stock(null, 2, 2)), 4::bigint, 'el total no cambia con la página'
);
select is(
  (select count(*)::int from public.listar_movimientos_stock(null, 100000, 0)), 4,
  'un tamaño enorme se acota al tope sin romper'
);
select is(
  (select count(*)::int from public.listar_movimientos_stock('a2000000-0000-0000-0000-000000000001')),
  0, 'un producto de otra organización no devuelve filas'
);

-- Consulta (lectura) lee; sin organización (sin acceso a Stock) no recibe filas.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.listar_movimientos_stock()), 4, 'Consulta ve el historial'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000009');
select is(
  (select count(*)::int from public.listar_movimientos_stock()), 0, 'sin acceso a Stock no recibe filas'
);

-- Aislamiento: la otra organización solo ve lo suyo.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select string_agg(id::text, ',') from public.listar_movimientos_stock()),
  'b0000000-0000-0000-0000-000000000005', 'la organización Dos ve solo su movimiento'
);

-- anon
reset role;
select is(
  has_function_privilege('anon', 'public.listar_movimientos_stock(uuid, integer, integer)', 'EXECUTE'),
  false, 'anon no ejecuta listar_movimientos_stock'
);
select is(
  has_function_privilege('authenticated', 'public.listar_movimientos_stock(uuid, integer, integer)', 'EXECUTE'),
  true, 'authenticated ejecuta listar_movimientos_stock'
);

select * from finish();
rollback;
