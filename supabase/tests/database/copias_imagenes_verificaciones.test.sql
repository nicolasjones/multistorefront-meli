-- Copias de imágenes y verificación de restauración (épica MSF-457, F-OPS-01).
-- Mismo enfoque que backups_postgres.test.sql: el "actor" que escribe es el
-- rol de servicio kestra_backups, así que sus permisos se chequean con
-- has_function_privilege y el comportamiento se ejerce como postgres (dueño
-- de las funciones). La lectura se prueba asumiendo rol authenticated.
begin;

select plan(38);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('e1111111-1111-1111-1111-111111111112', 'Organización Copias');

insert into auth.users (id, email) values
  ('e5000000-0000-0000-0000-000000000015', 'superadmin-copias@example.com'),
  ('e1000000-0000-0000-0000-000000000015', 'admin-copias@example.com'),
  ('e2000000-0000-0000-0000-000000000015', 'miembro-copias@example.com');

insert into superadmins (user_id) values ('e5000000-0000-0000-0000-000000000015');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000015', 'e1111111-1111-1111-1111-111111111112', 'administrador'),
  ('e2000000-0000-0000-0000-000000000015', 'e1111111-1111-1111-1111-111111111112', 'miembro');

-- ============================================================================
-- Permisos: solo kestra_backups ejecuta las funciones (FR-008)
-- [kestra_backups, authenticated, anon] por función
-- ============================================================================

select is(
  array[
    has_function_privilege('kestra_backups', 'public.iniciar_respaldo_imagenes(text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.iniciar_respaldo_imagenes(text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.iniciar_respaldo_imagenes(text)', 'EXECUTE')
  ],
  array[true, false, false],
  'iniciar_respaldo_imagenes: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_respaldo_imagenes_completado: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_respaldo_imagenes_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_respaldo_imagenes_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_respaldo_imagenes_error(bigint, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_respaldo_imagenes_error: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.iniciar_verificacion_restauracion()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.iniciar_verificacion_restauracion()', 'EXECUTE'),
    has_function_privilege('anon', 'public.iniciar_verificacion_restauracion()', 'EXECUTE')
  ],
  array[true, false, false],
  'iniciar_verificacion_restauracion: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_verificacion_completado(bigint, integer, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_verificacion_completado(bigint, integer, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_verificacion_completado(bigint, integer, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_verificacion_completado: solo kestra_backups'
);

select is(
  array[
    has_function_privilege('kestra_backups', 'public.finalizar_verificacion_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.finalizar_verificacion_error(bigint, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.finalizar_verificacion_error(bigint, text)', 'EXECUTE')
  ],
  array[true, false, false],
  'finalizar_verificacion_error: solo kestra_backups'
);

-- ============================================================================
-- Tablas: anon sin lectura, authenticated sin escritura directa, RLS activa
-- ============================================================================

select is(has_table_privilege('anon', 'public.respaldos_imagenes', 'SELECT'), false,
  'anon no puede leer respaldos_imagenes');
select is(has_table_privilege('anon', 'public.verificaciones_restauracion', 'SELECT'), false,
  'anon no puede leer verificaciones_restauracion');
select is(has_table_privilege('authenticated', 'public.respaldos_imagenes', 'INSERT'), false,
  'authenticated no escribe directo en respaldos_imagenes');
select is(has_table_privilege('authenticated', 'public.verificaciones_restauracion', 'INSERT'), false,
  'authenticated no escribe directo en verificaciones_restauracion');

select is(
  (select relrowsecurity from pg_class where oid = 'public.respaldos_imagenes'::regclass),
  true,
  'respaldos_imagenes tiene RLS activa'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.verificaciones_restauracion'::regclass),
  true,
  'verificaciones_restauracion tiene RLS activa'
);

-- ============================================================================
-- Copia de imágenes
-- ============================================================================

select throws_ok(
  $$select public.iniciar_respaldo_imagenes('otro')$$,
  '22023',
  null,
  'iniciar_respaldo_imagenes rechaza un origen que no es programado ni manual'
);

select is(
  (select estado from public.iniciar_respaldo_imagenes('programado')),
  'en_progreso',
  'iniciar_respaldo_imagenes crea la fila en_progreso'
);

select throws_ok(
  $$select public.iniciar_respaldo_imagenes('manual')$$,
  '55006',
  'Ya hay una copia de imágenes en progreso',
  'una segunda copia mientras la primera sigue en_progreso se rechaza'
);

select throws_ok(
  $$insert into public.respaldos_imagenes (origen, estado, finalizado_en, cantidad_objetos, tamano_bytes, ubicacion)
    values ('programado', 'completado', clock_timestamp(), 3, 1024, null)$$,
  '23514',
  null,
  'el check rechaza una copia de imágenes completada sin ubicación'
);

select lives_ok(
  $$select public.finalizar_respaldo_imagenes_completado(
      (select id from public.respaldos_imagenes where estado = 'en_progreso'),
      12, 4096, 'respaldos:/respaldos/imagenes/20261018-030000'
    )$$,
  'finalizar_respaldo_imagenes_completado no lanza error'
);

select is(
  (select estado || ':' || cantidad_objetos || ':' || tamano_bytes
     from public.respaldos_imagenes where ubicacion = 'respaldos:/respaldos/imagenes/20261018-030000'),
  'completado:12:4096',
  'la copia de imágenes queda completada con cantidad y tamaño'
);

insert into public.respaldos_imagenes (origen, estado, iniciado_en)
values ('programado', 'en_progreso', clock_timestamp() - interval '4 hours');

select lives_ok(
  $$select public.iniciar_respaldo_imagenes('programado')$$,
  'iniciar_respaldo_imagenes auto-sana la fila colgada y arranca la nueva'
);

select matches(
  (select motivo_error from public.respaldos_imagenes
     where iniciado_en < clock_timestamp() - interval '3 hours'
     order by id desc limit 1),
  'interrumpida',
  'la copia colgada quedó en error con motivo legible'
);

select lives_ok(
  $$select public.finalizar_respaldo_imagenes_error(
      (select id from public.respaldos_imagenes where estado = 'en_progreso'),
      'rclone: no se pudo listar el bucket'
    )$$,
  'finalizar_respaldo_imagenes_error no lanza error'
);

select is(
  (select motivo_error from public.respaldos_imagenes where motivo_error like 'rclone:%'),
  'rclone: no se pudo listar el bucket',
  'el motivo real del fallo queda registrado'
);

-- ============================================================================
-- Verificación de restauración
-- ============================================================================

delete from public.respaldos;

select throws_ok(
  $$select * from public.iniciar_verificacion_restauracion()$$,
  'P0002',
  null,
  'sin copia de base completada no hay nada que verificar'
);

insert into public.respaldos (origen, estado, finalizado_en, tamano_bytes, ubicacion)
values ('programado', 'completado', clock_timestamp(), 2048, 'respaldos:/respaldos/base/20261018-030000-1.dump');

select is(
  (select ubicacion from public.iniciar_verificacion_restauracion()),
  'respaldos:/respaldos/base/20261018-030000-1.dump',
  'iniciar_verificacion_restauracion elige la última copia completada'
);

select throws_ok(
  $$select * from public.iniciar_verificacion_restauracion()$$,
  '55006',
  'Ya hay una verificación de restauración en progreso',
  'una segunda verificación mientras la primera sigue en curso se rechaza'
);

select throws_ok(
  $$insert into public.verificaciones_restauracion (respaldo_id, estado, finalizado_en, duracion_segundos)
    values ((select id from public.respaldos limit 1), 'completado', clock_timestamp(), null)$$,
  '23514',
  null,
  'el check rechaza una verificación completada sin duración'
);

select lives_ok(
  $$select public.finalizar_verificacion_completado(
      (select id from public.verificaciones_restauracion where estado = 'en_progreso'),
      95, 'public.respaldos=1; public.organizaciones=3'
    )$$,
  'finalizar_verificacion_completado no lanza error'
);

select is(
  (select estado || ':' || duracion_segundos from public.verificaciones_restauracion
     where detalle like 'public.respaldos=%'),
  'completado:95',
  'la verificación queda completada con su duración'
);

insert into public.verificaciones_restauracion (respaldo_id, estado, iniciado_en)
values ((select id from public.respaldos limit 1), 'en_progreso', clock_timestamp() - interval '4 hours');

select lives_ok(
  $$select * from public.iniciar_verificacion_restauracion()$$,
  'iniciar_verificacion_restauracion auto-sana la fila colgada y arranca la nueva'
);

select matches(
  (select motivo_error from public.verificaciones_restauracion
     where iniciado_en < clock_timestamp() - interval '3 hours'
     order by id desc limit 1),
  'interrumpida',
  'la verificación colgada quedó en error con motivo legible'
);

select lives_ok(
  $$select public.finalizar_verificacion_error(
      (select id from public.verificaciones_restauracion where estado = 'en_progreso'),
      'restaurar: la tabla public.organizaciones quedó vacía'
    )$$,
  'finalizar_verificacion_error no lanza error'
);

select is(
  (select motivo_error from public.verificaciones_restauracion where motivo_error like 'restaurar:%'),
  'restaurar: la tabla public.organizaciones quedó vacía',
  'el motivo real del fallo de la verificación queda registrado'
);

-- ============================================================================
-- RLS: solo el superadmin lee
-- ============================================================================

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1000000-0000-0000-0000-000000000015', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.respaldos_imagenes),
  0,
  'un administrador de organización no ve respaldos_imagenes'
);
select is(
  (select count(*)::int from public.verificaciones_restauracion),
  0,
  'un administrador de organización no ve verificaciones_restauracion'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e2000000-0000-0000-0000-000000000015', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.respaldos_imagenes),
  0,
  'un miembro de organización no ve respaldos_imagenes'
);
select is(
  (select count(*)::int from public.verificaciones_restauracion),
  0,
  'un miembro de organización no ve verificaciones_restauracion'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e5000000-0000-0000-0000-000000000015', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select cmp_ok(
  (select count(*)::int from public.respaldos_imagenes),
  '>',
  0,
  'el superadmin ve el historial de copias de imágenes'
);
select cmp_ok(
  (select count(*)::int from public.verificaciones_restauracion),
  '>',
  0,
  'el superadmin ve el historial de verificaciones'
);

reset role;

select * from finish();

rollback;
