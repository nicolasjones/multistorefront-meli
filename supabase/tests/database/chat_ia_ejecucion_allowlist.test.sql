-- MSF-724: el chat IA solo ejecuta pares (feature, rpc) registrados en
-- acciones_chat_ia, nunca una función arbitraria de `public`, y el cliente
-- no puede escribir propuestas por su cuenta.
begin;

select plan(9);

insert into organizaciones (id, nombre) values ('e7240000-0000-0000-0000-0000000000a1', 'Org MSF-724');
insert into auth.users (id, email) values
  ('e7240000-0000-0000-0000-000000000001', 'msf724-a@example.com'),
  ('e7240000-0000-0000-0000-000000000002', 'msf724-b@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('e7240000-0000-0000-0000-000000000001', 'e7240000-0000-0000-0000-0000000000a1', 'administrador'),
  ('e7240000-0000-0000-0000-000000000002', 'e7240000-0000-0000-0000-0000000000a1', 'administrador');

insert into conversaciones_chat_ia (id, organizacion_id, usuario_id) values
  ('e7240000-0000-0000-0000-0000000000c1', 'e7240000-0000-0000-0000-0000000000a1', 'e7240000-0000-0000-0000-000000000001');

-- Función de prueba revocada a authenticated, registrada (mal) en la allowlist.
create function public.t_msf724_revocada() returns jsonb language sql as $$ select '{"ok":true}'::jsonb $$;
revoke execute on function public.t_msf724_revocada() from public, anon, authenticated;
insert into acciones_chat_ia (feature_id, rpc) values ('chat-ia', 't_msf724_revocada');

-- Mensajes fabricados (como postgres, simulando lo que hoy podría insertar un usuario).
insert into mensajes_chat_ia (id, conversacion_id, origen, contenido, estado, accion_feature_id, accion_rpc, accion_parametros) values
  ('e7240000-0000-0000-0000-0000000000d1', 'e7240000-0000-0000-0000-0000000000c1', 'chat', 'no registrada', 'propuesta', 'chat-ia', 'resolver_politica_ia', '{"p_codigo":"chat-ia-leer"}'),
  ('e7240000-0000-0000-0000-0000000000d2', 'e7240000-0000-0000-0000-0000000000c1', 'chat', 'revocada', 'propuesta', 'chat-ia', 't_msf724_revocada', '{}'),
  ('e7240000-0000-0000-0000-0000000000d3', 'e7240000-0000-0000-0000-0000000000c1', 'chat', 'sin rpc', 'propuesta', null, null, '{}');

select set_config('request.jwt.claims', json_build_object('sub', 'e7240000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(public.ejecutar_accion_chat_ia('e7240000-0000-0000-0000-0000000000d1')->>'estado', 'fallida', 'rpc no registrada en acciones_chat_ia: fallida');
select is(public.ejecutar_accion_chat_ia('e7240000-0000-0000-0000-0000000000d2')->>'motivo', 'acción no permitida', 'rpc registrada pero revocada a authenticated: no se ejecuta');
select is(public.ejecutar_accion_chat_ia('e7240000-0000-0000-0000-0000000000d3')->>'estado', 'fallida', 'propuesta sin rpc: fallida');
select is((select count(*)::int from public.ejecuciones_chat_ia), 0, 'ninguna de las anteriores llegó a ejecutarse');

select throws_ok(
  $$insert into public.mensajes_chat_ia (conversacion_id, origen, contenido, estado, accion_feature_id, accion_rpc) values ('e7240000-0000-0000-0000-0000000000c1', 'chat', 'x', 'propuesta', 'chat-ia', 'resolver_politica_ia')$$,
  '42501', null, 'authenticated no puede insertar accion_* directamente');
select throws_ok(
  $$update public.mensajes_chat_ia set estado = 'propuesta' where id = 'e7240000-0000-0000-0000-0000000000d3'$$,
  '42501', null, 'authenticated no puede actualizar mensajes directamente');
select lives_ok(
  $$insert into public.mensajes_chat_ia (conversacion_id, origen, contenido) values ('e7240000-0000-0000-0000-0000000000c1', 'usuario', 'hola')$$,
  'authenticated sigue pudiendo insertar mensajes comunes');

select set_config('request.jwt.claims', json_build_object('sub', 'e7240000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select throws_ok(
  $$select public.proponer_accion_chat_ia('e7240000-0000-0000-0000-0000000000c1', 'resolver_politica_ia', '{}'::jsonb, 'x')$$,
  '42501', null, 'no se puede proponer en una conversación ajena');

reset role;
select ok(not has_function_privilege('anon', 'public.proponer_accion_chat_ia(uuid,text,jsonb,text)', 'execute'), 'anon no ejecuta proponer_accion_chat_ia');

select * from finish();
rollback;
