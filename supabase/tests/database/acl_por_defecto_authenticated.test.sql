-- MSF-670: una tabla NUEVA creada por `postgres` en `public` no le da a `authenticated` TRUNCATE, REFERENCES ni TRIGGER
-- (privilegios por defecto, migración 20270507600000), ni nada a `anon`; los DML por defecto no se tocan.
begin;

select plan(9);

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

-- Los DML por defecto no se tocaron: si el entorno los otorga por defecto (Supabase), siguen; si no, esta aserción no aplica.
select ok(
  not exists (select 1 from pg_default_acl d
              where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
                and exists (select 1 from aclexplode(d.defaclacl) a
                            where a.grantee = 'authenticated'::regrole and a.privilege_type in ('INSERT', 'SELECT', 'UPDATE', 'DELETE'))
                and not (has_table_privilege('authenticated', 'public.zz_tabla_acl_defecto', 'SELECT')
                         and has_table_privilege('authenticated', 'public.zz_tabla_acl_defecto', 'INSERT')
                         and has_table_privilege('authenticated', 'public.zz_tabla_acl_defecto', 'UPDATE')
                         and has_table_privilege('authenticated', 'public.zz_tabla_acl_defecto', 'DELETE'))),
  'los DML otorgados por defecto a authenticated en public siguen otorgándose');

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

select * from finish();
rollback;
