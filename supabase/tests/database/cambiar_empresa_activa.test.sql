-- Selector de empresa activa (spec 20261016-140000-permisos-por-empresa, F-ROL-06;
-- FR-009, FR-010, FR-013, FR-014). El fixture corre como postgres (RLS no aplica) y las
-- verificaciones como authenticated vía request.jwt.claims.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'operador1@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'suspendido1@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador', 'suspendido'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tercera'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Ajena');

-- El operador trabaja en las dos primeras; el suspendido tenía la primera.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador');

-- Operador con dos empresas.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.empresas_para_selector()), 2,
  'el selector lista solo las empresas asignadas'
);
select is(
  (select count(*)::int from public.empresas_para_selector() where es_activa), 0,
  'sin elección previa no hay empresa activa marcada'
);
select lives_ok(
  $$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000002')$$,
  'elige una empresa asignada'
);
select is(
  (select id::text from public.empresas_para_selector() where es_activa),
  'e1000000-0000-0000-0000-000000000002', 'la activa queda marcada'
);
select is(
  (select empresa_id::text from public.usuario_empresa_activa where user_id = auth.uid()),
  'e1000000-0000-0000-0000-000000000002', 'la elección persiste en la base'
);
select lives_ok(
  $$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000001')$$,
  'cambia a la otra empresa asignada'
);
select is(
  (select count(*)::int from public.usuario_empresa_activa where user_id = auth.uid()), 1,
  'sigue habiendo una sola fila por usuario'
);
select lives_ok(
  $$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000001')$$,
  'repetir la misma empresa es idempotente'
);

-- Rechazos: empresa de la organización sin asignar, ajena, inexistente y nula.
select throws_ok($$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000003')$$, '42501', null, 'empresa de su organización sin asignar rechazada');
select throws_ok($$select public.cambiar_empresa_activa('e2000000-0000-0000-0000-000000000001')$$, '42501', null, 'empresa de otra organización rechazada');
select throws_ok($$select public.cambiar_empresa_activa('e9000000-0000-0000-0000-000000000009')$$, '42501', null, 'empresa inexistente rechazada');
select throws_ok($$select public.cambiar_empresa_activa(null)$$, '22023', null, 'empresa nula rechazada');
select is(
  (select empresa_id::text from public.usuario_empresa_activa where user_id = auth.uid()),
  'e1000000-0000-0000-0000-000000000001', 'los rechazos no cambian la activa'
);

-- Sin escritura directa en la tabla.
select throws_ok(
  $$update public.usuario_empresa_activa set empresa_id = 'e1000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'no hay UPDATE directo'
);
reset role;

-- Evento: uno por cambio efectivo (dos), no por la repetición ni por los rechazos.
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'usuario.empresa_activa_cambiada' and actor_id = 'a1000000-0000-0000-0000-000000000002'),
  2, 'se registra un evento por cada cambio efectivo'
);
select is(
  (select empresa_id::text from public.registro_actividad
    where tipo = 'usuario.empresa_activa_cambiada' and detalle like '%San Javucho%'),
  'e1000000-0000-0000-0000-000000000001', 'el evento lleva la empresa y su nombre'
);

-- Administrador: ve todas las de su organización, ninguna ajena.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.empresas_para_selector()), 3, 'el Administrador ve todas las empresas de su organización');
select lives_ok($$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000003')$$, 'el Administrador activa cualquiera de su organización');
select throws_ok($$select public.cambiar_empresa_activa('e2000000-0000-0000-0000-000000000001')$$, '42501', null, 'el Administrador no activa una de otra organización');
reset role;

-- Suspendido: pierde el acceso.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000001')$$, '42501', null, 'un usuario suspendido no cambia de empresa');
reset role;

-- Activa guardada que ya no es accesible (asignación removida): ninguna queda marcada (FR-010).
delete from usuarios_empresas
 where user_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.empresas_para_selector() where es_activa), 0, 'una activa sin acceso no se marca como activa');
select is((select count(*)::int from public.empresas_para_selector()), 1, 'el selector solo lista lo que sigue asignado');
reset role;

-- Ejecutabilidad: anon no; authenticated sí.
select is(has_function_privilege('anon', 'public.cambiar_empresa_activa(uuid)', 'EXECUTE'), false, 'anon no ejecuta cambiar_empresa_activa');
select is(has_function_privilege('anon', 'public.empresas_para_selector()', 'EXECUTE'), false, 'anon no ejecuta empresas_para_selector');
select is(has_function_privilege('authenticated', 'public.cambiar_empresa_activa(uuid)', 'EXECUTE'), true, 'authenticated ejecuta cambiar_empresa_activa');

select * from finish();
rollback;
