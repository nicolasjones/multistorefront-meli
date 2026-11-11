-- F-STK-15 (MSF-353, épica MSF-292): traslado de stock entre depósitos.
-- Cubre FR-020, FR-021, FR-022 y FR-023: `trasladar_stock` exige edición en Stock (consulta y
-- anon no), rechaza sin rastro origen = destino, cantidad ≤ 0, depósitos inactivos o de otra
-- organización, fecha futura y cantidad mayor que el disponible del origen (con reservado);
-- un traslado de 4 sobre 10 deja dos movimientos vinculados con el motivo de sistema, el total
-- y el reservado no cambian y no se emite `stock.actualizado`. La concurrencia real (FR-024)
-- la prueba el E2E `stock-traslado-concurrencia.e2e.ts`.
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
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'JOY-1', 50);

-- Cada organización nace con «Depósito principal» (por defecto); se suman «Sur» y uno que luego se desactiva.
insert into dominio.depositos (id, organizacion_id, nombre, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Depósito Sur', true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Depósito Cerrado', true);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create temp table deposito_ajeno on commit drop as
select d.id from dominio.depositos d where d.organizacion_id = '22222222-2222-2222-2222-222222222222';
grant select on deposito_ajeno to authenticated;

create temp table principal on commit drop as
select d.id from dominio.depositos d where d.organizacion_id = '11111111-1111-1111-1111-111111111111' and d.por_defecto;
grant select on principal to authenticated;

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

-- 10 unidades en el depósito principal (cargadas como operador, por la RPC de siempre).
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 10,
      (select id from ids where nombre = 'Compra a proveedor' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      null, current_date, (select id from principal))$$,
  'arranque: 10 unidades en el depósito principal'
);

-- ============================================================================
-- FR-020: permisos y definición de la función
-- ============================================================================

reset role;

select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.trasladar_stock(uuid,uuid,uuid,integer,text,date)'::regprocedure),
  true, 'trasladar_stock es security definer con search_path vacío'
);
select is(has_function_privilege('anon', 'public.trasladar_stock(uuid,uuid,uuid,integer,text,date)', 'EXECUTE'), false, 'anon no puede ejecutar trasladar_stock');
select is(has_function_privilege('authenticated', 'public.trasladar_stock(uuid,uuid,uuid,integer,text,date)', 'EXECUTE'), true, 'authenticated puede ejecutar trasladar_stock');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000001', 1)$$,
  '42501', 'Tu rol no puede trasladar stock', 'un usuario de consulta no puede trasladar'
);
reset role;

-- ============================================================================
-- FR-021: rechazos sin rastro
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), (select id from principal), 1)$$,
  '22023', 'El depósito de origen y el de destino deben ser distintos', 'rechaza origen = destino'
);
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000001', 0)$$,
  '22023', 'La cantidad debe ser un entero mayor a cero', 'rechaza cantidad 0'
);
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000001', -3)$$,
  '22023', 'La cantidad debe ser un entero mayor a cero', 'rechaza cantidad negativa'
);
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000001', 1, null, current_date + 1)$$,
  '22023', 'La fecha no puede ser futura', 'rechaza fecha futura'
);
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), (select id from deposito_ajeno), 1)$$,
  '22023', 'No encontramos el depósito de destino', 'rechaza un destino de otra organización'
);
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from deposito_ajeno), 'b1000000-0000-0000-0000-000000000001', 1)$$,
  '22023', 'No encontramos el depósito de origen', 'rechaza un origen de otra organización'
);
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000001', 11)$$,
  '23514', 'No hay stock suficiente', 'rechaza más que el disponible del origen (11 sobre 10)'
);

reset role;
update dominio.depositos set activo = false where id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000002', 1)$$,
  '22023', 'El depósito de destino está inactivo: elegí otro', 'rechaza un destino inactivo'
);
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 1)$$,
  '22023', 'El depósito de origen está inactivo: elegí otro', 'rechaza un origen inactivo'
);

reset role;

select is((select count(*)::int from dominio.movimientos_stock where traslado_id is not null), 0, 'los rechazos no dejan movimientos de traslado');
select is((select count(*)::int from dominio.movimientos_stock), 1, 'ni otro movimiento (solo la entrada de arranque)');
select is(
  (select count(*)::int from dominio.motivos_movimiento where lower(nombre) = 'traslado entre depósitos'),
  0, 'los rechazos tampoco crean el motivo de sistema'
);
select is((select cantidad from dominio.existencias_deposito where deposito_id = (select id from principal)), 10, 'los rechazos no cambian el depósito de origen');

-- ============================================================================
-- FR-022 / FR-023: traslado 4 de 10 (el total y el reservado no cambian, sin evento)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000001', 4, '  Reposición ')$$,
  'traslado de 4 de 10 al Depósito Sur'
);
reset role;

select is(
  (select string_agg(d.nombre || ':' || x.cantidad, ',' order by d.nombre collate "C")
     from dominio.existencias_deposito x join dominio.depositos d on d.id = x.deposito_id
    where x.producto_id = 'a1000000-0000-0000-0000-000000000001' and x.cantidad > 0),
  'Depósito Sur:4,Depósito principal:6', 'origen queda con 6 y destino con 4'
);
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 10, 'el total sigue en 10');
select is((select reservado from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 0, 'el reservado total no cambia');
select ok(pg_temp.total_coincide(), 'total y reservado = suma por depósito');
select is(
  (select string_agg(m.tipo || '@' || d.nombre || ':' || m.cantidad, ',' order by m.tipo)
     from dominio.movimientos_stock m join dominio.depositos d on d.id = m.deposito_id
    where m.traslado_id is not null),
  'entrada@Depósito Sur:4,salida@Depósito principal:4', 'dos movimientos vinculados: salida en el origen y entrada en el destino'
);
select is(
  (select count(distinct m.traslado_id)::int from dominio.movimientos_stock m where m.traslado_id is not null),
  1, 'comparten el mismo traslado_id'
);
select is(
  (select count(*)::int from dominio.movimientos_stock m
     join dominio.motivos_movimiento mo on mo.id = m.motivo_id
    where m.traslado_id is not null and mo.nombre = 'Traslado entre depósitos' and m.nota = 'Reposición'),
  2, 'ambos llevan el motivo de sistema «Traslado entre depósitos» y la nota normalizada'
);
select is(
  (select count(*)::int from public.cola_eventos where tipo = 'stock.actualizado'),
  1, 'no se emite stock.actualizado por el traslado (solo el de la entrada de arranque)'
);

-- ============================================================================
-- Disponible con reservado: A tiene 6, 3 reservadas → máximo 3
-- ============================================================================

update dominio.existencias_deposito set reservado = 3
 where producto_id = 'a1000000-0000-0000-0000-000000000001' and deposito_id = (select id from principal);
update dominio.existencias set reservado = 3 where producto_id = 'a1000000-0000-0000-0000-000000000001';

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000001', 4)$$,
  '23514', 'No hay stock suficiente', 'con 6 y 3 reservadas no se pueden trasladar 4 (disponible 3)'
);
select lives_ok(
  $$select * from public.trasladar_stock('a1000000-0000-0000-0000-000000000001', (select id from principal), 'b1000000-0000-0000-0000-000000000001', 3)$$,
  'trasladar el disponible (3) se acepta'
);
reset role;

select ok(pg_temp.total_coincide() and (select reservado from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001') = 3, 'el reservado total sigue en 3 y coincide con la suma');

-- Devolución del Revisor: el motivo de sistema no se usa en un movimiento manual (sin traslado_id).
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 1,
      (select id from dominio.motivos_movimiento where nombre = 'Traslado entre depósitos'
         and organizacion_id = '11111111-1111-1111-1111-111111111111'),
      null, current_date, (select id from principal))$$,
  '22023', 'El motivo «Traslado entre depósitos» solo se usa al trasladar stock entre depósitos',
  'un movimiento manual con el motivo de traslado se rechaza'
);
reset role;

select * from finish();

rollback;
