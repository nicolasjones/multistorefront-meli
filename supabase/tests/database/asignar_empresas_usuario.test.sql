-- Asignar empresas y rol por empresa (spec 20261016-140000-permisos-por-empresa, F-ROL-07;
-- FR-015, FR-017, FR-018). El fixture corre como postgres (RLS no aplica) y las
-- verificaciones como authenticated vía request.jwt.claims.
begin;

select plan(36);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'operador1@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'otroadmin1@example.com'),
  ('a1000000-0000-0000-0000-000000000004', 'nuevo1@example.com'),
  ('a1000000-0000-0000-0000-000000000005', 'nuevo2@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Ajena');

-- Administrador: asigna A = Operador y B = Consulta.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002', $$[
    {"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "operador"},
    {"empresa_id": "e1000000-0000-0000-0000-000000000002", "rol_id": "consulta"}
  ]$$::jsonb),
  2, 'asigna dos empresas y devuelve el total'
);
select is(
  (select count(*)::int from public.listar_empresas_usuarios() where user_id = 'a1000000-0000-0000-0000-000000000002'),
  2, 'la lista de Usuarios ve las dos tiendas'
);
select is(
  (select rol_id from public.listar_empresas_usuarios()
    where user_id = 'a1000000-0000-0000-0000-000000000002' and empresa_nombre = 'Mundo JC'),
  'consulta', 'la lista trae el rol por tienda'
);
reset role;

select is(
  (select empresa_id::text from public.usuario_empresa_activa where user_id = 'a1000000-0000-0000-0000-000000000002'),
  'e1000000-0000-0000-0000-000000000002', 'sin activa previa, la primera empresa (por nombre) queda activa'
);
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'usuario.empresas_asignadas'),
  1, 'se registra el evento usuario.empresas_asignadas'
);

-- Reemplazo: una sola empresa; la activa vigente se conserva.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002',
    '[{"empresa_id": "e1000000-0000-0000-0000-000000000002", "rol_id": "mostrador"}]'::jsonb)$$,
  'reemplaza las asignaciones'
);
reset role;
select is(
  (select array_agg(rol_id order by empresa_id) from usuarios_empresas where user_id = 'a1000000-0000-0000-0000-000000000002'),
  array['mostrador'], 'el reemplazo deja solo la nueva asignación'
);
select is(
  (select empresa_id::text from usuario_empresa_activa where user_id = 'a1000000-0000-0000-0000-000000000002'),
  'e1000000-0000-0000-0000-000000000002', 'la activa vigente no se pisa'
);

-- Rechazos: nada cambia (atomicidad).
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002', '[
    {"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "operador"},
    {"empresa_id": "e2000000-0000-0000-0000-000000000001", "rol_id": "operador"}]'::jsonb)$$,
  '42501', null, 'una empresa de otra organización rechaza todo el lote'
);
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002', '[
    {"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "operador"},
    {"empresa_id": "e1000000-0000-0000-0000-000000000002", "rol_id": "administrador"}]'::jsonb)$$,
  '22023', null, 'el rol administrador por empresa se rechaza'
);
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002',
    '[{"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "miembro"}]'::jsonb)$$,
  '22023', null, 'el rol miembro por empresa se rechaza'
);
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002', '[
    {"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "operador"},
    {"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "consulta"}]'::jsonb)$$,
  '22023', null, 'una empresa repetida se rechaza'
);
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002', '{"x": 1}'::jsonb)$$,
  '22023', null, 'un formato que no es lista se rechaza'
);
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000003',
    '[{"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "operador"}]'::jsonb)$$,
  '22023', null, 'al Administrador no se le asignan empresas'
);
select throws_ok(
  $$select public.asignar_empresas_usuario('a2000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'P0002', null, 'un usuario de otra organización no se toca'
);
reset role;
select is(
  (select array_agg(rol_id order by empresa_id) from usuarios_empresas where user_id = 'a1000000-0000-0000-0000-000000000002'),
  array['mostrador'], 'los rechazos no cambian las asignaciones'
);

-- No Administrador: rechazado y sin ver el listado.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002',
    '[{"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "operador"}]'::jsonb)$$,
  '42501', null, 'un no Administrador no asigna'
);
select is((select count(*)::int from public.listar_empresas_usuarios()), 0, 'un no Administrador no ve el listado');
reset role;

-- Administrador de otra organización: no ve ni toca esta.
select set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.listar_empresas_usuarios()), 0, 'otra organización no ve estas asignaciones');
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002', '[]'::jsonb)$$,
  'P0002', null, 'otra organización no asigna a usuarios ajenos'
);
reset role;

-- Quitar todas: vuelve al rol de organización.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002', '[]'::jsonb), 0, 'quitar todas devuelve cero');
reset role;
select is((select count(*)::int from usuarios_empresas where user_id = 'a1000000-0000-0000-0000-000000000002'), 0, 'no quedan asignaciones');
select is((select count(*)::int from usuario_empresa_activa where user_id = 'a1000000-0000-0000-0000-000000000002'), 0, 'sin asignaciones no queda empresa activa');
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'usuario.empresas_asignadas'),
  3, 'cada asignación efectiva registró su evento (los rechazos no)'
);

-- Invitación con asignaciones (FR-017): se guardan y se aplican al aceptar.
insert into invitaciones_organizacion (id, organizacion_id, email, rol_id, auth_user_id)
values ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'nuevo1@example.com', 'consulta', 'a1000000-0000-0000-0000-000000000004');
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$select public.guardar_asignaciones_invitacion('b1000000-0000-0000-0000-000000000001',
    '[{"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "deposito"}]'::jsonb)$$,
  'la invitación guarda las asignaciones'
);
select throws_ok(
  $$select public.guardar_asignaciones_invitacion('b1000000-0000-0000-0000-000000000001',
    '[{"empresa_id": "e2000000-0000-0000-0000-000000000001", "rol_id": "deposito"}]'::jsonb)$$,
  '42501', null, 'la invitación rechaza una empresa ajena'
);
reset role;
select is((select count(*)::int from usuarios_empresas where user_id = 'a1000000-0000-0000-0000-000000000004'), 0, 'antes de aceptar no hay filas');

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(public.aceptar_invitacion(), 'consulta', 'aceptar sigue devolviendo el rol de la invitación');
reset role;
select is(
  (select rol_id from usuarios_empresas where user_id = 'a1000000-0000-0000-0000-000000000004'
    and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'deposito', 'al aceptar se aplican las asignaciones de la invitación'
);

-- Tope de tamaño y jsonb normalizado (sin claves extra).
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.asignar_empresas_usuario('a1000000-0000-0000-0000-000000000002',
    (select jsonb_agg(jsonb_build_object('empresa_id', 'e1000000-0000-0000-0000-000000000001', 'rol_id', 'consulta')) from generate_series(1, 201)))$$,
  '22023', 'Demasiadas asignaciones', 'rechaza un lote con más de 200 asignaciones'
);
reset role;

-- Empresa borrada entre invitar y aceptar: se ignora y el alta no se bloquea.
insert into invitaciones_organizacion (id, organizacion_id, email, rol_id, auth_user_id, asignaciones)
values ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
  'nuevo2@example.com', 'consulta', 'a1000000-0000-0000-0000-000000000005',
  '[{"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "consulta"},
    {"empresa_id": "e1000000-0000-0000-0000-0000000000ff", "rol_id": "consulta"}]'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select public.aceptar_invitacion()$$, 'aceptar no falla si una empresa de la invitación ya no existe');
reset role;
select is((select count(*)::int from usuarios_empresas where user_id = 'a1000000-0000-0000-0000-000000000005'), 1, 'solo se aplican las empresas vigentes');
select is(
  (select asignaciones from invitaciones_organizacion where id = 'b1000000-0000-0000-0000-000000000001'),
  '[{"empresa_id": "e1000000-0000-0000-0000-000000000001", "rol_id": "deposito"}]'::jsonb,
  'la invitación guarda el jsonb normalizado (empresa_id, rol_id)'
);

-- Ejecutabilidad: anon no.
select is(has_function_privilege('anon', 'public.asignar_empresas_usuario(uuid, jsonb)', 'EXECUTE'), false, 'anon no ejecuta asignar_empresas_usuario');
select is(has_function_privilege('anon', 'public.guardar_asignaciones_invitacion(uuid, jsonb)', 'EXECUTE'), false, 'anon no ejecuta guardar_asignaciones_invitacion');
select is(has_function_privilege('anon', 'public.listar_empresas_usuarios()', 'EXECUTE'), false, 'anon no ejecuta listar_empresas_usuarios');

select * from finish();
rollback;
