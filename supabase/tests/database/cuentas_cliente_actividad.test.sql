-- F-CLI-05 (MSF-422, épica MSF-237): eventos de Actividad de la cuenta web. Cubre FR-016: crear, suspender,
-- reactivar y restablecer dejan un evento con actor, cliente y tienda, en la misma transacción que la operación;
-- las repeticiones idempotentes no duplican eventos y el detalle no lleva el correo.
begin;

select plan(9);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f3000000-0000-0000-0000-0000000000a1', 'cliente-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho');
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'sanjavucho.ejemplo.com');
insert into clientes (id, organizacion_id, numero, nombre, correo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'norte@example.com');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Crear (la Edge Function llama como service_role con el actor del operador).
set local role service_role;
select public.vincular_cuenta_cliente(
  'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-0000000000a1', 'f3000000-0000-0000-0000-000000000001');
-- Reintento idempotente: no duplica el evento.
select public.vincular_cuenta_cliente(
  'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-0000000000a1', 'f3000000-0000-0000-0000-000000000001');
reset role;

select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.cuenta_creada'),
  1,
  'crear deja un solo evento cliente.cuenta_creada (el reintento no duplica)'
);

select is(
  (select actor_id::text || '|' || empresa_id::text from registro_actividad where tipo = 'cliente.cuenta_creada'),
  'f3000000-0000-0000-0000-000000000001|a1000000-0000-0000-0000-000000000001',
  'el evento de alta lleva el actor y la tienda'
);

select is(
  (select detalle from registro_actividad where tipo = 'cliente.cuenta_creada'),
  'Creó la cuenta web del cliente Nº 10 · Distribuidora Norte en San Javucho',
  'el detalle nombra cliente y tienda'
);

select pg_temp.como('f3000000-0000-0000-0000-000000000001');
select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'suspendida');
select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'suspendida');
select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'activa');
select public.registrar_restablecimiento_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001');
reset role;

select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.cuenta_suspendida'),
  1,
  'suspender deja un evento (la repetición idempotente no duplica)'
);

select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.cuenta_reactivada'),
  1,
  'reactivar deja un evento'
);

select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.cuenta_restablecida'),
  1,
  'restablecer deja un evento'
);

select is(
  (select count(*)::int from registro_actividad
    where tipo like 'cliente.cuenta\_%'
      and actor_id = 'f3000000-0000-0000-0000-000000000001'
      and empresa_id = 'a1000000-0000-0000-0000-000000000001'),
  4,
  'los cuatro eventos llevan el actor del operador y la tienda'
);

select is(
  (select count(*)::int from registro_actividad where tipo like 'cliente.cuenta\_%' and detalle like '%@%'),
  0,
  'ningún detalle lleva el correo'
);

-- Misma transacción: si la operación se deshace, el evento también.
savepoint antes;
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
select public.cambiar_estado_cuenta_cliente('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'suspendida');
rollback to savepoint antes;
select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.cuenta_suspendida'),
  1,
  'al deshacer la operación se deshace también su evento (misma transacción)'
);

select * from finish();

rollback;
