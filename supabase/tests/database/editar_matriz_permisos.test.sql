-- F-ROL-02 (MSF-239, épica MSF-125): matriz de permisos editable por rol.
-- Cubre FR-003 (Administrador no restringible), FR-013 (solo el Administrador
-- de la organización edita; el cambio no afecta a otra organización) y FR-015
-- (restablecer valores iniciales). Corre como postgres para armar el fixture y
-- como "authenticated" (request.jwt.claims, igual que PostgREST) para verificar.
begin;

select plan(39);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('b9000000-0000-0000-0000-000000000009', 'sin-organizacion@example.com'),
  ('b5000000-0000-0000-0000-000000000005', 'superadmin@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into superadmins (user_id) values ('b5000000-0000-0000-0000-000000000005');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Solo el Administrador edita (FR-013)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"stock","nivel":"ninguno"}]', '[]')$$,
  '42501', null, 'un operador no puede guardar la matriz'
);
select throws_ok(
  $$select public.restablecer_matriz_permisos()$$,
  '42501', null, 'un operador no puede restablecer la matriz'
);
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"consulta","seccion":"stock","nivel":"edicion"}]', '[]')$$,
  '42501', null, 'un rol de solo lectura no se puede auto-promover'
);
reset role;

select pg_temp.como('b9000000-0000-0000-0000-000000000009');
select throws_ok(
  $$select public.guardar_matriz_permisos('[]', '[]')$$,
  '42501', null, 'quien no pertenece a ninguna organización no puede editar'
);
reset role;

select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'stock'),
  'edicion', 'los intentos rechazados no cambiaron nada'
);

-- ============================================================================
-- El Administrador guarda niveles y acciones
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_matriz_permisos(
      '[{"rol_id":"operador","seccion":"stock","nivel":"lectura"},{"rol_id":"consulta","seccion":"ventas","nivel":"ninguno"}]',
      '[{"rol_id":"operador","seccion":"productos","accion":"eliminar","permitido":true}]')$$,
  'el Administrador guarda cambios de niveles y acciones'
);
reset role;

select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'stock'),
  'lectura', 'el nivel guardado se persiste'
);
select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas'),
  'ninguno', 'se guardan varios cambios en un mismo pedido'
);
select is(
  (select permitido from permisos_rol_accion where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'productos' and accion = 'eliminar'),
  true, 'la acción guardada se persiste'
);

-- El cambio se refleja en las funciones que usan las políticas (SC-004)
select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select is(private.nivel_seccion('stock'), 'lectura', 'nivel_seccion refleja el cambio guardado');
select ok(private.puede_accion('productos', 'eliminar'), 'puede_accion refleja el cambio guardado');
reset role;

-- ============================================================================
-- Alcance por organización (FR-013)
-- ============================================================================

select is(
  (select nivel from permisos_rol where organizacion_id = '22222222-2222-2222-2222-222222222222' and rol_id = 'operador' and seccion = 'stock'),
  'edicion', 'el cambio no afecta a la matriz de otra organización'
);
select pg_temp.como('b2000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"clientes","nivel":"lectura"}]', '[]')$$,
  'el Administrador de la Dos edita su propia matriz'
);
reset role;
select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'clientes'),
  'edicion', 'editar la Dos no toca la Uno'
);

-- ============================================================================
-- Administrador no restringible y validación (FR-003)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"administrador","seccion":"stock","nivel":"lectura"}]', '[]')$$,
  '22023', null, 'no se puede restringir al Administrador (niveles)'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[]', '[{"rol_id":"administrador","seccion":"stock","accion":"eliminar","permitido":false}]')$$,
  '22023', null, 'no se puede restringir al Administrador (acciones)'
);
select throws_ok(
  format($$select public.guardar_matriz_permisos(%L::jsonb, '[]')$$, (select jsonb_agg('{"rol_id":"operador","seccion":"stock","nivel":"lectura"}'::jsonb) from generate_series(1, 201))),
  '22023', null, 'más de 200 niveles en un guardado se rechaza'
);
select throws_ok(
  format($$select public.guardar_matriz_permisos('[]', %L::jsonb)$$, (select jsonb_agg('{"rol_id":"operador","seccion":"stock","accion":"eliminar","permitido":true}'::jsonb) from generate_series(1, 401))),
  '22023', null, 'más de 400 acciones en un guardado se rechaza'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"stock","nivel":"todo"}]', '[]')$$,
  '22023', null, 'un nivel inválido se rechaza'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"inexistente","nivel":"lectura"}]', '[]')$$,
  '22023', null, 'una sección desconocida se rechaza'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[]', '[{"rol_id":"operador","seccion":"stock","accion":"borrar","permitido":true}]')$$,
  '22023', null, 'una acción desconocida se rechaza'
);
select throws_ok(
  $$select public.guardar_matriz_permisos(
      '[{"rol_id":"operador","seccion":"inicio","nivel":"ninguno"},{"rol_id":"operador","seccion":"inexistente","nivel":"lectura"}]', '[]')$$,
  '22023', null, 'un pedido con un cambio inválido se rechaza completo'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"stock"}]', '[]')$$,
  '22023', null, 'un nivel ausente se rechaza con error de validación'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"stock","nivel":null}]', '[]')$$,
  '22023', null, 'un nivel nulo se rechaza con error de validación'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[]', '[{"rol_id":"operador","seccion":"stock","accion":"eliminar","permitido":"si"}]')$$,
  '22023', null, 'permitido no booleano se rechaza'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('["operador"]', '[]')$$,
  '22023', null, 'un elemento de niveles que no es objeto se rechaza'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[]', '[7]')$$,
  '22023', null, 'un elemento de acciones que no es objeto se rechaza'
);
select throws_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"miembro","seccion":"stock","nivel":"ninguno"}]', '[]')$$,
  '22023', null, 'el rol miembro del template no se edita desde la matriz'
);
reset role;
select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'inicio'),
  'edicion', 'todo o nada: el cambio válido del pedido rechazado no quedó aplicado'
);

-- ============================================================================
-- Superadmin con organización activa (puede_escribir lo admite)
-- ============================================================================

select pg_temp.como('b5000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.guardar_matriz_permisos('[]', '[]')$$,
  '42501', null, 'un superadmin sin organización activa no puede editar'
);
reset role;
insert into superadmin_organizacion_activa (user_id, organizacion_id) values
  ('b5000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222');
select pg_temp.como('b5000000-0000-0000-0000-000000000005');
select lives_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"deposito","seccion":"stock","nivel":"lectura"}]', '[]')$$,
  'un superadmin con organización activa edita la matriz de esa organización'
);
reset role;
select is(
  (select nivel from permisos_rol where organizacion_id = '22222222-2222-2222-2222-222222222222' and rol_id = 'deposito' and seccion = 'stock'),
  'lectura', 'el cambio del superadmin cae en la organización activa'
);
select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito' and seccion = 'stock'),
  'edicion', 'y no en otra organización'
);

-- ============================================================================
-- Restablecer valores iniciales (FR-015)
-- ============================================================================

-- Fixture: una acción personalizada en cada organización (la Dos no debe cambiar).
update permisos_rol_accion set permitido = true
 where organizacion_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
   and rol_id = 'consulta' and seccion = 'ventas' and accion = 'eliminar';

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.restablecer_matriz_permisos()$$, 'el Administrador restablece la matriz');
reset role;
select is(
  (select nivel from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'stock'),
  'edicion', 'restablecer devuelve el valor inicial de Roles.dc.html'
);
select is(
  (select count(*)::int from permisos_rol where organizacion_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from permisos_rol_accion where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  16 * 7 + 16 * 7 * 3, 'restablecer deja la matriz completa, sin filas duplicadas ni faltantes'
);
select is(
  (select permitido from permisos_rol_accion where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas' and accion = 'eliminar'),
  false, 'restablecer también revierte las acciones personalizadas'
);
select is(
  (select nivel from permisos_rol where organizacion_id = '22222222-2222-2222-2222-222222222222' and rol_id = 'operador' and seccion = 'clientes'),
  'lectura', 'restablecer no toca la matriz de otra organización'
);
select is(
  (select permitido from permisos_rol_accion where organizacion_id = '22222222-2222-2222-2222-222222222222' and rol_id = 'consulta' and seccion = 'ventas' and accion = 'eliminar'),
  true, 'ni sus acciones personalizadas'
);

select * from finish();
rollback;
