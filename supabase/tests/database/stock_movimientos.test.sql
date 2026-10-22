-- F-STK-02 (MSF-153, épica MSF-136): registrar un movimiento de stock.
-- Cubre SC-002 (aislamiento entre dos organizaciones, rechazo de escritura directa
-- sobre existencias / movimientos_stock / motivos_movimiento salvo Administrador en
-- motivos, `anon` sin acceso) y SC-006 (Consulta ve pero no registra).
-- Corre como postgres para armar el fixture y como "authenticated"
-- (request.jwt.claims, igual que PostgREST) para verificar.
begin;

select plan(43);

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
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado Dos', 'TEC-2', 30);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Existencias y motivos nacen solos (FR-001, FR-007)
-- ============================================================================

select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'un producto nuevo nace con existencias en 0'
);
select is(
  (select count(*)::int from dominio.motivos_movimiento where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  6, 'la organización nace con los 6 motivos iniciales'
);

-- ============================================================================
-- Operador: entrada 10 / salida 4 / ajuste a 3
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.registrar_movimiento_stock(
      'a1000000-0000-0000-0000-000000000001', 'entrada', 10,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      '  Primera carga  ', current_date)$$,
  'operador: registra una entrada de 10'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  10, 'el stock pasa a 10'
);
select is(
  (select nota from dominio.movimientos_stock where tipo = 'entrada'),
  'Primera carga', 'la nota se guarda recortada'
);
select lives_ok(
  $$select public.registrar_movimiento_stock(
      'a1000000-0000-0000-0000-000000000001', 'salida', 4,
      (select id from ids where nombre = 'Venta en local' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'operador: registra una salida de 4'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  6, 'el stock pasa a 6'
);
select lives_ok(
  $$select public.registrar_movimiento_stock(
      'a1000000-0000-0000-0000-000000000001', 'ajuste', 3,
      (select id from ids where nombre = 'Conteo de inventario' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'operador: registra un ajuste con stock contado 3'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  3, 'el stock pasa a 3'
);
select is(
  (select cantidad || '|' || diferencia || '|' || saldo from dominio.movimientos_stock where tipo = 'ajuste'),
  '3|-3|3', 'el ajuste guarda lo contado, la diferencia (−3) y el saldo (3)'
);
select is(
  (select string_agg(tipo || ':' || diferencia || ':' || saldo, ',' order by saldo desc, tipo)
     from dominio.movimientos_stock),
  'entrada:10:10,salida:-4:6,ajuste:-3:3', 'quedan tres movimientos con diferencia y saldo'
);
select is(
  (select count(*)::int from dominio.movimientos_stock where actor_id = 'd1000000-0000-0000-0000-000000000002' and actor_nombre = 'operador@example.com'),
  3, 'el responsable sale de la sesión'
);

-- Rechazos de la RPC: ninguno deja rastro.
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 0,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', null, 'una entrada de 0 se rechaza'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'ajuste', -1,
      (select id from ids where nombre = 'Conteo de inventario' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', null, 'un stock contado negativo se rechaza'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      null, current_date + 1)$$,
  '22023', null, 'una fecha futura se rechaza'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Venta en local' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', null, 'un motivo que no aplica al tipo se rechaza'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-0000000000ff', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', null, 'un producto inexistente se rechaza'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 99,
      (select id from ids where nombre = 'Venta en local' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '23514', null, 'una salida mayor al stock no deja el saldo negativo'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  3, 'tras los rechazos el stock sigue en 3'
);
select is((select count(*)::int from dominio.movimientos_stock), 3, 'los rechazos no dejan movimientos');

-- Escritura directa: nadie la tiene.
select throws_ok(
  $$update dominio.existencias set cantidad = 999$$,
  '42501', null, 'operador: update directo de existencias se rechaza'
);
select throws_ok(
  $$insert into dominio.movimientos_stock (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha)
    select organizacion_id, producto_id, 'entrada', 1, 1, 1, (select id from ids limit 1), current_date from dominio.existencias$$,
  '42501', null, 'operador: insert directo de movimientos se rechaza'
);
select throws_ok(
  $$insert into dominio.motivos_movimiento (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Otro')$$,
  '42501', null, 'operador: no crea motivos (solo el Administrador)'
);
reset role;

select is(
  (select count(*)::int from registro_actividad where tipo in ('stock.entrada', 'stock.salida', 'stock.ajuste')
     and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3, 'cada movimiento registró su evento stock.* en la actividad'
);
select ok(
  exists (select 1 from registro_actividad where tipo = 'stock.entrada' and detalle like '%Joystick Pro (SKU JOY-1)%10%'),
  'el evento incluye producto, cantidad y saldo'
);

-- ============================================================================
-- Consulta: ve pero no registra (SC-006)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.existencias), 1, 'consulta: ve las existencias');
select is((select count(*)::int from dominio.movimientos_stock), 3, 'consulta: ve los movimientos');
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '42501', null, 'consulta: la RPC se rechaza'
);
reset role;

-- Sin acceso a Stock (sin membresía): sin filas y sin RPC.
select pg_temp.como('d1000000-0000-0000-0000-000000000009');
select is((select count(*)::int from dominio.existencias), 0, 'sin acceso: no recibe existencias');
select is((select count(*)::int from dominio.motivos_movimiento), 0, 'sin acceso: no recibe motivos');
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '42501', null, 'sin acceso: la RPC se rechaza'
);
reset role;

-- ============================================================================
-- Administrador: motivos (alta, duplicado, desactivación)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
    values ('11111111-1111-1111-1111-111111111111', '  Muestra  ', '{salida}')$$,
  'administrador: crea un motivo'
);
select throws_ok(
  $$insert into dominio.motivos_movimiento (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'MUESTRA')$$,
  '23505', null, 'el nombre del motivo no se repite en la organización (sin distinguir mayúsculas)'
);
select lives_ok(
  $$update dominio.motivos_movimiento set activo = false where nombre = 'Muestra'$$,
  'administrador: desactiva un motivo'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 1,
      (select id from dominio.motivos_movimiento where nombre = 'Muestra'))$$,
  '22023', null, 'un motivo desactivado no se ofrece para movimientos nuevos'
);
reset role;

-- ============================================================================
-- Aislamiento entre organizaciones (SC-002)
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.existencias where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0, 'organización dos no ve las existencias de la uno'
);
select is(
  (select count(*)::int from dominio.movimientos_stock where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0, 'organización dos no ve los movimientos de la uno'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '22222222-2222-2222-2222-222222222222'))$$,
  '22023', null, 'organización dos no puede mover el stock de un producto de la uno'
);
select is(
  (select count(*)::int from dominio.motivos_movimiento), 6, 'organización dos ve solo sus propios motivos'
);
reset role;

-- ============================================================================
-- anon
-- ============================================================================

select is(has_table_privilege('anon', 'dominio.existencias', 'SELECT'), false, 'anon no lee existencias');
select is(has_table_privilege('anon', 'dominio.movimientos_stock', 'SELECT'), false, 'anon no lee movimientos');
select is(has_table_privilege('anon', 'dominio.motivos_movimiento', 'SELECT'), false, 'anon no lee motivos');
select is(
  has_function_privilege('anon', 'public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date)', 'EXECUTE'),
  false, 'anon no ejecuta registrar_movimiento_stock'
);

select * from finish();

rollback;
