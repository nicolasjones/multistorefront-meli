-- MSF-150 · F-ACC-01: acota el efecto de 20261013130000 sobre el esquema private.
-- Revocar EXECUTE a PUBLIC en los privilegios por defecto no admite `in schema`
-- (el privilegio de PUBLIC viene del valor por defecto global y un revoke
-- por esquema no lo quita), así que alcanza a todos los esquemas. Los helpers
-- de RLS de private (organizacion_id, es_superadmin, ...) los ejecuta
-- authenticated desde las policies: un helper futuro nacería sin ese permiso.
-- Se devuelve de forma explícita para private, sin abrirlo a anon.
--
-- Aditiva. Reversión: alter default privileges for role <rol> in schema
-- private revoke execute on functions from authenticated, service_role;

alter default privileges for role postgres in schema private
  grant execute on functions to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
     and pg_has_role(current_user, 'supabase_admin', 'member') then
    alter default privileges for role supabase_admin in schema private
      grant execute on functions to authenticated, service_role;
  else
    raise notice 'MSF-150: se omiten los privilegios por defecto de supabase_admin en private (el rol que migra no es miembro).';
  end if;
end
$$;
