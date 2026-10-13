-- MSF-150 · F-ACC-01: lo que nazca después tampoco queda abierto a anon.
-- 20261013120000 revocó EXECUTE a PUBLIC y anon sobre las funciones que
-- existían. Una función, tabla o secuencia futura en public volvería a
-- nacer con los privilegios por defecto (EXECUTE para PUBLIC; ALL para anon
-- por la configuración de Supabase) y anon, que tiene USAGE sobre public
-- por las RPC de bloqueo, la alcanzaría sin que nadie lo note.
--
-- Cambia solo los privilegios por defecto de lo que se cree desde ahora:
-- ningún objeto existente se toca. Una función, tabla o secuencia que sí
-- deba ser pública lo declara con su propio grant explícito (las RPC de
-- acceso ya lo hacen), que sigue funcionando.
--
-- Aditiva. Reversión: alter default privileges for role <rol> grant
-- execute on functions to public; y, in schema public, grant all on
-- functions/tables/sequences to anon.

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- supabase_admin también crea objetos en public (extensiones, Studio). Solo
-- se puede alterar si el rol que migra es miembro suyo.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
     and pg_has_role(current_user, 'supabase_admin', 'member') then
    alter default privileges for role supabase_admin revoke execute on functions from public;
    alter default privileges for role supabase_admin in schema public revoke all on functions from anon;
    alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
    alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
  end if;
end
$$;
