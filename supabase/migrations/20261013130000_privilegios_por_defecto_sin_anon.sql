-- MSF-150 · F-ACC-01: lo que nazca después tampoco queda abierto a anon.
-- Una función, tabla o secuencia futura en public volvería a nacer con ALL
-- para anon (configuración de Supabase) y anon, que tiene USAGE sobre public
-- por las RPC de bloqueo, la alcanzaría sin que nadie lo note.
--
-- Cambia solo los privilegios por defecto de anon, in schema public, de lo
-- que se cree desde ahora: ningún objeto existente se toca. NO revoca
-- EXECUTE a PUBLIC (no admite `in schema`, rige en todos los esquemas y
-- rompería funciones de extensiones, private o dominio); que anon no
-- ejecute funciones de public lo vigila el test pgTAP sobre las existentes. Una función, tabla o secuencia que sí
-- deba ser pública lo declara con su propio grant explícito (las RPC de
-- acceso ya lo hacen), que sigue funcionando.
--
-- Aditiva. Reversión: alter default privileges for role <rol> in schema
-- public grant all on
-- functions/tables/sequences to anon.

alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- supabase_admin también crea objetos en public (extensiones, Studio). Solo
-- se puede alterar si el rol que migra es miembro suyo.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
     and pg_has_role(current_user, 'supabase_admin', 'member') then
    alter default privileges for role supabase_admin in schema public revoke all on functions from anon;
    alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
    alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
  else
    raise notice 'MSF-150: se omiten los privilegios por defecto de supabase_admin (el rol que migra no es miembro); local y producción pueden diferir.';
  end if;
end
$$;
