-- «Todas mis empresas» · vista combinada del selector de empresa activa
-- (spec 20261018-180000-empresa-activa-todas, F-ROL-06).
-- Fixture como postgres; verificaciones como `authenticated` (request.jwt.claims).
begin;

select plan(18);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'operador-todas@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'suspendido-todas@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'sin-empresas-todas@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-dos-todas@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'suspendido'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'Empresa Ajena');

-- El operador trabaja en A (Operador) y B (Consulta); la activa es A.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('b1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'operador');

insert into usuario_empresa_activa (user_id, empresa_id) values
  ('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000011');

-- ============================================================================
-- Vista combinada: se borra la activa y las secciones por empresa usan el mejor rol
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from public.empresas_para_selector()), 2, 'el selector lista las dos empresas asignadas');
select is((select count(*)::int from public.empresas_para_selector() where es_activa), 1, 'con una activa elegida hay una marcada');
select is((select private.nivel_seccion('ventas')), 'edicion', 'con A activa: ventas = edicion (Operador)');

select lives_ok($$select public.usar_todas_las_empresas()$$, 'pasa a «Todas mis empresas»');

select is(
  (select count(*)::int from public.usuario_empresa_activa where user_id = auth.uid()), 0,
  'sin empresa activa no queda fila'
);
select is((select count(*)::int from public.empresas_para_selector() where es_activa), 0, 'ninguna empresa queda marcada como activa');
select is((select private.nivel_seccion('ventas')), 'edicion', 'sin activa: ventas = mejor rol entre sus empresas (Operador en A)');
select is((select private.nivel_seccion('consultas')), 'edicion', 'sin activa: consultas = mejor rol (Operador en A)');
select is((select private.nivel_seccion('clientes')), 'edicion', 'sin activa: la compartida sigue con el mejor rol');

-- Idempotente: repetir no escribe ni vuelve a registrar.
select lives_ok($$select public.usar_todas_las_empresas()$$, 'repetir «Todas» es idempotente');

reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'usuario.empresa_activa_cambiada' and actor_id = 'b1000000-0000-0000-0000-000000000001'),
  1, 'se registra un solo evento por el pase a «Todas»'
);
select is(
  (select empresa_id from public.registro_actividad
    where tipo = 'usuario.empresa_activa_cambiada' and actor_id = 'b1000000-0000-0000-0000-000000000001'),
  null, 'el evento de «Todas» no lleva empresa'
);

-- ============================================================================
-- Volver a una empresa concreta restaura el rol de esa empresa
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', 'b1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000012')$$, 'elegir una empresa concreta de nuevo');
select is(
  (select id::text from public.empresas_para_selector() where es_activa),
  'e1000000-0000-0000-0000-000000000012', 'la empresa elegida queda marcada'
);
select is((select private.nivel_seccion('ventas')), 'lectura', 'con B activa: ventas = lectura (Consulta)');

-- ============================================================================
-- Rechazos y privilegios
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', 'b1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.usar_todas_las_empresas()$$, '42501', null, 'un usuario suspendido no pasa a «Todas»');

select set_config('request.jwt.claims', json_build_object('sub', 'b1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.usar_todas_las_empresas()$$, '42501', null, 'sin empresas accesibles no hay vista combinada');

reset role;
select is(has_function_privilege('anon', 'public.usar_todas_las_empresas()', 'EXECUTE'), false, 'anon no ejecuta usar_todas_las_empresas');
select is(has_function_privilege('authenticated', 'public.usar_todas_las_empresas()', 'EXECUTE'), true, 'authenticated ejecuta usar_todas_las_empresas');

select * from finish();
rollback;
