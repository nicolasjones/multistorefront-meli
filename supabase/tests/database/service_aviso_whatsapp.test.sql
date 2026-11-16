-- MSF-952 (S-1 de MSF-118): envío automático del aviso de estado al cliente por WhatsApp, desde el servidor.
-- Cubre el modelo (`canal`, `clave_envio`, índices y privilegios por columna), el consentimiento del cliente, la RPC
-- `public.avisar_cliente_whatsapp` (permisos, anulada, tienda y organización ajenas, consentimiento, teléfono,
-- idempotencia, outbox y actividad sin el número) y el cierre por el flow (`pendiente → enviado/fallido`).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador y la consulta solo acceden a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo, correo, celular) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Ana Pérez', 'minorista', 'ana@example.com', '11 2233-4455'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente sin teléfono', 'minorista', null, null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', 'dos@example.com', '11 9999-8888');

-- La conexión de envíos (la `comprobantes-pdf` de la spec 019) solo existe en la organización Uno.
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id) values
  ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'comprobantes-pdf', gen_random_uuid());

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
-- Modelo y privilegios
-- ============================================================================

select has_column('dominio', 'reparacion_avisos', 'canal', 'la tabla de avisos tiene el canal del envío');
select has_column('dominio', 'reparacion_avisos', 'clave_envio', 'la tabla de avisos tiene la clave de idempotencia');
select has_column('dominio', 'clientes', 'acepta_whatsapp', 'el cliente tiene el consentimiento de WhatsApp');
select is((select column_default from information_schema.columns
    where table_schema = 'dominio' and table_name = 'reparacion_avisos' and column_name = 'canal'),
  '''correo''::text', 'los avisos de correo quedan con canal = correo');
select is((select column_default from information_schema.columns
    where table_schema = 'dominio' and table_name = 'clientes' and column_name = 'acepta_whatsapp'),
  'false', 'sin consentimiento de WhatsApp por defecto');
select ok((select indexdef like '%UNIQUE%' and indexdef like '%canal%' and indexdef like '%estado_envio%pendiente%'
    from pg_indexes where indexname = 'reparacion_avisos_pendiente_uq'),
  'el aviso pendiente es único por reparación, estado y canal (el de WhatsApp no bloquea el de correo)');
select ok((select indexdef like '%UNIQUE%' and indexdef like '%clave_envio%' and indexdef like '%whatsapp%'
    from pg_indexes where indexname = 'reparacion_avisos_whatsapp_clave_uq'),
  'una clave de envío identifica un solo aviso de WhatsApp');
select is(has_column_privilege('authenticated', 'dominio.reparacion_avisos', 'canal', 'select'), true,
  'authenticated lee el canal del aviso');
select is(has_column_privilege('authenticated', 'dominio.reparacion_avisos', 'clave_envio', 'select'), false,
  'la clave de idempotencia no se lee desde la app');
select is(
  has_table_privilege('authenticated', 'dominio.reparacion_avisos', 'insert')
  or has_table_privilege('authenticated', 'dominio.reparacion_avisos', 'update')
  or has_table_privilege('authenticated', 'dominio.reparacion_avisos', 'delete')
  or has_table_privilege('anon', 'dominio.reparacion_avisos', 'select'),
  false, 'sin escritura directa ni acceso de anon a los avisos');
select is(
  (select count(*) from unnest(array['public.avisar_cliente_whatsapp(uuid, uuid)']) f
    where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta la RPC de WhatsApp');
select is(
  (select count(*) from unnest(array['public.avisar_cliente_whatsapp(uuid, uuid)']) f
    where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  1, 'authenticated ejecuta la RPC de WhatsApp');
select is(
  has_function_privilege('authenticated', 'private.telefono_whatsapp(text, text)', 'execute')
  or has_function_privilege('anon', 'private.telefono_whatsapp(text, text)', 'execute'),
  false, 'el ayudante de teléfono no es ejecutable por la app');

-- ============================================================================
-- Normalización del teléfono (misma regla que `normalizarNumero` del front)
-- ============================================================================

select is(private.telefono_whatsapp('11 2233-4455', null), '5491122334455', 'un móvil local pasa a 549');
select is(private.telefono_whatsapp('011 15 2233-4455', null), '5491122334455', 'se quitan el 0 troncal y el 15');
select is(private.telefono_whatsapp('+54 9 11 2233-4455', null), '5491122334455', 'un móvil internacional se respeta');
select is(private.telefono_whatsapp(null, '11 2233-4455'), '5491122334455', 'sin celular se usa el teléfono');
select is(private.telefono_whatsapp('123', null), null, 'un número demasiado corto no sirve');
select is(private.telefono_whatsapp('no hay numero', null), null, 'un texto no es un número');

-- ============================================================================
-- Reparaciones de la prueba
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select c, (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid
from unnest(array['r1', 'anulada']) c;
insert into reps (clave, id)
select 'sin_telefono', (public.crear_reparacion(
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
-- Consentimiento y teléfono: sin uno de los dos no se encola nada
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(
  (select public.avisar_cliente_whatsapp((select id from reps where clave = 'r1'))->>'resultado'),
  'sin_consentimiento', 'sin consentimiento del cliente no se encola');
reset role;
select is((select count(*)::int from dominio.reparacion_avisos where reparacion_id = (select id from reps where clave = 'r1')), 0,
  'sin consentimiento no crea ningún aviso');
select is((select count(*)::int from public.capacidades_ejecucion where clave like 'enviar-aviso-whatsapp-%'), 0,
  'sin consentimiento no deja ninguna orden en la outbox');

-- El consentimiento lo enciende la ficha del cliente y la base guarda la fecha.
update dominio.clientes set acepta_whatsapp = true where id = 'c5000000-0000-0000-0000-000000000001';
select is((select acepta_whatsapp_en is not null from dominio.clientes where id = 'c5000000-0000-0000-0000-000000000001'), true,
  'la base guarda el momento del consentimiento');
update dominio.clientes set acepta_whatsapp = false where id = 'c5000000-0000-0000-0000-000000000001';
select is((select acepta_whatsapp_en is null from dominio.clientes where id = 'c5000000-0000-0000-0000-000000000001'), true,
  'al apagar el consentimiento se borra la fecha');
update dominio.clientes set acepta_whatsapp = true where id = 'c5000000-0000-0000-0000-000000000001';
update dominio.clientes set acepta_whatsapp = true where id = 'c5000000-0000-0000-0000-000000000001';
select is((select acepta_whatsapp_en is not null from dominio.clientes where id = 'c5000000-0000-0000-0000-000000000001'), true,
  'encender el consentimiento dos veces no borra la fecha');
update dominio.clientes set acepta_whatsapp = true where id = 'c5000000-0000-0000-0000-000000000002';
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(
  (select public.avisar_cliente_whatsapp((select id from reps where clave = 'sin_telefono'))->>'resultado'),
  'sin_telefono', 'sin un teléfono válido no se encola');
reset role;
select is((select count(*)::int from dominio.reparacion_avisos where reparacion_id = (select id from reps where clave = 'sin_telefono')), 0,
  'sin teléfono no crea ningún aviso');

-- ============================================================================
-- Rechazos (permisos, anulada, tienda y organización ajenas)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.avisar_cliente_whatsapp(%L)$$, (select id from reps where clave = 'r1')), '42501', null,
  'la consulta (lectura) no puede avisar por WhatsApp');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.avisar_cliente_whatsapp(%L)$$, (select id from reps where clave = 'anulada')), '55000', null,
  'una reparación anulada no se avisa (55000)');
select throws_ok(format($$select public.avisar_cliente_whatsapp(%L)$$, (select id from reps where clave = 'otra_tienda')), 'P0002', null,
  'una reparación de una tienda no accesible no existe para el operador');
select throws_ok(format($$select public.avisar_cliente_whatsapp(%L)$$, (select id from reps where clave = 'dos')), 'P0002', null,
  'una reparación de otra organización no existe');
select throws_ok(format($$select public.avisar_cliente_whatsapp(%L, %L)$$, (select id from reps where clave = 'r1'), (select estado_dos from datos)), '22023', null,
  'un estado de otra organización no existe');
select throws_ok($$select public.avisar_cliente_whatsapp(null)$$, '22023', null, 'sin reparación se rechaza');

-- ============================================================================
-- Encolado, idempotencia y outbox
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into avisos (clave, id)
select 'w1', (public.avisar_cliente_whatsapp((select id from reps where clave = 'r1'))->>'aviso_id')::uuid;
select isnt((select id from avisos where clave = 'w1'), null::uuid, 'el aviso de WhatsApp devuelve su id');
select is((select public.avisar_cliente_whatsapp((select id from reps where clave = 'r1'))->>'resultado'), 'encolado',
  'repetir el aviso de WhatsApp del mismo estado devuelve encolado');
select is((select (public.avisar_cliente_whatsapp((select id from reps where clave = 'r1'))->>'aviso_id')::uuid), (select id from avisos where clave = 'w1'),
  'es idempotente: devuelve el mismo aviso pendiente');
reset role;
select is((select count(*)::int from dominio.reparacion_avisos where reparacion_id = (select id from reps where clave = 'r1')), 1,
  'el doble pedido deja un solo aviso de WhatsApp');
select is(
  (select row(canal, estado_envio, destinatario, clave_envio is not null)::text
     from dominio.reparacion_avisos where id = (select id from avisos where clave = 'w1')),
  '(whatsapp,pendiente,5491122334455,t)', 'el aviso nace pendiente, por WhatsApp, con el teléfono normalizado y su clave');
select is(
  (select count(*)::int from public.despachos_ejecucion d
    join public.ejecuciones_worker e on e.id = d.ejecucion_id
    join public.capacidades_ejecucion c on c.id = e.capacidad_id
   where c.clave = 'enviar-aviso-whatsapp-' || (select id from avisos where clave = 'w1')::text and d.estado = 'pendiente'),
  1, 'el aviso deja su orden en la outbox con el prefijo que reclama el flow (misma transacción)');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'reparacion.aviso_whatsapp_solicitado' and empresa_id = 'a1000000-0000-0000-0000-000000000001'
      and actor_id = 'e1000000-0000-0000-0000-000000000002'
      and detalle = 'Pidió avisar al cliente por WhatsApp de la reparación R-0001 (estado «En diagnóstico»)'),
  1, 'se registra reparacion.aviso_whatsapp_solicitado una sola vez');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'reparacion.aviso_whatsapp_solicitado' and detalle like '%5491122334455%'),
  0, 'la actividad no lleva el número de teléfono del cliente');

-- El aviso de WhatsApp no bloquea el de correo del mismo estado (y al revés).
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is((select public.avisar_cliente_reparacion((select id from reps where clave = 'r1'))->>'resultado'), 'encolado',
  'el aviso por correo del mismo estado también se encola');
reset role;
select is((select count(*)::int from dominio.reparacion_avisos where reparacion_id = (select id from reps where clave = 'r1')), 2,
  'conviven el aviso de correo y el de WhatsApp del mismo estado');
select is((select count(*)::int from dominio.reparacion_avisos where reparacion_id = (select id from reps where clave = 'r1') and canal = 'correo'), 1,
  'el aviso de correo conserva su canal');

-- ============================================================================
-- Historial: el canal de cada aviso
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.avisos_de_reparacion((select id from reps where clave = 'r1')) h
    where h.canal in ('correo', 'whatsapp')),
  2, 'el historial devuelve el canal de cada aviso');

-- ============================================================================
-- Cierre por el flow (pendiente → enviado/fallido)
-- ============================================================================

-- Las funciones del flow las ejecuta solo el rol de servicio de Kestra: la prueba las llama como `postgres`.
reset role;
select ok(
  (select d->>'canal' = 'whatsapp' and d->>'clave_envio' is not null and d->>'estado_envio' = 'pendiente'
     from (select private.datos_aviso_reparacion((select id from avisos where clave = 'w1')) as d) x),
  'el flow recibe el canal y la clave de idempotencia');
select ok(
  (select not (d ? 'total') and not (d ? 'total_cliente') and not (d ? 'costo_mano_obra')
     from (select private.datos_aviso_reparacion((select id from avisos where clave = 'w1')) as d) x),
  'el flow no recibe importes ni costos');

select lives_ok($$select private.cerrar_aviso_reparacion((select id from avisos where clave = 'w1'), null)$$, 'el flow cierra el aviso como enviado');
select is(
  (select row(estado_envio, error is null, enviado_en is not null, intentos)::text
     from dominio.reparacion_avisos where id = (select id from avisos where clave = 'w1')),
  '(enviado,t,t,1)', 'el aviso queda enviado con fecha');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'reparacion.aviso_enviado'
      and detalle = 'Se envió al cliente por WhatsApp el aviso de la reparación R-0001 (estado «En diagnóstico»)'),
  1, 'el cierre registra que el aviso salió por WhatsApp');
select lives_ok($$select private.cerrar_aviso_reparacion((select id from avisos where clave = 'w1'), 'otro')$$, 'un segundo cierre no falla');
select is((select estado_envio from dominio.reparacion_avisos where id = (select id from avisos where clave = 'w1')), 'enviado',
  'un segundo cierre no cambia un aviso ya cerrado (idempotente)');

-- Un aviso fallido con un motivo que parece un secreto no lo guarda.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into avisos (clave, id)
select 'w2', (public.avisar_cliente_whatsapp((select id from reps where clave = 'r1'), (select recibido from datos))->>'aviso_id')::uuid;
reset role;
select lives_ok($$select private.cerrar_aviso_reparacion((select id from avisos where clave = 'w2'), 'el proveedor rechazó: token=abc123')$$,
  'el flow cierra un aviso como fallido');
select is((select error from dominio.reparacion_avisos where id = (select id from avisos where clave = 'w2')), 'No se pudo enviar el WhatsApp',
  'un motivo con forma de secreto no se guarda');
select is((select estado_envio from dominio.reparacion_avisos where id = (select id from avisos where clave = 'w2')), 'fallido', 'el aviso queda fallido');
select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'reparacion.aviso_fallido'
      and detalle = 'No se pudo enviar al cliente por WhatsApp el aviso de la reparación R-0001 (estado «Recibido»)'),
  1, 'el fallo registra que el aviso de WhatsApp no salió');

-- ============================================================================
-- Pendientes vencidos
-- ============================================================================

update dominio.reparacion_avisos set solicitado_en = now() - interval '20 minutes' where id = (select id from avisos where clave = 'w2');
update dominio.reparacion_avisos set estado_envio = 'pendiente', enviado_en = null, error = null where id = (select id from avisos where clave = 'w2');
select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(
  (select h.estado_envio from public.avisos_de_reparacion((select id from reps where clave = 'r1')) h where h.id = (select id from avisos where clave = 'w2')),
  'fallido', 'un pendiente de WhatsApp vencido se muestra como fallido');
reset role;
select is((select error from dominio.reparacion_avisos where id = (select id from avisos where clave = 'w2')), 'El WhatsApp tardó demasiado en enviarse. Probá de nuevo.',
  'con un motivo del canal');

select * from finish();
rollback;
