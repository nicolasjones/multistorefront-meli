-- MSF-796 (épica MSF-515, Lote 1): la política de borrado del bucket `tienda-identidad` exige que la ruta no esté
-- referenciada por la identidad publicada, el borrador ni ninguna versión. Verifica: la función auxiliar
-- (privilegios, search_path vacío, las tres columnas de ruta en las tres fuentes), el borrado real sobre
-- `storage.objects` como persona editora (referenciado = no se borra; sin referencia = se borra), el aislamiento
-- entre organizaciones y que sin edición en Empresas no se borra nada.
-- Storage rechaza el DELETE SQL directo salvo con `storage.allow_delete_query = 'true'`: se activa en cada borrado
-- para que lo único que decida sea la política de filas.
begin;

select plan(29);

-- ============================================================================
-- Fixture (como postgres: RLS no aplica)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

-- Identidad publicada: logo y banner móvil. Borrador: banner. Versión 7: logo, banner y banner móvil viejos.
insert into dominio.tienda_identidad (empresa_id, organizacion_id, logo_ruta, banner_movil_ruta) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-vivo.png',
   '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/movil-vivo.png');

insert into dominio.tienda_borrador (empresa_id, organizacion_id, identidad) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   jsonb_build_object('banner_ruta', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/banner-borrador.png'));

insert into dominio.tienda_versiones (empresa_id, organizacion_id, numero, resumen, instantanea) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 7, 'Versión vieja',
   jsonb_build_object('identidad', jsonb_build_object(
     'logo_ruta', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-version.png',
     'banner_ruta', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/banner-version.png',
     'banner_movil_ruta', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/movil-version.png')));

-- Otra empresa de la misma organización: su identidad referencia su propio archivo y su borrador (adrede, algo que la
-- función de guardado no permite) apunta a la ruta `ajena-a-b.png` de la Tienda A: esa referencia NO protege el archivo de A.
insert into dominio.tienda_identidad (empresa_id, organizacion_id, logo_ruta) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000002/logo-b.png');
insert into dominio.tienda_borrador (empresa_id, organizacion_id, identidad) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   jsonb_build_object('banner_ruta', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/ajena-a-b.png'));

-- Objetos del bucket: seis referenciados (uno por fuente y columna) y uno huérfano; más uno huérfano de la otra organización.
insert into storage.objects (bucket_id, name, owner)
select 'tienda-identidad', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/' || f, 'd1000000-0000-0000-0000-000000000001'
  from unnest(array['logo-vivo.png', 'movil-vivo.png', 'banner-borrador.png', 'logo-version.png', 'banner-version.png',
                    'movil-version.png', 'huerfano.png', 'huerfano-2.png', 'huerfano-3.png', 'ajena-a-b.png']) as f;
insert into storage.objects (bucket_id, name, owner) values
  ('tienda-identidad', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000002/logo-b.png', 'd1000000-0000-0000-0000-000000000001');
insert into storage.objects (bucket_id, name, owner) values
  ('tienda-identidad', '22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/propio.png', 'd2000000-0000-0000-0000-000000000001');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- Borra como la persona dada (Storage API = DELETE con RLS) y devuelve cuántas filas borró.
create function pg_temp.borrar(p_user uuid, p_ruta text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.como(p_user);
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'tienda-identidad' and name = p_ruta;
  get diagnostics v = row_count;
  reset role;
  return v;
end;
$$;

-- ============================================================================
-- Función auxiliar: privilegios y definición
-- ============================================================================

select is(has_function_privilege('anon', 'private.ruta_identidad_referenciada(text)', 'execute'), false,
  'anon no ejecuta private.ruta_identidad_referenciada');
select is(has_function_privilege('authenticated', 'private.ruta_identidad_referenciada(text)', 'execute'), true,
  'authenticated la ejecuta (la política se evalúa con sus privilegios)');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'private.ruta_identidad_referenciada(text)'::regprocedure),
  true, 'es security definer con search_path vacío');
select ok(
  exists (select 1 from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname = 'tienda_identidad_objetos_delete'
             and cmd = 'DELETE' and qual like '%ruta_identidad_referenciada%' and qual like '%tienda-identidad%'),
  'la política de borrado del bucket consulta las referencias');

-- ============================================================================
-- La función: una fila por fuente y columna
-- ============================================================================

select is(private.ruta_identidad_referenciada('11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-vivo.png'), true, 'identidad publicada: logo');
select is(private.ruta_identidad_referenciada('11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/movil-vivo.png'), true, 'identidad publicada: banner móvil');
select is(private.ruta_identidad_referenciada('11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/banner-borrador.png'), true, 'borrador: banner');
select is(private.ruta_identidad_referenciada('11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-version.png'), true, 'versión: logo');
select is(private.ruta_identidad_referenciada('11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/banner-version.png'), true, 'versión: banner');
select is(private.ruta_identidad_referenciada('11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/movil-version.png'), true, 'versión: banner móvil');
select is(private.ruta_identidad_referenciada('11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/huerfano.png'), false, 'sin referencia: falso');
select is(
  (select array[private.ruta_identidad_referenciada(null), private.ruta_identidad_referenciada(''), private.ruta_identidad_referenciada('sin-barras.png'),
                private.ruta_identidad_referenciada('11111111-1111-1111-1111-111111111111/no-es-uuid/logo-vivo.png')]),
  array[false, false, false, false], 'null, vacío y rutas mal formadas: falso, sin error');

-- ============================================================================
-- La RPC consejera usa la misma función (M3): mismas respuestas que la política
-- ============================================================================

create temp table candidatas as
select '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/' || f as ruta
  from unnest(array['logo-vivo.png', 'movil-vivo.png', 'banner-borrador.png', 'logo-version.png', 'banner-version.png',
                    'movil-version.png', 'huerfano.png', 'huerfano-2.png', 'ajena-a-b.png']) as f;
grant select on candidatas to authenticated;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select array(select unnest(public.rutas_tienda_sin_referencia('e1000000-0000-0000-0000-000000000001', (select array_agg(ruta) from candidatas))) order by 1)),
  array[
    '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/ajena-a-b.png',
    '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/huerfano-2.png',
    '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/huerfano.png'],
  'rutas_tienda_sin_referencia devuelve solo las que ninguna fuente referencia (la referencia de otra empresa no cuenta)');
select is(
  (select array(select unnest(public.rutas_tienda_sin_referencia('e1000000-0000-0000-0000-000000000001', (select array_agg(ruta) from candidatas))) order by 1)),
  (select array_agg(ruta order by ruta) from candidatas where not private.ruta_identidad_referenciada(ruta)),
  'la RPC y la función privada coinciden en todas las rutas candidatas');
select is(
  public.rutas_tienda_sin_referencia('e1000000-0000-0000-0000-000000000001',
    array['22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/propio.png',
          '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000002/otra-empresa.png', null]),
  '{}'::text[], 'la RPC sigue ignorando rutas fuera del prefijo de la empresa (otra organización, otra empresa, nulo)');
reset role;
select is(has_function_privilege('anon', 'public.rutas_tienda_sin_referencia(uuid, text[])', 'execute'), false, 'anon sigue sin ejecutar la RPC');
select is(has_function_privilege('authenticated', 'public.rutas_tienda_sin_referencia(uuid, text[])', 'execute'), true, 'authenticated sigue ejecutándola');

-- ============================================================================
-- Borrado real como persona editora
-- ============================================================================

select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-version.png'), 0,
  'el administrador NO borra un objeto que referencia una versión restaurable');
select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/banner-borrador.png'), 0,
  'el administrador NO borra un objeto del borrador');
select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-vivo.png'), 0,
  'el administrador NO borra un objeto de la identidad publicada');
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'tienda-identidad' and name like '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/%' and name not like '%huerfano%' and name not like '%ajena-a-b%'),
  6, 'los seis objetos referenciados siguen en el bucket');

select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/huerfano.png'), 1,
  'el administrador SÍ borra un objeto sin referencia');

-- Aislamiento: otra organización no borra ni siquiera un huérfano ajeno; sin edición en Empresas tampoco.
select is(pg_temp.borrar('d2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/huerfano-2.png'), 0,
  'otra organización no borra un objeto ajeno sin referencia');
select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/huerfano-2.png'), 0,
  'sin edición en Empresas no se borra ni un objeto sin referencia');
select is(pg_temp.borrar('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/propio.png'), 1,
  'la otra organización sí borra su propio objeto sin referencia (la referencia de Uno no la afecta)');

-- Una referencia de otra empresa no protege la ruta de esta (la ruta lleva la empresa): el borrador de la Tienda B apunta
-- a `ajena-a-b.png` de la Tienda A y, aun así, ese archivo se borra; en cambio el logo propio de la B queda protegido.
select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/ajena-a-b.png'), 1,
  'la referencia de otra empresa no protege el archivo de esta');
select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000002/logo-b.png'), 0,
  'el logo publicado de la otra empresa sigue protegido por su propia identidad');
select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/huerfano-2.png'), 1,
  'el objeto sin referencia que quedaba se borra con normalidad');

-- Quitar la referencia libera el archivo: al descartar el borrador, su banner queda sin referencia.
delete from dominio.tienda_borrador where empresa_id = 'e1000000-0000-0000-0000-000000000001';
select is(pg_temp.borrar('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/banner-borrador.png'), 1,
  'sin el borrador, el banner que solo él referenciaba queda libre y se borra');

select * from finish();
rollback;
