-- F-STK-16 (MSF-337, épica MSF-292): reserva y descuento de productos «A pedido».
-- Cubre FR-030…FR-038 y los escenarios US3-1…US3-9: reservar 3 de 10 deja cantidad 10 / reservado 3 /
-- disponible 7; descontar deja cantidad 7 / reservado 0 con una salida en el libro y el motivo de sistema;
-- liberar no toca la cantidad; las reservas en estado final se rechazan sin doble efecto; un producto que
-- no es «A pedido», una cantidad mayor al disponible, un rol de lectura, otra organización y `anon` se
-- rechazan; la misma referencia no duplica la reserva; la disponibilidad deriva del disponible; y los
-- eventos `stock.actualizado` salen al reservar/liberar (diferencia 0) y al descontar (por su salida).
-- La carrera real (8 reservas de 1 sobre disponible 5) la prueba `stock-reservas-concurrencia.e2e.ts`.
begin;

select plan(56);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- P1 es «A pedido»; P2 no tiene etiqueta manual (disponibilidad derivada).
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, disponibilidad_manual) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consola a pedido', 'PED-1', 50, 'a_pedido'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'JOY-1', 50, null);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create temp table deposito on commit drop as
select d.id from dominio.depositos d
 where d.organizacion_id = '11111111-1111-1111-1111-111111111111' and d.por_defecto;
grant select on deposito to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.total_coincide() returns boolean language sql as $$
  select not exists (
    select 1 from dominio.existencias e
     where e.cantidad <> coalesce((select sum(x.cantidad) from dominio.existencias_deposito x where x.producto_id = e.producto_id), 0)
        or e.reservado <> coalesce((select sum(x.reservado) from dominio.existencias_deposito x where x.producto_id = e.producto_id), 0)
  );
$$;

-- ============================================================================
-- Tabla: RLS y sin escritura directa (FR-030)
-- ============================================================================

select ok(
  (select relrowsecurity from pg_class where oid = 'dominio.reservas_stock'::regclass),
  'reservas_stock tiene RLS activa'
);
select ok(
  not has_table_privilege('anon', 'dominio.reservas_stock', 'select'),
  'anon no lee reservas_stock'
);
select ok(
  not has_table_privilege('authenticated', 'dominio.reservas_stock', 'insert')
  and not has_table_privilege('authenticated', 'dominio.reservas_stock', 'update')
  and not has_table_privilege('authenticated', 'dominio.reservas_stock', 'delete'),
  'authenticated no escribe reservas_stock directamente: solo las RPC'
);

-- ============================================================================
-- Stock inicial: 10 de P1 y 5 de P2 en el depósito por defecto
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 10,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'entrada de 10 del producto a pedido'
);
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000002', 'entrada', 5,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'entrada de 5 del producto común'
);

-- ============================================================================
-- Reservar (FR-031) — US3-1, US3-5, US3-6
-- ============================================================================

select lives_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito), 3, 'PEDIDO-1')$$,
  'reservar 3 de 10 en un producto a pedido'
);
select is(
  (select reservado from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  3, 'reservado total 3'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  10, 'la cantidad no cambia al reservar'
);
select is(
  (select cantidad - reservado from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  7, 'disponible 7'
);
select is(
  (select reservado from dominio.existencias_deposito where producto_id = 'a1000000-0000-0000-0000-000000000001' and deposito_id = (select id from deposito)),
  3, 'reservado 3 en el depósito'
);
select is(
  (select estado from dominio.reservas_stock where referencia = 'PEDIDO-1'),
  'activa', 'la reserva nace activa'
);
select throws_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito), 8, 'PEDIDO-X')$$,
  '23514', 'No hay stock suficiente', 'reservar 8 con disponible 7 se rechaza'
);
select throws_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000002', (select id from deposito), 1, 'PEDIDO-Y')$$,
  '22023', 'Solo se puede reservar stock de productos A pedido', 'un producto que no es a pedido no se reserva'
);
select throws_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito), 0, 'PEDIDO-Z')$$,
  '22023', 'La cantidad a reservar debe ser un entero mayor a cero', 'cantidad cero se rechaza'
);

-- ============================================================================
-- Idempotencia por referencia (FR-032, D-8) — US3-7
-- ============================================================================

select lives_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito), 1, 'VENTA-1')$$,
  'reservar 1 con la referencia VENTA-1'
);
select is(
  (select (public.reservar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito), 1, 'VENTA-1')).id),
  (select id from dominio.reservas_stock where referencia = 'VENTA-1'),
  'la misma referencia devuelve la misma reserva'
);
select is(
  (select count(*)::int from dominio.reservas_stock where referencia = 'VENTA-1'),
  1, 'la misma referencia no duplica la reserva'
);
select is(
  (select reservado from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  4, 'el reintento no reserva dos veces (3 + 1)'
);
select throws_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito), 2, 'VENTA-1')$$,
  '23505', 'Esa referencia ya tiene una reserva con otros datos', 'la misma referencia con otra cantidad se rechaza'
);

-- ============================================================================
-- Liberar (FR-033, FR-035) — US3-3, US3-4
-- ============================================================================

select lives_ok(
  $$select public.liberar_reserva((select id from dominio.reservas_stock where referencia = 'VENTA-1'))$$,
  'liberar la reserva VENTA-1'
);
select is(
  (select estado from dominio.reservas_stock where referencia = 'VENTA-1'),
  'liberada', 'la reserva pasa a liberada'
);
select is(
  (select reservado from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  3, 'liberar devuelve el reservado (4 → 3)'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  10, 'liberar no cambia la cantidad'
);
select throws_ok(
  $$select public.liberar_reserva((select id from dominio.reservas_stock where referencia = 'VENTA-1'))$$,
  '22023', 'La reserva ya fue liberada', 'liberar dos veces se rechaza'
);
select throws_ok(
  $$select public.descontar_reserva((select id from dominio.reservas_stock where referencia = 'VENTA-1'))$$,
  '22023', 'La reserva ya fue liberada', 'descontar una reserva liberada se rechaza'
);

-- ============================================================================
-- Descontar (FR-034, FR-035, D-7) — US3-2, US3-4
-- ============================================================================

select lives_ok(
  $$select public.descontar_reserva((select id from dominio.reservas_stock where referencia = 'PEDIDO-1'))$$,
  'descontar la reserva PEDIDO-1'
);
select is(
  (select estado from dominio.reservas_stock where referencia = 'PEDIDO-1'),
  'descontada', 'la reserva pasa a descontada'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  7, 'descontar deja cantidad 7'
);
select is(
  (select reservado from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'descontar deja reservado 0'
);
select is(
  (select diferencia from dominio.movimientos_stock
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and tipo = 'salida'),
  -3, 'queda una salida de 3 en el libro'
);
select is(
  (select mo.nombre from dominio.movimientos_stock m join dominio.motivos_movimiento mo on mo.id = m.motivo_id
    where m.producto_id = 'a1000000-0000-0000-0000-000000000001' and m.tipo = 'salida'),
  'Entrega de producto a pedido', 'la salida usa el motivo de sistema'
);
select is(
  (select m.deposito_id from dominio.movimientos_stock m
    where m.producto_id = 'a1000000-0000-0000-0000-000000000001' and m.tipo = 'salida'),
  (select id from deposito), 'la salida se registra en el depósito de la reserva'
);
select throws_ok(
  $$select public.descontar_reserva((select id from dominio.reservas_stock where referencia = 'PEDIDO-1'))$$,
  '22023', 'La reserva ya fue descontada', 'descontar dos veces se rechaza'
);
select throws_ok(
  $$select public.liberar_reserva((select id from dominio.reservas_stock where referencia = 'PEDIDO-1'))$$,
  '22023', 'La reserva ya fue descontada', 'liberar una reserva descontada se rechaza'
);
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  7, 'los rechazos no hacen doble descuento'
);
select ok(pg_temp.total_coincide(), 'total y reservado = suma por depósito tras reservar, liberar y descontar');

-- ============================================================================
-- Eventos stock.actualizado (FR-038)
-- ============================================================================

reset role;

select is(
  (select count(*)::int from public.cola_eventos where carga->>'tipo_movimiento' = 'reserva'),
  2, 'cada reserva emite un evento (la repetida no emite otro)'
);
select is(
  (select count(*)::int from public.cola_eventos where carga->>'tipo_movimiento' = 'liberacion'),
  1, 'liberar emite un evento'
);
select is(
  (select count(*)::int from public.cola_eventos
    where carga->>'tipo_movimiento' in ('reserva', 'liberacion') and (carga->>'diferencia')::int <> 0),
  0, 'los eventos de reserva y liberación llevan diferencia 0'
);
select is(
  (select c.carga->>'reservado' || '/' || (c.carga->>'disponible')
     from public.cola_eventos c
    where c.tipo = 'stock.actualizado'
      and c.clave_idempotencia = (select id::text from dominio.reservas_stock where referencia = 'PEDIDO-1') || ':reserva'),
  '3/7', 'el evento de reserva informa reservado 3 y disponible 7'
);
select is(
  (select c.carga->>'reservado' || '/' || (c.carga->>'disponible')
     from public.cola_eventos c
    where c.tipo = 'stock.actualizado'
      and c.clave_idempotencia = (select id::text from dominio.movimientos_stock where tipo = 'salida')),
  '0/7', 'descontar emite por su salida, con reservado 0 y disponible 7'
);

-- ============================================================================
-- Disponibilidad sobre el disponible (FR-036) — US3-8
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is(
  (select private.disponibilidad_producto('a1000000-0000-0000-0000-000000000001')),
  'a_pedido', 'el producto a pedido sigue A pedido (la etiqueta manual manda)'
);
select is(
  (select private.disponibilidad_producto('a1000000-0000-0000-0000-000000000002')),
  'stock', 'el producto común con disponible 5 está en Stock'
);

reset role;
-- Se reserva todo el stock del producto común (el estado lo arma el test: la RPC solo reserva a pedido).
update dominio.existencias_deposito set reservado = cantidad where producto_id = 'a1000000-0000-0000-0000-000000000002';
update dominio.existencias set reservado = cantidad where producto_id = 'a1000000-0000-0000-0000-000000000002';
select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is(
  (select private.disponibilidad_producto('a1000000-0000-0000-0000-000000000002')),
  'sin_stock', 'el producto común con disponible 0 pasa a Sin stock'
);
select is(
  (select count(*)::int from private.productos_con_stock() as x(id) where x.id = 'a1000000-0000-0000-0000-000000000002'),
  0, 'productos_con_stock excluye al producto sin disponible'
);

-- ============================================================================
-- Depósito inactivo, rol de lectura y otra organización (FR-037) — US3-9
-- ============================================================================

reset role;
insert into dominio.depositos (id, organizacion_id, nombre, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Depósito Viejo', false);
select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 1, 'PEDIDO-2')$$,
  '22023', 'El depósito está inactivo: elegí otro para reservar', 'un depósito inactivo no admite reservas'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000003');

select throws_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito), 1, 'PEDIDO-3')$$,
  '42501', 'Tu rol no puede reservar stock', 'lectura no reserva'
);
select throws_ok(
  $$select public.liberar_reserva((select id from dominio.reservas_stock where referencia = 'PEDIDO-1'))$$,
  '42501', 'Tu rol no puede liberar reservas', 'lectura no libera'
);
select throws_ok(
  $$select public.descontar_reserva((select id from dominio.reservas_stock where referencia = 'PEDIDO-1'))$$,
  '42501', 'Tu rol no puede descontar reservas', 'lectura no descuenta'
);

reset role;
create temp table reserva_ajena on commit drop as
select id from dominio.reservas_stock where referencia = 'PEDIDO-1';
grant select on reserva_ajena to authenticated;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.reservar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito), 1, 'PEDIDO-4')$$,
  '22023', 'No encontramos ese producto', 'otra organización no reserva un producto ajeno'
);
select throws_ok(
  $$select public.liberar_reserva((select id from reserva_ajena))$$,
  '22023', 'No encontramos esa reserva', 'otra organización no libera una reserva ajena'
);
select throws_ok(
  $$select public.descontar_reserva((select id from reserva_ajena))$$,
  '22023', 'No encontramos esa reserva', 'otra organización no descuenta una reserva ajena'
);
select is(
  (select count(*)::int from dominio.reservas_stock),
  0, 'RLS: otra organización no ve las reservas'
);

reset role;

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('reservar_stock', 'liberar_reserva', 'descontar_reserva')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon no ejecuta ninguna de las tres RPC'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('reservar_stock', 'liberar_reserva', 'descontar_reserva')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  3, 'authenticated ejecuta las tres RPC'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('reservar_stock', 'liberar_reserva', 'descontar_reserva')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'las tres RPC son security definer con search_path vacío'
);

select * from finish();

rollback;
