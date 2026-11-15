-- Clientes en `dominio` y filtro de texto unificado (listado, exportación y correo masivo).
-- Cubre: el listado y la exportación devuelven las mismas filas con un texto que solo coincide en
-- `expreso_preferido`; el índice trigram vive en `dominio`; `dominio/clientes.csv` entra a la exportación
-- total; ninguna función conserva `public.clientes` en su cuerpo; el correo masivo sigue ejecutable por
-- `authenticated` (el revoke de la migración no le quita EXECUTE a quien lo necesita).
begin;

select plan(11);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id)
values ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador');

insert into dominio.clientes (organizacion_id, numero, nombre, tipo, correo, expreso_preferido, acepta_correo_masivo) values
  ('11111111-1111-1111-1111-111111111111', 501, 'Cliente Uno', 'minorista', 'uno@example.com', 'Expreso Zeta Cargas', true),
  ('11111111-1111-1111-1111-111111111111', 502, 'Cliente Dos', 'minorista', 'dos@example.com', 'Otro Transporte', true);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select results_eq(
  $$select nombre from buscar_clientes('zeta cargas')$$,
  $$values ('Cliente Uno'::text)$$,
  'el listado encuentra un cliente por un texto que solo coincide en expreso_preferido');
select results_eq(
  $$select nombre from exportar_clientes('zeta cargas')$$,
  $$values ('Cliente Uno'::text)$$,
  'la exportación devuelve la misma fila que el listado para ese texto');
select is(
  (select count(*)::int from jsonb_array_elements(public.listar_destinatarios_correo_masivo(p_texto => 'zeta cargas')->'filas')),
  1, 'el correo masivo filtra por el mismo texto (authenticated puede ejecutarlo)');
select is(
  (public.resumen_destinatarios_correo_masivo(p_texto => 'zeta cargas')->>'elegibles')::int,
  1, 'el resumen del correo masivo cuenta lo mismo (authenticated puede ejecutarlo)');

reset role;

select ok(
  has_function_privilege('authenticated', 'private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[])', 'execute')
  and not has_function_privilege('anon', 'private.clientes_para_correo_masivo(text, text, uuid, boolean, uuid[])', 'execute'),
  'private.clientes_para_correo_masivo: authenticated ejecuta, anon no');

select ok(
  exists (select 1 from pg_indexes where schemaname = 'dominio' and tablename = 'clientes' and indexname = 'clientes_busqueda_trgm_idx')
  and not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'clientes_busqueda_trgm_idx'),
  'el índice trigram de búsqueda existe en dominio.clientes');

select ok(
  (select indexdef from pg_indexes where schemaname = 'dominio' and indexname = 'clientes_busqueda_trgm_idx') like '%texto_busqueda_cliente%',
  'el índice se define sobre private.texto_busqueda_cliente (la misma expresión que filtran las RPC)');

select ok(
  exists (select 1 from private.conjuntos_exportacion_total() where esquema || '/' || tabla || '.csv' = 'dominio/clientes.csv'),
  'dominio/clientes.csv aparece en la exportación total');

select ok(
  not exists (select 1 from private.conjuntos_exportacion_total() where esquema = 'public' and tabla = 'clientes'),
  'public/clientes.csv ya no aparece en la exportación total');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc ~ '\mpublic\.clientes\M'),
  0, 'ninguna función nombra public.clientes en su cuerpo');

select is(to_regclass('public.clientes')::text, null, 'public.clientes ya no existe');

select * from finish();
rollback;
