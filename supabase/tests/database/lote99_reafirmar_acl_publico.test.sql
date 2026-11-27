-- Lote 99 (MSF-653): `private.reafirmar_acl_rpc_internas_de_publico()` corrige la deriva del ACL de las RPC internas de `publico`.
-- Escenario armado acá: se simula el estado del DEV (anon y authenticated con EXECUTE), se llama a la MISMA función que usa la migración
-- 20270514000000 y se mira el resultado. Si la función no revocara, revocara de más o no fuera idempotente, estas aserciones fallan.
begin;

select plan(13);

select has_function('private', 'reafirmar_acl_rpc_internas_de_publico', array[]::text[], 'existe private.reafirmar_acl_rpc_internas_de_publico');

-- Deriva simulada (lo que mostraba el DEV).
grant execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) to anon, authenticated;
grant execute on function publico.registrar_interes_whatsapp(text, uuid) to anon, authenticated;
select ok(
  has_function_privilege('anon', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute')
  and has_function_privilege('authenticated', 'publico.registrar_interes_whatsapp(text, uuid)', 'execute'),
  'precondición: con la deriva simulada anon y authenticated ejecutan las RPC internas');

select lives_ok($$select private.reafirmar_acl_rpc_internas_de_publico()$$, 'la función corre sin error');

select ok(not has_function_privilege('anon', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute'), 'anon ya no ejecuta crear_consulta_publica');
select ok(not has_function_privilege('authenticated', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute'), 'authenticated ya no ejecuta crear_consulta_publica');
select ok(not has_function_privilege('anon', 'publico.registrar_interes_whatsapp(text, uuid)', 'execute'), 'anon ya no ejecuta registrar_interes_whatsapp');
select ok(not has_function_privilege('authenticated', 'publico.registrar_interes_whatsapp(text, uuid)', 'execute'), 'authenticated ya no ejecuta registrar_interes_whatsapp');
select ok(has_function_privilege('service_role', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute')
  and has_function_privilege('service_role', 'publico.registrar_interes_whatsapp(text, uuid)', 'execute'), 'service_role sigue ejecutando las dos');
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'publico.crear_consulta_publica(text, text, text, text, text, uuid)'::regprocedure and a.grantee = 0),
  0, 'PUBLIC (grantee 0) no conserva EXECUTE sobre crear_consulta_publica');

-- Idempotente: una segunda llamada no cambia nada ni falla.
select lives_ok($$select private.reafirmar_acl_rpc_internas_de_publico()$$, 'reaplicable sin error');
select ok(not has_function_privilege('anon', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute')
  and has_function_privilege('service_role', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute'), 'tras la segunda llamada el estado es el mismo');

-- No revoca de más: una RPC pública legítima de la tienda sigue ejecutable por anon.
select ok(
  exists (select 1 from pg_proc p where p.pronamespace = 'publico'::regnamespace and p.proname = 'catalogo_pagina_por_dominio'
                                       and has_function_privilege('anon', p.oid, 'execute')),
  'catalogo_pagina_por_dominio (RPC pública de la tienda) sigue ejecutable por anon');

-- La función de reparación no la alcanza nadie por la API.
select ok(not has_function_privilege('anon', 'private.reafirmar_acl_rpc_internas_de_publico()', 'execute')
  and not has_function_privilege('authenticated', 'private.reafirmar_acl_rpc_internas_de_publico()', 'execute')
  and not has_function_privilege('service_role', 'private.reafirmar_acl_rpc_internas_de_publico()', 'execute'),
  'ni anon, ni authenticated ni service_role ejecutan la función de reparación');

select * from finish();
rollback;
