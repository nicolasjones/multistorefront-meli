-- MSF-315 · F-TDA-24 (épica MSF-164): analítica de visitas de la tienda (GA4 y Meta Pixel).
-- Verifica FR-010 (tabla, RLS, checks, sin anon), FR-011 (RPC: permisos, empresa ajena, normalización,
-- formato con hint, vaciar), FR-012 (función pública: lista blanca, null idéntico) y FR-017 (aislamiento entre
-- tiendas). Corre como postgres para armar el fixture y como "authenticated"/"anon" para verificar.
begin;

select plan(33);

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Uno A'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Uno B'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos A');

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'analitica-uno-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'analitica-uno-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'analitica-dos-a.ejemplo.com');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Devuelve el `hint` del error que levanta una sentencia (null si no falla), para comprobar el campo (FR-011).
create function pg_temp.hint_de(p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-010)
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.tienda_analitica'::regclass),
  true,
  'dominio.tienda_analitica tiene RLS activado'
);
select is(has_table_privilege('anon', 'dominio.tienda_analitica', 'select'), false, 'anon no lee dominio.tienda_analitica');
select is(has_table_privilege('authenticated', 'dominio.tienda_analitica', 'select'), true, 'authenticated lee (filtrado por RLS)');
select is(has_table_privilege('authenticated', 'dominio.tienda_analitica', 'insert'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'dominio.tienda_analitica', 'update'), false, 'authenticated no actualiza directo');
select is(has_table_privilege('authenticated', 'dominio.tienda_analitica', 'delete'), false, 'authenticated no borra directo');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0,
  'el esquema publico sigue sin tablas'
);
select is(has_function_privilege('anon', 'public.guardar_analitica_tienda(uuid,text,text)', 'execute'), false, 'anon no ejecuta guardar_analitica_tienda');
select is(has_function_privilege('authenticated', 'public.guardar_analitica_tienda(uuid,text,text)', 'execute'), true, 'authenticated ejecuta guardar_analitica_tienda');
select is(has_function_privilege('anon', 'publico.analitica_por_dominio(text)', 'execute'), true, 'anon ejecuta publico.analitica_por_dominio');

-- Checks de formato de la tabla (FR-010), insertando como postgres.
select throws_ok(
  $$insert into dominio.tienda_analitica (organizacion_id, empresa_id, ga4_id)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'g-abc123')$$,
  '23514', null, 'un ID de GA4 en minúsculas viola el check de formato'
);
select throws_ok(
  $$insert into dominio.tienda_analitica (organizacion_id, empresa_id, meta_pixel_id)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '12ab')$$,
  '23514', null, 'un ID de Meta Pixel que no es numérico de 8 a 20 dígitos viola el check'
);
select throws_ok(
  $$insert into dominio.tienda_analitica (organizacion_id, empresa_id, ga4_id)
    values ('11111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-000000000001', 'G-ABC123')$$,
  '23503', null, 'la FK compuesta no deja atar una empresa de otra organización'
);

-- ============================================================================
-- RPC guardar_analitica_tienda (FR-011)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.guardar_analitica_tienda('e1000000-0000-0000-0000-000000000001', 'G-ABC123', '123456789')$$,
  '42501', null, 'un rol sin edición en Empresas no puede guardar la analítica'
);
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_analitica_tienda('e2000000-0000-0000-0000-000000000001', 'G-ABC123', null)$$,
  '42501', null, 'no se puede guardar la analítica de una empresa de otra organización'
);

-- Recorta espacios y pasa a mayúsculas el ID de GA4.
select is(
  (select ga4_id from public.guardar_analitica_tienda('e1000000-0000-0000-0000-000000000001', '  g-abc123  ', '  123456789  ')),
  'G-ABC123',
  'el ID de GA4 se recorta y se pasa a mayúsculas'
);
select is(
  (select meta_pixel_id from dominio.tienda_analitica where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '123456789',
  'el ID de Meta Pixel se recorta'
);

-- Formato inválido: error con el hint del campo y no guarda nada (FR-011, CA-TDA-24-3).
select throws_ok(
  $$select public.guardar_analitica_tienda('e1000000-0000-0000-0000-000000000001', 'UA-123', '123456789')$$,
  '22023', null, 'un ID de GA4 con formato inválido se rechaza'
);
select is(
  pg_temp.hint_de($$select public.guardar_analitica_tienda('e1000000-0000-0000-0000-000000000001', 'UA-123', '123456789')$$),
  'ga4_id',
  'el error de GA4 nombra el campo en el hint'
);
select is(
  pg_temp.hint_de($$select public.guardar_analitica_tienda('e1000000-0000-0000-0000-000000000001', 'G-ABC123', '12ab')$$),
  'meta_pixel_id',
  'el error de Meta Pixel nombra el campo en el hint'
);
select is(
  (select ga4_id from dominio.tienda_analitica where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'G-ABC123',
  'un formato inválido no pisa lo ya guardado'
);

-- Vaciar quita la herramienta pero deja la otra.
select public.guardar_analitica_tienda('e1000000-0000-0000-0000-000000000001', '', '123456789');
select is(
  (select ga4_id is null and meta_pixel_id = '123456789' from dominio.tienda_analitica where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  true,
  'un valor vacío quita esa herramienta y conserva la otra'
);

-- Vuelve a cargar GA4 para las pruebas públicas.
select public.guardar_analitica_tienda('e1000000-0000-0000-0000-000000000001', 'G-ABC123', '123456789');
select is(
  (select count(*)::int from dominio.tienda_analitica),
  1,
  'el administrador de la Uno ve solo la analítica de su organización (RLS)'
);
reset role;

-- La otra organización guarda lo suyo con IDs distintos.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select public.guardar_analitica_tienda('e2000000-0000-0000-0000-000000000001', 'G-DOSDOS1', '999888777');
select is(
  (select count(*)::int from dominio.tienda_analitica),
  1,
  'el administrador de la Dos ve solo su fila: no ve la de la Uno (RLS)'
);
reset role;

-- ============================================================================
-- Función pública (FR-012, FR-017)
-- ============================================================================

set local role anon;

select is(
  (select array_agg(k order by k) from jsonb_object_keys(publico.analitica_por_dominio('analitica-uno-a.ejemplo.com')) k),
  array['ga4_id', 'meta_pixel_id'],
  'lista blanca: solo ga4_id y meta_pixel_id (nunca organizacion_id ni empresa_id)'
);
select is(
  publico.analitica_por_dominio('analitica-uno-a.ejemplo.com'),
  '{"ga4_id": "G-ABC123", "meta_pixel_id": "123456789"}'::jsonb,
  'la tienda A devuelve sus IDs'
);
select is(
  publico.analitica_por_dominio('analitica-uno-b.ejemplo.com'),
  '{"ga4_id": null, "meta_pixel_id": null}'::jsonb,
  'una tienda activa sin analítica devuelve ambos IDs en null (sin mezclar con la otra tienda de la organización)'
);
select is(
  publico.analitica_por_dominio('analitica-dos-a.ejemplo.com'),
  '{"ga4_id": "G-DOSDOS1", "meta_pixel_id": "999888777"}'::jsonb,
  'cada tienda carga solo los IDs de su empresa (aislamiento entre organizaciones)'
);
select is(publico.analitica_por_dominio('desconocido.ejemplo.com'), null, 'un host desconocido devuelve null');
select is(publico.analitica_por_dominio(''), null, 'un host inválido devuelve null');
select is(publico.analitica_por_dominio('analitica uno a'), null, 'un host con caracteres inválidos devuelve null');

reset role;

-- Empresa desactivada: mismo null que un host desconocido.
update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-000000000001';
set local role anon;
select is(publico.analitica_por_dominio('analitica-uno-a.ejemplo.com'), null, 'una empresa desactivada devuelve null');
select is(
  publico.analitica_por_dominio('analitica-uno-a.ejemplo.com') is not distinct from publico.analitica_por_dominio('desconocido.ejemplo.com'),
  true,
  'desactivada y desconocida son indistinguibles (null idéntico)'
);
reset role;

select * from finish();
rollback;
