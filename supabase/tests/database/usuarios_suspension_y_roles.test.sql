-- F-USR-02 (MSF-228, épica MSF-125): listado, cambio de rol, suspensión y
-- reactivación. Cubre FR-011, FR-012, FR-018, SC-003 y los escenarios 6, 7 y 8:
-- un suspendido pierde el acceso en la base de datos, reactivar lo restituye,
-- el último Administrador activo está protegido y solo un Administrador de la
-- misma organización puede operar.
begin;

select plan(34);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'admin-dos@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'operador@example.com'),
  ('c1000000-0000-0000-0000-000000000004', 'consulta@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-otra-org@example.com'),
  ('c2000000-0000-0000-0000-000000000002', 'operador-otra-org@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador'),
  ('c2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'operador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estado y listado (FR-011)
-- ============================================================================

select is(
  (select estado from usuarios_organizacion where user_id = 'c1000000-0000-0000-0000-000000000003'),
  'activo', 'una membresía nueva nace activa'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_usuarios_organizacion()),
  4, 'el Administrador lista solo a las 4 personas de su organización (incluye el estado)'
);
select is(
  (select estado from public.listar_usuarios_organizacion() where user_id = 'c1000000-0000-0000-0000-000000000003'),
  'activo', 'el listado informa el estado'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.listar_usuarios_organizacion()),
  0, 'quien no administra membresías no obtiene el listado (escenario 8)'
);

-- ============================================================================
-- Cambio de rol a cualquiera de los seis roles (FR-011, FR-012)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  (select rol_id from public.cambiar_rol_miembro('c1000000-0000-0000-0000-000000000003', 'deposito')),
  'deposito', 'el Administrador cambia el rol a uno de los seis roles de negocio'
);
reset role;
select is(
  (select count(*)::int from eventos_membresia
    where target_user_id = 'c1000000-0000-0000-0000-000000000003'
      and accion = 'rol_cambiado' and rol_anterior = 'operador' and rol_nuevo = 'deposito'),
  1, 'el cambio de rol emite usuario.rol_cambiado'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cambiar_rol_miembro('c1000000-0000-0000-0000-000000000003', 'inexistente')$$,
  '22023', 'Rol inválido', 'un rol que no existe se rechaza'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.cambiar_rol_miembro('c1000000-0000-0000-0000-000000000003', 'consulta')$$,
  '42501', null, 'un no Administrador no puede cambiar roles (escenario 8)'
);

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cambiar_rol_miembro('c1000000-0000-0000-0000-000000000003', 'consulta')$$,
  '42501', null, 'un Administrador de otra organización no puede cambiar roles'
);

-- ============================================================================
-- Suspensión: pierde el acceso en la base de datos (SC-003, escenario 6)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select isnt(
  (select private.nivel_seccion('stock')), 'ninguno', 'antes de suspenderlo, el depósito tiene acceso a Stock'
);
select isnt((select private.organizacion_id()), null, 'antes de suspenderlo, resuelve su organización');

select pg_temp.como('c1000000-0000-0000-0000-000000000004');
select throws_ok(
  $$select public.suspender_miembro('c1000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'un no Administrador no puede suspender'
);

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.suspender_miembro('c1000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'un Administrador de otra organización no puede suspender'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  (select estado from public.suspender_miembro('c1000000-0000-0000-0000-000000000003')),
  'suspendido', 'el Administrador suspende a un usuario'
);
select throws_ok(
  $$select public.suspender_miembro('c1000000-0000-0000-0000-000000000003')$$,
  '22023', null, 'suspender a quien ya está suspendido se rechaza'
);
select throws_ok(
  $$select public.suspender_miembro('c1000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'nadie puede suspenderse a sí mismo'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is((select private.nivel_seccion('stock')), 'ninguno', 'el suspendido no tiene nivel en ninguna sección');
select is((select private.organizacion_id()), null, 'el suspendido no resuelve organización (RLS lo deja sin datos)');
select is((select private.puede_accion('stock', 'exportar')), false, 'el suspendido no puede ninguna acción');

reset role;
select is(
  (select count(*)::int from eventos_membresia
    where target_user_id = 'c1000000-0000-0000-0000-000000000003' and accion = 'suspendido'),
  1, 'la suspensión emite usuario.suspendido'
);

-- ============================================================================
-- Reactivación restituye el acceso
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  (select estado from public.reactivar_miembro('c1000000-0000-0000-0000-000000000003')),
  'activo', 'el Administrador reactiva a un usuario suspendido'
);
select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select isnt((select private.nivel_seccion('stock')), 'ninguno', 'reactivar restituye el acceso');

reset role;
select is(
  (select count(*)::int from eventos_membresia
    where target_user_id = 'c1000000-0000-0000-0000-000000000003' and accion = 'reactivado'),
  1, 'la reactivación emite usuario.reactivado'
);

-- ============================================================================
-- Último Administrador activo protegido (escenario 7)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.suspender_miembro('c1000000-0000-0000-0000-000000000002')$$,
  'se puede suspender a un Administrador mientras quede otro activo'
);

-- Un Administrador activo siempre es "otro" para el objetivo, así que la regla
-- solo se puede forzar con un superadmin (que no cuenta como Administrador de
-- la organización) operando sobre la organización Dos, con un único Administrador.
reset role;
insert into auth.users (id, email) values ('c9000000-0000-0000-0000-000000000009', 'super@example.com');
insert into superadmins (user_id) values ('c9000000-0000-0000-0000-000000000009');
insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('c9000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222');

select pg_temp.como('c9000000-0000-0000-0000-000000000009');
select throws_ok(
  $$select public.suspender_miembro('c2000000-0000-0000-0000-000000000001')$$,
  '23514', 'La organización debe conservar al menos un administrador',
  'no se suspende al último Administrador activo (escenario 7)'
);
select throws_ok(
  $$select public.cambiar_rol_miembro('c2000000-0000-0000-0000-000000000001', 'consulta')$$,
  '23514', 'La organización debe conservar al menos un administrador',
  'no se degrada al último Administrador activo (escenario 7)'
);

-- ============================================================================
-- Un Administrador suspendido pierde la gestión de membresías (migración 140300)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  (select es_propio from public.listar_usuarios_organizacion() where user_id = 'c1000000-0000-0000-0000-000000000001'),
  true, 'el listado marca la fila propia'
);
select is(
  (select email from public.listar_usuarios_organizacion() where user_id = 'c1000000-0000-0000-0000-000000000003'),
  'operador@example.com', 'el listado informa el correo para restablecer la contraseña'
);
select throws_ok(
  $$select public.suspender_miembro('c1000000-0000-0000-0000-00000000dead')$$,
  '42501', null, 'un objetivo inexistente responde igual que uno ajeno (sin sondeo de UUID)'
);

-- admin-dos quedó suspendido más arriba.
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is(
  (select private.puede_gestionar_membresias('11111111-1111-1111-1111-111111111111')),
  false, 'un Administrador suspendido no gestiona membresías'
);
select throws_ok(
  $$select public.suspender_miembro('c1000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'un Administrador suspendido no puede suspender'
);
select throws_ok(
  $$select public.cambiar_rol_miembro('c1000000-0000-0000-0000-000000000004', 'operador')$$,
  '42501', null, 'un Administrador suspendido no puede cambiar roles'
);

-- remover_miembro cuenta solo Administradores activos.
reset role;
insert into auth.users (id, email) values ('c2000000-0000-0000-0000-000000000003', 'admin-suspendido-otra-org@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'administrador', 'suspendido');

select pg_temp.como('c9000000-0000-0000-0000-000000000009');
select throws_ok(
  $$select public.remover_miembro('c2000000-0000-0000-0000-000000000001')$$,
  '23514', 'La organización debe conservar al menos un administrador',
  'no se remueve al último Administrador activo aunque haya otro suspendido (escenario 7)'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.remover_miembro('c1000000-0000-0000-0000-000000000002')$$,
  'se puede remover a un Administrador suspendido: no era el que sostiene la organización'
);

select * from finish();
rollback;
