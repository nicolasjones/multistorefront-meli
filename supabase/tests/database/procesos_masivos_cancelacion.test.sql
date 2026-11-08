-- MSF-354 (F-IMP-01, FR-009, FR-010): cancelación de procesos masivos. Pendiente -> cancelado de
-- inmediato (libera la orden de despacho y la capacidad); en curso -> cancelación solicitada que el
-- worker detecta con `proceso_masivo_cancelado`; terminal -> PROCESO_TERMINADO.
begin;

select plan(20);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'miembro-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into sistemas_externos (id, descripcion) values ('procesos-prueba', 'Sistema de prueba de procesos masivos')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'procesos-prueba', gen_random_uuid());
insert into capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
select '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-0000000000c1', 'importar-' || n, 3600
from generate_series(1, 4) n;

create function pg_temp.como_admin(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.nuevo(p_n int) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');
  set local role authenticated;
  v := public.iniciar_proceso_masivo('c1000000-0000-0000-0000-0000000000c1', 'importar-' || p_n, 'importacion', 'catalogo', 'Carga ' || p_n);
  reset role;
  return v;
end $$;

-- ============================================================================
-- Permisos
-- ============================================================================

select ok(
  has_function_privilege('authenticated', 'public.solicitar_cancelacion_proceso_masivo(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.solicitar_cancelacion_proceso_masivo(uuid)', 'execute'),
  'solicitar_cancelacion_proceso_masivo: authenticated sí, anon no'
);

select ok(
  has_function_privilege('workers_orquestacion', 'public.proceso_masivo_cancelado(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.proceso_masivo_cancelado(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.proceso_masivo_cancelado(uuid)', 'execute'),
  'proceso_masivo_cancelado: solo los workers'
);

select set_config('t.p1', pg_temp.nuevo(1)::text, false);

select pg_temp.como_admin('d1000000-0000-0000-0000-000000000012');
set local role authenticated;
select throws_ok(
  format($f$ select public.solicitar_cancelacion_proceso_masivo('%s') $f$, current_setting('t.p1')),
  '42501', null, 'un miembro que no es administrador no cancela'
);
reset role;

select pg_temp.como_admin('d2000000-0000-0000-0000-000000000011');
set local role authenticated;
select throws_ok(
  format($f$ select public.solicitar_cancelacion_proceso_masivo('%s') $f$, current_setting('t.p1')),
  '42501', null, 'el administrador de otra organización no cancela'
);
select throws_ok(
  $$ select public.solicitar_cancelacion_proceso_masivo(gen_random_uuid()) $$,
  '42501', null, 'un proceso inexistente da el mismo error que uno ajeno'
);
reset role;

select is(
  (select estado from public.procesos_masivos where id = current_setting('t.p1')::uuid),
  'pendiente',
  'las cancelaciones rechazadas no tocan el proceso'
);

-- ============================================================================
-- Pendiente -> cancelado de inmediato (libera la orden)
-- ============================================================================

select pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');
set local role authenticated;

select is(
  public.solicitar_cancelacion_proceso_masivo(current_setting('t.p1')::uuid),
  'cancelado',
  'cancelar un proceso pendiente da cancelado'
);

reset role;

select is(
  (select p.estado || '/' || (p.finalizado_en is not null) || '/' || d.estado || '/' || e.estado
     from public.procesos_masivos p
     join public.ejecuciones_worker e on e.id = p.ejecucion_id
     join public.despachos_ejecucion d on d.ejecucion_id = e.id
    where p.id = current_setting('t.p1')::uuid),
  'cancelado/true/cancelada/fallida',
  'el proceso queda cancelado, su orden liberada y su ejecución cerrada'
);

select lives_ok(
  $$ select pg_temp.nuevo(1) $$,
  'la capacidad quedó libre: se puede iniciar otra carga'
);

select pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');
set local role authenticated;

select throws_ok(
  format($f$ select public.solicitar_cancelacion_proceso_masivo('%s') $f$, current_setting('t.p1')),
  'P0001', null, 'cancelar un proceso terminal da PROCESO_TERMINADO'
);

reset role;

-- ============================================================================
-- En curso -> cancelación solicitada; el worker la detecta y confirma
-- ============================================================================

select set_config('t.p2', pg_temp.nuevo(2)::text, false);
select pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');

select is(public.proceso_masivo_cancelado(current_setting('t.p2')::uuid), false, 'sin pedido, el worker no ve cancelación');

select public.actualizar_progreso_proceso_masivo(current_setting('t.p2')::uuid, 30, 100);

set local role authenticated;
select is(
  public.solicitar_cancelacion_proceso_masivo(current_setting('t.p2')::uuid),
  'cancelacion_solicitada',
  'cancelar un proceso en curso solo solicita la cancelación'
);
reset role;

select is(
  (select estado || '/' || cancelacion_solicitada || '/' || procesados from public.procesos_masivos where id = current_setting('t.p2')::uuid),
  'en_curso/true/30',
  'sigue en curso, con la solicitud marcada y lo procesado intacto'
);

select is(public.proceso_masivo_cancelado(current_setting('t.p2')::uuid), true, 'el worker detecta la cancelación entre lotes');

select lives_ok(
  format($f$ select public.cerrar_proceso_masivo('%s', 'cancelado') $f$, current_setting('t.p2')),
  'el worker confirma cerrando cancelado'
);

select is(
  (select estado || '/' || procesados from public.procesos_masivos where id = current_setting('t.p2')::uuid),
  'cancelado/30',
  'el proceso queda cancelado conservando lo ya procesado'
);

-- ============================================================================
-- Pendiente con la orden ya reclamada: la cancelación es cooperativa
-- ============================================================================

select set_config('t.p3', pg_temp.nuevo(3)::text, false);
update public.despachos_ejecucion set estado = 'reclamada', intentos = 1, reclamada_en = clock_timestamp(),
  vence_en = clock_timestamp() + interval '5 minutes'
where ejecucion_id = (select ejecucion_id from public.procesos_masivos where id = current_setting('t.p3')::uuid);

select pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');
set local role authenticated;
select is(
  public.solicitar_cancelacion_proceso_masivo(current_setting('t.p3')::uuid),
  'cancelacion_solicitada',
  'con la orden ya reclamada por Kestra, la cancelación queda solicitada'
);
reset role;

select is(
  (select p.estado || '/' || d.estado from public.procesos_masivos p
     join public.despachos_ejecucion d on d.ejecucion_id = p.ejecucion_id
    where p.id = current_setting('t.p3')::uuid),
  'pendiente/reclamada',
  'la orden reclamada no se toca'
);

-- ============================================================================
-- Cerrado justo antes: gana el estado terminal
-- ============================================================================

select set_config('t.p4', pg_temp.nuevo(4)::text, false);
select pg_temp.como_admin('d1000000-0000-0000-0000-000000000011');
select public.cerrar_proceso_masivo(current_setting('t.p4')::uuid, 'completado');

set local role authenticated;
select throws_ok(
  format($f$ select public.solicitar_cancelacion_proceso_masivo('%s') $f$, current_setting('t.p4')),
  'P0001', null, 'si el worker ya cerró, cancelar da PROCESO_TERMINADO'
);
reset role;

select is(
  (select estado from public.procesos_masivos where id = current_setting('t.p4')::uuid),
  'completado',
  'el estado terminal ya guardado no se pisa'
);

select * from finish();
rollback;
