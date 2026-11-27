-- MSF-653 (lote 99): reafirma el ACL de las RPC internas de `publico` y deja la corrección en una función reaplicable.
--
-- Qué pasó: `publico.crear_consulta_publica` y `publico.registrar_interes_whatsapp` solo deben ejecutarlas `service_role` y el propietario
-- (20261212120800 y 20270507150100 les hacen `revoke ... from public, anon, authenticated`). En el DEV vivo, sin embargo, `proacl` mostraba
-- `anon=X` y `authenticated=X`: la migración figuraba registrada pero su SQL no había corrido (migración «aplicada-manual», deriva del DEV,
-- ver docs/endurecimiento-infra.md). Un anónimo con un dominio de tienda válido podía insertar consultas sin el tope de 5 por hora.
--
-- Qué hace esta migración: define `private.reafirmar_acl_rpc_internas_de_publico()` (idempotente) que repite el revoke/grant y la invoca una
-- vez. Como las migraciones posteriores del DEV sí se aplican por el cron, esta reparación llega aunque las anteriores no hayan corrido. La
-- misma función la usa el pgTAP `lote99_reafirmar_acl_publico.test.sql`: no hay una copia del SQL en la prueba. Si una función no existe en el
-- entorno (base descartable sin esa migración) se omite sin error.
--
-- Sin tablas ni datos: solo privilegios. Reaplicable (revocar lo ya revocado no cambia nada).
--
-- Reversión (migración posterior; no recomendada, vuelve a abrir las RPC a anónimos):
--   drop function private.reafirmar_acl_rpc_internas_de_publico();
--   grant execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) to anon, authenticated;
--   grant execute on function publico.registrar_interes_whatsapp(text, uuid) to anon, authenticated;

create or replace function private.reafirmar_acl_rpc_internas_de_publico()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_firma text;
begin
  foreach v_firma in array array[
    'publico.crear_consulta_publica(text, text, text, text, text, uuid)',
    'publico.registrar_interes_whatsapp(text, uuid)'
  ] loop
    if to_regprocedure(v_firma) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_firma);
      execute format('grant execute on function %s to service_role', v_firma);
    end if;
  end loop;
end;
$$;

comment on function private.reafirmar_acl_rpc_internas_de_publico() is
  'MSF-653: repite el revoke a public/anon/authenticated y el grant a service_role de publico.crear_consulta_publica y publico.registrar_interes_whatsapp. Idempotente; solo la ejecuta el propietario (migraciones).';

revoke all on function private.reafirmar_acl_rpc_internas_de_publico() from public, anon, authenticated, service_role;

select private.reafirmar_acl_rpc_internas_de_publico();
