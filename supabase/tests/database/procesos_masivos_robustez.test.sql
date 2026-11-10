-- Épica MSF-206 (revisión independiente): robustez de los procesos masivos.
--   * Tope de claves de idempotencia (10.000) y marca `detalle_truncado`.
--   * Validaciones de cierre (cancelado exige solicitud; completado/con_errores exigen procesados = total) y archivo vacío.
--   * Capacidad de importación / exportación en `iniciar_proceso_masivo`.
--   * Huérfanos: orden agotada -> ejecución fallida -> proceso fallido; ejecución vencida -> timeout; cancelación del
--     administrador de un proceso sin worker vivo.
--   * Cancelar procesos pendientes no genera una alerta de sincronización.
-- Mismo esquema de fixture que procesos_masivos_worker.test.sql (como postgres con el JWT de un administrador).
begin;

select plan(37);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador');

insert into sistemas_externos (id, descripcion) values ('procesos-prueba', 'Sistema de prueba de procesos masivos')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'procesos-prueba', gen_random_uuid());
insert into capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
select '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'importar-' || n, 3600
from generate_series(1, 12) n;
insert into capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg) values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'exportar-todo', 3600),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'carga-vieja', 3600);

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

create function pg_temp.cancelar(p uuid) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.como_admin();
  set local role authenticated;
  r := public.solicitar_cancelacion_proceso_masivo(p);
  reset role;
  return r;
end $$;

-- ============================================================================
-- Capacidad permitida
-- ============================================================================

select pg_temp.como_admin();
set local role authenticated;
select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'carga-vieja', 'importacion', 'catalogo', 'Carga') $$,
  '22023', null, 'una capacidad que no es importar-…/exportar-… se rechaza');
select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'exportar-todo', 'importacion', 'catalogo', 'Carga') $$,
  '22023', null, 'una exportación no puede declararse importación');
select throws_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'importar-1', 'exportacion', 'catalogo', 'Carga') $$,
  '22023', null, 'ni una importación declararse exportación');
select lives_ok(
  $$ select public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'exportar-todo', 'exportacion', 'exportacion-total', 'Todo') $$,
  'exportar-… con tipo exportacion es válido');
reset role;

-- ============================================================================
-- Tope de claves y detalle truncado
-- ============================================================================

select set_config('t.p1', pg_temp.nuevo(1)::text, false);
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, 1, 'A', 'Mal');
select is((select detalle_truncado from public.procesos_masivos where id = current_setting('t.p1')::uuid), false,
  'con pocos errores el detalle no está truncado');

-- Se simulan 9.999 errores ya contados y se llega al tope de claves.
update public.procesos_masivos set con_errores = 9999 where id = current_setting('t.p1')::uuid;
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, 20000, 'B', 'Mal');
select is((select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid), 10000, 'el error 10.000 se cuenta');
select is((select count(*)::int from public.procesos_masivos_errores_claves where proceso_id = current_setting('t.p1')::uuid), 2,
  'y todavía guarda su clave (la del error 1 y la del error 10.000)');
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, 20001, 'C', 'Mal');
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, 20002, 'D', 'Mal');
select is((select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid), 10002, 'pasado el tope solo se cuenta');
select is((select count(*)::int from public.procesos_masivos_errores_claves where proceso_id = current_setting('t.p1')::uuid), 2,
  'pasado el tope de claves no se inserta ninguna fila de clave ni de detalle nueva');
select is((select detalle_truncado from public.procesos_masivos where id = current_setting('t.p1')::uuid), true, 'el proceso queda marcado «detalle truncado»');

-- Reintentos pasado el tope: la marca de agua evita contar de nuevo (el worker informa en orden ascendente).
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, 20001, 'C', 'Mal');
select is((select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid), 10002, 'reintentar una fila contada sin clave no vuelve a sumar');
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, 1, 'A', 'Mal');
select is((select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid), 10002, 'reintentar una fila que tiene clave tampoco suma');
select public.registrar_error_proceso_masivo(current_setting('t.p1')::uuid, 20003, 'E', 'Mal');
select is((select con_errores from public.procesos_masivos where id = current_setting('t.p1')::uuid), 10003, 'una fila nueva posterior sí suma');

-- Tope de 1000 detalles: 1000 errores no truncan, el 1001 sí.
select set_config('t.p2', pg_temp.nuevo(2)::text, false);
do $$
begin
  for i in 1..1000 loop
    perform public.registrar_error_proceso_masivo(current_setting('t.p2')::uuid, i, 'REF-' || i, 'Inválida');
  end loop;
end $$;
select is((select detalle_truncado from public.procesos_masivos where id = current_setting('t.p2')::uuid), false, '1000 errores caben en el detalle');
select public.registrar_error_proceso_masivo(current_setting('t.p2')::uuid, 1001, 'REF-1001', 'Inválida');
select is((select detalle_truncado || '/' || con_errores from public.procesos_masivos where id = current_setting('t.p2')::uuid), 'true/1001',
  'el error 1001 se cuenta pero marca el detalle como truncado');
select is((select count(*)::int from public.procesos_masivos_errores where proceso_id = current_setting('t.p2')::uuid), 1000, 'el detalle sigue en 1000');

-- ============================================================================
-- Validaciones de cierre
-- ============================================================================

select set_config('t.p3', pg_temp.nuevo(3)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p3')::uuid, 5, 10);
select throws_ok(format($f$ select public.cerrar_proceso_masivo('%s', 'completado') $f$, current_setting('t.p3')),
  '22023', null, 'completado con 5 de 10 procesados se rechaza');
select public.registrar_error_proceso_masivo(current_setting('t.p3')::uuid, 1, 'X', 'Mal');
select throws_ok(format($f$ select public.cerrar_proceso_masivo('%s', 'con_errores') $f$, current_setting('t.p3')),
  '22023', null, 'con_errores con 5 de 10 procesados se rechaza');
select throws_ok(format($f$ select public.cerrar_proceso_masivo('%s', 'cancelado') $f$, current_setting('t.p3')),
  '22023', null, 'cancelado sin cancelación solicitada se rechaza');
select lives_ok(format($f$ select public.cerrar_proceso_masivo('%s', 'fallido', 'No pudo terminar') $f$, current_setting('t.p3')),
  'fallido sí puede cerrarse sin haber terminado');
select set_config('t.p4', pg_temp.nuevo(4)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p4')::uuid, 10, 10);
select lives_ok(format($f$ select public.cerrar_proceso_masivo('%s', 'completado') $f$, current_setting('t.p4')),
  'completado con 10 de 10 procesados se acepta');

-- Archivo vacío: 0 de 0.
select set_config('t.p5', pg_temp.nuevo(5)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p5')::uuid, 0, 0);
select lives_ok(format($f$ select public.cerrar_proceso_masivo('%s', 'completado') $f$, current_setting('t.p5')),
  'un archivo vacío (0 de 0) se cierra completado');
select is((select estado || '/' || procesados || '/' || total from public.procesos_masivos where id = current_setting('t.p5')::uuid), 'completado/0/0',
  'y queda en 0 de 0');

-- ============================================================================
-- Huérfanos: orden agotada
-- ============================================================================

select set_config('t.p6', pg_temp.nuevo(6)::text, false);
update public.despachos_ejecucion set estado = 'agotada', ultimo_error_sanitizado = 'AGOTADO'
where ejecucion_id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p6')::uuid);
select is((select estado || '/' || motivo_sanitizado from public.ejecuciones_worker
  where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p6')::uuid)),
  'fallida/DESPACHO_AGOTADO', 'al agotarse la orden la ejecución del proceso se cierra fallida');
select is((select estado from public.procesos_masivos where id = current_setting('t.p6')::uuid), 'fallido', 'y el proceso pasa a fallido');
select ok((select motivo_sanitizado from public.procesos_masivos_errores where proceso_id = current_setting('t.p6')::uuid) like 'No se pudo iniciar%',
  'con un motivo claro para el usuario');

-- ============================================================================
-- Huérfanos: ejecución vencida por tiempo máximo
-- ============================================================================

select set_config('t.p7', pg_temp.nuevo(7)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p7')::uuid, 3, 10);
update public.ejecuciones_worker set iniciada_en = now() - interval '2 hours'
where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p7')::uuid);
select is(private.cerrar_procesos_masivos_vencidos(), 1, 'se cierra la ejecución que superó su tiempo máximo');
select is((select estado from public.ejecuciones_worker where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p7')::uuid)),
  'timeout', 'queda en timeout');
select is((select estado from public.procesos_masivos where id = current_setting('t.p7')::uuid), 'fallido', 'y el proceso en fallido');
select ok((select motivo_sanitizado from public.procesos_masivos_errores where proceso_id = current_setting('t.p7')::uuid) like 'El proceso superó el tiempo máximo%',
  'con el motivo del tiempo máximo');

-- ============================================================================
-- Cancelación del administrador de un proceso sin worker vivo
-- ============================================================================

-- (a) ejecución vencida: el proceso en curso se cierra cancelado de inmediato.
select set_config('t.p8', pg_temp.nuevo(8)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p8')::uuid, 3, 10);
update public.ejecuciones_worker set iniciada_en = now() - interval '2 hours'
where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p8')::uuid);
select is(pg_temp.cancelar(current_setting('t.p8')::uuid), 'cancelado', 'cancelar un proceso con la ejecución vencida lo cierra cancelado');
select is((select estado from public.procesos_masivos where id = current_setting('t.p8')::uuid), 'cancelado', 'el proceso queda cancelado');
select is((select estado from public.ejecuciones_worker where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p8')::uuid)),
  'timeout', 'y la ejecución vencida queda en timeout');

-- (b) ejecución cerrada sin que el proceso se cerrara.
select set_config('t.p9', pg_temp.nuevo(9)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p9')::uuid, 3, 10);
update public.ejecuciones_worker set estado = 'exitosa', finalizada_en = clock_timestamp()
where id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p9')::uuid);
select is(pg_temp.cancelar(current_setting('t.p9')::uuid), 'cancelado', 'cancelar un proceso abierto cuya ejecución ya terminó lo cierra cancelado');

-- (c) con worker vivo sigue siendo cooperativa.
select set_config('t.p10', pg_temp.nuevo(10)::text, false);
select public.actualizar_progreso_proceso_masivo(current_setting('t.p10')::uuid, 3, 10);
select is(pg_temp.cancelar(current_setting('t.p10')::uuid), 'cancelacion_solicitada', 'con worker vivo la cancelación sigue siendo solicitada');

-- ============================================================================
-- Cancelar procesos pendientes no genera una alerta falsa de sincronización
-- ============================================================================

select set_config('t.p11', pg_temp.nuevo(11)::text, false);
select set_config('t.p12', pg_temp.nuevo(12)::text, false);
select is(pg_temp.cancelar(current_setting('t.p11')::uuid) || '/' || pg_temp.cancelar(current_setting('t.p12')::uuid), 'cancelado/cancelado',
  'dos procesos pendientes se cancelan');
select is((select count(*)::int from public.evaluar_monitoreo(10, 1, 15) where fuente = 'sincronizacion' and clave like '%importar-1_'), 0,
  'las ejecuciones canceladas no abren una alerta de sincronización (ni con umbral de 1 fallo)');

select * from finish();
rollback;
