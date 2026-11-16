-- MSF-354 (F-IMP-01, RF-IMP-01-3, RF-IMP-01-5): columna del reporte de errores, idempotencia de
-- registrar_error_proceso_masivo (con y sin fila, y pasado el tope de detalle) y eventos de actividad
-- importacion.iniciada / finalizada / cancelada sin datos sensibles. Mismo esquema de fixture que
-- procesos_masivos_worker.test.sql: se llama como postgres con el JWT de un administrador.
begin;

select plan(19);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador');

insert into sistemas_externos (id, descripcion) values ('procesos-prueba', 'Sistema de prueba de procesos masivos')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'procesos-prueba', gen_random_uuid());
insert into capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
select '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'importar-' || n, 3600
from generate_series(1, 4) n;

create function pg_temp.como_admin() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000011', 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.nuevo(p_n int) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.como_admin();
  set local role authenticated;
  v := public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'importar-' || p_n, 'importacion', 'catalogo', 'Carga ' || p_n);
  reset role;
  return v;
end $$;

create function pg_temp.eventos(p_tipo text) returns int language sql as $$
  select count(*)::int from public.registro_actividad where tipo = p_tipo
$$;

-- ============================================================================
-- Actividad: iniciada
-- ============================================================================

select set_config('t.p1', pg_temp.nuevo(1)::text, false);

select is(pg_temp.eventos('importacion.iniciada'), 1, 'iniciar un proceso registra importacion.iniciada');
select is(
  (select actor_id::text from public.registro_actividad where tipo = 'importacion.iniciada'),
  'd1000000-0000-0000-0000-000000000011',
  'el evento queda a nombre de quien inició el proceso'
);
select ok(
  (select detalle from public.registro_actividad where tipo = 'importacion.iniciada') like '%Carga 1%',
  'el detalle nombra el proceso'
);

-- ============================================================================
-- Columna del reporte e idempotencia
-- ============================================================================

select public.actualizar_progreso_proceso_masivo(current_setting('t.p1')::uuid, 1, 2000);

select lives_ok(
  format($f$ select public.registrar_error_proceso_masivo('%s', 3, 'SKU-1', 'Precio inválido', 'precio') $f$, current_setting('t.p1')),
  'el worker registra un error con su columna'
);
select is(
  (select columna from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid and fila = 3),
  'precio',
  'el error guarda la columna'
);
select ok(
  has_column_privilege('authenticated', 'public.procesos_masivos_errores', 'columna', 'select'),
  'la app puede leer la columna del reporte'
);
select ok(
  not has_table_privilege('authenticated', 'public.procesos_masivos_errores_claves', 'select')
  and not has_table_privilege('anon', 'public.procesos_masivos_errores_claves', 'select'),
  'la tabla de claves de idempotencia no es legible desde la app'
);

-- Errores sin fila: el reintento no duplica ni suma.
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, null, 'LOTE-9', 'Servicio no disponible');
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, null, 'LOTE-9', 'Servicio no disponible');
select is(
  (select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  2,
  'un error sin fila repetido (reintento) se cuenta una sola vez'
);
select is(
  (select count(*)::int from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid and fila is null),
  1,
  'y su detalle no se duplica'
);

-- Pasado el tope de 1000 detalles, repetir una fila ya contada no vuelve a sumar.
do $$
begin
  for i in 1..1100 loop
    perform public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, i + 100, 'REF-' || i, 'Fila inválida');
  end loop;
end $$;
select is(
  (select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  1102,
  'con_errores cuenta cada fila una vez (1100 filas + 2 anteriores)'
);
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, 1200, 'REF-1100', 'Fila inválida');
select is(
  (select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  1102,
  'repetir una fila posterior al tope de detalle no vuelve a contarla'
);
select is(
  (select count(*)::int from public.procesos_masivos_errores where proceso_id = current_setting('t.p1')::uuid),
  1000,
  'el detalle sigue topeado en 1000'
);

-- ============================================================================
-- Actividad: finalizada (solo cifras, sin motivo ni filas)
-- ============================================================================

select public.actualizar_progreso_proceso_masivo(current_setting('t.p1')::uuid, 1500, 1500);
select public.cerrar_proceso_masivo(current_setting('t.p1')::uuid, 'con_errores');
select is(pg_temp.eventos('importacion.finalizada'), 1, 'cerrar el proceso registra importacion.finalizada');
select ok(
  (select detalle from public.registro_actividad where tipo = 'importacion.finalizada') like '%398 correctas y 1102 con error%',
  'la finalización lleva las cifras (procesados - con_errores correctas)'
);
select ok(
  (select detalle from public.registro_actividad where tipo = 'importacion.finalizada') !~* '(SKU-1|Precio|REF-|Servicio)',
  'la actividad no lleva referencias ni motivos de error'
);

-- ============================================================================
-- Actividad: cancelada
-- ============================================================================

select set_config('t.p2', pg_temp.nuevo(2)::text, false);
select pg_temp.como_admin();
set local role authenticated;
select public.solicitar_cancelacion_proceso_masivo(current_setting('t.p2')::uuid);
reset role;
select is(pg_temp.eventos('importacion.cancelada'), 1, 'cancelar un proceso pendiente registra importacion.cancelada');

select set_config('t.p3', pg_temp.nuevo(3)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p3')::uuid, 5, 10);
select pg_temp.como_admin();
set local role authenticated;
select public.solicitar_cancelacion_proceso_masivo(current_setting('t.p3')::uuid);
select public.solicitar_cancelacion_proceso_masivo(current_setting('t.p3')::uuid);
reset role;
select is(pg_temp.eventos('importacion.cancelada'), 2, 'pedir dos veces la cancelación de uno en curso la registra una sola vez');

select public.cerrar_proceso_masivo(current_setting('t.p3')::uuid, 'cancelado');
select is(pg_temp.eventos('importacion.cancelada'), 2, 'el cierre cancelado de una cancelación ya pedida no la registra de nuevo');
select is(pg_temp.eventos('importacion.finalizada'), 1, 'y un cierre cancelado no cuenta como finalizada');

select * from finish();
rollback;
