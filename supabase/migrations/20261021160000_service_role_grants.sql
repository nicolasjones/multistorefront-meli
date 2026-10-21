-- El sandbox y las herramientas server-side usan service_role. Supabase lo crea con BYPASSRLS,
-- pero el esquema `dominio`/`private` y sus tablas no tenían grants explícitos: el seed fallaba
-- con "permission denied for schema dominio" / "for table usuarios_organizacion".
-- service_role es server-only (nunca se expone al navegador): se le da acceso completo.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public, dominio, private to service_role;
    grant all privileges on all tables in schema public, dominio to service_role;
    grant all privileges on all sequences in schema public, dominio to service_role;
    grant execute on all functions in schema public, dominio, private to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
    alter default privileges in schema dominio grant all on tables to service_role;
    alter default privileges in schema dominio grant all on sequences to service_role;
  end if;
end $$;
