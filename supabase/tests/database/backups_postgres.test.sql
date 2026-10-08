-- Backups automáticos de la base de datos (spec 011). Ver
-- specs/011-backups-postgres/data-model.md y
-- contracts/respaldo-postgres.md.
--
-- A diferencia del resto de las suites, acá el "actor" que escribe no es
-- un authenticated con JWT sino el rol de servicio kestra_backups
-- (research.md R1/R2). El chequeo de permisos usa has_function_privilege
-- (mismo patrón que perfil_usuario.test.sql para supabase_auth_admin) en
-- vez de "set local role kestra_backups": postgres (el rol de conexión de
-- este test) no es superusuario acá y no tiene membresía en kestra_backups
-- para poder asumirlo. Las llamadas de comportamiento se hacen como
-- postgres directamente: es dueño de las 3 funciones, así que el "revoke
-- ... from public/authenticated/anon" no le aplica (mismo motivo por el
-- que perfil_usuario.test.sql llama registrar_inicio_sesion sin asumir
-- supabase_auth_admin).
begin;

select plan(28);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('e1111111-1111-1111-1111-111111111111', 'Organización Backups');

insert into auth.users (id, email) values
  ('e5000000-0000-0000-0000-000000000005', 'superadmin-backups@example.com'),
  ('e1000000-0000-0000-0000-000000000001', 'admin-backups@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'miembro-backups@example.com');

insert into superadmins (user_id) values ('e5000000-0000-0000-0000-000000000005');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'administrador'),
  ('e2000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'miembro');

-- ============================================================================
-- Permisos: solo kestra_backups ejecuta las 3 funciones (FR-011)
-- ============================================================================

select is(
  has_function_privilege('kestra_backups', 'public.iniciar_respaldo(text)', 'EXECUTE'),
  true,
  'kestra_backups puede ejecutar iniciar_respaldo'
);

select is(
  has_function_privilege('authenticated', 'public.iniciar_respaldo(text)', 'EXECUTE'),
  false,
  'authenticated no puede ejecutar iniciar_respaldo'
);

select is(
  has_function_privilege('anon', 'public.iniciar_respaldo(text)', 'EXECUTE'),
  false,
  'anon no puede ejecutar iniciar_respaldo'
);

select is(
  has_function_privilege('kestra_backups', 'public.finalizar_respaldo_completado(bigint, bigint, text)', 'EXECUTE'),
  true,
  'kestra_backups puede ejecutar finalizar_respaldo_completado'
);

select is(
  has_function_privilege('authenticated', 'public.finalizar_respaldo_completado(bigint, bigint, text)', 'EXECUTE'),
  false,
  'authenticated no puede ejecutar finalizar_respaldo_completado'
);

select is(
  has_function_privilege('anon', 'public.finalizar_respaldo_completado(bigint, bigint, text)', 'EXECUTE'),
  false,
  'anon no puede ejecutar finalizar_respaldo_completado'
);

select is(
  has_function_privilege('kestra_backups', 'public.finalizar_respaldo_error(bigint, text)', 'EXECUTE'),
  true,
  'kestra_backups puede ejecutar finalizar_respaldo_error'
);

select is(
  has_function_privilege('authenticated', 'public.finalizar_respaldo_error(bigint, text)', 'EXECUTE'),
  false,
  'authenticated no puede ejecutar finalizar_respaldo_error'
);

select is(
  has_function_privilege('anon', 'public.finalizar_respaldo_error(bigint, text)', 'EXECUTE'),
  false,
  'anon no puede ejecutar finalizar_respaldo_error'
);

-- El grant es real, no solo teórico: un authenticated que igual lo intenta
-- se encuentra con el error de permisos de Postgres.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select throws_ok(
  $$select public.iniciar_respaldo('programado')$$,
  '42501',
  null,
  'authenticated no puede llamar iniciar_respaldo aunque sea superadmin (el límite es el rol de Postgres, no is_superadmin(), research.md R2)'
);

reset role;

-- ============================================================================
-- iniciar_respaldo: validación de origen (FR-004)
-- ============================================================================

select throws_ok(
  $$select public.iniciar_respaldo('otro')$$,
  '22023',
  null,
  'iniciar_respaldo rechaza un origen que no es programado ni manual'
);

select is(
  (select estado from public.iniciar_respaldo('programado')),
  'en_progreso',
  'iniciar_respaldo crea la fila en en_progreso'
);

-- ============================================================================
-- FR-003: el índice único bloquea un segundo backup mientras el primero
-- sigue en_progreso.
-- ============================================================================

select throws_ok(
  $$select public.iniciar_respaldo('manual')$$,
  '55006',
  'Ya hay un respaldo en progreso',
  'un segundo iniciar_respaldo mientras el primero sigue en_progreso se rechaza antes de tocar pg_dump'
);

-- ============================================================================
-- Constraint de consistencia estado/resto de campos (data-model.md)
-- ============================================================================

select throws_ok(
  $$insert into public.respaldos (origen, estado, finalizado_en, tamano_bytes, ubicacion)
    values ('programado', 'completado', clock_timestamp(), 1024, null)$$,
  '23514',
  null,
  'el check rechaza un completado sin ubicacion'
);

select throws_ok(
  $$insert into public.respaldos (origen, estado, finalizado_en, motivo_error)
    values ('programado', 'error', clock_timestamp(), null)$$,
  '23514',
  null,
  'el check rechaza un error sin motivo'
);

-- ============================================================================
-- finalizar_respaldo_completado
-- ============================================================================

select lives_ok(
  $$select public.finalizar_respaldo_completado(
      (select id from public.respaldos where estado = 'en_progreso'),
      2048,
      'kestra-storage://respaldos/e1.dump'
    )$$,
  'finalizar_respaldo_completado no lanza error sobre la fila en_progreso'
);

select is(
  (select estado from public.respaldos where ubicacion = 'kestra-storage://respaldos/e1.dump'),
  'completado',
  'la fila queda completado con tamaño y ubicación (FR-004)'
);

select is(
  (select tamano_bytes from public.respaldos where ubicacion = 'kestra-storage://respaldos/e1.dump'),
  2048::bigint,
  'el tamaño queda registrado'
);

-- ============================================================================
-- Auto-sanado de una fila colgada (research.md R5) — simula una caída
-- real del proceso, no un fallo capturado por errors:.
-- ============================================================================

insert into public.respaldos (origen, estado, iniciado_en)
values ('programado', 'en_progreso', clock_timestamp() - interval '4 hours');

select lives_ok(
  $$select public.iniciar_respaldo('programado')$$,
  'iniciar_respaldo no lanza error pese a la fila colgada: la auto-sana primero'
);

select is(
  (select estado from public.respaldos
     where iniciado_en < clock_timestamp() - interval '3 hours'
     order by id desc limit 1),
  'error',
  'la fila colgada quedó marcada error, no en_progreso para siempre'
);

select matches(
  (select motivo_error from public.respaldos
     where iniciado_en < clock_timestamp() - interval '3 hours'
     order by id desc limit 1),
  'interrumpido',
  'el motivo explica que fue un backup interrumpido, no un genérico "algo salió mal" (FR-006/FR-008)'
);

select is(
  (select count(*)::int from public.respaldos where estado = 'en_progreso'),
  1,
  'iniciar_respaldo sí dejó una fila nueva en_progreso — no quedó bloqueado por la colgada'
);

-- ============================================================================
-- finalizar_respaldo_error
-- ============================================================================

select lives_ok(
  $$select public.finalizar_respaldo_error(
      (select id from public.respaldos where estado = 'en_progreso'),
      'pg_dump terminó con código de salida distinto de cero: conexión rechazada'
    )$$,
  'finalizar_respaldo_error no lanza error sobre la fila en_progreso'
);

select is(
  (select count(*)::int from public.respaldos where estado = 'en_progreso'),
  0,
  'ya no queda ninguna fila en_progreso tras finalizar_respaldo_error — un backup fallido no bloquea el siguiente (FR-006)'
);

select is(
  (select motivo_error from public.respaldos where motivo_error like 'pg_dump terminó%'),
  'pg_dump terminó con código de salida distinto de cero: conexión rechazada',
  'el motivo_error real queda legible, no un genérico "algo salió mal"'
);

-- ============================================================================
-- RLS: respaldos_select — solo superadmin (FR-011)
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.respaldos),
  0,
  'un administrador de organización no ve ninguna fila de respaldos'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.respaldos),
  0,
  'un miembro de organización tampoco ve ninguna fila de respaldos'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e5000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select cmp_ok(
  (select count(*)::int from public.respaldos),
  '>',
  0,
  'el superadmin sí ve el historial de respaldos'
);

reset role;

select * from finish();

rollback;
