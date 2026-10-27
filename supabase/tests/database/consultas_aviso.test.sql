-- MSF-207 · F-CON-03 (épica MSF-122, SC-005): dirección de avisos y cola de avisos de consultas.
-- Cubre FR-009, FR-011 y el soporte de FR-012: esquema `dominio` con RLS en las dos tablas,
-- aislamiento entre organizaciones, permisos de la RPC (`42501`, `edicion`), destinatario efectivo
-- (propio / contacto / ninguno), un aviso por consulta, reintento sin duplicar y `anon` sin
-- privilegios. El fixture corre como postgres (RLS no aplica); las verificaciones, como
-- «authenticated», «anon» o «service_role», igual que PostgREST.
begin;

select plan(72);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- A tiene correo de contacto; B no tiene ninguno; C es de la otra organización.
insert into dominio.empresas (id, organizacion_id, nombre, correo) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'San Javucho', 'contacto@san.example'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Mundo JC', null),
  ('a2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Empresa Dos', 'dos@example.com');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador');
insert into usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a');

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'aviso-san.localhost'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'aviso-mundo.localhost');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema (Principio VII) y privilegios
-- ============================================================================

select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'consultas_configuracion' and c.relrowsecurity),
  'consultas_configuracion vive en «dominio» y tiene RLS activada'
);
select ok(
  exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'dominio' and c.relname = 'consultas_avisos' and c.relrowsecurity),
  'consultas_avisos vive en «dominio» y tiene RLS activada'
);
select ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname in ('consultas_configuracion', 'consultas_avisos')),
  'no existen copias en «public»'
);
select is(has_table_privilege('anon', 'dominio.consultas_configuracion', 'select'), false, 'anon no lee consultas_configuracion');
select is(has_table_privilege('anon', 'dominio.consultas_avisos', 'select'), false, 'anon no lee consultas_avisos');
select is(has_table_privilege('authenticated', 'dominio.consultas_avisos', 'insert'), false, 'authenticated no inserta avisos');
select is(has_table_privilege('authenticated', 'dominio.consultas_configuracion', 'insert'), false, 'authenticated no inserta configuración');
select is(
  has_function_privilege('anon', 'public.guardar_correo_avisos_consultas(uuid, text, timestamptz)', 'execute'),
  false, 'anon no ejecuta guardar_correo_avisos_consultas'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('tomar_aviso_consulta', 'cerrar_aviso_consulta', 'avisos_consulta_pendientes')
      and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  'anon no ejecuta las RPC del aviso'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('tomar_aviso_consulta', 'cerrar_aviso_consulta', 'avisos_consulta_pendientes')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  'authenticated tampoco: son solo de service_role'
);
select is(
  has_function_privilege('service_role', 'public.tomar_aviso_consulta(uuid, integer)', 'execute'),
  true, 'service_role ejecuta tomar_aviso_consulta'
);
select is(
  has_function_privilege('authenticated', 'public.guardar_correo_avisos_consultas(uuid, text, timestamptz)', 'execute'),
  true, 'authenticated ejecuta guardar_correo_avisos_consultas'
);
select is_empty(
  $$select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('correo_avisos_consulta', 'encolar_aviso_consulta')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  'authenticated no ejecuta los ayudantes internos del aviso'
);

-- ============================================================================
-- Cola: un aviso por consulta, encolado en el alta (FR-011)
-- ============================================================================

reset role;
set local role service_role;
select lives_ok(
  $$select publico.crear_consulta_publica('aviso-san.localhost', 'formulario', 'Ana Pérez', 'ana@example.com', 'Hola')$$,
  'la tienda de A crea una consulta'
);
select lives_ok(
  $$select publico.crear_consulta_publica('aviso-mundo.localhost', 'whatsapp', 'Carlos', '+54 9 11 5555-1234')$$,
  'la tienda de B crea una consulta'
);
reset role;

insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c2000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222',
   'a2000000-0000-0000-0000-00000000000c', 'formulario', 'Dora', 'dora@example.com', 'Consulta ajena');

-- FR-012 (MSF-562): el alta ya no encola por el camino directo (va por private.emitir_aviso). Se
-- siembra la cola a mano para seguir probando el envío de los avisos que quedaron encolados.
select is((select count(*)::int from dominio.consultas_avisos), 0, 'el alta ya no encola por el camino directo');
insert into dominio.consultas_avisos (consulta_id, organizacion_id, empresa_id)
  select id, organizacion_id, empresa_id from dominio.consultas;
select is(
  (select count(*)::int from dominio.consultas_avisos where estado = 'pendiente' and intentos = 0 and enviado_en is null),
  3, 'los avisos nacen pendientes, sin intentos'
);
select throws_ok(
  $$insert into dominio.consultas_avisos (consulta_id, organizacion_id, empresa_id)
    select id, organizacion_id, empresa_id from dominio.consultas limit 1$$,
  '23505', null, 'un segundo aviso para la misma consulta se rechaza'
);

create temp table ca as select id from dominio.consultas where empresa_id = 'a1000000-0000-0000-0000-00000000000a';
create temp table cb as select id from dominio.consultas where empresa_id = 'a1000000-0000-0000-0000-00000000000b';
grant select on ca, cb to service_role, authenticated;

-- ============================================================================
-- Aislamiento (RLS)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.consultas_avisos), 2, 'el administrador de la Uno ve los avisos de sus dos empresas y ninguno de la Dos');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select array_agg(consulta_id) from dominio.consultas_avisos), array['c2000000-0000-0000-0000-00000000000c']::uuid[],
  'la organización Dos ve solo su aviso');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.consultas_avisos), 0, 'sin empresas = edición (operador) no se ven los avisos');

-- ============================================================================
-- guardar_correo_avisos_consultas (FR-009)
-- ============================================================================

select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'x@example.com')$$,
  '42501', null, 'sin empresas = edición la RPC rechaza (42501)'
);

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'no-es-un-correo')$$,
  '22023', null, 'formato de correo inválido'
);
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a2000000-0000-0000-0000-00000000000c', 'x@example.com')$$,
  '42501', null, 'una empresa de otra organización no se edita ni revela si existe'
);
select lives_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', '  avisos@san.example ')$$,
  'el administrador fija la dirección de avisos'
);
select is(
  (select correo_avisos from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  'avisos@san.example', 'el correo quedó normalizado'
);
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'otro@san.example', null)$$,
  '40001', null, 'conflicto de edición: el sello no coincide'
);
select is(
  public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'avisos@san.example', null),
  (select updated_at from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  'repetir el mismo valor es idempotente: devuelve el sello vigente sin conflicto'
);
select lives_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'otro@san.example',
    (select updated_at from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'))$$,
  'con el sello correcto se cambia la dirección'
);
select lives_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', null,
    (select updated_at from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'))$$,
  'null vuelve al correo de contacto'
);
select is(
  (select correo_avisos from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  null, 'la dirección propia quedó vacía'
);
select is(public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000b', null), null,
  'sin fila y sin valor no hay nada que guardar');
select is((select count(*)::int from dominio.consultas_configuracion where empresa_id = 'a1000000-0000-0000-0000-00000000000b'), 0,
  'y no se creó una fila vacía');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.consultas_configuracion), 0, 'la organización Dos no ve la configuración de la Uno');
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'x@example.com')$$,
  '42501', null, 'la organización Dos no escribe en una empresa de la Uno'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.guardar_correo_avisos_consultas('a1000000-0000-0000-0000-00000000000a', 'x@example.com')$$,
  '42501', null, 'anon no ejecuta la RPC'
);
reset role;

select is(
  (select count(*)::int from public.registro_actividad
    where tipo = 'consulta.avisos_actualizados' and empresa_id = 'a1000000-0000-0000-0000-00000000000a'),
  3, 'solo los cambios reales quedaron en la actividad (fijar, cambiar y volver al contacto)'
);

-- ============================================================================
-- Destinatario efectivo: propio / contacto / ninguno
-- ============================================================================

select is(private.correo_avisos_consulta('a1000000-0000-0000-0000-00000000000a'), 'contacto@san.example',
  'sin dirección propia se usa el correo de contacto de la empresa');
select is(private.correo_avisos_consulta('a1000000-0000-0000-0000-00000000000b'), null,
  'sin dirección propia ni contacto no hay destinatario');
update dominio.consultas_configuracion set correo_avisos = 'avisos@san.example'
 where empresa_id = 'a1000000-0000-0000-0000-00000000000a';
select is(private.correo_avisos_consulta('a1000000-0000-0000-0000-00000000000a'), 'avisos@san.example',
  'con dirección propia manda sobre el contacto');

-- ============================================================================
-- Toma, reintento y cierre (FR-012 soporte): un envío por consulta, sin duplicar
-- ============================================================================

set local role service_role;
select is((select count(*)::int from public.avisos_consulta_pendientes(5, 50)), 3, 'el barrido ve los tres avisos pendientes');

select is((select resultado from public.tomar_aviso_consulta((select id from cb))), 'sin_destinatario',
  'B no tiene destinatario: queda «sin destinatario»');
select is((select resultado from public.tomar_aviso_consulta((select id from cb))), 'sin_destinatario',
  'y no se reintenta');
select is((select count(*)::int from public.avisos_consulta_pendientes(5, 50)), 2, 'el barrido ya no lo incluye');

create temp table tomado as select * from public.tomar_aviso_consulta((select id from ca));
select is((select resultado from tomado), 'enviar', 'A se toma para enviar');
select is((select destinatario from tomado), 'avisos@san.example', 'el destinatario es la dirección propia');
select is(
  (select concat_ws('|', empresa_nombre, origen, nombre, contacto, mensaje) from tomado),
  'San Javucho|formulario|Ana Pérez|ana@example.com|Hola', 'trae los datos del correo'
);
select is((select resultado from public.tomar_aviso_consulta((select id from ca))), 'en_proceso',
  'una segunda toma inmediata no manda otro correo');
select is(public.cerrar_aviso_consulta((select id from ca), false, 'smtp caído'), 'fallido', 'un fallo de envío queda registrado');
select is((select count(*)::int from public.avisos_consulta_pendientes(5, 50) p where p = (select id from ca)), 0,
  'el reintento espera a que venza la reserva');

reset role;
update dominio.consultas_avisos set updated_at = now() - interval '3 minutes'
 where consulta_id = (select id from ca);
set local role service_role;
select is((select count(*)::int from public.avisos_consulta_pendientes(5, 50) p where p = (select id from ca)), 1,
  'vencida la reserva el barrido lo reintenta');
create temp table tomado2 as select * from public.tomar_aviso_consulta((select id from ca));
select is((select resultado from tomado2), 'enviar', 'el reintento vuelve a tomar el aviso');

reset role;
select is((select intentos from dominio.consultas_avisos where consulta_id = (select id from ca)), 2, 'se contaron los dos intentos');
select is((select ultimo_error from dominio.consultas_avisos where consulta_id = (select id from ca)), 'smtp caído',
  'el error útil queda guardado');
set local role service_role;
select is(public.cerrar_aviso_consulta((select id from ca), true), 'enviado', 'el reintento exitoso cierra el aviso');
select is((select resultado from public.tomar_aviso_consulta((select id from ca))), 'ya_enviado', 'un aviso enviado no se reenvía');
select is(public.cerrar_aviso_consulta((select id from ca), false, 'tarde'), null, 'un cierre repetido no pisa un aviso enviado');

reset role;
select is(
  (select estado from dominio.consultas_avisos where consulta_id = (select id from ca)), 'enviado',
  'el aviso quedó enviado'
);
select ok(
  (select enviado_en is not null and ultimo_error is null from dominio.consultas_avisos where consulta_id = (select id from ca)),
  'con fecha de envío y sin error'
);
select is(
  (select estado from dominio.consultas_avisos where consulta_id = (select id from cb)), 'sin_destinatario',
  'B quedó «sin destinatario»'
);
select is((select estado from dominio.consultas where id = (select id from ca)), 'nueva',
  'el aviso no modificó la consulta');

-- Tope de reintentos.
update dominio.consultas_avisos set intentos = 5, estado = 'fallido', updated_at = now() - interval '1 hour'
 where consulta_id = 'c2000000-0000-0000-0000-00000000000c';
set local role service_role;
select is((select resultado from public.tomar_aviso_consulta('c2000000-0000-0000-0000-00000000000c')), 'agotado',
  'con el tope alcanzado no se vuelve a intentar');
select is((select count(*)::int from public.avisos_consulta_pendientes(5, 50)), 0, 'y el barrido lo deja de listar');
select is((select resultado from public.tomar_aviso_consulta(gen_random_uuid())), 'no_existe', 'un aviso inexistente se informa');

-- Último intento sin cierre (el proceso murió): se cierra como fallido con error útil.
reset role;
update dominio.consultas_avisos set intentos = 5, estado = 'pendiente', ultimo_error = null, updated_at = now() - interval '1 hour'
 where consulta_id = 'c2000000-0000-0000-0000-00000000000c';
set local role service_role;
select is((select count(*)::int from public.avisos_consulta_pendientes(5, 50) p where p = 'c2000000-0000-0000-0000-00000000000c'), 1,
  'el barrido retoma el aviso atascado en el último intento');
select is((select resultado from public.tomar_aviso_consulta('c2000000-0000-0000-0000-00000000000c')), 'agotado',
  'el atascado se informa como agotado');
reset role;
select is((select estado from dominio.consultas_avisos where consulta_id = 'c2000000-0000-0000-0000-00000000000c'), 'fallido',
  'y queda fallido');
select ok((select ultimo_error is not null from dominio.consultas_avisos where consulta_id = 'c2000000-0000-0000-0000-00000000000c'),
  'con un error útil');

-- sin_destinatario se reintenta cuando la empresa carga el correo.
update dominio.empresas set correo = 'tarde@san.example' where id = 'a1000000-0000-0000-0000-00000000000b';
set local role service_role;
select is((select count(*)::int from public.avisos_consulta_pendientes(5, 50) p where p = (select id from cb)), 1,
  'con destinatario nuevo el barrido retoma el aviso sin destinatario');
select is((select destinatario from public.tomar_aviso_consulta((select id from cb))), 'tarde@san.example',
  'y se toma para enviar al correo recién cargado');

-- authenticated y anon no llegan a las RPC del aviso.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.tomar_aviso_consulta((select id from ca))$$,
  '42501', null, 'un usuario autenticado no toma avisos'
);
reset role;
set local role anon;
select throws_ok(
  $$select * from public.avisos_consulta_pendientes(5, 50)$$,
  '42501', null, 'anon no lista avisos pendientes'
);

select * from finish();
rollback;
