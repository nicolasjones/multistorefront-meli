-- MSF-670: una tabla NUEVA creada por `postgres` en `public` no le da a `authenticated` TRUNCATE, REFERENCES ni TRIGGER
-- (privilegios por defecto, migración 20270507600000; los de `supabase_admin`, 20270507700000, si quien migra es miembro),
-- ni nada a `anon`; los DML por defecto no se tocan.
begin;

select plan(12);

create table public.zz_tabla_acl_defecto (id int);
create table dominio.zz_tabla_acl_defecto (id int);

select ok(not has_table_privilege('authenticated', 'public.zz_tabla_acl_defecto', 'TRUNCATE'),
  'tabla nueva en public: authenticated sin TRUNCATE');
select ok(not has_table_privilege('authenticated', 'public.zz_tabla_acl_defecto', 'REFERENCES'),
  'tabla nueva en public: authenticated sin REFERENCES');
select ok(not has_table_privilege('authenticated', 'public.zz_tabla_acl_defecto', 'TRIGGER'),
  'tabla nueva en public: authenticated sin TRIGGER');
select ok(not has_table_privilege('anon', 'public.zz_tabla_acl_defecto', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'tabla nueva en public: anon sin ningún privilegio');

-- Sin sobre-revocar: si el entorno otorga algo por defecto a authenticated (Supabase otorga todo), siguen los cuatro DML.
select ok(
  (select count(*) filter (where a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) in (0, 4) and count(*) = count(*) filter (where a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
     from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
      and a.grantee = 'authenticated'::regrole),
  'el default de postgres en public otorga a authenticated los cuatro DML o nada: la migración no revoca de más');

select is(
  (select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
      and a.grantee = 'authenticated'::regrole and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'pg_default_acl de postgres en public no otorga TRUNCATE/REFERENCES/TRIGGER a authenticated');

select ok(not has_table_privilege('authenticated', 'dominio.zz_tabla_acl_defecto', 'TRUNCATE,REFERENCES,TRIGGER'),
  'tabla nueva en dominio: authenticated sin TRUNCATE, REFERENCES ni TRIGGER');
select ok(not has_table_privilege('anon', 'dominio.zz_tabla_acl_defecto', 'SELECT,INSERT,UPDATE,DELETE'),
  'tabla nueva en dominio: anon sin acceso');

-- Una tabla con grant explícito (como hacen las migraciones) conserva exactamente lo otorgado.
create table public.zz_tabla_acl_explicita (id int);
grant select, insert, update, delete on public.zz_tabla_acl_explicita to authenticated;
select ok(has_table_privilege('authenticated', 'public.zz_tabla_acl_explicita', 'SELECT')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_explicita', 'INSERT')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_explicita', 'UPDATE')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_explicita', 'DELETE')
  and not has_table_privilege('authenticated', 'public.zz_tabla_acl_explicita', 'TRUNCATE,REFERENCES,TRIGGER'),
  'el grant explícito de una migración conserva select/insert/update/delete sin TRUNCATE/REFERENCES/TRIGGER');

-- Tablas creadas por supabase_admin (Studio, extensiones): mismo endurecimiento (migración 20270507700000), pero esa migración
-- solo puede alterar los privilegios de ese rol si quien migra es miembro suyo; si no, se omite (como en 20261013130000).
select case
  when exists (select 1 from pg_roles where rolname = 'supabase_admin') and pg_has_role(current_user, 'supabase_admin', 'member') then
    is((select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
         where d.defaclrole = (select oid from pg_roles where rolname = 'supabase_admin')
           and d.defaclnamespace in ('public'::regnamespace, 'dominio'::regnamespace) and d.defaclobjtype = 'r'
           and a.grantee = 'authenticated'::regrole and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
       0, 'pg_default_acl de supabase_admin no otorga TRUNCATE/REFERENCES/TRIGGER a authenticated en public ni dominio')
  else skip(1, 'el rol que migra no es miembro de supabase_admin: sus privilegios por defecto no se tocan')
end;

-- Los DML por defecto no se tocaron (al final: modifica el default de postgres dentro de la transacción). El escenario se arma acá, sin depender del entorno: se simula el default de Supabase
-- (todo para authenticated), se aplica la MISMA sentencia que la migración 20270507600000 y se mira una tabla nueva.
alter default privileges for role postgres in schema public grant all on tables to authenticated;
do $$
declare
  v_privilegios text := 'truncate, references, trigger';
begin
  if current_setting('server_version_num')::int >= 170000 then
    v_privilegios := v_privilegios || ', maintain';
  end if;
  execute format('alter default privileges for role postgres in schema public revoke %s on tables from authenticated', v_privilegios);
end $$;
create table public.zz_tabla_acl_simulada (id int);
select ok(has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'SELECT')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'INSERT')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'UPDATE')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'DELETE'),
  'con el default de Supabase y el revoke de la migración, una tabla nueva conserva select/insert/update/delete');
select ok(not has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'REFERENCES')
  and not has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'TRIGGER'),
  'con el default de Supabase y el revoke de la migración, una tabla nueva no recibe truncate/references/trigger');
select * from finish();
rollback;
