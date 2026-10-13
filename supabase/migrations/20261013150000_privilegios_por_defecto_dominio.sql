-- MSF-150 · F-ACC-01: acota el efecto de 20261013130000 sobre el esquema dominio.
-- El revoke de EXECUTE a PUBLIC en los privilegios por defecto es global; las
-- funciones futuras de dominio (RPC y helpers de RLS) nacerían sin permiso para
-- authenticated y fallarían en silencio. Se devuelve de forma explícita, sin
-- abrirlo a anon. Quien cree funciones en otros esquemas debe conceder EXECUTE
-- a mano (ver docs/acceso-ingreso.md).
--
-- Aditiva. Reversión: alter default privileges for role <rol> in schema
-- dominio revoke execute on functions from authenticated, service_role;

alter default privileges for role postgres in schema dominio
  grant execute on functions to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
     and pg_has_role(current_user, 'supabase_admin', 'member') then
    alter default privileges for role supabase_admin in schema dominio
      grant execute on functions to authenticated, service_role;
  else
    raise notice 'MSF-150: se omiten los privilegios por defecto de supabase_admin en dominio (el rol que migra no es miembro).';
  end if;
end
$$;
