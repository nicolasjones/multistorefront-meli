-- F-AUD-01 (MSF-463, épica MSF-455): registro de actividad e historial.
-- Cubre SC-002 (aislamiento entre organizaciones), SC-003 (permisos por rol
-- según la matriz: administrador, operador y administración leen; consulta,
-- mostrador, depósito y miembro no; nadie escribe por API directa; anon sin
-- acceso) y SC-005 (otro componente registra con una llamada). Corre como
-- postgres para armar el fixture y como "authenticated" (request.jwt.claims,
-- igual que PostgREST) para verificar.
begin;

select plan(74);

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
  ('b1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('b1000000-0000-0000-0000-000000000007', 'miembro@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('b9000000-0000-0000-0000-000000000009', 'sin-organizacion@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('b1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Empresa A1'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Empresa A2'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa B1');

insert into perfiles_usuario (user_id, nombre, apellido) values
  ('b1000000-0000-0000-0000-000000000003', 'Carla', 'Consulta');

-- Horas elegidas para cruzar la medianoche de Buenos Aires (UTC-3):
--   a1: 2026-10-01 02:30 UTC = 30/09 23:30 en Buenos Aires
--   a2: 2026-10-01 03:30 UTC = 01/10 00:30 en Buenos Aires
insert into registro_actividad (id, organizacion_id, empresa_id, actor_id, actor_nombre, tipo, detalle, creado_en) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'producto.creado', 'Creó el producto Lámpara 100%', '2026-10-01 02:30:00+00'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000002', 'Omar Operador', 'empresa.pausada', 'Se pausó la empresa', '2026-10-01 03:30:00+00'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', null,
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'usuario.rol_cambiado', 'Cambió el rol de Ana', '2026-10-02 15:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'producto.creado', 'Creó el producto Cañería', '2026-10-03 15:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', null,
    'b2000000-0000-0000-0000-000000000001', 'Admin Dos', 'otra.cosa', 'Evento de la otra organización', '2026-10-02 12:00:00+00');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-001, FR-002, SC-003)
-- ============================================================================

select ok(
  (select relrowsecurity from pg_class where oid = 'public.registro_actividad'::regclass),
  'registro_actividad tiene RLS habilitada'
);
select is(has_table_privilege('anon', 'public.registro_actividad', 'select'), false, 'anon no lee registro_actividad');
select is(has_table_privilege('authenticated', 'public.registro_actividad', 'insert'), false, 'authenticated no inserta en registro_actividad');
select is(has_table_privilege('authenticated', 'public.registro_actividad', 'update'), false, 'authenticated no actualiza registro_actividad');
select is(has_table_privilege('authenticated', 'public.registro_actividad', 'delete'), false, 'authenticated no borra de registro_actividad');
select is(has_function_privilege('anon', 'public.registrar_actividad(text, text, uuid)', 'EXECUTE'), false, 'anon no ejecuta registrar_actividad');
select is(has_function_privilege('anon', 'public.listar_actividad(date, date, uuid, uuid, text, text, integer, integer)', 'EXECUTE'), false, 'anon no ejecuta listar_actividad');
select is(has_function_privilege('anon', 'public.opciones_actividad()', 'EXECUTE'), false, 'anon no ejecuta opciones_actividad');
select is(has_function_privilege('anon', 'private.registrar_actividad(text, text, uuid)', 'EXECUTE'), false, 'anon no ejecuta private.registrar_actividad');
select is(has_function_privilege('authenticated', 'private.registrar_actividad(text, text, uuid)', 'EXECUTE'), false, 'authenticated no ejecuta private.registrar_actividad (el filtro del wrapper no se saltea)');
select is(has_function_privilege('authenticated', 'public.registrar_actividad(text, text, uuid)', 'EXECUTE'), true, 'authenticated ejecuta registrar_actividad');
select is(has_function_privilege('authenticated', 'private.insertar_actividad(uuid, uuid, text, text, uuid)', 'EXECUTE'), false, 'authenticated no ejecuta la inserción interna (organización y actor no se eligen)');

-- ============================================================================
-- Permisos por rol según la matriz (escenarios 7 y 8)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from registro_actividad), 4, 'administrador (edicion) ve los 4 eventos de su organización');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from registro_actividad), 4, 'operador (lectura) ve todos los eventos, también los de usuarios y permisos');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000006');
select is((select count(*)::int from registro_actividad), 4, 'administración (lectura en la matriz) ve los eventos');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from registro_actividad), 0, 'consulta (ninguno) no ve ningún evento');
select is((select count(*)::int from public.listar_actividad()), 0, 'consulta no obtiene filas de listar_actividad');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from registro_actividad), 0, 'mostrador (ninguno) no ve ningún evento');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from registro_actividad), 0, 'depósito (ninguno) no ve ningún evento');
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000007');
select is((select count(*)::int from registro_actividad), 0, 'miembro (ninguno) no ve ningún evento');
reset role;

select pg_temp.como('b9000000-0000-0000-0000-000000000009');
select is((select count(*)::int from registro_actividad), 0, 'una persona sin organización no ve eventos');
reset role;

-- ============================================================================
-- Aislamiento entre organizaciones (escenario 9, SC-002)
-- ============================================================================

select pg_temp.como('b2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from registro_actividad), 1, 'el administrador de la otra organización ve solo su evento');
select is((select count(*)::int from registro_actividad where tipo = 'producto.creado'), 0, 'no ve eventos de la organización Uno por ningún filtro');
select is((select count(*)::int from public.listar_actividad(p_actor => 'b1000000-0000-0000-0000-000000000001')), 0, 'filtrar por un actor ajeno no filtra datos de otra organización');
select is((select count(*)::int from public.listar_actividad(p_empresa => 'e1000000-0000-0000-0000-000000000001')), 0, 'filtrar por una empresa ajena no devuelve nada');
select is((select jsonb_array_length(public.opciones_actividad() -> 'tipos')), 1, 'las opciones de filtro son solo de su organización');
reset role;

-- ============================================================================
-- Solo de agregado: nadie escribe por API directa (escenario 13)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into registro_actividad (organizacion_id, tipo, detalle) values ('11111111-1111-1111-1111-111111111111', 'x.y', 'directo')$$,
  '42501', null, 'ni el administrador inserta directo'
);
select throws_ok(
  $$update registro_actividad set detalle = 'editado'$$,
  '42501', null, 'ni el administrador edita eventos'
);
select throws_ok(
  $$delete from registro_actividad$$,
  '42501', null, 'ni el administrador borra eventos'
);
reset role;

set local role anon;
select throws_ok($$select count(*) from public.registro_actividad$$, '42501', null, 'anon no lee la tabla');
select throws_ok($$select * from public.listar_actividad()$$, '42501', null, 'anon no ejecuta listar_actividad');
reset role;

-- ============================================================================
-- Listado: orden, total, paginación y filtros (FR-003, FR-004)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');

select is((select detalle from public.listar_actividad() limit 1), 'Creó el producto Cañería', 'el listado va del más reciente al más antiguo');
select is((select total from public.listar_actividad() limit 1), 4::bigint, 'cada fila trae el total del filtro');
select is((select empresa_nombre from public.listar_actividad() limit 1), 'Empresa A1', 'la empresa se resuelve por nombre, no por id');
select is((select count(*)::int from public.listar_actividad(p_tamano => 2)), 2, 'el tamaño de página se respeta');
select is((select total from public.listar_actividad(p_tamano => 2) limit 1), 4::bigint, 'el total no depende del tamaño de página');
select is((select detalle from public.listar_actividad(p_pagina => 2, p_tamano => 3)), 'Creó el producto Lámpara 100%', 'la segunda página trae lo que sobra');
select is((select count(*)::int from public.listar_actividad(p_tamano => 0)), 1, 'un tamaño inválido se acota a 1');
select is(
  (select detalle from public.listar_actividad(p_desde => '2026-10-01', p_hasta => '2026-10-01')),
  'Se pausó la empresa', 'el día se calcula en Buenos Aires: 00:30 del 1/10 entra y 23:30 del 30/09 no'
);
select is((select count(*)::int from public.listar_actividad(p_hasta => '2026-09-30')), 1, 'hasta el 30/09 (hora de Buenos Aires) entra el evento de las 23:30');
select is((select count(*)::int from public.listar_actividad(p_empresa => 'e1000000-0000-0000-0000-000000000001')), 2, 'filtro por empresa');
select is((select count(*)::int from public.listar_actividad(p_actor => 'b1000000-0000-0000-0000-000000000002')), 1, 'filtro por usuario');
select is((select count(*)::int from public.listar_actividad(p_tipo => 'producto.creado')), 2, 'filtro por tipo');
select is(
  (select detalle from public.listar_actividad(p_tipo => 'producto.creado', p_empresa => 'e1000000-0000-0000-0000-000000000001', p_desde => '2026-10-02')),
  'Creó el producto Cañería', 'los filtros se combinan'
);
select is((select count(*)::int from public.listar_actividad(p_texto => 'LAMPARA')), 1, 'la búsqueda no distingue mayúsculas ni tildes');
select is((select count(*)::int from public.listar_actividad(p_texto => '%')), 1, 'el % de la búsqueda es literal (solo el evento que lo contiene)');
select is((select count(*)::int from public.listar_actividad(p_texto => '_')), 0, 'el _ de la búsqueda es literal');
select lives_ok(
  format($$select * from public.listar_actividad(p_texto => %L)$$, repeat('a', 5000)),
  'un texto de búsqueda muy largo se acota sin error'
);
select is((select jsonb_array_length(public.opciones_actividad() -> 'tipos')), 3, 'opciones de tipo derivadas de los eventos');
select is((select jsonb_array_length(public.opciones_actividad() -> 'actores')), 2, 'opciones de usuario derivadas de los eventos');
reset role;

-- ============================================================================
-- Registro: organización y actor los fija el servidor (escenario 10, SC-005)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.registrar_actividad('empresa.pausada', 'Falsificado por un operador', 'e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'quien no puede escribir (operador) no registra actividad'
);
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.registrar_actividad('empresa.pausada', 'Falsificado por consulta', 'e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'consulta (nivel ninguno) no registra actividad'
);
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.registrar_actividad('empresa.actualizada', 'Creó el producto Prueba', 'e1000000-0000-0000-0000-000000000001')$$,
  'el administrador registra un evento empresa.* con una llamada'
);
select throws_ok(
  $$select public.registrar_actividad('empresa.actualizada', 'Con empresa ajena', 'e2000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'rechaza una empresa de otra organización'
);
select throws_ok(
  $$select public.registrar_actividad('empresa.actualizada', 'Sin empresa')$$,
  '22023', null, 'un evento empresa.* exige la empresa'
);
select throws_ok(
  $$select public.registrar_actividad('Producto Creado', 'Tipo mal formado')$$,
  '42501', null, 'rechaza un tipo que no es de la lista del frontend'
);
select throws_ok(
  $$select public.registrar_actividad('producto.creado', 'Tipo ajeno a la lista', 'e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'el frontend solo registra empresa.pausada, reactivada y actualizada'
);
select throws_ok(
  $$select public.registrar_actividad('usuario.rol_cambiado', 'Falsificado desde el navegador')$$,
  '42501', null, 'el frontend no puede fabricar eventos de Acceso'
);
reset role;

select pg_temp.como('b9000000-0000-0000-0000-000000000009');
select throws_ok(
  $$select public.registrar_actividad('empresa.pausada', 'Sin organización', 'e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'sin organización no se registra nada'
);
reset role;

select is(
  (select organizacion_id from registro_actividad where detalle = 'Creó el producto Prueba'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'el evento queda en la organización del servidor'
);
select is(
  (select actor_id from registro_actividad where detalle = 'Creó el producto Prueba'),
  'b1000000-0000-0000-0000-000000000001'::uuid, 'el actor es el usuario autenticado'
);
select is(
  (select actor_nombre from registro_actividad where detalle = 'Creó el producto Prueba'),
  'administrador@example.com', 'sin perfil, el nombre visible del actor es su correo'
);
select ok(
  (select creado_en > now() - interval '1 minute' from registro_actividad where detalle = 'Creó el producto Prueba'),
  'la fecha la pone el servidor'
);
select is((select count(*)::int from registro_actividad where detalle in ('Con empresa ajena', 'Tipo mal formado', 'Sin organización')), 0, 'los intentos rechazados no dejan filas');

-- ============================================================================
-- Eventos de Acceso (escenario 11): las RPC existentes los registran
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.cambiar_rol_miembro('b1000000-0000-0000-0000-000000000003', 'mostrador')$$,
  'cambiar_rol_miembro sigue funcionando'
);
select lives_ok(
  $$select public.suspender_miembro('b1000000-0000-0000-0000-000000000004')$$,
  'suspender_miembro sigue funcionando'
);
select lives_ok(
  $$select public.guardar_matriz_permisos('[{"rol_id":"operador","seccion":"stock","nivel":"lectura"}]', '[]')$$,
  'guardar_matriz_permisos sigue funcionando'
);
select lives_ok($$select public.restablecer_matriz_permisos()$$, 'restablecer_matriz_permisos sigue funcionando');
reset role;

select is(
  (select detalle from registro_actividad where tipo = 'usuario.rol_cambiado' and actor_id = 'b1000000-0000-0000-0000-000000000001' and detalle like 'Cambió el rol de Carla%'),
  'Cambió el rol de Carla Consulta: Consulta → Mostrador', 'el cambio de rol queda en el historial con persona y roles'
);
select is(
  (select detalle from registro_actividad where tipo = 'usuario.suspendido'),
  'Suspendió a mostrador@example.com', 'la suspensión queda en el historial'
);
select is(
  (select actor_id from registro_actividad where tipo = 'usuario.suspendido'),
  'b1000000-0000-0000-0000-000000000001'::uuid, 'el actor de la suspensión es quien la hizo'
);
select is((select count(*)::int from registro_actividad where tipo = 'permisos.matriz_guardada'), 1, 'guardar la matriz queda en el historial');
select is((select count(*)::int from registro_actividad where tipo = 'permisos.matriz_restablecida'), 1, 'restablecer la matriz queda en el historial');
select is(
  (select count(*)::int from registro_actividad where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1, 'los eventos de Acceso de la organización Uno no tocan a la otra'
);

select * from finish();
rollback;
