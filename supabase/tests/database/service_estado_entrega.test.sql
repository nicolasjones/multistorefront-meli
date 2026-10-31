-- F-SVC-03 (MSF-303, épica MSF-182): cambio de estado, historial, entrega y anulación (SC-005).
-- Cubre: cambio idempotente (sin historial duplicado) y serializado (`for update`), historial íntegro y
-- ordenado, estado ajeno / inactivo / que cierra rechazado, entrega con validaciones (fecha, quién), cambio
-- de estado en la misma transacción, anulación irreversible y de solo lectura, `42501` con `lectura` /
-- `ninguno`, `anon` sin ejecución, actividad `reparacion.*` y aislamiento entre organizaciones.
-- La concurrencia real no cabe en una transacción: se prueba el bloqueo de fila en el código de la RPC.
-- Matriz vigente de `service_tecnico`: administrador y operador `edicion`; consulta y administración
-- `lectura`; depósito `ninguno`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador solo accede a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Estados sembrados (F-SVC-01): Recibido, En diagnóstico, … Entregado y Sin reparación (cierran).
create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1) as modelo_dos,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Recibido') as recibido,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'En diagnóstico') as diagnostico,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'En reparación') as reparacion,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra order by orden limit 1) as cierra_uno,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra order by orden desc limit 1) as cierra_dos,
    (select id from dominio.estados_reparacion where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1) as estado_dos;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

-- ============================================================================
-- Privilegios y diseño
-- ============================================================================

select is(
  (select count(*) from unnest(array[
    'public.cambiar_estado_reparacion(uuid,uuid)',
    'public.registrar_entrega_reparacion(uuid,uuid,date,text)',
    'public.anular_reparacion(uuid,text,uuid[])',
    'public.historial_reparacion(uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de estado, entrega y anulación');
select is(
  (select count(*) from unnest(array[
    'public.cambiar_estado_reparacion(uuid,uuid)',
    'public.registrar_entrega_reparacion(uuid,uuid,date,text)',
    'public.anular_reparacion(uuid,text,uuid[])',
    'public.historial_reparacion(uuid)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  4, 'authenticated ejecuta las cuatro RPC');
select ok(
  (select bool_and(prosrc like '%for update%') from pg_proc
    where oid in ('public.cambiar_estado_reparacion(uuid,uuid)'::regprocedure,
                  'public.registrar_entrega_reparacion(uuid,uuid,date,text)'::regprocedure,
                  'public.anular_reparacion(uuid,text,uuid[])'::regprocedure)),
  'las tres RPC bloquean la fila (for update) para serializar cambios simultáneos');

-- ============================================================================
-- Cambio de estado: idempotente, historial íntegro y ordenado
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select 'r1', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'r2', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'otra', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;

select is(
  (public.cambiar_estado_reparacion((select id from reps where clave = 'r1'), (select diagnostico from datos))->>'estado_id')::uuid,
  (select diagnostico from datos), 'cambia el estado y devuelve la reparación');
select is(
  (select count(*) from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'r1') and tipo = 'estado')::int,
  1, 'el cambio escribe un evento estado');
select is(
  (select estado_anterior_id || '/' || estado_nuevo_id from dominio.reparacion_historial
    where reparacion_id = (select id from reps where clave = 'r1') and tipo = 'estado'),
  (select recibido || '/' || diagnostico from datos), 'el evento guarda estado anterior y nuevo');
select is(
  (select usuario_id from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'r1') and tipo = 'estado'),
  'e1000000-0000-0000-0000-000000000001'::uuid, 'el evento guarda el usuario');

select is(
  (select array_agg(tipo order by creado_en desc, id desc) from public.historial_reparacion((select id from reps where clave = 'r1'))),
  array['estado', 'alta'], 'historial_reparacion devuelve más reciente primero');
select is(
  (select estado_anterior || '>' || estado_nuevo from public.historial_reparacion((select id from reps where clave = 'r1')) where tipo = 'estado'),
  'Recibido>En diagnóstico', 'historial_reparacion devuelve nombres de estado, no ids');
select is(
  (select usuario from public.historial_reparacion((select id from reps where clave = 'r1')) where tipo = 'estado'),
  'Usuario sin nombre', 'historial_reparacion no expone el email: sin nombre devuelve un texto neutro');

-- Con perfil completo devuelve «Nombre Apellido» y nunca el email.
reset role;
insert into public.perfiles_usuario (user_id, nombre, apellido) values ('e1000000-0000-0000-0000-000000000001', 'Ana', 'Pérez')
  on conflict (user_id) do update set nombre = excluded.nombre, apellido = excluded.apellido;
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select usuario from public.historial_reparacion((select id from reps where clave = 'r1')) where tipo = 'estado'),
  'Ana Pérez', 'historial_reparacion devuelve «Nombre Apellido» con perfil completo');
select is(
  (select count(*) from public.historial_reparacion((select id from reps where clave = 'r1')) where usuario like '%@%')::int,
  0, 'historial_reparacion nunca expone el email');

-- Idempotencia: repetir el mismo estado no duplica historial ni actividad.
select lives_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r1'), (select diagnostico from datos))$$,
  'elegir el estado actual no falla');
select is(
  (select count(*) from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'r1') and tipo = 'estado')::int,
  1, 'elegir el estado actual no duplica el historial');

select public.cambiar_estado_reparacion((select id from reps where clave = 'r1'), (select reparacion from datos));
select public.cambiar_estado_reparacion((select id from reps where clave = 'r1'), (select diagnostico from datos));  -- hacia atrás
select is(
  (select array_agg(tipo order by creado_en, id) from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'r1')),
  array['alta', 'estado', 'estado', 'estado'], 'historial íntegro: alta y tres cambios, en orden');
select is(
  (select count(*) from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'r1') and tipo = 'estado' and estado_anterior_id = estado_nuevo_id)::int,
  0, 'ningún evento deja el mismo estado como anterior y nuevo');

select is(
  (select count(*) from public.registro_actividad where tipo = 'reparacion.estado_cambiado' and organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  3, 'se registra reparacion.estado_cambiado solo por los cambios reales');
select ok(
  (select bool_and(detalle like '%R-%' and detalle !~ '[0-9a-f]{8}-[0-9a-f]{4}') from public.registro_actividad where tipo = 'reparacion.estado_cambiado'),
  'el detalle de la actividad usa el código visible, no ids');

-- Rechazos de estado
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r2'), (select estado_dos from datos))$$,
  '22023', null, 'un estado de otra organización se rechaza');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r2'), gen_random_uuid())$$,
  '22023', null, 'un estado inexistente se rechaza');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r2'), null)$$,
  '22023', null, 'sin estado se rechaza');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r2'), (select cierra_uno from datos))$$,
  '22023', null, 'un estado que cierra no se elige por el cambio de estado: va por la entrega');
select throws_ok(
  $$select public.cambiar_estado_reparacion(gen_random_uuid(), (select diagnostico from datos))$$,
  'P0002', null, 'una reparación inexistente se rechaza');
reset role;
update dominio.estados_reparacion set activo = false where id = (select reparacion from datos);
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r2'), (select reparacion from datos))$$,
  '22023', null, 'un estado desactivado se rechaza');
reset role;
update dominio.estados_reparacion set activo = true where id = (select reparacion from datos);
select pg_temp.como('e1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Entrega
-- ============================================================================

select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r1'), (select diagnostico from datos), current_date, 'Juan')$$,
  '22023', null, 'la entrega exige un estado que cierra');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r1'), (select cierra_uno from datos), current_date, '   ')$$,
  '22023', null, 'quién entregó es obligatorio');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r1'), (select cierra_uno from datos), null, 'Juan')$$,
  '22023', null, 'la fecha de entrega es obligatoria');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r1'), (select cierra_uno from datos), current_date + 3, 'Juan')$$,
  '22023', null, 'la entrega no puede ser futura');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r1'), (select cierra_uno from datos), current_date - 30, 'Juan')$$,
  '22023', null, 'la entrega no puede ser anterior al ingreso');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r1'), (select estado_dos from datos), current_date, 'Juan')$$,
  '22023', null, 'la entrega con un estado de otra organización se rechaza');
select is(
  (select estado_id from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  (select diagnostico from datos), 'las entregas rechazadas no cambiaron el estado');

select is(
  (public.registrar_entrega_reparacion((select id from reps where clave = 'r1'), (select cierra_uno from datos), (now() at time zone 'America/Argentina/Buenos_Aires')::date, '  María Pérez ')->>'entregado_por'),
  'María Pérez', 'registra la entrega y recorta quién entregó');
select is(
  (select estado_id from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  (select cierra_uno from datos), 'la entrega cambió el estado en la misma transacción');
select is(
  (select count(*) from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'r1') and tipo = 'entrega')::int,
  1, 'la entrega escribe un evento entrega');
select is(
  (select count(*) from public.registro_actividad where tipo = 'reparacion.entregada')::int,
  1, 'se registra reparacion.entregada');
select is(
  (select count(*) from public.registro_actividad where tipo = 'reparacion.estado_cambiado')::int,
  3, 'la entrega no genera además reparacion.estado_cambiado');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r1'), (select diagnostico from datos))$$,
  '55000', null, 'una reparación entregada no admite más cambios de estado');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r1'), (select cierra_dos from datos), current_date, 'Otro')$$,
  '55000', null, 'una reparación entregada no se entrega dos veces');

-- ============================================================================
-- Anulación: motivo obligatorio, irreversible, solo lectura
-- ============================================================================

select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r2'), '  ')$$,
  '22023', null, 'el motivo de la anulación es obligatorio');
select is(
  (select anulada_en from dominio.reparaciones where id = (select id from reps where clave = 'r2')),
  null::timestamptz, 'la anulación rechazada no marca la reparación');

select is(
  (public.anular_reparacion((select id from reps where clave = 'r2'), ' Cliente desistió ')->>'anulada_motivo'),
  'Cliente desistió', 'anula con motivo (recortado)');
select ok(
  (select anulada_en is not null from dominio.reparaciones where id = (select id from reps where clave = 'r2')),
  'queda con anulada_en');
select is(
  (select count(*) from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'r2') and tipo = 'anulacion' and nota = 'Cliente desistió')::int,
  1, 'la anulación escribe un evento anulacion con el motivo');
select is(
  (select count(*) from public.registro_actividad where tipo = 'reparacion.anulada')::int,
  1, 'se registra reparacion.anulada');
select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r2'), 'Otra vez')$$,
  '55000', null, 'la anulación no se repite ni se revierte');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r2'), (select diagnostico from datos))$$,
  '55000', null, 'una anulada no admite cambio de estado');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r2'), (select cierra_uno from datos), current_date, 'Juan')$$,
  '55000', null, 'una anulada no admite entrega');
select throws_ok(
  $$select public.actualizar_reparacion(
      (select id from reps where clave = 'r2'),
      (public.obtener_reparacion((select id from reps where clave = 'r2'))->>'updated_at')::timestamptz,
      'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos), '', null, '', '', null, null, null, null, null)$$,
  '55000', null, 'una anulada es de solo lectura (no se edita)');

-- ============================================================================
-- Permisos por nivel
-- ============================================================================

-- Operador (edicion, solo San Javucho): opera en su tienda, no en la otra.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into reps (clave, id)
select 'r3', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
select lives_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r3'), (select diagnostico from datos))$$,
  'el operador con edición cambia el estado');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'otra'), (select diagnostico from datos))$$,
  '42501', null, 'el operador no cambia el estado de una reparación de una tienda inaccesible');
select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'otra'), 'x')$$,
  '42501', null, 'el operador no anula una reparación de una tienda inaccesible');

-- Consulta (lectura): lee el historial, no muta.
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select ok(
  (select count(*) from dominio.reparacion_historial where reparacion_id = (select id from reps where clave = 'r3')) >= 2,
  'consulta (lectura) lee el historial');
select ok(
  (select count(*) from public.historial_reparacion((select id from reps where clave = 'r3'))) >= 2,
  'consulta (lectura) lee el historial por la RPC');
select throws_ok(
  $$select * from public.historial_reparacion((select id from reps where clave = 'otra'))$$,
  'P0002', null, 'no lee el historial de una tienda inaccesible');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r3'), (select reparacion from datos))$$,
  '42501', null, 'lectura no cambia el estado');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r3'), (select cierra_uno from datos), current_date, 'Juan')$$,
  '42501', null, 'lectura no registra entregas');
select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r3'), 'x')$$,
  '42501', null, 'lectura no anula');

-- Depósito (ninguno): no lee ni muta.
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select is(
  (select count(*) from dominio.reparacion_historial), 0::bigint, 'ninguno no lee el historial');
select throws_ok(
  $$select * from public.historial_reparacion((select id from reps where clave = 'r3'))$$,
  '42501', null, 'ninguno no lee el historial por la RPC');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r3'), (select reparacion from datos))$$,
  '42501', null, 'ninguno no cambia el estado');
select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r3'), 'x')$$,
  '42501', null, 'ninguno no anula');

-- Anónimo: sin ejecución.
reset role;
set local role anon;
select throws_ok(
  $$select public.cambiar_estado_reparacion(gen_random_uuid(), gen_random_uuid())$$,
  '42501', null, 'anon no cambia el estado');
select throws_ok(
  $$select public.anular_reparacion(gen_random_uuid(), 'x')$$,
  '42501', null, 'anon no anula');

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from dominio.reparacion_historial), 0::bigint, 'otra organización no lee el historial ajeno');
select throws_ok(
  $$select * from public.historial_reparacion((select id from reps where clave = 'r3'))$$,
  'P0002', null, 'otra organización no lee el historial por la RPC');
select throws_ok(
  $$select public.cambiar_estado_reparacion((select id from reps where clave = 'r3'), (select estado_dos from datos))$$,
  'P0002', null, 'otra organización no cambia el estado de una reparación ajena');
select throws_ok(
  $$select public.registrar_entrega_reparacion((select id from reps where clave = 'r3'), (select estado_dos from datos), current_date, 'x')$$,
  'P0002', null, 'otra organización no registra la entrega de una reparación ajena');
select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r3'), 'x')$$,
  'P0002', null, 'otra organización no anula una reparación ajena');

select * from finish();
rollback;
