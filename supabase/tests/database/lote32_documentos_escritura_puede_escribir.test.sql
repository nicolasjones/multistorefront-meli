-- MSF-651 (lote 32): la escritura de `fragmentos_indexados` y del bucket `documentos-rag` exige `private.puede_escribir()`.
-- El rol Consulta (y Operador, que no es administrador) lee pero no inserta, modifica ni borra; otra organización tampoco.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into documentos (id, organizacion_id, nombre, subido_por) values
  ('f3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'doc.pdf', 'd1000000-0000-0000-0000-000000000001');
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por) values
  ('f4000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/f3000000-0000-0000-0000-000000000001/f4000000-0000-0000-0000-000000000001', 'activa', 'd1000000-0000-0000-0000-000000000001');
insert into fragmentos_indexados (id, version_id, organizacion_id, texto, embedding, orden) values
  ('f5000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'fragmento existente', array_fill(0.1, array[1536])::vector, 0);
insert into storage.buckets (id, name, public) values ('documentos-rag', 'documentos-rag', false) on conflict do nothing;
insert into storage.objects (id, bucket_id, name) values
  ('e0000000-0000-0000-0000-000000000001', 'documentos-rag', '11111111-1111-1111-1111-111111111111/f3000000-0000-0000-0000-000000000001/viejo');

-- En Supabase real `authenticated` ya tiene privilegios sobre storage.objects (manda la RLS); en el stub de CI no.
grant select, insert, update, delete on storage.objects to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.n_fragmentos() returns integer language sql security definer as $$ select count(*)::int from public.fragmentos_indexados $$;
create function pg_temp.n_objetos() returns integer language sql security definer as $$ select count(*)::int from storage.objects where bucket_id = 'documentos-rag' $$;
grant execute on function pg_temp.n_fragmentos(), pg_temp.n_objetos(), pg_temp.como(uuid) to public;

-- ============================================================================
-- Estructura de las políticas
-- ============================================================================
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fragmentos_indexados' and cmd = 'ALL'),
  0, 'ya no hay política for all en fragmentos_indexados');
select is(
  (select array_agg(cmd order by cmd) from pg_policies where schemaname = 'public' and tablename = 'fragmentos_indexados'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[], 'una política por comando');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fragmentos_indexados'
     and cmd in ('INSERT', 'UPDATE', 'DELETE') and (coalesce(qual, '') || coalesce(with_check, '')) like '%puede_escribir%'),
  3, 'insert, update y delete exigen puede_escribir');
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('documentos_rag_propia_organizacion_insert', 'documentos_rag_propia_organizacion_delete')
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%puede_escribir%'),
  2, 'insert y delete del bucket exigen puede_escribir');

-- ============================================================================
-- Consulta y Operador: leen, no escriben
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(pg_temp.n_fragmentos(), 1, 'sanity');
select is((select count(*)::int from public.fragmentos_indexados), 1, 'Consulta sigue leyendo los fragmentos de su organización');
select throws_ok(
  $$insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
    values ('f4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x', array_fill(0.1, array[1536])::vector, 1)$$,
  '42501', 'new row violates row-level security policy for table "fragmentos_indexados"', 'Consulta no inserta fragmentos');
with u as (update public.fragmentos_indexados set texto = 'pisado' returning 1) select is((select count(*)::int from u), 0, 'Consulta no modifica fragmentos');
with d as (delete from public.fragmentos_indexados returning 1) select is((select count(*)::int from d), 0, 'Consulta no borra fragmentos');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('documentos-rag', '11111111-1111-1111-1111-111111111111/f3000000-0000-0000-0000-000000000001/nuevo')$$,
  '42501', 'new row violates row-level security policy for table "objects"', 'Consulta no sube archivos al bucket');
with d as (delete from storage.objects where bucket_id = 'documentos-rag' returning 1) select is((select count(*)::int from d), 0, 'Consulta no borra archivos del bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'documentos-rag'), 1, 'Consulta sigue viendo los archivos de su organización');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
    values ('f4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x', array_fill(0.1, array[1536])::vector, 1)$$,
  '42501', 'new row violates row-level security policy for table "fragmentos_indexados"', 'Operador (sin escritura de organización) no inserta fragmentos');

-- ============================================================================
-- Otra organización: ni siquiera con puede_escribir
-- ============================================================================
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.fragmentos_indexados), 0, 'el administrador de otra organización no ve los fragmentos ajenos');
select throws_ok(
  $$insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
    values ('f4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x', array_fill(0.1, array[1536])::vector, 1)$$,
  '42501', 'new row violates row-level security policy for table "fragmentos_indexados"', 'el administrador de otra organización no escribe fragmentos ajenos');
with d as (delete from public.fragmentos_indexados returning 1) select is((select count(*)::int from d), 0, 'ni los borra');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('documentos-rag', '11111111-1111-1111-1111-111111111111/f3000000-0000-0000-0000-000000000001/ajeno')$$,
  '42501', 'new row violates row-level security policy for table "objects"', 'ni sube archivos a la carpeta de otra organización');

-- ============================================================================
-- Administrador: sigue escribiendo
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
    values ('f4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'nuevo', array_fill(0.1, array[1536])::vector, 1)$$,
  'el administrador inserta fragmentos');
with u as (update public.fragmentos_indexados set texto = 'editado' where texto = 'nuevo' returning 1) select is((select count(*)::int from u), 1, 'el administrador modifica fragmentos');
with d as (delete from public.fragmentos_indexados where texto = 'editado' returning 1) select is((select count(*)::int from d), 1, 'el administrador borra fragmentos');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('documentos-rag', '11111111-1111-1111-1111-111111111111/f3000000-0000-0000-0000-000000000001/nuevo')$$,
  'el administrador sube archivos a su carpeta');
with d as (delete from storage.objects where bucket_id = 'documentos-rag' and name like '%/nuevo' returning 1) select is((select count(*)::int from d), 1, 'el administrador borra archivos de su carpeta');

select * from finish();
rollback;
