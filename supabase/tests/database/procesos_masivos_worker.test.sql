-- MSF-354 (F-IMP-01, FR-005…FR-008, FR-010): funciones del worker sobre su proceso masivo (progreso
-- monótono y acotado, errores sanitizados con tope, cierre), aislamiento por organización y
-- reconciliación con la ejecución. El rol de conexión (postgres) no es superusuario en el CI y no
-- puede simular el login del worker: las llamadas se hacen como postgres con el JWT de un
-- administrador (lo que `autorizar_llamante_ciclo` acepta) y el gate de rol se cubre con grants.
begin;

select plan(42);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into sistemas_externos (id, descripcion) values ('procesos-prueba', 'Sistema de prueba de procesos masivos')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'procesos-prueba', gen_random_uuid());
insert into capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
select '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'importar-' || n, 3600
from generate_series(1, 6) n;

create function pg_temp.como_admin(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

-- Crea un proceso con la capacidad `importar-<n>` como administrador de la organización Uno.
create function pg_temp.nuevo(p_n int) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');
  set local role authenticated;
  v := public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'importar-' || p_n, 'importacion', 'catalogo', 'Carga ' || p_n);
  reset role;
  return v;
end $$;

select set_config('t.p1', pg_temp.nuevo(1)::text, false);

-- ============================================================================
-- Permisos: solo el worker (FR-010)
-- ============================================================================

select ok(
  not has_function_privilege('authenticated', 'public.actualizar_progreso_proceso_masivo(uuid, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.actualizar_progreso_proceso_masivo(uuid, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.registrar_error_proceso_masivo(uuid, integer, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_error_proceso_masivo(uuid, integer, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.cerrar_proceso_masivo(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.cerrar_proceso_masivo(uuid, text, text)', 'execute'),
  'ni authenticated ni anon ejecutan las funciones del worker'
);

select ok(
  has_function_privilege('workers_orquestacion', 'public.actualizar_progreso_proceso_masivo(uuid, integer, integer)', 'execute')
  and has_function_privilege('workers_orquestacion', 'public.registrar_error_proceso_masivo(uuid, integer, text, text, text)', 'execute')
  and has_function_privilege('workers_orquestacion', 'public.cerrar_proceso_masivo(uuid, text, text)', 'execute'),
  'los workers ejecutan las funciones de su proceso'
);

select pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');
set local role authenticated;

select throws_ok(
  format($f$ select public.actualizar_progreso_proceso_masivo('%s', 1, 10) $f$, current_setting('t.p1')),
  '42501', null, 'una sesión de la app no informa progreso (solo el worker)'
);

reset role;

-- ============================================================================
-- Progreso (FR-005)
-- ============================================================================

select lives_ok(
  format($f$ select public.actualizar_progreso_proceso_masivo('%s', 10, 100) $f$, current_setting('t.p1')),
  'el worker informa su avance'
);

select is(
  (select estado || '/' || procesados || '/' || total || '/' || (iniciado_en is not null) from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  'en_curso/10/100/true',
  'el primer avance pasa el proceso a en_curso con total y procesados'
);

select lives_ok(
  format($f$ select public.actualizar_progreso_proceso_masivo('%s', 4) $f$, current_setting('t.p1')),
  'un avance menor no falla'
);

select is(
  (select procesados from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  10,
  'procesados no retrocede'
);

select lives_ok(
  format($f$ select public.actualizar_progreso_proceso_masivo('%s', 500) $f$, current_setting('t.p1')),
  'un avance mayor que el total no falla'
);

select is(
  (select procesados from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  100,
  'procesados se acota a total'
);

select throws_ok(
  format($f$ select public.actualizar_progreso_proceso_masivo('%s', -1) $f$, current_setting('t.p1')),
  '22023', null, 'un avance negativo se rechaza'
);

select throws_ok(
  $$ select public.actualizar_progreso_proceso_masivo(gen_random_uuid(), 1) $$,
  'P0001', null, 'un proceso desconocido se rechaza'
);

-- ============================================================================
-- Errores (FR-006)
-- ============================================================================

select lives_ok(
  format($f$ select public.registrar_error_proceso_masivo('%s', 3, 'SKU-1', 'Precio inválido, avisar a ana@example.com password=abc123 tel 11 4444-5555') $f$, current_setting('t.p1')),
  'el worker registra un error por fila'
);

select is(
  (select fila || '/' || referencia from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid),
  '3/SKU-1',
  'el error guarda fila y referencia'
);

select ok(
  (select motivo_sanitizado from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid)
    !~ '(@|abc123|4444)'
  and (select motivo_sanitizado from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid) like 'Precio inválido%',
  'el motivo se sanitiza en la base: sin correo, secreto ni teléfono'
);

select is(
  (select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  1,
  'con_errores aumenta'
);

select lives_ok(
  format($f$ select public.registrar_error_proceso_masivo('%s', 4, '7791234567890', 'Código repetido') $f$, current_setting('t.p1')),
  'la referencia numérica (un código de barras) se acepta'
);

select is(
  (select referencia from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid and fila = 4),
  '7791234567890',
  'la referencia no se confunde con un teléfono'
);

select is(
  private.sanitizar_motivo_proceso('Falló {"token":"abc"} y "password": "x"'),
  'Falló {"[secreto] y "[secreto]',
  'el motivo redacta credenciales con forma JSON'
);

select lives_ok(
  format($f$ select public.registrar_error_proceso_masivo('%s', 3, 'SKU-1', 'Precio inválido') $f$, current_setting('t.p1')),
  'el reintento del mismo lote (misma fila) no falla'
);

select is(
  (select count(*)::int from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid and fila = 3)
  || '/' || (select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  '1/2',
  'el reintento no duplica el error de la fila ni suma a con_errores'
);

select throws_ok(
  format($f$ select public.registrar_error_proceso_masivo('%s', 5, 'X', '   ') $f$, current_setting('t.p1')),
  '22023', null, 'el motivo es obligatorio'
);

do $$
begin
  for i in 1..1100 loop
    perform public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, i + 10, 'REF-' || i, 'Fila inválida');
  end loop;
end $$;

select is(
  (select count(*)::int from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid),
  1000,
  'se guardan como máximo 1000 detalles de error por proceso'
);

select is(
  (select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  1102,
  'con_errores sigue contando todos los errores'
);

-- ============================================================================
-- Otra organización: el worker solo escribe en su propia organización (FR-010)
-- ============================================================================

select pg_temp.como_admin('d2000000-0000-0000-0000-000000000011');

select throws_ok(
  format($f$ select public.registrar_error_proceso_masivo('%s', 1, 'X', 'Intruso') $f$, current_setting('t.p1')),
  'P0001', null, 'un worker de otra organización no escribe errores'
);

select throws_ok(
  format($f$ select public.actualizar_progreso_proceso_masivo('%s', 1) $f$, current_setting('t.p1')),
  'P0001', null, 'un worker de otra organización no informa progreso'
);

select throws_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'fallido') $f$, current_setting('t.p1')),
  'P0001', null, 'un worker de otra organización no cierra el proceso'
);

select pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');

-- ============================================================================
-- Cierre (FR-007)
-- ============================================================================

select throws_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'completado') $f$, current_setting('t.p1')),
  '22023', null, 'completado no vale si hubo filas rechazadas'
);

select throws_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'terminado') $f$, current_setting('t.p1')),
  '22023', null, 'un estado de cierre desconocido se rechaza'
);

select lives_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'con_errores') $f$, current_setting('t.p1')),
  'el worker cierra con_errores'
);

select is(
  (select estado || '/' || (finalizado_en is not null) from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  'con_errores/true',
  'el proceso queda con_errores y con fecha de fin'
);

select throws_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'fallido') $f$, current_setting('t.p1')),
  'P0001', null, 'un proceso terminado no se vuelve a cerrar'
);

select throws_ok(
  format($f$ select public.actualizar_progreso_proceso_masivo('%s', 1) $f$, current_setting('t.p1')),
  'P0001', null, 'un proceso terminado no acepta avances'
);

select throws_ok(
  format($f$ select public.registrar_error_proceso_masivo('%s', 1, 'X', 'Tarde') $f$, current_setting('t.p1')),
  'P0001', null, 'un proceso terminado no acepta errores'
);

select set_config('t.p2', pg_temp.nuevo(2)::text, false);
select throws_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'con_errores') $f$, current_setting('t.p2')),
  '22023', null, 'con_errores exige al menos una fila rechazada'
);
select lives_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'completado') $f$, current_setting('t.p2')),
  'un proceso sin errores se cierra completado'
);
select is(
  (select estado || '/' || total from public.procesos_masivos where id = current_setting('t.p2')::uuid),
  'completado/0',
  'completado deja el total en lo procesado cuando no se informó'
);

select set_config('t.p3', pg_temp.nuevo(3)::text, false);
select lives_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'fallido', 'No se pudo leer el archivo') $f$, current_setting('t.p3')),
  'el worker cierra fallido con un motivo'
);
select is(
  (select estado || '/' || count(e.*) || '/' || max(p.con_errores) from public.procesos_masivos p
    left join public.procesos_masivos_errores e on e.proceso_id = p.id and e.fila is null
    where p.id = current_setting('t.p3')::uuid group by p.estado),
  'fallido/1/0',
  'el motivo del cierre queda como detalle sin fila y no cuenta como fila rechazada'
);

-- ============================================================================
-- Reconciliación con la ejecución (FR-008)
-- ============================================================================

select set_config('t.p4', pg_temp.nuevo(4)::text, false);
select set_config('t.p5', pg_temp.nuevo(5)::text, false);
select set_config('t.p6', pg_temp.nuevo(6)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p4')::uuid, 5, 10);

update public.ejecuciones_worker set estado = 'fallida', finalizada_en = clock_timestamp(), motivo_sanitizado = 'WORKER_CAIDO'
where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p4')::uuid);

select is(
  (select estado || '/' || (finalizado_en is not null) from public.procesos_masivos where id = current_setting('t.p4')::uuid),
  'fallido/true',
  'si la ejecución termina fallida, el proceso en curso pasa a fallido'
);

select is(
  (select motivo_sanitizado from public.procesos_masivos_errores where proceso_id = current_setting('t.p4')::uuid),
  'WORKER_CAIDO',
  'el motivo de la ejecución queda como detalle del proceso'
);

update public.ejecuciones_worker set estado = 'timeout', finalizada_en = clock_timestamp(), motivo_sanitizado = 'TIMEOUT:3600s'
where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p5')::uuid);

select is(
  (select estado from public.procesos_masivos where id = current_setting('t.p5')::uuid),
  'fallido',
  'si la ejecución termina por timeout, el proceso pendiente pasa a fallido'
);

select public.cerrar_proceso_masivo(current_setting('t.p6')::uuid, 'completado');
update public.ejecuciones_worker set estado = 'fallida', finalizada_en = clock_timestamp(), motivo_sanitizado = 'TARDE'
where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p6')::uuid);

select is(
  (select estado from public.procesos_masivos where id = current_setting('t.p6')::uuid),
  'completado',
  'un proceso ya cerrado no cambia cuando su ejecución falla después'
);

select * from finish();
rollback;
