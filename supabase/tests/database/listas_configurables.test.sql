-- F-CFG-01 (MSF-333, épica MSF-189, FR-014…FR-016, SC-006): listas configurables.
-- Cubre estados de consulta (alta, renombre, nombre vacío/repetido sin distinguir mayúsculas ni
-- espacios, desactivar y reactivar sin borrar, orden al final), escritura solo Administrador,
-- aislamiento entre organizaciones, `motivos_movimiento` como la misma tabla de F-STK-02 y `anon`
-- sin ejecución ni acceso. El fixture corre como postgres (RLS no aplica); las verificaciones,
-- como "authenticated".
begin;

select plan(31);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'operador-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- anon: sin ejecución ni acceso
-- ============================================================================

select is(has_table_privilege('anon', 'dominio.estados_consulta', 'SELECT'), false, 'anon no lee estados_consulta');
select is(has_table_privilege('anon', 'dominio.estados_consulta', 'INSERT'), false, 'anon no inserta en estados_consulta');
select is(has_function_privilege('anon', 'public.crear_estado_consulta(text)', 'EXECUTE'), false, 'anon no ejecuta crear_estado_consulta');
select is(has_function_privilege('anon', 'public.renombrar_estado_consulta(uuid, text)', 'EXECUTE'), false, 'anon no ejecuta renombrar_estado_consulta');
select is(has_function_privilege('anon', 'public.cambiar_estado_estado_consulta(uuid, boolean)', 'EXECUTE'), false, 'anon no ejecuta cambiar_estado_estado_consulta');
select is(has_table_privilege('authenticated', 'dominio.estados_consulta', 'DELETE'), false, 'nadie borra estados: authenticated sin delete');

-- ============================================================================
-- Administrador de la Uno: alta, orden, renombre
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(
  (select nombre from public.crear_estado_consulta('  Nueva  ')),
  'Nueva',
  'el administrador crea un estado y el nombre se guarda recortado'
);
select is(
  (select activo from dominio.estados_consulta where nombre = 'Nueva'),
  true,
  'el estado nuevo queda activo'
);
select is(
  (select orden from public.crear_estado_consulta('En curso')),
  2,
  'el segundo estado queda al final del orden'
);

select throws_ok($$select public.crear_estado_consulta('   ')$$, '23514', null, 'nombre vacío rechazado al crear');
select throws_ok($$select public.crear_estado_consulta('nueva')$$, '23505', null, 'nombre repetido (otras mayúsculas) rechazado al crear');
select throws_ok($$select public.crear_estado_consulta(' EN CURSO ')$$, '23505', null, 'nombre repetido (espacios y mayúsculas) rechazado al crear');

select is(
  (select nombre from public.renombrar_estado_consulta(
    (select id from dominio.estados_consulta where nombre = 'En curso'), 'Esperando respuesta')),
  'Esperando respuesta',
  'el administrador renombra un estado'
);
select throws_ok(
  $$select public.renombrar_estado_consulta((select id from dominio.estados_consulta where nombre = 'Esperando respuesta'), 'NUEVA')$$,
  '23505', null, 'renombrar a un nombre existente se rechaza'
);
select throws_ok(
  $$select public.renombrar_estado_consulta((select id from dominio.estados_consulta where nombre = 'Esperando respuesta'), '')$$,
  '23514', null, 'renombrar a vacío se rechaza'
);
select lives_ok(
  $$select public.renombrar_estado_consulta((select id from dominio.estados_consulta where nombre = 'Esperando respuesta'), 'esperando respuesta')$$,
  'renombrar solo cambiando mayúsculas del propio estado es válido'
);

-- Desactivar y reactivar sin borrar
select is(
  (select activo from public.cambiar_estado_estado_consulta((select id from dominio.estados_consulta where nombre = 'Nueva'), false)),
  false,
  'el administrador desactiva un estado'
);
select is((select count(*)::int from dominio.estados_consulta), 2, 'desactivar no borra la fila');
select is(
  (select activo from public.cambiar_estado_estado_consulta((select id from dominio.estados_consulta where nombre = 'Nueva'), true)),
  true,
  'el administrador reactiva el estado'
);
select throws_ok(
  $$select public.cambiar_estado_estado_consulta('00000000-0000-0000-0000-000000000000', false)$$,
  'P0002', null, 'cambiar un estado inexistente se rechaza'
);

-- ============================================================================
-- Operador de la Uno: lee (acceso a consultas) pero no escribe
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select throws_ok($$select public.crear_estado_consulta('Cerrada')$$, '42501', null, 'un no administrador no crea estados');
select throws_ok(
  $$select public.cambiar_estado_estado_consulta((select id from dominio.estados_consulta limit 1), false)$$,
  '42501', null, 'un no administrador no cambia el estado de un ítem'
);
select throws_ok(
  $$insert into dominio.estados_consulta (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Directo')$$,
  '42501', null, 'RLS rechaza el insert directo de un no administrador'
);

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select is((select count(*)::int from dominio.estados_consulta), 0, 'la Dos no ve los estados de la Uno');
select is((select nombre from public.crear_estado_consulta('Nueva')), 'Nueva', 'el mismo nombre se puede usar en otra organización');
select throws_ok(
  $$select public.renombrar_estado_consulta((select id from dominio.estados_consulta where organizacion_id = '11111111-1111-1111-1111-111111111111'), 'X')$$,
  'P0002', null, 'la Dos no renombra un estado de la Uno'
);

-- ============================================================================
-- Motivos de stock: la misma tabla de F-STK-02, escritura solo Administrador
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select lives_ok(
  $$insert into dominio.motivos_movimiento (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Motivo de prueba')$$,
  'el administrador agrega un motivo en dominio.motivos_movimiento'
);
select lives_ok(
  $$update dominio.motivos_movimiento set activo = false where nombre = 'Motivo de prueba'$$,
  'el administrador desactiva un motivo'
);
select is(
  (select activo from dominio.motivos_movimiento where nombre = 'Motivo de prueba'),
  false,
  'el motivo queda desactivado y sigue en la tabla'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select throws_ok(
  $$insert into dominio.motivos_movimiento (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Intruso')$$,
  '42501', null, 'un no administrador no agrega motivos'
);

reset role;
select is(
  (select count(*)::int from dominio.motivos_movimiento where nombre = 'Motivo de prueba'),
  1,
  'no existe una copia de la lista de motivos: es la misma tabla'
);

select * from finish();
rollback;
