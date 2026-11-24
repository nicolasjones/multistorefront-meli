-- Lote 38: la toma de inventario elige el depósito (`confirmar_toma_inventario(p_items, p_fecha, p_deposito_id)`).
-- Cubre: depósito elegido distinto del principal (ajusta solo ese), null = principal, depósito de otra organización,
-- depósito inactivo, depósito inexistente, rol sin edición, anon, y que la firma de dos parámetros sigue operando sobre el principal.
begin;

select plan(14);

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
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 50);

-- Depósitos: el principal ya existe por la siembra de la organización; se agregan uno activo, uno inactivo y uno ajeno.
insert into dominio.depositos (id, organizacion_id, nombre, activo, por_defecto) values
  ('d0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Norte', true, false),
  ('d0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Cerrado', false, false),
  ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Ajeno', true, false);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

-- Depósito elegido: ajusta el Norte y deja el principal intacto.
select is(
  (select diferencia from public.confirmar_toma_inventario(
     '[{"producto":"a1000000-0000-0000-0000-000000000001","contado":6}]'::jsonb, current_date, 'd0000000-0000-0000-0000-0000000000a1')),
  6, 'con depósito elegido ajusta ese depósito (0 → 6)');
reset role;
select is(
  (select cantidad from dominio.existencias_deposito
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and deposito_id = 'd0000000-0000-0000-0000-0000000000a1'),
  6, 'el depósito elegido quedó en lo contado');
select is(
  (select coalesce(sum(cantidad), 0)::int from dominio.existencias_deposito x
    join dominio.depositos d on d.id = x.deposito_id and d.por_defecto
    where x.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'el depósito principal no se tocó');
select is(
  (select deposito_id from dominio.movimientos_stock where producto_id = 'a1000000-0000-0000-0000-000000000001' order by creado_en desc limit 1),
  'd0000000-0000-0000-0000-0000000000a1'::uuid, 'el movimiento de ajuste queda en el depósito elegido');

-- Sin depósito (null): principal.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select diferencia from public.confirmar_toma_inventario(
     '[{"producto":"a1000000-0000-0000-0000-000000000001","contado":3}]'::jsonb, current_date, null)),
  3, 'p_deposito_id null opera sobre el principal (0 → 3)');
-- Firma de dos parámetros: también el principal (3 → 4).
select is(
  (select diferencia from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000001","contado":4}]'::jsonb)),
  1, 'la firma de dos parámetros sigue operando sobre el principal');

select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000001","contado":1}]'::jsonb, current_date, 'd0000000-0000-0000-0000-0000000000b1')$$,
  '22023', 'No encontramos ese depósito', 'un depósito de otra organización se rechaza');
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000001","contado":1}]'::jsonb, current_date, 'd0000000-0000-0000-0000-0000000000ff')$$,
  '22023', 'No encontramos ese depósito', 'un depósito inexistente se rechaza');
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000001","contado":1}]'::jsonb, current_date, 'd0000000-0000-0000-0000-0000000000a2')$$,
  '22023', 'El depósito está inactivo y no admite movimientos', 'un depósito inactivo se rechaza');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.confirmar_toma_inventario('[{"producto":"a1000000-0000-0000-0000-000000000001","contado":1}]'::jsonb, current_date, 'd0000000-0000-0000-0000-0000000000a1')$$,
  '42501', 'Tu rol no puede registrar movimientos de stock', 'un rol de solo lectura no confirma tomas');

reset role;
select is(has_function_privilege('anon', 'public.confirmar_toma_inventario(jsonb,date,uuid)', 'EXECUTE'), false, 'anon no ejecuta la firma con depósito');
select is(has_function_privilege('anon', 'public.confirmar_toma_inventario(jsonb,date)', 'EXECUTE'), false, 'anon no ejecuta la firma de dos parámetros');
select is(has_function_privilege('authenticated', 'public.confirmar_toma_inventario(jsonb,date,uuid)', 'EXECUTE'), true, 'authenticated ejecuta la firma con depósito');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.confirmar_toma_inventario(jsonb,date,uuid)'::regprocedure),
  true, 'la firma con depósito es security definer con search_path vacío');

select * from finish();
rollback;
