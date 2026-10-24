-- F-STK-10 (MSF-407, épica MSF-131): movimientos en lote.
-- Cubre FR-003…FR-009 y SC-001/SC-002: un lote de 5 productos deja 5 entradas con el mismo número
-- y el stock actualizado; una línea inválida o una falla en la 3.ª deja 0 lotes y 0 movimientos;
-- la misma clave devuelve el mismo lote; `lectura` y `anon` no registran; lotes y movimientos no se
-- editan ni se borran; otra organización no ve lotes. La numeración bajo carga real simultánea se
-- razona en `stock_lotes_concurrencia.test.sql` (un solo backend no puede simularla).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'operador2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'operador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto 1', 'P-1', 10),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto 2', 'P-2', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Producto 3', 'P-3', 10),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Producto 4', 'P-4', 10),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Producto 5', 'P-5', 10),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto ajeno', 'Z-1', 10);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.lineas(p_n integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('producto', ('a1000000-0000-0000-0000-00000000000' || i)::uuid, 'cantidad', i) order by i)
    from generate_series(1, p_n) i;
$$;

-- ============================================================================
-- FR-007: permisos
-- ============================================================================

select is(has_function_privilege('anon', 'public.registrar_lote_stock(jsonb,uuid,text,date,uuid)', 'EXECUTE'), false, 'anon no ejecuta registrar_lote_stock');
select is(has_function_privilege('anon', 'public.listar_lotes_stock(integer,jsonb)', 'EXECUTE'), false, 'anon no ejecuta listar_lotes_stock');
select is(has_function_privilege('anon', 'public.listar_movimientos_lote(uuid)', 'EXECUTE'), false, 'anon no ejecuta listar_movimientos_lote');
select is(has_function_privilege('anon', 'public.registrar_movimiento_stock(uuid,text,integer,uuid,text,date,uuid,uuid)', 'EXECUTE'), false, 'anon no ejecuta registrar_movimiento_stock');
select is(has_function_privilege('authenticated', 'public.registrar_lote_stock(jsonb,uuid,text,date,uuid)', 'EXECUTE'), true, 'authenticated ejecuta registrar_lote_stock');
select is(has_table_privilege('anon', 'dominio.lotes_stock', 'SELECT'), false, 'anon no lee dominio.lotes_stock');
select is(has_table_privilege('authenticated', 'dominio.lotes_stock', 'INSERT'), false, 'authenticated no inserta directo en lotes_stock');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.registrar_lote_stock(pg_temp.lineas(1), (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '42501', 'Tu rol no puede registrar lotes de stock', 'un usuario de solo lectura no registra lotes'
);
reset role;

-- ============================================================================
-- FR-003, FR-004, SC-001: lote de 5 productos
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is(
  (public.registrar_lote_stock(
     pg_temp.lineas(5),
     (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
     'Distribuidora Sur', current_date, 'c1000000-0000-0000-0000-000000000001') -> 'lote' ->> 'numero')::int,
  1, 'el primer lote de la organización es el número 1'
);

reset role;

create temp table lote_uno on commit drop as select l.id from dominio.lotes_stock l where l.numero = 1;
grant select on lote_uno to authenticated;

select is((select count(*)::int from dominio.lotes_stock), 1, 'se creó un solo lote');
select is((select proveedor from dominio.lotes_stock), 'Distribuidora Sur', 'el proveedor se guarda como texto libre, tal cual');
select is(
  (select count(*)::int from dominio.movimientos_stock m join dominio.lotes_stock l on l.id = m.lote_id where m.tipo = 'entrada'),
  5, 'cinco movimientos de entrada vinculados al mismo lote'
);
select is(
  (select count(distinct m.lote_id)::int from dominio.movimientos_stock m where m.lote_id is not null),
  1, 'todos los movimientos comparten el mismo lote (mismo número)'
);
select is(
  (select e.cantidad from dominio.existencias e where e.producto_id = 'a1000000-0000-0000-0000-000000000003'),
  3, 'el stock del producto 3 subió en su cantidad'
);
select is(
  (select sum(e.cantidad)::int from dominio.existencias e where e.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  15, 'el stock total sube 1+2+3+4+5'
);
select ok(
  exists (select 1 from registro_actividad where tipo = 'stock.lote_registrado' and detalle like '%Distribuidora Sur%15 unidades en 5 productos%'),
  'queda la actividad stock.lote_registrado'
);

-- ============================================================================
-- FR-008: idempotencia por clave
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (public.registrar_lote_stock(
     pg_temp.lineas(5),
     (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
     'Distribuidora Sur', current_date, 'c1000000-0000-0000-0000-000000000001') -> 'lote' ->> 'numero')::int,
  1, 'la misma clave devuelve el mismo lote'
);
reset role;
select is((select count(*)::int from dominio.lotes_stock), 1, 'el reintento no creó otro lote');
select is((select count(*)::int from dominio.movimientos_stock), 5, 'el reintento no creó otros movimientos');
select is(
  (select sum(e.cantidad)::int from dominio.existencias e where e.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  15, 'el reintento no movió el stock otra vez'
);

-- ============================================================================
-- FR-002, FR-003, SC-002: rechazos sin rastro (todo o nada)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.registrar_lote_stock('[{"producto":"a1000000-0000-0000-0000-000000000001","cantidad":0}]'::jsonb,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', 'La cantidad debe ser un entero mayor a cero', 'rechaza cantidad 0'
);
select throws_ok(
  $$select public.registrar_lote_stock('[{"producto":"a1000000-0000-0000-0000-000000000001","cantidad":-2}]'::jsonb,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', 'La cantidad debe ser un entero mayor a cero', 'rechaza cantidad negativa'
);
select throws_ok(
  $$select public.registrar_lote_stock('[{"producto":"a1000000-0000-0000-0000-000000000001","cantidad":1},{"producto":"a1000000-0000-0000-0000-000000000001","cantidad":2}]'::jsonb,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', 'No se puede repetir el mismo producto en un lote', 'rechaza un producto repetido'
);
select throws_ok(
  $$select public.registrar_lote_stock('[{"producto":"a1000000-0000-0000-0000-0000000000ff","cantidad":1}]'::jsonb,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', 'Uno de los productos no existe, está inactivo o es de otra organización', 'rechaza un producto inexistente'
);
select throws_ok(
  $$select public.registrar_lote_stock('[{"producto":"a2000000-0000-0000-0000-000000000001","cantidad":1}]'::jsonb,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', 'Uno de los productos no existe, está inactivo o es de otra organización', 'rechaza un producto de otra organización'
);
select throws_ok(
  $$select public.registrar_lote_stock('[]'::jsonb,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', 'Agregá al menos un producto para registrar el lote', 'rechaza un lote sin líneas'
);
select throws_ok(
  $$select public.registrar_lote_stock(pg_temp.lineas(1),
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      null, current_date + 1)$$,
  '22023', 'La fecha del lote no puede ser futura', 'rechaza una fecha futura'
);
select throws_ok(
  $$select public.registrar_lote_stock(pg_temp.lineas(1),
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      repeat('x', 121))$$,
  '22023', 'El proveedor admite hasta 120 caracteres', 'rechaza un proveedor de más de 120 caracteres'
);
select throws_ok(
  $$select public.registrar_lote_stock(pg_temp.lineas(1),
      (select id from ids where nombre = 'Venta en local' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', 'Elegí un motivo activo que aplique a las entradas', 'rechaza un motivo que no aplica a entradas'
);
-- Falla en la 3.ª línea: las dos primeras ya se habían aplicado dentro de la transacción.
select throws_ok(
  $$select public.registrar_lote_stock(
      '[{"producto":"a1000000-0000-0000-0000-000000000001","cantidad":7},
        {"producto":"a1000000-0000-0000-0000-000000000002","cantidad":7},
        {"producto":"a1000000-0000-0000-0000-0000000000ff","cantidad":7}]'::jsonb,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  '22023', 'Uno de los productos no existe, está inactivo o es de otra organización', 'una falla en la 3.ª línea rechaza el lote'
);
reset role;

select is((select count(*)::int from dominio.lotes_stock), 1, 'los rechazos no dejan lotes nuevos');
select is((select count(*)::int from dominio.movimientos_stock), 5, 'ni movimientos nuevos');
select is(
  (select e.cantidad from dominio.existencias e where e.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'ni cambios de stock (el producto 1 sigue en 1)'
);

-- ============================================================================
-- FR-004: segundo lote, número consecutivo
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (public.registrar_lote_stock(
     pg_temp.lineas(2),
     (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
     null, current_date, 'c1000000-0000-0000-0000-000000000002') -> 'lote' ->> 'numero')::int,
  2, 'el siguiente lote es el número 2 (los rechazos no consumen número)'
);
reset role;
select is((select proveedor from dominio.lotes_stock where numero = 2), null, 'el proveedor es opcional');

-- ============================================================================
-- FR-006: lote_id fijado, libro inmutable, stock sin negativos
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 999,
      (select id from ids where nombre = 'Venta en local' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      null, current_date, null, (select id from lote_uno))$$,
  '23514', 'No hay stock suficiente', 'con lote, el stock negativo sigue bloqueado'
);
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'registrar_movimiento_stock sin lote sigue funcionando (llamadores existentes)'
);
reset role;
select is(
  (select count(*)::int from dominio.movimientos_stock where lote_id is null), 1,
  'el movimiento individual no queda en ningún lote'
);

select throws_ok($$update dominio.lotes_stock set proveedor = 'X'$$, '42501', 'Los lotes de stock no se pueden modificar', 'el lote no se edita');
select throws_ok($$delete from dominio.lotes_stock$$, '42501', 'Los lotes de stock no se pueden modificar', 'el lote no se borra');
select throws_ok($$update dominio.movimientos_stock set nota = 'X' where lote_id is not null$$, '42501', 'Los movimientos de stock no se pueden modificar', 'los movimientos del lote no se editan');
select throws_ok($$delete from dominio.movimientos_stock where lote_id is not null$$, '42501', 'Los movimientos de stock no se pueden modificar', 'los movimientos del lote no se borran');

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$update dominio.lotes_stock set proveedor = 'X'$$, '42501', null, 'authenticated no edita lotes');
select throws_ok($$delete from dominio.lotes_stock$$, '42501', null, 'authenticated no borra lotes');
reset role;

-- ============================================================================
-- FR-009: lecturas (lectura y edición), aisladas por organización
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.listar_lotes_stock()), 2, 'lectura ve el historial de lotes');
select is((select numero from public.listar_lotes_stock() limit 1), 2, 'el más reciente primero');
select is(
  (select productos::int || '/' || unidades::int from public.listar_lotes_stock() where numero = 1),
  '5/15', 'el lote 1 informa 5 productos y 15 unidades'
);
select is((select count(*)::int from public.listar_lotes_stock(50, '{"numero": 2}'::jsonb)), 1, 'el cursor devuelve los lotes anteriores');
select is(
  (select count(*)::int from public.listar_movimientos_lote((select id from lote_uno))),
  5, 'el detalle del lote 1 lista sus 5 movimientos'
);
select is(
  (select producto from public.listar_movimientos_lote((select id from lote_uno)) order by cantidad limit 1),
  'Producto 1', 'el detalle muestra el nombre del producto'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from dominio.lotes_stock), 0, 'otra organización no ve lotes');
select is((select count(*)::int from public.listar_lotes_stock()), 0, 'otra organización lista 0 lotes');
select is(
  (select count(*)::int from public.listar_movimientos_lote((select id from lote_uno))),
  0, 'otra organización no ve movimientos de lotes ajenos'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a2000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '22222222-2222-2222-2222-222222222222'),
      null, current_date, null, (select id from lote_uno))$$,
  '22023', 'No encontramos ese lote', 'un lote de otra organización no se puede usar en un movimiento'
);
reset role;

select * from finish();

rollback;
