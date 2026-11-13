-- Endurecimiento de privilegios (migración 20270304100000): `anon` no tiene ningún privilegio sobre las tablas de `public` y
-- `dominio`; `authenticated` no tiene TRUNCATE, REFERENCES ni TRIGGER; y la plataforma de IA no se escribe desde el cliente.
begin;

select no_plan();

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema in ('public', 'dominio')),
  0, 'anon no tiene ningún privilegio sobre las tablas de public ni dominio');

select is(
  (select count(*)::int from information_schema.role_usage_grants
    where grantee = 'anon' and object_schema in ('public', 'dominio') and object_type = 'SEQUENCE'),
  0, 'ni sobre sus secuencias');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema in ('public', 'dominio')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'authenticated no tiene TRUNCATE, REFERENCES ni TRIGGER');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and table_name in ('fuentes_chat_ia', 'fuentes_mcp', 'capacidades_mcp', 'acciones_mcp')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'authenticated no escribe directo las tablas de fuentes y capacidades de IA');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and table_name in ('fuentes_chat_ia', 'fuentes_mcp', 'capacidades_mcp', 'acciones_mcp')
      and privilege_type = 'SELECT') > 0,
  true, 'pero sigue pudiendo leerlas (las pantallas de capacidades las leen)');

-- Una tabla creada a partir de ahora por el rol de las migraciones nace sin privilegios para anon.
create table public.zz_tabla_privilegios_prueba (id int);
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_name = 'zz_tabla_privilegios_prueba'),
  0, 'una tabla nueva no le da privilegios a anon');

select is(has_table_privilege('anon', 'public.organizaciones', 'TRUNCATE'), false, 'anon no puede truncar organizaciones');
select is(has_table_privilege('authenticated', 'public.organizaciones', 'TRUNCATE'), false, 'authenticated tampoco');
select is(has_table_privilege('authenticated', 'public.organizaciones', 'SELECT'), true, 'authenticated conserva la lectura de lo que ya leía (la RLS la filtra)');

select finish();
rollback;
