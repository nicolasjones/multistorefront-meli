-- F-AUD-02 (MSF-259, épica MSF-170): registro de actividad inalterable, con antes y después.
-- Cubre FR-001…FR-006, SC-001 y SC-002 de la spec 20261102-100000-auditoria-avanzada-y-soporte.
begin;

select plan(49);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('b1000000-0000-0000-0000-000000000004', 'mostrador@example.com'),
  ('b1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Nivel inicial de Operador en Stock (lo siembra la organización): las aserciones de la matriz no lo suponen.
create temp table t_ini as
  select nivel from permisos_rol
  where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'stock';

-- Evento anterior a la épica: sin valores.
insert into registro_actividad (id, organizacion_id, actor_id, actor_nombre, tipo, detalle) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'usuario.rol_cambiado', 'Cambió el rol de Ana (anterior a F-AUD-02)'),
  ('a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
    'b2000000-0000-0000-0000-000000000001', 'Admin Dos', 'otra.cosa', 'Evento de la otra organización');

-- ============================================================================
-- Catálogo de tipos (FR-001)
-- ============================================================================

select ok((select relrowsecurity from pg_class where oid = 'public.tipos_evento_actividad'::regclass), 'tipos_evento_actividad tiene RLS');
select is(has_table_privilege('anon', 'public.tipos_evento_actividad', 'select'), false, 'anon no lee el catálogo');
select is(has_table_privilege('authenticated', 'public.tipos_evento_actividad', 'insert'), false, 'authenticated no escribe el catálogo');
select is(has_table_privilege('authenticated', 'public.tipos_evento_actividad', 'select'), true, 'authenticated lee el catálogo');
select is(
  (select array_agg(tipo order by tipo) from public.tipos_evento_actividad where sensible),
  array['permisos.matriz_guardada', 'permisos.matriz_restablecida', 'usuario.reactivado', 'usuario.removido', 'usuario.rol_cambiado', 'usuario.suspendido'],
  'el seed marca como sensibles los seis tipos de la spec'
);
select is((select count(*)::int from public.tipos_evento_actividad where tipo = 'producto.creado'), 0, 'un tipo ausente del catálogo no figura');

-- ============================================================================
-- Columnas, límite de 8 KB y registro con valores (FR-002, FR-003)
-- ============================================================================

select col_type_is('public', 'registro_actividad', 'valor_anterior', 'jsonb', 'valor_anterior es jsonb');
select col_type_is('public', 'registro_actividad', 'valor_nuevo', 'jsonb', 'valor_nuevo es jsonb');

select lives_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'usuario.rol_cambiado', 'Cambió el rol de Carla: Consulta → Mostrador', '{"rol":"Consulta"}', '{"rol":"Mostrador"}')$$,
  'un sensible con antes y después se registra'
);
select throws_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'usuario.rol_cambiado', 'Sin nuevo', '{"rol":"Consulta"}', null)$$,
  '22023', null, 'un sensible sin valor nuevo se rechaza'
);
select throws_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'usuario.rol_cambiado', 'Sin anterior', null, '{"rol":"Consulta"}')$$,
  '22023', null, 'un sensible sin valor anterior se rechaza'
);
select is((select count(*)::int from registro_actividad where detalle in ('Sin nuevo', 'Sin anterior')), 0, 'los rechazados no dejan fila');
select lives_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'usuario.removido', 'Quitó a una persona', '{"rol":"Consulta"}', '{}')$$,
  'una baja (nuevo vacío) es un objeto válido'
);
select throws_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'producto.creado', 'Valor que no es objeto', '[1,2]', null)$$,
  '22023', null, 'los valores deben ser objetos'
);
select throws_ok(
  format($$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'usuario.rol_cambiado', 'Muy grande', %L::jsonb, '{}')$$, jsonb_build_object('x', repeat('a', 9000))::text),
  '22023', null, 'un valor de más de 8 KB se rechaza'
);
select lives_ok(
  $$select private.insertar_cambio_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'producto.creado', 'No sensible sin valores', null, null)$$,
  'un tipo no sensible no exige valores'
);
select throws_ok(
  $$select private.insertar_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'usuario.suspendido', 'Por la vía vieja')$$,
  '22023', null, 'insertar_actividad rechaza los tipos sensibles'
);
select is(
  (select count(*)::int from registro_actividad where detalle = 'Por la vía vieja'), 0, 'el rechazo no deja fila'
);
select lives_ok(
  $$select private.insertar_actividad('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001',
    'producto.editado', 'Un evento común sigue funcionando')$$,
  'insertar_actividad conserva su firma para los no sensibles'
);
select is(has_function_privilege('authenticated', 'private.registrar_cambio_actividad(text, text, jsonb, jsonb, uuid)', 'execute'), false,
  'authenticated no ejecuta registrar_cambio_actividad');
select is(has_function_privilege('authenticated', 'private.insertar_cambio_actividad(uuid, uuid, text, text, jsonb, jsonb, uuid)', 'execute'), false,
  'authenticated no ejecuta insertar_cambio_actividad');

-- ============================================================================
-- Inalterabilidad (FR-004, SC-001)
-- ============================================================================

select throws_ok($$update registro_actividad set detalle = 'editado'$$, '42501', null, 'el dueño de la tabla no actualiza');
select throws_ok($$delete from registro_actividad$$, '42501', null, 'el dueño de la tabla no borra');
select throws_ok($$truncate registro_actividad$$, '42501', null, 'el dueño de la tabla no trunca');

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select throws_ok($$update registro_actividad set detalle = 'editado'$$, '42501', null, 'el Administrador no actualiza');
select throws_ok($$delete from registro_actividad$$, '42501', null, 'el Administrador no borra');
select throws_ok($$truncate registro_actividad$$, '42501', null, 'el Administrador no trunca');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select throws_ok($$delete from registro_actividad$$, '42501', null, 'el Operador no borra');
reset role;

set local role anon;
select throws_ok($$delete from registro_actividad$$, '42501', null, 'anon no borra');
reset role;

select is(has_table_privilege('authenticated', 'public.registro_actividad', 'truncate'), false, 'authenticated sin TRUNCATE');
select is(has_table_privilege('authenticated', 'public.registro_actividad', 'delete'), false, 'authenticated sin DELETE');

-- Borrado en cascada de una organización (la única excepción de este archivo).
insert into organizaciones (id, nombre) values ('33333333-3333-3333-3333-333333333333', 'Organización Tres');
select private.insertar_actividad('33333333-3333-3333-3333-333333333333', null, 'otra.cosa', 'Evento de una organización que se borra');
select lives_ok($$delete from organizaciones where id = '33333333-3333-3333-3333-333333333333'$$, 'borrar la organización funciona (cascada)');
select is((select count(*)::int from registro_actividad where organizacion_id = '33333333-3333-3333-3333-333333333333'), 0, 'sus eventos se borraron con ella');

-- ============================================================================
-- Antes y después en los eventos existentes (FR-005, SC-002)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select public.cambiar_rol_miembro('b1000000-0000-0000-0000-000000000003', 'mostrador');
select public.suspender_miembro('b1000000-0000-0000-0000-000000000004');
select public.reactivar_miembro('b1000000-0000-0000-0000-000000000004');
select public.remover_miembro('b1000000-0000-0000-0000-000000000005');
select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"stock","nivel":"ninguno"}]', '[]');
reset role;

select is(
  (select valor_anterior from registro_actividad where tipo = 'usuario.rol_cambiado' and detalle like 'Cambió el rol de consulta@example.com%'),
  '{"rol":"Consulta"}'::jsonb, 'el cambio de rol guarda el rol anterior'
);
select is(
  (select valor_nuevo from registro_actividad where tipo = 'usuario.rol_cambiado' and detalle like 'Cambió el rol de consulta@example.com%'),
  '{"rol":"Mostrador"}'::jsonb, 'y el nuevo'
);
select is(
  (select valor_nuevo from registro_actividad where tipo = 'usuario.suspendido'),
  '{"estado":"Suspendido"}'::jsonb, 'la suspensión guarda el estado nuevo'
);
select is(
  (select valor_nuevo from registro_actividad where tipo = 'usuario.reactivado'),
  '{"estado":"Activo"}'::jsonb, 'la reactivación guarda el estado nuevo'
);
select is(
  (select valor_nuevo from registro_actividad where tipo = 'usuario.removido' and detalle like 'Quitó a deposito@example.com%'),
  '{}'::jsonb, 'la remoción guarda un nuevo vacío'
);
select ok(
  (select valor_anterior ? 'rol' from registro_actividad where tipo = 'usuario.removido' and detalle like 'Quitó a deposito@example.com%'),
  'la remoción guarda el rol que tenía'
);
select is(
  (select valor_anterior from registro_actividad where tipo = 'permisos.matriz_guardada'),
  jsonb_build_object('Operador · stock', (select nivel from t_ini)), 'guardar la matriz guarda solo lo que cambió: el nivel anterior'
);
select is(
  (select valor_nuevo from registro_actividad where tipo = 'permisos.matriz_guardada'),
  '{"Operador · stock":"ninguno"}'::jsonb, 'y el nuevo'
);

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select public.restablecer_matriz_permisos();
reset role;

select is(
  (select valor_anterior from registro_actividad where tipo = 'permisos.matriz_restablecida'),
  '{"Operador · stock":"ninguno"}'::jsonb, 'restablecer guarda lo que se revirtió (antes)'
);
select is(
  (select valor_nuevo from registro_actividad where tipo = 'permisos.matriz_restablecida'),
  jsonb_build_object('Operador · stock', (select nivel from t_ini)), 'restablecer guarda los valores iniciales (después)'
);

-- ============================================================================
-- obtener_detalle_actividad (FR-006)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select is(
  (select sensible from public.obtener_detalle_actividad((select id from registro_actividad where tipo = 'usuario.suspendido'))),
  true, 'el detalle indica que el tipo es sensible'
);
select is(
  (select valor_anterior from public.obtener_detalle_actividad((select id from registro_actividad where tipo = 'usuario.suspendido'))),
  '{"estado":"Activo"}'::jsonb, 'el detalle devuelve el valor anterior'
);
select is(
  (select valor_anterior from public.obtener_detalle_actividad('a0000000-0000-0000-0000-000000000001')),
  null, 'un evento anterior a la épica no tiene valores y no da error'
);
select is(
  (select count(*)::int from public.obtener_detalle_actividad('a0000000-0000-0000-0000-000000000005')),
  0, 'el detalle de un evento de otra organización no devuelve filas'
);
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.obtener_detalle_actividad('a0000000-0000-0000-0000-000000000001')),
  0, 'sin permiso sobre Actividad no devuelve filas'
);
reset role;

set local role anon;
select throws_ok($$select * from public.obtener_detalle_actividad('a0000000-0000-0000-0000-000000000001')$$, '42501', null, 'anon no ejecuta obtener_detalle_actividad');
reset role;

select * from finish();
rollback;
