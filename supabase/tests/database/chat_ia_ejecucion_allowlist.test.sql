-- MSF-724: el chat IA solo ejecuta pares (feature, rpc) registrados en
-- acciones_chat_ia, nunca una función arbitraria de `public`; el cliente no
-- puede escribir propuestas por su cuenta; y la RPC registrada se ejecuta
-- con los privilegios del usuario (RLS incluida), no con los del dueño.
begin;

select plan(37);

-- ============================================================================
-- Fixture
-- ============================================================================
insert into organizaciones (id, nombre) values
  ('e7240000-0000-0000-0000-0000000000a1', 'Org MSF-724'),
  ('e7240000-0000-0000-0000-0000000000b1', 'Org MSF-724 B');

insert into auth.users (id, email) values
  ('e7240000-0000-0000-0000-000000000001', 'msf724-a@example.com'),
  ('e7240000-0000-0000-0000-000000000002', 'msf724-b@example.com'),
  ('e7240000-0000-0000-0000-000000000009', 'msf724-super@example.com');

-- Superadmin de plataforma: es quien ajusta las capacidades del chat (por
-- RPC) y quien carga la allowlist de acciones.
insert into public.superadmins (user_id) values
  ('e7240000-0000-0000-0000-000000000009');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('e7240000-0000-0000-0000-000000000001', 'e7240000-0000-0000-0000-0000000000a1', 'administrador'),
  ('e7240000-0000-0000-0000-000000000002', 'e7240000-0000-0000-0000-0000000000a1', 'administrador');

insert into conversaciones_chat_ia (id, organizacion_id, usuario_id) values
  ('e7240000-0000-0000-0000-0000000000c1', 'e7240000-0000-0000-0000-0000000000a1', 'e7240000-0000-0000-0000-000000000001');

-- Funcionalidades de prueba: el chat y la acción, habilitadas para la
-- organización del usuario (sin esto, private.puede_chat_ejecutar_
-- funcionalidad es false y no hay camino feliz).
insert into features (id, nombre) values
  ('chat-ia', 'Chat'),
  ('msf-724-demo', 'Demo MSF-724'),
  ('aaa-msf-724', 'Orden lexicografico 1'),
  ('zzz-msf-724', 'Orden lexicografico 2'),
  ('msf-724-extra', 'Sin capacidad de chat')
on conflict (id) do nothing;

insert into organizaciones_features (feature_id, organizacion_id, habilitado_por) values
  ('chat-ia', 'e7240000-0000-0000-0000-0000000000a1', 'e7240000-0000-0000-0000-000000000001'),
  ('msf-724-demo', 'e7240000-0000-0000-0000-0000000000a1', 'e7240000-0000-0000-0000-000000000001'),
  ('aaa-msf-724', 'e7240000-0000-0000-0000-0000000000a1', 'e7240000-0000-0000-0000-000000000001'),
  ('zzz-msf-724', 'e7240000-0000-0000-0000-0000000000a1', 'e7240000-0000-0000-0000-000000000001');

insert into capacidades_chat_ia (feature_id, ejecucion) values
  ('msf-724-demo', true),
  ('aaa-msf-724', true),
  ('zzz-msf-724', true);

-- Acciones de prueba, todas security invoker como las RPC de negocio que se
-- registran para el chat: la RLS del usuario tiene que aplicarse.
create function public.t_msf724_accion(p_texto text) returns jsonb
language sql security invoker set search_path = ''
as $$ select jsonb_build_object('texto', p_texto) $$;

create function public.t_msf724_doble(p_texto text) returns jsonb
language sql security invoker set search_path = ''
as $$ select jsonb_build_object('texto', p_texto) $$;

-- Lee una organización por id: con la RLS de `organizaciones`, un usuario de
-- la org A no ve la org B. Con el wrapper security definer anterior (que
-- ejecutaba como postgres) sí la veía: esa es la escalada que se cierra.
create function public.t_msf724_leer_organizacion(p_organizacion_id uuid) returns text
language sql security invoker set search_path = ''
as $$
  select coalesce(
    (select o.id::text from public.organizaciones o where o.id = p_organizacion_id),
    'SIN_ACCESO'
  )
$$;

-- Función de prueba revocada a authenticated, registrada (mal) en la allowlist.
create function public.t_msf724_revocada() returns jsonb language sql as $$ select '{"ok":true}'::jsonb $$;
revoke execute on function public.t_msf724_revocada() from public, anon, authenticated;

insert into acciones_chat_ia (feature_id, rpc) values
  ('chat-ia', 't_msf724_revocada'),
  ('msf-724-demo', 't_msf724_accion'),
  ('msf-724-demo', 't_msf724_leer_organizacion'),
  ('aaa-msf-724', 't_msf724_doble'),
  ('zzz-msf-724', 't_msf724_doble');

-- Tablas temporales para guardar los ids de las propuestas y los resultados
-- (los ids los genera la base: no se pueden escribir a mano).
create temporary table t_propuestas (id uuid primary key, rpc text);
grant all on t_propuestas to authenticated;

create temporary table t_resultados (clave text primary key, resultado jsonb);
grant all on t_resultados to authenticated;

-- Mensajes fabricados (como postgres, simulando lo que hoy podría insertar un
-- usuario): rpc no registrada, rpc revocada, sin rpc y parámetros inventados.
insert into mensajes_chat_ia (id, conversacion_id, origen, contenido, estado, accion_feature_id, accion_rpc, accion_parametros) values
  ('e7240000-0000-0000-0000-0000000000d1', 'e7240000-0000-0000-0000-0000000000c1', 'chat', 'no registrada', 'propuesta', 'chat-ia', 'resolver_politica_ia', '{"p_codigo":"chat-ia-leer"}'),
  ('e7240000-0000-0000-0000-0000000000d2', 'e7240000-0000-0000-0000-0000000000c1', 'chat', 'revocada', 'propuesta', 'chat-ia', 't_msf724_revocada', '{}'),
  ('e7240000-0000-0000-0000-0000000000d3', 'e7240000-0000-0000-0000-0000000000c1', 'chat', 'sin rpc', 'propuesta', null, null, '{}'),
  ('e7240000-0000-0000-0000-0000000000d4', 'e7240000-0000-0000-0000-0000000000c1', 'chat', 'parametro forjado', 'propuesta', 'msf-724-demo', 't_msf724_accion', '{"p_organizacion_id":"e7240000-0000-0000-0000-0000000000b1"}');

select set_config('request.jwt.claims', json_build_object('sub', 'e7240000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ============================================================================
-- Rechazos: nada que no esté en la allowlist se ejecuta
-- ============================================================================
select is(public.ejecutar_accion_chat_ia('e7240000-0000-0000-0000-0000000000d1')->>'estado', 'fallida', 'rpc no registrada en acciones_chat_ia: fallida');
select is(public.ejecutar_accion_chat_ia('e7240000-0000-0000-0000-0000000000d2')->>'motivo', 'acción no permitida', 'rpc registrada pero revocada a authenticated: no se ejecuta');
select is(public.ejecutar_accion_chat_ia('e7240000-0000-0000-0000-0000000000d3')->>'estado', 'fallida', 'propuesta sin rpc: fallida');
select is((select count(*)::int from public.ejecuciones_chat_ia), 0, 'ninguna de las anteriores llegó a ejecutarse');

select is(
  public.ejecutar_accion_chat_ia('e7240000-0000-0000-0000-0000000000d4')->>'motivo',
  'parámetros no permitidos',
  'una fila fabricada con un parámetro que la acción no declara: no se ejecuta'
);

-- ============================================================================
-- El cliente no escribe propuestas
-- ============================================================================
select throws_ok(
  $$insert into public.mensajes_chat_ia (conversacion_id, origen, contenido, estado, accion_feature_id, accion_rpc) values ('e7240000-0000-0000-0000-0000000000c1', 'chat', 'x', 'propuesta', 'chat-ia', 'resolver_politica_ia')$$,
  '42501', null, 'authenticated no puede insertar accion_* directamente');
select throws_ok(
  $$update public.mensajes_chat_ia set estado = 'propuesta' where id = 'e7240000-0000-0000-0000-0000000000d3'$$,
  '42501', null, 'authenticated no puede actualizar mensajes directamente');
select lives_ok(
  $$insert into public.mensajes_chat_ia (conversacion_id, origen, contenido) values ('e7240000-0000-0000-0000-0000000000c1', 'usuario', 'hola')$$,
  'authenticated sigue pudiendo insertar mensajes comunes');

-- Un mensaje con estado 'propuesta' escrito a mano por el cliente no tiene
-- acción: sin (feature, rpc) no hay nada que ejecutar.
select lives_ok(
  $$insert into public.mensajes_chat_ia (conversacion_id, origen, contenido, estado) values ('e7240000-0000-0000-0000-0000000000c1', 'usuario', 'propuesta a mano', 'propuesta')$$,
  'el cliente puede escribir un mensaje con estado propuesta, pero sin accion');

insert into t_propuestas (id, rpc)
select id, 'propuesta-a-mano'
from public.mensajes_chat_ia
where conversacion_id = 'e7240000-0000-0000-0000-0000000000c1'
  and contenido = 'propuesta a mano'
  and estado = 'propuesta';

select is(
  public.ejecutar_accion_chat_ia((select id from t_propuestas where rpc = 'propuesta-a-mano'))->>'motivo',
  'acción no registrada',
  'una propuesta escrita a mano por el cliente no ejecuta nada'
);

-- ============================================================================
-- Camino feliz: proponer una acción registrada y ejecutarla
-- ============================================================================
select is(
  public.proponer_accion_chat_ia('e7240000-0000-0000-0000-0000000000c1', 't_msf724_accion', '{"p_texto":"hola"}'::jsonb, 'accion de prueba')->>'propuesta',
  'true',
  'una accion registrada y ejecutable se propone'
);

insert into t_propuestas (id, rpc)
select id, accion_rpc
from public.mensajes_chat_ia
where conversacion_id = 'e7240000-0000-0000-0000-0000000000c1'
  and accion_rpc = 't_msf724_accion'
  -- d4 (fabricada, ya fallida) usa la misma rpc: sin este filtro la
  -- subconsulta escalar de abajo devolvería dos filas y abortaría el script.
  and estado = 'propuesta';

insert into t_resultados (clave, resultado)
select 'accion', public.ejecutar_accion_chat_ia((select id from t_propuestas where rpc = 't_msf724_accion'));

select is((select resultado->>'estado' from t_resultados where clave = 'accion'), 'completada', 'la accion registrada se ejecuta');
select is((select resultado->'resultado'->>'texto' from t_resultados where clave = 'accion'), 'hola', 'la accion recibe los parametros de la propuesta');
select is((select count(*)::int from public.ejecuciones_chat_ia), 1, 'la ejecucion quedo auditada');
select is((select estado from public.ejecuciones_chat_ia), 'completada', 'la auditoria queda en estado completado');
select is(
  (select estado from public.mensajes_chat_ia where id = (select id from t_propuestas where rpc = 't_msf724_accion')),
  'confirmada',
  'el mensaje de la propuesta queda confirmado'
);

-- ============================================================================
-- La RPC registrada corre con los privilegios del usuario (RLS), no como
-- el dueño: un p_organizacion_id forjado no alcanza datos de otra organización.
-- ============================================================================
select is(
  public.proponer_accion_chat_ia('e7240000-0000-0000-0000-0000000000c1', 't_msf724_leer_organizacion', '{"p_organizacion_id":"e7240000-0000-0000-0000-0000000000b1"}'::jsonb, 'leer')->>'propuesta',
  'true',
  'la accion de lectura se propone con un parametro declarado por la accion'
);

insert into t_resultados (clave, resultado)
select 'organizacion', public.ejecutar_accion_chat_ia(
  (select id from public.mensajes_chat_ia
    where conversacion_id = 'e7240000-0000-0000-0000-0000000000c1'
      and accion_rpc = 't_msf724_leer_organizacion'
      and estado = 'propuesta'
    limit 1)
);

select is(
  (select resultado->>'resultado' from t_resultados where clave = 'organizacion'),
  'SIN_ACCESO',
  'la RPC registrada corrio con los privilegios del usuario: la RLS le oculto la otra organizacion'
);

-- ============================================================================
-- Los parametros de una propuesta tienen que ser los que la accion declara
-- ============================================================================
select is(
  public.proponer_accion_chat_ia('e7240000-0000-0000-0000-0000000000c1', 't_msf724_accion', '{"p_texto":"hola","p_organizacion_id":"e7240000-0000-0000-0000-0000000000b1"}'::jsonb, 'x')->>'motivo',
  'PARAMETROS_NO_PERMITIDOS',
  'una propuesta con un parametro que la accion no declara se rechaza'
);

-- ============================================================================
-- La feature de la propuesta es determinista (misma rpc en dos features)
-- ============================================================================
select is(
  public.proponer_accion_chat_ia('e7240000-0000-0000-0000-0000000000c1', 't_msf724_doble', '{"p_texto":"x"}'::jsonb, 'x')->>'propuesta',
  'true',
  'una rpc registrada en dos features se propone una sola vez'
);

select is(
  (select accion_feature_id from public.mensajes_chat_ia where accion_rpc = 't_msf724_doble' limit 1),
  'aaa-msf-724',
  'la propuesta se liga a la primera feature ejecutable por orden (determinista, no por plan de ejecucion)'
);

-- ============================================================================
-- La plataforma del chat no se escribe desde el cliente: ni las capacidades
-- por funcionalidad ni la allowlist de acciones. El permiso está DENEGADO
-- (42501), no filtrado en silencio por la RLS (MSF-724).
-- ============================================================================
select throws_ok(
  $$insert into public.capacidades_chat_ia (feature_id, ejecucion) values ('msf-724-extra', true)$$,
  '42501', null, 'authenticated no puede habilitar la ejecucion de una funcionalidad por su cuenta');
select throws_ok(
  $$update public.capacidades_chat_ia set ejecucion = true where feature_id = 'msf-724-demo'$$,
  '42501', null, 'authenticated no puede habilitar la ejecucion de una funcionalidad ya registrada');
select throws_ok(
  $$insert into public.acciones_chat_ia (feature_id, rpc) values ('msf-724-demo', 't_msf724_accion_falsa')$$,
  '42501', null, 'authenticated no puede ampliar la allowlist de acciones');
select throws_ok(
  $$delete from public.acciones_chat_ia where feature_id = 'msf-724-demo' and rpc = 't_msf724_accion'$$,
  '42501', null, 'authenticated no puede borrar una accion registrada');
select is(has_table_privilege('authenticated', 'public.capacidades_chat_ia', 'insert'), false, 'authenticated no inserta capacidades del chat');
select is(has_table_privilege('authenticated', 'public.capacidades_chat_ia', 'update'), false, 'authenticated no actualiza capacidades del chat');
select is(has_table_privilege('authenticated', 'public.capacidades_chat_ia', 'delete'), false, 'authenticated no borra capacidades del chat');
select is(has_table_privilege('authenticated', 'public.acciones_chat_ia', 'insert'), false, 'authenticated no inserta en la allowlist');
select is(has_table_privilege('authenticated', 'public.acciones_chat_ia', 'update'), false, 'authenticated no actualiza la allowlist');
select is(has_table_privilege('authenticated', 'public.acciones_chat_ia', 'delete'), false, 'authenticated no borra la allowlist');
select is(has_table_privilege('anon', 'public.capacidades_chat_ia', 'select'), false, 'anon no lee las capacidades del chat');
select is(has_table_privilege('anon', 'public.acciones_chat_ia', 'select'), false, 'anon no lee la allowlist');

-- ============================================================================
-- Aislamiento entre usuarios
-- ============================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'e7240000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select public.proponer_accion_chat_ia('e7240000-0000-0000-0000-0000000000c1', 'resolver_politica_ia', '{}'::jsonb, 'x')$$,
  '42501', null, 'no se puede proponer en una conversacion ajena');

-- ============================================================================
-- La gobernanza sigue funcionando: el superadmin ajusta la capacidad por RPC
-- (es el camino que usa la pantalla de capacidades del chat)
-- ============================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'e7240000-0000-0000-0000-000000000009', 'role', 'authenticated')::text, true);
select lives_ok(
  $$select public.actualizar_capacidad_chat_ejecucion('msf-724-extra', true)$$,
  'el superadmin habilita la ejecucion de una funcionalidad por RPC');
select is(
  (select ejecucion from public.capacidades_chat_ia where feature_id = 'msf-724-extra'),
  true,
  'la capacidad de ejecucion queda habilitada por el superadmin');

reset role;
select ok(not has_function_privilege('anon', 'public.proponer_accion_chat_ia(uuid,text,jsonb,text)', 'execute'), 'anon no ejecuta proponer_accion_chat_ia');

select * from finish();
rollback;
