-- F-STK-14 (MSF-316, épica MSF-292): movimientos por depósito y barrera sobre el disponible.
-- Cubre FR-008, FR-009, FR-013 y SC-006: entrada/salida/ajuste aplican al depósito indicado,
-- sin depósito se usa el por defecto (llamadores anteriores), el libro guarda deposito_id,
-- una salida o ajuste que pasa el disponible (cantidad − reservado) se rechaza sin movimiento
-- ni evento aunque otro depósito tenga unidades, y `stock.actualizado` lleva deposito_id,
-- reservado y disponible, uno por movimiento. La concurrencia real la prueba el E2E
-- `stock-deposito-concurrencia.e2e.ts`; acá se verifica la secuencia equivalente.
begin;

select plan(23);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'JOY-1', 50);

-- Cada organización nace con «Depósito principal» (por defecto); se suma «Depósito Sur» a la uno.
insert into dominio.depositos (id, organizacion_id, nombre) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Depósito Sur');

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

-- Depósito de la organización dos, fijado como postgres (el operador no lo vería por RLS).
create temp table deposito_ajeno on commit drop as
select d.id from dominio.depositos d where d.organizacion_id = '22222222-2222-2222-2222-222222222222';
grant select on deposito_ajeno to authenticated;

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
-- Entrada al depósito indicado y al por defecto (FR-008, SC-006)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 5,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, current_date,
      'b1000000-0000-0000-0000-000000000001')$$,
  'entrada de 5 aplicada a «Depósito Sur»'
);
-- Llamador anterior: sin p_deposito (4 argumentos posicionales) → depósito por defecto.
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 4,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'))$$,
  'los llamadores anteriores de registrar_movimiento_stock siguen funcionando'
);

reset role;

select is(
  (select cantidad from dominio.existencias_deposito where deposito_id = 'b1000000-0000-0000-0000-000000000001'),
  5, 'la entrada con p_deposito suma en ese depósito'
);
select is(
  (select x.cantidad from dominio.existencias_deposito x join dominio.depositos d on d.id = x.deposito_id
    where d.por_defecto and d.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  4, 'sin depósito usa el por defecto'
);
select is(
  (select array_agg(d.nombre order by m.ocurrido_en, m.id) from dominio.movimientos_stock m join dominio.depositos d on d.id = m.deposito_id),
  array['Depósito Sur', 'Depósito principal']::text[], 'el libro guarda deposito_id en cada movimiento'
);
select ok(pg_temp.total_coincide(), 'total = suma por depósito tras las entradas');
select is(
  (select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  9, 'el total único es 9'
);

-- ============================================================================
-- La salida se acota al disponible del depósito (FR-009)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 6,
      (select id from ids where nombre = 'Venta en local' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, current_date,
      'b1000000-0000-0000-0000-000000000001')$$,
  '23514', 'No hay stock suficiente', 'salida de 6 con 5 en el depósito se rechaza aunque otro depósito tenga unidades'
);

reset role;

select is(
  (select count(*)::int from dominio.movimientos_stock), 2, 'el rechazo no deja movimiento'
);
select is(
  (select count(*)::int from public.cola_eventos where tipo = 'stock.actualizado'), 2, 'el rechazo no deja evento'
);
select is(
  (select cantidad from dominio.existencias_deposito where deposito_id = 'b1000000-0000-0000-0000-000000000001'),
  5, 'el rechazo no cambia la cantidad del depósito'
);

-- Reservado 3 sobre cantidad 5 en «Depósito Sur» (lo escribirá F-STK-16; acá se arma el estado).
update dominio.existencias_deposito set reservado = 3 where deposito_id = 'b1000000-0000-0000-0000-000000000001';
update dominio.existencias set reservado = 3 where producto_id = 'a1000000-0000-0000-0000-000000000001';

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 3,
      (select id from ids where nombre = 'Venta en local' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, current_date,
      'b1000000-0000-0000-0000-000000000001')$$,
  '23514', 'No hay stock suficiente', 'salida de 3 con reservado 3 sobre cantidad 5 se rechaza (disponible 2)'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'ajuste', 2,
      (select id from ids where nombre = 'Conteo de inventario' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, current_date,
      'b1000000-0000-0000-0000-000000000001')$$,
  '23514', 'No hay stock suficiente', 'un ajuste por debajo de lo reservado se rechaza'
);
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 2,
      (select id from ids where nombre = 'Venta en local' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, current_date,
      'b1000000-0000-0000-0000-000000000001')$$,
  'salida de 2 (el disponible) se acepta'
);
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'ajuste', 6,
      (select id from ids where nombre = 'Conteo de inventario' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, current_date,
      'b1000000-0000-0000-0000-000000000001')$$,
  'ajuste al stock contado del depósito (6) se acepta'
);

reset role;

select is(
  (select diferencia from dominio.movimientos_stock where tipo = 'ajuste'),
  3, 'el ajuste calcula la diferencia contra el stock del depósito (3 → 6)'
);
select ok(pg_temp.total_coincide(), 'total y reservado = suma por depósito tras salidas y ajustes');

-- ============================================================================
-- stock.actualizado con depósito, reservado y disponible (FR-013)
-- ============================================================================

select is(
  (select count(*)::int from public.cola_eventos where tipo = 'stock.actualizado'),
  (select count(*)::int from dominio.movimientos_stock),
  'se emite un stock.actualizado por movimiento'
);
select is(
  (select carga->>'deposito_id' from public.cola_eventos c
    where c.tipo = 'stock.actualizado'
      and c.clave_idempotencia = (select id::text from dominio.movimientos_stock where tipo = 'ajuste')),
  'b1000000-0000-0000-0000-000000000001', 'el evento informa el depósito del movimiento'
);
select is(
  (select (carga->>'reservado')::int from public.cola_eventos c
    where c.tipo = 'stock.actualizado'
      and c.clave_idempotencia = (select id::text from dominio.movimientos_stock where tipo = 'ajuste')),
  3, 'el evento informa el reservado total'
);
select is(
  (select (carga->>'disponible')::int from public.cola_eventos c
    where c.tipo = 'stock.actualizado'
      and c.clave_idempotencia = (select id::text from dominio.movimientos_stock where tipo = 'ajuste')),
  7, 'el evento informa el disponible total (10 − 3)'
);
select is(
  (select (carga->>'cantidad')::int from public.cola_eventos c
    where c.tipo = 'stock.actualizado'
      and c.clave_idempotencia = (select id::text from dominio.movimientos_stock where tipo = 'ajuste')),
  10, 'cantidad sigue siendo el stock total único (compatibilidad)'
);

-- ============================================================================
-- Un depósito de otra organización no sirve
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'), null, current_date,
      (select id from deposito_ajeno))$$,
  '22023', 'No encontramos ese depósito', 'no admite un depósito de otra organización'
);

select * from finish();

rollback;
