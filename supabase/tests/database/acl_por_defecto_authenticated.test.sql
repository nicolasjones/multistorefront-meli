-- MSF-670: una tabla NUEVA creada por `postgres` en `public` no le da a `authenticated` TRUNCATE, REFERENCES ni TRIGGER
-- (privilegios por defecto, migración 20270507600000; los de `supabase_admin`, 20270507700000, si quien migra es miembro),
-- ni nada a `anon`; los DML por defecto no se tocan.
begin;

select plan(28);

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

-- Escenario armado acá (no depende del entorno): se simula el default de Supabase (todo para authenticated), se llama a la
-- MISMA función que usa la migración 20270507700000 y se mira una tabla nueva. Va al final porque modifica el default de postgres
-- dentro de la transacción. Si la función revocara de más (select, all) o no existiera, estas aserciones fallan.
select has_function('private', 'endurecer_acl_por_defecto', array['name', 'text[]', 'name'], 'existe private.endurecer_acl_por_defecto');
alter default privileges for role postgres in schema public grant all on tables to authenticated;
select private.endurecer_acl_por_defecto('postgres', array['public']);
create table public.zz_tabla_acl_simulada (id int);
select ok(has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'SELECT')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'INSERT')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'UPDATE')
  and has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'DELETE'),
  'con el default de Supabase y la función real, una tabla nueva conserva select/insert/update/delete');
select ok(not has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'REFERENCES')
  and not has_table_privilege('authenticated', 'public.zz_tabla_acl_simulada', 'TRIGGER'),
  'con el default de Supabase y la función real, una tabla nueva no recibe truncate/references/trigger');

-- supabase_admin: no se pueden crear tablas con ese rol aquí; se mira su default. Solo si existe y quien corre es miembro.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') and pg_has_role(current_user, 'supabase_admin', 'member') then
    alter default privileges for role supabase_admin in schema public grant all on tables to authenticated;
    perform private.endurecer_acl_por_defecto('supabase_admin', array['public']);
  end if;
end $$;
select case
  when exists (select 1 from pg_roles where rolname = 'supabase_admin') and pg_has_role(current_user, 'supabase_admin', 'member') then
    is((select array_agg(a.privilege_type order by a.privilege_type)
          from pg_default_acl d, aclexplode(d.defaclacl) a
         where d.defaclrole = (select oid from pg_roles where rolname = 'supabase_admin')
           and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r' and a.grantee = 'authenticated'::regrole),
       array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
       'supabase_admin con default de Supabase y la función real: authenticated conserva solo select/insert/update/delete')
  else skip(1, 'supabase_admin no existe o el rol que corre no es miembro')
end;

select ok(not has_function_privilege('anon', 'private.endurecer_acl_por_defecto(name, text[], name)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.endurecer_acl_por_defecto(name, text[], name)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.endurecer_acl_por_defecto(name, text[], name)', 'EXECUTE'),
  'la función no es ejecutable por anon, authenticated ni service_role');
select throws_ok($$select private.endurecer_acl_por_defecto('postgres', array['otro'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza esquema no admitido');
select throws_ok($$select private.endurecer_acl_por_defecto('authenticator', array['public'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza rol authenticator no admitido');
select throws_ok($$select private.endurecer_acl_por_defecto('service_role', array['public'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza rol service_role no admitido');
select throws_ok($$select private.endurecer_acl_por_defecto('postgres', array['public'], 'anon')$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza destinatario anon no admitido');
select throws_ok($$select private.endurecer_acl_por_defecto(null, array['public'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquemas y destinatario son obligatorios y no pueden ser NULL ni vacíos', 'la función rechaza rol NULL');
select throws_ok($$select private.endurecer_acl_por_defecto('postgres', array['public'], null)$$, '22023', 'endurecer_acl_por_defecto: rol, esquemas y destinatario son obligatorios y no pueden ser NULL ni vacíos', 'la función rechaza destinatario NULL');
select throws_ok($$select private.endurecer_acl_por_defecto('postgres', null)$$, '22023', 'endurecer_acl_por_defecto: rol, esquemas y destinatario son obligatorios y no pueden ser NULL ni vacíos', 'la función rechaza esquemas NULL');
select throws_ok($$select private.endurecer_acl_por_defecto('postgres', array[]::text[])$$, '22023', 'endurecer_acl_por_defecto: rol, esquemas y destinatario son obligatorios y no pueden ser NULL ni vacíos', 'la función rechaza esquemas vacío');
select throws_ok($$select private.endurecer_acl_por_defecto('postgres', array['public', null])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza elemento NULL en esquemas');
select throws_ok($$select private.endurecer_acl_por_defecto('POSTGRES', array['public'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza rol en mayúsculas');
select throws_ok($$select private.endurecer_acl_por_defecto('"postgres"', array['public'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza rol entrecomillado');
select throws_ok($$select private.endurecer_acl_por_defecto(' postgres', array['public'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza rol con espacio');
select throws_ok($$select private.endurecer_acl_por_defecto('postgres', array['PUBLIC'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza esquema en mayúsculas');
select throws_ok($$select private.endurecer_acl_por_defecto('postgres', array[' public'])$$, '22023', 'endurecer_acl_por_defecto: rol, esquema o destinatario no admitido', 'la función rechaza esquema con espacio');

select * from finish();
rollback;
