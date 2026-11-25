-- Lote 59 (MSF-654, MSF-655): las RPC de formas de envío, transportes, contrarreembolsos y envíos en moto contestan `PT404`
-- (HTTP 404) cuando el dato no existe o es de otra organización y `PT412` (HTTP 412) ante un conflicto de edición, con el
-- mismo mensaje de negocio de siempre.
begin;

select plan(8);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'Retiro en local', 'retiro_local');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

-- «No existe»: PT404 con el mismo mensaje
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.actualizar_forma_envio('ffffffff-0000-0000-0000-000000000000', now(), 'Otro nombre', 'retiro_local', false, 0, 'sin_armar', 3, true)$$, 'PT404', 'La forma de envío no existe', 'actualizar_forma_envio: una forma inexistente responde 404');
select throws_ok($$select public.cambiar_estado_forma_envio('ffffffff-0000-0000-0000-000000000000', false)$$, 'PT404', 'La forma de envío no existe', 'cambiar_estado_forma_envio: una forma inexistente responde 404');
select throws_ok($$select public.actualizar_transporte('ffffffff-0000-0000-0000-000000000000', now(), 'Expreso Ejemplo del Sur', 'expreso', '20123456786', 'Terminal Sur, Rosario', 'Rosario', '0341 000-0000', 'cobranzas@expreso.example', 'Ana', 'Calle 1 100', true, 2.5, 7, 1, true, array[]::uuid[])$$, 'PT404', 'El transporte no existe', 'actualizar_transporte: un transporte inexistente responde 404');
select throws_ok($$select public.cambiar_estado_transporte('ffffffff-0000-0000-0000-000000000000', false)$$, 'PT404', 'El transporte no existe', 'cambiar_estado_transporte: un transporte inexistente responde 404');
select throws_ok($$select public.marcar_contrarreembolso_cobrado('ffffffff-0000-0000-0000-000000000000', now())$$, 'PT404', 'El contrarreembolso no existe', 'marcar_contrarreembolso_cobrado: un contrarreembolso inexistente responde 404');

-- Una forma de otra organización no existe para quien pregunta.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.cambiar_estado_forma_envio('b1000000-0000-0000-0000-00000000000a', false)$$, 'PT404', 'La forma de envío no existe', 'cambiar_estado_forma_envio: otra organización recibe 404');

-- Conflicto de edición: PT412
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.actualizar_forma_envio('b1000000-0000-0000-0000-00000000000a', '2000-01-01T00:00:00Z', 'Otro nombre', 'retiro_local', false, 0, 'sin_armar', 3, true)$$, 'PT412', 'La forma de envío fue modificada por otra persona', 'actualizar_forma_envio: una versión vieja es un conflicto (412)');
select throws_ok($$select public.marcar_contrarreembolso_cobrado('ffffffff-0000-0000-0000-000000000000', null)$$, 'PT404', 'El contrarreembolso no existe', 'marcar_contrarreembolso_cobrado: sin versión y sin fila sigue siendo 404');

select * from finish();
rollback;
