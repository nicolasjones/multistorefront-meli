-- F-SVC-14 (MSF-424, épica MSF-232): aviso por correo al cliente por el estado de su reparación (SC-004).
-- Cubre FR-020 (tabla en `dominio`, RLS, sin escritura directa ni `delete`, `anon`), FR-021 (aviso y orden de
-- despacho atómicos, idempotencia, `sin_correo`, anulada `55000`, permisos, tienda y organización ajenas, sin
-- conexión), FR-022 (funciones del flow solo para `kestra_orquestacion`, cierre `enviado`/`fallido` idempotente,
-- motivo con forma de secreto), FR-026 (`avisos_de_reparacion`, sin correo del usuario, pendientes vencidos),
-- FR-027 (un aviso nuevo con el correo ACTUAL) y FR-029 (actividades `reparacion.aviso_*`).
-- Matriz vigente: administrador y operador `edicion` en `service_tecnico`; consulta `lectura`; depósito `ninguno`.
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

-- El operador, la consulta y el depósito (Ventas en lectura, sin Service) solo acceden a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('e1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into clientes (id, organizacion_id, numero, nombre, tipo, correo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Ana Pérez', 'minorista', 'ana@example.com'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente sin correo', 'minorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', 'dos@example.com');

-- La conexión de envíos (la `comprobantes-pdf` de la spec 019) solo existe en la organización Uno.
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'comprobantes-pdf', gen_random_uuid());

-- Perfil con nombre visible para el operador: el historial muestra el nombre, nunca el correo.
insert into public.perfiles_usuario (user_id, nombre, apellido) values
  ('e1000000-0000-0000-0000-000000000002', 'Laura', 'Gómez')
on conflict (user_id) do update set nombre = excluded.nombre, apellido = excluded.apellido;


create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.modelos_equipo where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1) as modelo_dos,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Recibido') as recibido,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'En diagnóstico') as diagnostico,
    (select id from dominio.estados_reparacion where organizacion_id = '22222222-2222-2222-2222-222222222222' limit 1) as estado_dos;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;
create temp table avisos (clave text primary key, id uuid);
grant select, insert on avisos to public;

-- ============================================================================
-- Diseño y privilegios (FR-020)
-- ============================================================================

select is((select count(*)::int from pg_tables where schemaname = 'dominio' and tablename = 'reparacion_avisos'), 1,
  'reparacion_avisos vive en el esquema dominio (Principio VII)');
select is((select count(*)::int from pg_tables where schemaname = 'public' and tablename = 'reparacion_avisos'), 0,
  'la tabla no se creó en public');
select is((select relrowsecurity from pg_class where oid = 'dominio.reparacion_avisos'::regclass), true, 'reparacion_avisos tiene RLS activado');
select is(
  has_table_privilege('authenticated', 'dominio.reparacion_avisos', 'insert')
  or has_table_privilege('authenticated', 'dominio.reparacion_avisos', 'update')
  or has_table_privilege('authenticated', 'dominio.reparacion_avisos', 'delete')
  or has_table_privilege('anon', 'dominio.reparacion_avisos', 'select')
  or has_table_privilege('anon', 'dominio.reparacion_avisos', 'insert'),
  false, 'sin escritura directa ni delete para authenticated y sin acceso para anon');
select is(has_column_privilege('authenticated', 'dominio.reparacion_avisos', 'destinatario', 'select'), false,
  'authenticated no lee el correo del cliente por la tabla (sale por la RPC con permiso)');
select ok((select indexdef like '%UNIQUE%' and indexdef like '%estado_envio%pendiente%' from pg_indexes where indexname = 'reparacion_avisos_pendiente_uq'),
  'el índice único parcial de un aviso pendiente por reparación y estado existe');
select is(
  (select count(*) from unnest(array['public.avisar_cliente_reparacion(uuid, uuid)', 'public.avisos_de_reparacion(uuid)']) f
    where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de avisos');
select is(
  (select count(*) from unnest(array['public.avisar_cliente_reparacion(uuid, uuid)', 'public.avisos_de_reparacion(uuid)']) f
    where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  2, 'authenticated ejecuta las dos RPC de avisos');
select is(
  has_function_privilege('authenticated', 'private.datos_aviso_reparacion(uuid)', 'execute')
  or has_function_privilege('authenticated', 'private.cerrar_aviso_reparacion(uuid, text)', 'execute')
  or has_function_privilege('authenticated', 'private.aplicar_cierre_aviso_reparacion(uuid, text)', 'execute')
  or has_function_privilege('authenticated', 'private.expirar_avisos_reparacion(uuid)', 'execute')
  or has_function_privilege('anon', 'private.datos_aviso_reparacion(uuid)', 'execute')
  or has_function_privilege('anon', 'private.cerrar_aviso_reparacion(uuid, text)', 'execute'),
  false, 'las funciones del flow no son ejecutables por authenticated ni anon (solo kestra_orquestacion)');
select ok((select prosrc like '%for update%' from pg_proc where oid = 'public.avisar_cliente_reparacion(uuid, uuid)'::regprocedure),
  'avisar_cliente_reparacion bloquea la reparación (for update): el doble clic se serializa');

-- ============================================================================
-- Reparaciones de la prueba (las crea el administrador)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select c, (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid
from unnest(array['r1', 'anulada']) c;
insert into reps (clave, id)
select 'sin_correo', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'otra_tienda', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
select public.cambiar_estado_reparacion((select id from reps where clave = 'r1'), (select diagnostico from datos));
select public.anular_reparacion((select id from reps where clave = 'anulada'), 'Se canceló');

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
insert into reps (clave, id)
select 'dos', (public.crear_reparacion(
  'a2000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', (select modelo_dos from datos)
)->>'id')::uuid;

-- ============================================================================
-- Rechazos (FR-021)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.avisar_cliente_reparacion(%L)$$, (select id from reps where clave = 'r1')), '42501', null,
  'la consulta (lectura) no puede avisar');
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(format($$select public.avisar_cliente_reparacion(%L)$$, (select id from reps where clave = 'r1')), '42501', null,
  'el depósito (sin Service) no puede avisar');
select throws_ok(format($$select * from public.avisos_de_reparacion(%L)$$, (select id from reps where clave = 'r1')), '42501', null,
  'el depósito (sin Service) no ve los avisos');

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.avisar_cliente_reparacion(%L)$$, (select id from reps where clave = 'anulada')), '55000', null,
  'una reparación anulada no se avisa (55000)');
select throws_ok(format($$select public.avisar_cliente_reparacion(%L)$$, (select id from reps where clave = 'otra_tienda')), 'P0002', null,
  'una reparación de una tienda no accesible no existe para el operador');
select throws_ok(format($$select public.avisar_cliente_reparacion(%L)$$, (select id from reps where clave = 'dos')), 'P0002', null,
  'una reparación de otra organización no existe');
select throws_ok(format($$select public.avisar_cliente_reparacion(%L, %L)$$, (select id from reps where clave = 'r1'), (select estado_dos from datos)), '22023', null,
  'un estado de otra organización no existe');
select throws_ok($$select public.avisar_cliente_reparacion(null)$$, '22023', null, 'sin reparación se rechaza');

-- Cliente sin correo: no encola nada (FR-023).
select is(
  (select public.avisar_cliente_reparacion((select id from reps where clave = 'sin_correo'))->>'resultado'),
  'sin_correo', 'un cliente sin correo devuelve sin_correo');
select is(
  (select public.avisar_cliente_reparacion((select id from reps where clave = 'sin_correo'))->'aviso_id')::text,
  'null', 'sin_correo no devuelve aviso');
reset role;
select is((select count(*)::int from dominio.reparacion_avisos where reparacion_id = (select id from reps where clave = 'sin_correo')), 0,
  'sin_correo no crea ningún aviso');
select is((select count(*)::int from public.capacidades_ejecucion where clave like 'enviar-aviso-reparacion-%'), 0,
  'sin_correo no deja ninguna orden en la outbox');

-- ============================================================================
-- Encolado atómico e idempotencia (FR-021)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into avisos (clave, id)
select 'a1', (public.avisar_cliente_reparacion((select id from reps where clave = 'r1'))->>'aviso_id')::uuid;
select isnt((select id from avisos where clave = 'a1'), null::uuid, 'el aviso del estado actual devuelve su id');
select is((select public.avisar_cliente_reparacion((select id from reps where clave = 'r1'))->>'resultado'), 'encolado',
  'repetir el aviso del mismo estado devuelve encolado');
select is((select (public.avisar_cliente_reparacion((select id from reps where clave = 'r1'))->>'aviso_id')::uuid), (select id from avisos where clave = 'a1'),
  'es idempotente: devuelve el mismo aviso pendiente');
reset role;
select is((select count(*)::int from dominio.reparacion_avisos where reparacion_id = (select id from reps where clave = 'r1')), 1,
  'el doble pedido deja un solo aviso');
select is(
  (select row(estado_envio, destinatario, estado_nombre, intentos)::text from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a1')),
  '(pendiente,ana@example.com,"En diagnóstico",0)', 'el aviso nace pendiente con el correo del cliente y el estado actual');
select is(
  (select count(*)::int from public.despachos_ejecucion d
    join public.ejecuciones_worker e on e.id = d.ejecucion_id
    join public.capacidades_ejecucion c on c.id = e.capacidad_id
   where c.clave = 'enviar-aviso-reparacion-' || (select id from avisos where clave = 'a1')::text and d.estado = 'pendiente'),
  1, 'el aviso deja su orden en la outbox con el prefijo que reclama el flow (misma transacción)');
select is(
  (select ejecucion_id is not null from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a1')), true,
  'el aviso queda atado a su ejecución');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'reparacion.aviso_solicitado' and empresa_id = 'a1000000-0000-0000-0000-000000000001'
      and actor_id = 'e1000000-0000-0000-0000-000000000002'
      and detalle = 'Pidió avisar al cliente de la reparación R-0001 (estado «En diagnóstico»)'),
  1, 'se registra reparacion.aviso_solicitado una sola vez (FR-029)');

-- Otro estado = otro aviso pendiente.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into avisos (clave, id)
select 'a2', (public.avisar_cliente_reparacion((select id from reps where clave = 'r1'), (select recibido from datos))->>'aviso_id')::uuid;
select isnt((select id from avisos where clave = 'a2'), (select id from avisos where clave = 'a1'), 'otro estado crea otro aviso pendiente');

-- Sin la conexión de envíos (organización Dos) no se puede encolar.
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.avisar_cliente_reparacion(%L)$$, (select id from reps where clave = 'dos')), 'P0001', null,
  'sin la conexión de envíos de la organización no se encola');

-- ============================================================================
-- Historial (FR-026)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.avisos_de_reparacion((select id from reps where clave = 'r1'))), 2,
  'la consulta (lectura) ve el historial');
select is(
  (select solicitado_por_nombre from public.avisos_de_reparacion((select id from reps where clave = 'r1')) limit 1),
  'Laura Gómez', 'el historial muestra el nombre de quien lo pidió');
select is(
  (select count(*)::int from public.avisos_de_reparacion((select id from reps where clave = 'r1')) h
    where h.solicitado_por_nombre like '%@%'),
  0, 'el historial nunca muestra el correo del usuario');
select throws_ok(format($$select * from public.avisos_de_reparacion(%L)$$, (select id from reps where clave = 'otra_tienda')), 'P0002', null,
  'la consulta no ve avisos de una tienda a la que no accede');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select * from public.avisos_de_reparacion(%L)$$, (select id from reps where clave = 'r1')), 'P0002', null,
  'otra organización no ve el historial');

-- ============================================================================
-- RLS y escritura directa (FR-020)
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.reparacion_avisos), 0, 'otra organización no lee ningún aviso');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.reparacion_avisos), 2, 'el operador lee los avisos de su tienda');
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from dominio.reparacion_avisos), 0, 'el depósito (sin Service) no lee avisos');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into dominio.reparacion_avisos (organizacion_id, empresa_id, reparacion_id, estado_id, estado_nombre, destinatario)
     select organizacion_id, empresa_id, reparacion_id, estado_id, estado_nombre, destinatario from dominio.reparacion_avisos limit 1 $$,
  '42501', null, 'no hay escritura directa');
reset role;
select throws_ok(
  $$ insert into dominio.reparacion_avisos (organizacion_id, empresa_id, reparacion_id, estado_id, estado_nombre, destinatario)
     select organizacion_id, empresa_id, reparacion_id, estado_id, estado_nombre, destinatario from dominio.reparacion_avisos
      where id = (select id from avisos where clave = 'a1') $$,
  '23505', null, 'el índice único impide un segundo pendiente aun escribiendo directo');
set local role anon;
select throws_ok($$select count(*) from dominio.reparacion_avisos$$, '42501', null, 'anon no lee avisos');
reset role;

-- ============================================================================
-- Funciones del flow y cierre (FR-022, FR-029)
-- ============================================================================

select is((select private.datos_aviso_reparacion((select id from avisos where clave = 'a1'))->>'destinatario'), 'ana@example.com',
  'el flow recibe el destinatario');
select ok(
  (select d->>'numero' = 'R-0001' and d->>'empresa' = 'San Javucho' and d->>'cliente' = 'Ana Pérez'
      and d->>'equipo' = 'Nintendo Switch Estándar' and d->>'estado' = 'En diagnóstico' and d->>'estado_envio' = 'pendiente'
     from (select private.datos_aviso_reparacion((select id from avisos where clave = 'a1')) as d) x),
  'el flow recibe tienda, número, equipo, cliente y estado');
select ok(
  (select (d->>'descripcion') is not null and not (d ? 'total') and not (d ? 'total_cliente') and not (d ? 'costo_mano_obra')
     from (select private.datos_aviso_reparacion((select id from avisos where clave = 'a1')) as d) x),
  'el flow recibe la descripción del estado y ningún importe ni costo');
select throws_ok($$select private.datos_aviso_reparacion('00000000-0000-0000-0000-00000000dead')$$, 'P0001', null, 'un aviso desconocido se rechaza');

select lives_ok($$select private.cerrar_aviso_reparacion((select id from avisos where clave = 'a1'), null)$$, 'el flow cierra el aviso como enviado');
select is(
  (select row(estado_envio, error is null, enviado_en is not null, intentos)::text from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a1')),
  '(enviado,t,t,1)', 'el aviso queda enviado con fecha');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'reparacion.aviso_enviado' and actor_id = 'e1000000-0000-0000-0000-000000000002'
      and detalle = 'Se envió al cliente el aviso de la reparación R-0001 (estado «En diagnóstico»)'),
  1, 'el cierre registra reparacion.aviso_enviado con quién lo pidió');
select lives_ok($$select private.cerrar_aviso_reparacion((select id from avisos where clave = 'a1'), 'otro')$$, 'un segundo cierre no falla');
select is((select estado_envio from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a1')), 'enviado',
  'un segundo cierre no cambia un aviso ya cerrado (idempotente)');
select is((select count(*)::int from public.registro_actividad where tipo like 'reparacion.aviso_%' and tipo <> 'reparacion.aviso_solicitado'), 1,
  'el segundo cierre no duplica el evento');

select lives_ok($$select private.cerrar_aviso_reparacion((select id from avisos where clave = 'a2'), 'SMTP rechazó: password=hunter2 en smtp.interno')$$,
  'el flow cierra un aviso como fallido');
select is((select error from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a2')), 'No se pudo enviar el correo',
  'un motivo con forma de secreto no se guarda');
select is((select estado_envio from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a2')), 'fallido', 'el aviso queda fallido');
select is((select count(*)::int from public.registro_actividad where tipo = 'reparacion.aviso_fallido'), 1, 'el fallo registra reparacion.aviso_fallido');

-- ============================================================================
-- Reenviar: un aviso nuevo con el correo ACTUAL (FR-027)
-- ============================================================================

update public.clientes set correo = 'ana.nueva@example.com' where id = 'c5000000-0000-0000-0000-000000000001';
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into avisos (clave, id)
select 'a3', (public.avisar_cliente_reparacion((select id from reps where clave = 'r1'), (select diagnostico from datos))->>'aviso_id')::uuid;
select isnt((select id from avisos where clave = 'a3'), (select id from avisos where clave = 'a1'), 'reenviar crea un aviso nuevo');
reset role;
select is((select destinatario from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a3')), 'ana.nueva@example.com',
  'el aviso nuevo usa el correo actual del cliente');
select is((select destinatario from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a1')), 'ana@example.com',
  'el aviso anterior conserva el correo con el que se envió');

-- ============================================================================
-- Pendientes vencidos (FR-026)
-- ============================================================================

update dominio.reparacion_avisos set solicitado_en = now() - interval '20 minutes' where id = (select id from avisos where clave = 'a3');
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(
  (select h.estado_envio from public.avisos_de_reparacion((select id from reps where clave = 'r1')) h where h.id = (select id from avisos where clave = 'a3')),
  'fallido', 'un pendiente que ya no puede completarse se muestra como fallido');
reset role;
select is((select error from dominio.reparacion_avisos where id = (select id from avisos where clave = 'a3')), 'El correo tardó demasiado en enviarse. Probá de nuevo.',
  'con un motivo claro');

select * from finish();
rollback;
