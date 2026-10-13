-- F-USR-01 (MSF-211): endurecimiento tras la revisión del PR #34.
-- Cubre: `p_user_id` que no corresponde al correo invitado, agregar directo
-- (`miembro_agregado`), aceptar siendo miembro de otra organización o con una
-- cuenta de otro correo, una sola invitación pendiente por cuenta de Auth,
-- mensaje de error que no revela la organización y auditoría que sobrevive al
-- borrado de la cuenta de Auth (FR-012, Principio III).
begin;

select plan(22);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email, last_sign_in_at, email_confirmed_at) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com', now(), now()),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com', now(), now()),
  ('d2000000-0000-0000-0000-000000000002', 'persona-de-dos@example.com', now(), now()),
  ('d9000000-0000-0000-0000-000000000001', 'ingresada@example.com', now(), now()),
  ('d9000000-0000-0000-0000-000000000005', 'sinconfirmar@example.com', now(), null),
  ('d9000000-0000-0000-0000-000000000002', 'pendiente@example.com', null, null),
  ('d9000000-0000-0000-0000-000000000003', 'otra@example.com', null, null),
  ('d9000000-0000-0000-0000-000000000004', 'cancelable@example.com', null, null);

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador'),
  ('d2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'operador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Mensaje genérico: no revela en qué organización está la persona
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.registrar_invitacion('persona-de-dos@example.com', 'consulta')$$,
  '23505', 'No se puede invitar a ese correo', 'invitar a alguien de otra organización no revela dónde está'
);

select lives_ok($$select public.registrar_invitacion('ingresada@example.com', 'consulta')$$, 'se invita a una cuenta que ya ingresó');
select lives_ok($$select public.registrar_invitacion('pendiente@example.com', 'operador')$$, 'se invita a una cuenta que nunca ingresó');
select lives_ok($$select public.registrar_invitacion('cancelable@example.com', 'consulta')$$, 'se invita a una cuenta para cancelarla luego');

-- ============================================================================
-- vincular_invitacion no confía en p_user_id
-- ============================================================================

select throws_ok(
  $$select public.vincular_invitacion(
      (select id from public.invitaciones_organizacion where email = 'ingresada@example.com'),
      'd9000000-0000-0000-0000-000000000003', 'invitacion_enviada')$$,
  '22023', null, 'vincular una cuenta que no tiene el correo invitado se rechaza'
);
select throws_ok(
  $$select public.vincular_invitacion(
      (select id from public.invitaciones_organizacion where email = 'pendiente@example.com'),
      'd9000000-0000-0000-0000-000000000002', 'miembro_agregado')$$,
  '22023', null, 'agregar directo a una cuenta que nunca ingresó se rechaza (debe aceptar la invitación)'
);

select lives_ok(
  $$select public.vincular_invitacion(
      (select id from public.invitaciones_organizacion where email = 'ingresada@example.com'),
      'd9000000-0000-0000-0000-000000000001', 'miembro_agregado')$$,
  'una cuenta que ya ingresó, con el correo invitado y sin organización, se agrega directo'
);
select is(
  (select rol_id from public.usuarios_organizacion where user_id = 'd9000000-0000-0000-0000-000000000001'),
  'consulta', 'quien se agrega directo queda con el rol invitado'
);
select is(
  (select estado from public.invitaciones_organizacion where email = 'ingresada@example.com'),
  'aceptada', 'agregar directo deja la invitación aceptada'
);
-- eventos_membresia no tiene policy de select: se lee como postgres.
reset role;
select is(
  (select count(*)::int from public.eventos_membresia
    where target_email = 'ingresada@example.com' and accion = 'miembro_agregado'),
  1, 'agregar directo emite el evento con el correo destino'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.registrar_invitacion('sinconfirmar@example.com', 'consulta');
select throws_ok(
  $$select public.vincular_invitacion(
      (select id from public.invitaciones_organizacion where email = 'sinconfirmar@example.com'),
      'd9000000-0000-0000-0000-000000000005', 'miembro_agregado')$$,
  '22023', null, 'agregar directo exige correo confirmado'
);

-- Una cuenta que ya pertenece a otra organización no se vincula aunque el correo coincida.
reset role;
insert into public.invitaciones_organizacion (organizacion_id, email, rol_id)
values ('11111111-1111-1111-1111-111111111111', 'persona-de-dos@example.com', 'consulta');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.vincular_invitacion(
      (select id from public.invitaciones_organizacion where email = 'persona-de-dos@example.com'),
      'd2000000-0000-0000-0000-000000000002', 'invitacion_enviada')$$,
  '23505', null, 'vincular a alguien que ya pertenece a otra organización se rechaza'
);

-- ============================================================================
-- aceptar_invitacion
-- ============================================================================

-- Alguien que ya pertenece a otra organización no puede aceptar.
reset role;
update public.invitaciones_organizacion set auth_user_id = 'd2000000-0000-0000-0000-000000000002'
  where email = 'persona-de-dos@example.com';
select pg_temp.como('d2000000-0000-0000-0000-000000000002');
select throws_ok($$select public.aceptar_invitacion()$$, '23505', null, 'aceptar siendo miembro de otra organización se rechaza');

-- Una cuenta de otro correo no acepta una invitación que no es suya.
reset role;
insert into public.invitaciones_organizacion (organizacion_id, email, rol_id, auth_user_id)
values ('11111111-1111-1111-1111-111111111111', 'mismatch@example.com', 'administrador',
        'd9000000-0000-0000-0000-000000000003');
select pg_temp.como('d9000000-0000-0000-0000-000000000003');
select throws_ok($$select public.aceptar_invitacion()$$, 'P0002', null, 'una cuenta con otro correo no puede aceptar la invitación');
select is((select count(*)::int from public.mi_invitacion()), 0, 'una cuenta con otro correo no ve la invitación');

-- Una cuenta de Auth pertenece a una sola invitación pendiente.
reset role;
select throws_ok(
  $$insert into public.invitaciones_organizacion (organizacion_id, email, rol_id, auth_user_id)
    values ('22222222-2222-2222-2222-222222222222', 'otra@example.com', 'consulta', 'd9000000-0000-0000-0000-000000000003')$$,
  '23505', null, 'una cuenta de Auth no puede estar en dos invitaciones pendientes'
);

-- ============================================================================
-- Auditoría que sobrevive al borrado de la cuenta de Auth
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.vincular_invitacion(
      (select id from public.invitaciones_organizacion where email = 'cancelable@example.com'),
      'd9000000-0000-0000-0000-000000000004', 'invitacion_enviada')$$,
  'se vincula la cuenta a invitar y se emite invitacion_enviada'
);
select is(
  public.cancelar_invitacion((select id from public.invitaciones_organizacion where email = 'cancelable@example.com')),
  'd9000000-0000-0000-0000-000000000004'::uuid,
  'cancelar devuelve la cuenta sin uso para borrarla'
);
reset role;
select is(
  (select count(*)::int from public.eventos_membresia
    where target_email = 'cancelable@example.com' and accion = 'invitacion_cancelada'),
  1, 'cancelar emite el evento invitacion_cancelada'
);

reset role;
select lives_ok(
  $$delete from auth.users where id = 'd9000000-0000-0000-0000-000000000004'$$,
  'se borra la cuenta de Auth de la invitación cancelada'
);
select is(
  (select count(*)::int from public.eventos_membresia where target_email = 'cancelable@example.com'),
  2, 'los eventos de la invitación sobreviven al borrado de la cuenta'
);
select is(
  (select count(*)::int from public.eventos_membresia
    where target_email = 'cancelable@example.com' and target_user_id is null),
  2, 'los eventos quedan con target_user_id nulo y el correo como identidad'
);

select * from finish();
rollback;
