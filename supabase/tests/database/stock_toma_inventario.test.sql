-- F-STK-11 (MSF-415, épica MSF-131): toma de inventario. Cubre FR-103, FR-104, FR-105, FR-106 y
-- SC-003: `confirmar_toma_inventario` crea un ajuste por producto con diferencia (motivo de
-- sistema «Toma de inventario») y deja el stock en lo contado; sin diferencia no hay
-- movimiento; reenviar no crea nada; una falla no deja ningún ajuste; consulta recibe 42501;
-- `anon` no ejecuta; los movimientos previos quedan intactos.
begin;

select plan(31);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'JOY-1', 50),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 60),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Mouse', 'MOU-1', 20),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Auriculares', 'AUR-1', 40),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto ajeno', 'AJE-1', 10);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id, m.aplica_a from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.total_coincide() returns boolean language sql as $$
  select not exists (
    select 1 from dominio.existencias e
     where e.cantidad <> coalesce((select sum(x.cantidad) from dominio.existencias_deposito x where x.producto_id = e.producto_id), 0)
  );
$$;

-- ============================================================================
-- FR-105: definición y permisos de la función
-- ============================================================================

select is(has_function_privilege('anon', 'public.confirmar_toma_inventario(jsonb,date)', 'EXECUTE'), false, 'anon no puede ejecutar confirmar_toma_inventario');
select is(has_function_privilege('authenticated', 'public.confirmar_toma_inventario(jsonb,date)', 'EXECUTE'), true, 'authenticated puede ejecutar confirmar_toma_inventario');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.confirmar_toma_inventario(jsonb,date)'::regprocedure),
  true, 'confirmar_toma_inventario es security definer con search_path vacío'
);

-- ============================================================================
-- FR-104: motivo de sistema en organizaciones existentes (relleno) y nuevas (trigger)
-- ============================================================================

select is(
  (select aplica_a from ids where nombre = 'Toma de inventario' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['ajuste'], 'organización con motivo «Toma de inventario» que aplica solo a ajuste'
);
select is(
  (select count(*)::int from ids where nombre = 'Toma de inventario'),
  (select count(*)::int from public.organizaciones), 'todas las organizaciones tienen el motivo (siembra y relleno)'
);

select is(
  (select count(*)::int from ids where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  8, 'una organización nueva nace con los 8 motivos (los 7 vigentes, incl. toma, + carga inicial)'
);

-- Stock inicial (como operador, por la RPC de siempre): 10, 5 y 7 unidades; el cuarto queda en 0.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 10,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'arranque: 10 unidades del producto 1');
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000002', 'entrada', 5,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'arranque: 5 unidades del producto 2');
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000003', 'entrada', 7,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'arranque: 7 unidades del producto 3');

reset role;
create temp table antes on commit drop as
select m.id, m.producto_id, m.saldo, m.diferencia from dominio.movimientos_stock m;
grant select on antes to authenticated;

-- ============================================================================
-- FR-105: nivel de lectura rechazado
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000002","contado":1}]'::jsonb)$$,
  '42501', 'Tu rol no puede registrar movimientos de stock', 'consulta (lectura) recibe 42501'
);

-- ============================================================================
-- FR-103 / SC-003: 4 contados, 2 con diferencia
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
create temp table resultado as
select * from public.confirmar_toma_inventario($$[
  {"producto":"a1000000-0000-0000-0000-000000000001","contado":10},
  {"producto":"a1000000-0000-0000-0000-000000000002","contado":2},
  {"producto":"a1000000-0000-0000-0000-000000000003","contado":7},
  {"producto":"a1000000-0000-0000-0000-000000000004","contado":4}
]$$::jsonb);

select is((select count(*)::int from resultado), 2, 'devuelve solo los 2 productos con diferencia');
select is(
  (select string_agg(diferencia::text, ',' order by diferencia) from resultado), '-3,4',
  'las diferencias aplicadas son -3 y +4'
);
select is(
  (select string_agg(saldo::text, ',' order by saldo) from resultado), '2,4',
  'el saldo informado es lo contado'
);

reset role;
select is(
  (select array_agg(e.cantidad order by e.producto_id) from dominio.existencias e
    where e.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array[10, 2, 7, 4], 'el stock queda en lo contado (los que no difieren, intactos)'
);
select is(
  (select count(*)::int from dominio.movimientos_stock m
    where m.tipo = 'ajuste' and m.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'se crearon exactamente 2 ajustes'
);
select is(
  (select count(*)::int from dominio.movimientos_stock m
     join dominio.motivos_movimiento mo on mo.id = m.motivo_id
    where m.tipo = 'ajuste' and mo.nombre = 'Toma de inventario'),
  2, 'los 2 ajustes llevan el motivo «Toma de inventario»'
);
select is(
  (select count(*)::int from dominio.movimientos_stock m
    where m.producto_id in ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003')),
  2, 'los productos sin diferencia solo tienen su entrada de arranque'
);
select is(pg_temp.total_coincide(), true, 'el total coincide con la suma por depósito');
select is(
  (select count(*)::int from antes a join dominio.movimientos_stock m on m.id = a.id
    where m.saldo = a.saldo and m.diferencia = a.diferencia),
  (select count(*)::int from antes), 'FR-106: los movimientos previos quedaron intactos'
);

-- ============================================================================
-- FR-103: reenvío idempotente
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.confirmar_toma_inventario($$[
    {"producto":"a1000000-0000-0000-0000-000000000001","contado":10},
    {"producto":"a1000000-0000-0000-0000-000000000002","contado":2},
    {"producto":"a1000000-0000-0000-0000-000000000003","contado":7},
    {"producto":"a1000000-0000-0000-0000-000000000004","contado":4}
  ]$$::jsonb)),
  0, 'reenviar la misma toma no genera ajustes'
);
reset role;
select is((select count(*)::int from dominio.movimientos_stock), 5, 'siguen 5 movimientos (3 entradas y 2 ajustes)');

-- ============================================================================
-- FR-103: todo o nada y validaciones (22023)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[
    {"producto":"a1000000-0000-0000-0000-000000000002","contado":9},
    {"producto":"ffffffff-ffff-ffff-ffff-ffffffffffff","contado":1}]'::jsonb)$$,
  '22023', 'No encontramos ese producto', 'un producto inexistente rechaza toda la toma'
);
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a2000000-0000-0000-0000-000000000001","contado":1}]'::jsonb)$$,
  '22023', 'No encontramos ese producto', 'un producto de otra organización se rechaza'
);
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000002","contado":-1}]'::jsonb)$$,
  '22023', 'El stock contado debe ser un entero de cero o más', 'contado negativo'
);
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000002","contado":1.5}]'::jsonb)$$,
  '22023', 'El stock contado debe ser un entero de cero o más', 'contado decimal'
);
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[
    {"producto":"a1000000-0000-0000-0000-000000000002","contado":1},
    {"producto":"a1000000-0000-0000-0000-000000000002","contado":2}]'::jsonb)$$,
  '22023', 'Hay productos repetidos en la toma', 'producto repetido'
);
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[]'::jsonb)$$,
  '22023', 'Cargá al menos un producto contado', 'toma vacía'
);
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000002","contado":1}]'::jsonb, current_date + 1)$$,
  '22023', 'La fecha no puede ser futura', 'fecha futura'
);
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"no-es-uuid","contado":1}]'::jsonb)$$,
  '22023', 'Cada producto necesita su id y el stock contado', 'id de producto inválido'
);

reset role;
select is(
  (select array_agg(e.cantidad order by e.producto_id) from dominio.existencias e
    where e.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array[10, 2, 7, 4], 'tras las tomas rechazadas el stock no cambió'
);
select is((select count(*)::int from dominio.movimientos_stock), 5, 'tras las tomas rechazadas no quedó ningún ajuste nuevo');

select * from finish();
rollback;
