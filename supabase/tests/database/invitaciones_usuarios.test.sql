-- F-USR-01 (MSF-211, épica MSF-125): invitar usuarios.
-- Cubre los escenarios 3 (vencimiento), 4 (reenvío y cancelación), 7 (una sola
-- organización), 8 (rechazo en base a quien no gestiona usuarios) y 9 (evento
-- usuario.invitado), más FR-016 (RLS y aislamiento entre organizaciones).
-- Corre como postgres para armar el fixture y como "authenticated"
-- (request.jwt.claims, igual que PostgREST) para verificar.
begin;

select plan(33);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('c2000000-0000-0000-0000-000000000002', 'persona-de-dos@example.com'),
  ('c9000000-0000-0000-0000-000000000001', 'invitada@example.com'),
  ('c9000000-0000-0000-0000-000000000002', 'vencida@example.com'),
  ('c9000000-0000-0000-0000-000000000003', 'cancelada@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador'),
  ('c2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'operador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura (FR-016)
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'public.invitaciones_organizacion'::regclass),
  true, 'invitaciones_organizacion tiene RLS activa'
);
select ok(
  not has_table_privilege('anon', 'public.invitaciones_organizacion', 'select'),
  'anon no lee invitaciones_organizacion'
);
select ok(
  not has_table_privilege('authenticated', 'public.invitaciones_organizacion', 'insert, update, delete'),
  'authenticated no escribe invitaciones_organizacion directo (solo por RPC)'
);

-- ============================================================================
-- Invitar: solo quien gestiona usuarios, solo los seis roles
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.registrar_invitacion('nueva@example.com', 'consulta')$$,
  '42501', null, 'un Operador no puede invitar (rechazado en la base)'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.registrar_invitacion('nueva@example.com', 'miembro')$$,
  '22023', null, 'el rol legado miembro no es invitable'
);
select throws_ok(
  $$select public.registrar_invitacion('nueva@example.com', 'inexistente')$$,
  '22023', null, 'un rol inexistente se rechaza'
);
select throws_ok(
  $$select public.registrar_invitacion('no-es-un-correo', 'consulta')$$,
  '22023', null, 'un correo inválido se rechaza'
);
select throws_ok(
  $$select public.registrar_invitacion('persona-de-dos@example.com', 'consulta')$$,
  '23505', null, 'un correo que ya pertenece a otra organización se rechaza (escenario 7)'
);

select lives_ok(
  $$select public.registrar_invitacion('  Invitada@Example.com ', 'mostrador')$$,
  'el Administrador invita con cualquiera de los seis roles'
);

select is(
  (select estado || '/' || rol_id || '/' || email from public.invitaciones_organizacion),
  'pendiente/mostrador/invitada@example.com', 'la invitación queda pendiente, con el rol y el correo normalizado'
);
select ok(
  (select vence_en between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute'
     from public.invitaciones_organizacion),
  'la invitación vence a los 7 días'
);

-- Reenviar sobre una pendiente no duplica y renueva el vencimiento (escenario 4).
reset role;
update public.invitaciones_organizacion set vence_en = now() + interval '1 day';
select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.registrar_invitacion('invitada@example.com', 'deposito')$$,
  'reenviar una invitación pendiente es válido'
);
select is(
  (select count(*)::int from public.invitaciones_organizacion where email = 'invitada@example.com'),
  1, 'reenviar no duplica la invitación'
);
select is(
  (select rol_id from public.invitaciones_organizacion where email = 'invitada@example.com'),
  'deposito', 'reenviar permite corregir el rol'
);
select ok(
  (select vence_en > now() + interval '6 days' from public.invitaciones_organizacion where email = 'invitada@example.com'),
  'reenviar renueva el vencimiento a 7 días'
);

-- ============================================================================
-- Vincular la cuenta de Auth y evento usuario.invitado (escenario 9)
-- ============================================================================

select lives_ok(
  $$select public.vincular_invitacion(
      (select id from public.invitaciones_organizacion where email = 'invitada@example.com'),
      'c9000000-0000-0000-0000-000000000001', 'invitacion_enviada')$$,
  'se vincula la cuenta de Auth a la invitación'
);
select is(
  (select count(*)::int from public.eventos_membresia
    where target_user_id = 'c9000000-0000-0000-0000-000000000001' and accion = 'invitacion_enviada'),
  1, 'se emite el evento usuario.invitado (invitacion_enviada)'
);
select is(
  (select count(*)::int from public.usuarios_organizacion where user_id = 'c9000000-0000-0000-0000-000000000001'),
  0, 'invitar no crea la membresía: la persona sigue sin acceso hasta aceptar'
);
select throws_ok(
  $$select public.vincular_invitacion(gen_random_uuid(), 'c9000000-0000-0000-0000-000000000001', 'invitacion_enviada')$$,
  'P0002', null, 'vincular una invitación inexistente se rechaza'
);

-- ============================================================================
-- Aceptar (lado de la persona invitada)
-- ============================================================================

select pg_temp.como('c9000000-0000-0000-0000-000000000001');
select is(
  (select rol_id from public.mi_invitacion()),
  'deposito', 'la persona invitada ve con qué rol fue invitada'
);
select is(public.aceptar_invitacion(), 'deposito', 'aceptar devuelve el rol invitado');
select is(
  (select rol_id from public.usuarios_organizacion where user_id = 'c9000000-0000-0000-0000-000000000001'),
  'deposito', 'al aceptar queda activa en la organización con el rol invitado'
);
select is(public.aceptar_invitacion(), null, 'aceptar dos veces es idempotente (sin invitación pendiente)');

-- ============================================================================
-- Vencimiento (escenario 3)
-- ============================================================================

reset role;
insert into public.invitaciones_organizacion (organizacion_id, email, rol_id, auth_user_id, vence_en)
values ('11111111-1111-1111-1111-111111111111', 'vencida@example.com', 'consulta',
        'c9000000-0000-0000-0000-000000000002', now() - interval '1 second');

select pg_temp.como('c9000000-0000-0000-0000-000000000002');
select is((select vencida from public.mi_invitacion()), true, 'una invitación pasada de fecha figura como vencida');
select throws_ok($$select public.aceptar_invitacion()$$, 'P0001', null, 'aceptar una invitación vencida se rechaza');
select is(
  (select count(*)::int from public.usuarios_organizacion where user_id = 'c9000000-0000-0000-0000-000000000002'),
  0, 'la invitación vencida no deja acceso'
);

-- ============================================================================
-- Cancelación (escenario 4)
-- ============================================================================

reset role;
insert into public.invitaciones_organizacion (organizacion_id, email, rol_id, auth_user_id)
values ('11111111-1111-1111-1111-111111111111', 'cancelada@example.com', 'consulta',
        'c9000000-0000-0000-0000-000000000003');

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.cancelar_invitacion('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'un no-Administrador no puede cancelar'
);

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cancelar_invitacion(
      (select id from public.invitaciones_organizacion where email = 'cancelada@example.com'))$$,
  'P0002', null, 'cancelar una invitación de otra organización se rechaza'
);

reset role;
select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.cancelar_invitacion((select id from public.invitaciones_organizacion where email = 'cancelada@example.com')),
  'c9000000-0000-0000-0000-000000000003'::uuid,
  'cancelar devuelve la cuenta de Auth sin uso para invalidar el enlace'
);
select is(
  (select estado from public.invitaciones_organizacion where email = 'cancelada@example.com'),
  'cancelada', 'la invitación queda cancelada'
);
select pg_temp.como('c9000000-0000-0000-0000-000000000003');
select is(public.aceptar_invitacion(), null, 'una invitación cancelada no se puede aceptar');

-- ============================================================================
-- Aislamiento entre organizaciones (FR-016)
-- ============================================================================

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.invitaciones_organizacion),
  0, 'el Administrador de otra organización no ve las invitaciones ajenas'
);
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.invitaciones_organizacion),
  0, 'un usuario sin gestión de usuarios no lee invitaciones'
);

select * from finish();
rollback;
