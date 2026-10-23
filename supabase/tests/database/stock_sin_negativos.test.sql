-- F-STK-06 (MSF-214, épica MSF-136): prevención de stock negativo.
-- Cubre FR-016/FR-017 y SC-005: una salida mayor al stock se rechaza por la RPC y
-- por SQL directo sin dejar movimiento ni evento; un ajuste a negativo se rechaza;
-- la restricción y el disparador viven en la base. La concurrencia real entre dos
-- sesiones la serializa `select … for update` de la RPC (más el disparador, que ve
-- el valor vigente tras la espera); acá se verifica la secuencia equivalente: la
-- segunda salida ve el saldo de la primera y no lo sobrepasa.
begin;

select plan(21);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'JOY-1', 50);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m
where m.organizacion_id = '11111111-1111-1111-1111-111111111111';
grant select on ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Devuelve el DETAIL del error que levanta una sentencia.
create function pg_temp.detalle_de(p_sql text) returns text language plpgsql as $$
declare v_detalle text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detalle = pg_exception_detail;
  return v_detalle;
end $$;

select is(
  (select count(*)::int from pg_constraint where conname = 'existencias_cantidad_no_negativa'),
  1, 'existe la restricción check (cantidad >= 0)'
);
select has_trigger('dominio', 'existencias', 'existencias_sin_negativos', 'existe el disparador de stock negativo');

-- ============================================================================
-- Operador: entrada de 6 y salida de 8 (rechazada por la RPC)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 6,
      (select id from ids where nombre = 'Compra a proveedor'))$$,
  'operador: entrada de 6'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 8,
      (select id from ids where nombre = 'Venta en local'))$$,
  '23514', 'No hay stock suficiente', 'una salida de 8 con stock 6 se rechaza con «No hay stock suficiente»'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  6, 'el rechazo no cambia el stock'
);
select is(
  (select count(*)::int from dominio.movimientos_stock where tipo = 'salida'),
  0, 'el rechazo no deja movimiento'
);

reset role;

select is(
  (select count(*)::int from registro_actividad where tipo = 'stock.salida'),
  0, 'el rechazo no deja evento de actividad'
);

-- ============================================================================
-- SQL directo: el disparador y la restricción protegen cualquier camino
-- ============================================================================

select is(
  pg_temp.detalle_de($$update dominio.existencias set cantidad = cantidad - 9
    where producto_id = 'a1000000-0000-0000-0000-000000000001'$$),
  'Hay 6 unidades y la salida es de 9.', 'el detalle informa la cantidad vigente y la pedida'
);
select throws_ok(
  $$update dominio.existencias set cantidad = -1 where producto_id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514', 'No hay stock suficiente', 'SQL directo: dejar el stock en negativo se rechaza'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  6, 'SQL directo: el stock sigue en 6'
);

-- Sin el disparador, la restricción estructural también lo impide.
alter table dominio.existencias disable trigger existencias_sin_negativos;
select throws_ok(
  $$update dominio.existencias set cantidad = -1 where producto_id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'la restricción check rechaza el negativo aunque falte el disparador'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  6, 'con la restricción, el stock sigue en 6'
);
alter table dominio.existencias enable trigger existencias_sin_negativos;

-- El rol de la app no escribe existencias directamente.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$update dominio.existencias set cantidad = -1 where producto_id = 'a1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'el rol de la app no puede escribir existencias por SQL directo'
);

-- ============================================================================
-- Secuencia de dos salidas que juntas superan el stock (SC-005)
-- ============================================================================

select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 4,
      (select id from ids where nombre = 'Venta en local'))$$,
  'la primera salida de 4 se acepta'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2, 'el stock queda en 2'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 4,
      (select id from ids where nombre = 'Venta en local'))$$,
  '23514', 'No hay stock suficiente', 'la segunda salida de 4 ve el saldo de la primera y se rechaza'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2, 'el stock sigue en 2'
);
select is(
  (select count(*)::int from dominio.movimientos_stock),
  2, 'solo quedan la entrada y la primera salida'
);

-- Borde: una salida igual al stock es válida y deja 0.
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 2,
      (select id from ids where nombre = 'Venta en local'))$$,
  'una salida igual al stock se acepta'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'el stock queda en 0, no negativo'
);

-- Un ajuste a negativo se rechaza.
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'ajuste', -1,
      (select id from ids where nombre = 'Conteo de inventario'))$$,
  '22023', null, 'un ajuste a negativo se rechaza'
);

select * from finish();

rollback;
