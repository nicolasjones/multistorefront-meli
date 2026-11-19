-- MSF-651 (lote 32): el rol Consulta no escribe ni borra documentos RAG (fragmentos, documentos, versiones, objetos del bucket
-- y `eliminar_documento`); Administrador, Operador, Mostrador, Depósito, Administración y Técnico sí; otra organización y
-- `anon` no; y el cliente de servicio (la función Edge `indexar-documento`) escribe y borra fragmentos.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'mostrador-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'deposito-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000006', 'administracion-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000007', 'tecnico-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000008', 'suspendido-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000009', 'miembro-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion', 'activo'),
  ('d1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'tecnico', 'activo'),
  ('d1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'operador', 'suspendido'),
  ('d1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into public.features (id, nombre, descripcion) values ('busqueda-documental', 'RAG', 'x') on conflict do nothing;
insert into public.organizaciones_features (feature_id, organizacion_id, habilitado_por) values
  ('busqueda-documental', '11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001'),
  ('busqueda-documental', '22222222-2222-2222-2222-222222222222', 'd2000000-0000-0000-0000-000000000001');

-- Fixture: un documento con versión, fragmento y objeto de la organización Uno (como postgres).
insert into documentos (id, organizacion_id, nombre, subido_por) values
  ('f3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'doc.pdf', 'd1000000-0000-0000-0000-000000000001');
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por) values
  ('f4000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111/f3000000-0000-0000-0000-000000000001/f4000000-0000-0000-0000-000000000001', 'procesando', 'd1000000-0000-0000-0000-000000000001');
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

-- Ciclo completo de escritura con la sesión actual: documento, versión, fragmento, objeto; modificar y borrar todo.
-- Devuelve 'ok' o el SQLSTATE y el mensaje del primer fallo. Storage bloquea el delete directo salvo opt-in por transacción.
create function pg_temp.ciclo(p_n integer) returns text language plpgsql as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_doc uuid;
  v_ver uuid := gen_random_uuid();
  v_ruta text;
  v_filas integer;
begin
  insert into public.documentos (nombre) values ('doc-' || p_n || '.txt') returning id into v_doc;
  v_ruta := v_org || '/' || v_doc || '/' || v_ver;
  insert into public.versiones_documento (id, documento_id, storage_path, estado) values (v_ver, v_doc, v_ruta, 'procesando');
  insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
    values (v_ver, v_org, 'texto', array_fill(0.1, array[1536])::vector, 0);
  insert into storage.objects (bucket_id, name) values ('documentos-rag', v_ruta);
  update public.fragmentos_indexados set texto = 'editado' where version_id = v_ver;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then return 'no modificó el fragmento'; end if;
  update public.versiones_documento set motivo_error = 'x' where id = v_ver;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then return 'no modificó la versión'; end if;
  update public.documentos set nombre = 'otro.txt' where id = v_doc;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then return 'no modificó el documento'; end if;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'documentos-rag' and name = v_ruta;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then return 'no borró el objeto'; end if;
  delete from public.fragmentos_indexados where version_id = v_ver;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then return 'no borró el fragmento'; end if;
  delete from public.versiones_documento where id = v_ver;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then return 'no borró la versión'; end if;
  delete from public.documentos where id = v_doc;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then return 'no borró el documento'; end if;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
grant execute on function pg_temp.ciclo(integer), pg_temp.como(uuid) to public;

-- ============================================================================
-- Helper y estructura
-- ============================================================================
select is(has_function_privilege('anon', 'private.puede_gestionar_documentos()', 'execute'), false, 'anon no ejecuta el helper');
select is(has_function_privilege('authenticated', 'private.puede_gestionar_documentos()', 'execute'), true, 'authenticated lo ejecuta (lo usan las políticas)');
select is((select array_agg(cmd order by cmd) from pg_policies where schemaname = 'public' and tablename = 'fragmentos_indexados'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[], 'una política por comando en fragmentos_indexados (ya no hay for all)');
select is((select count(*)::int from pg_policies
            where ((schemaname = 'public' and tablename in ('fragmentos_indexados', 'documentos', 'versiones_documento') and cmd in ('INSERT', 'UPDATE', 'DELETE'))
               or (schemaname = 'storage' and tablename = 'objects' and policyname in ('documentos_rag_propia_organizacion_insert', 'documentos_rag_propia_organizacion_delete')))
              and (coalesce(qual, '') || coalesce(with_check, '')) not like '%puede_gestionar_documentos%'),
  0, 'toda política de escritura de documentos exige el helper');

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select private.puede_gestionar_documentos()), false, 'Consulta no puede gestionar documentos');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select private.puede_gestionar_documentos()), true, 'Operador sí');
select pg_temp.como('d1000000-0000-0000-0000-000000000008');
select is((select private.puede_gestionar_documentos()), false, 'un miembro suspendido no');
select pg_temp.como('d1000000-0000-0000-0000-000000000009');
select is((select private.puede_gestionar_documentos()), false, 'el rol heredado miembro (solo lectura) no puede gestionar documentos');
select ok(pg_temp.ciclo(8) like '42501:%', 'miembro no escribe (lista blanca de roles escritores)');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select private.puede_gestionar_documentos()), true, 'el administrador de otra organización gestiona SUS documentos');
reset role;
set local role anon;
select throws_ok($$select private.puede_gestionar_documentos()$$, '42501', 'permission denied for schema private', 'anon no ejecuta el helper');
reset role;

-- ============================================================================
-- Consulta: lee, no escribe ni borra
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.fragmentos_indexados), 1, 'Consulta sigue leyendo los fragmentos');
select is((select count(*)::int from public.documentos), 1, 'Consulta sigue viendo los documentos');
select is((select count(*)::int from storage.objects where bucket_id = 'documentos-rag'), 1, 'Consulta sigue viendo los objetos');
select throws_ok(
  $$insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
    values ('f4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x', array_fill(0.1, array[1536])::vector, 1)$$,
  '42501', 'new row violates row-level security policy for table "fragmentos_indexados"', 'Consulta no inserta fragmentos');
with u as (update public.fragmentos_indexados set texto = 'pisado' returning 1) select is((select count(*)::int from u), 0, 'Consulta no modifica fragmentos');
with d as (delete from public.fragmentos_indexados returning 1) select is((select count(*)::int from d), 0, 'Consulta no borra fragmentos');
select throws_ok($$insert into public.documentos (nombre) values ('nuevo.txt')$$,
  '42501', 'new row violates row-level security policy for table "documentos"', 'Consulta no crea documentos');
with u as (update public.documentos set nombre = 'pisado' returning 1) select is((select count(*)::int from u), 0, 'Consulta no modifica documentos');
with d as (delete from public.documentos returning 1) select is((select count(*)::int from d), 0, 'Consulta no borra documentos');
select throws_ok(
  $$insert into public.versiones_documento (documento_id, storage_path, estado) values ('f3000000-0000-0000-0000-000000000001', 'x', 'procesando')$$,
  '42501', 'new row violates row-level security policy for table "versiones_documento"', 'Consulta no crea versiones');
with u as (update public.versiones_documento set motivo_error = 'x' returning 1) select is((select count(*)::int from u), 0, 'Consulta no modifica versiones');
with d as (delete from public.versiones_documento returning 1) select is((select count(*)::int from d), 0, 'Consulta no borra versiones');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('documentos-rag', '11111111-1111-1111-1111-111111111111/f3000000-0000-0000-0000-000000000001/nuevo')$$,
  '42501', 'new row violates row-level security policy for table "objects"', 'Consulta no sube archivos al bucket');
select set_config('storage.allow_delete_query', 'true', true);
with d as (delete from storage.objects where bucket_id = 'documentos-rag' returning 1) select is((select count(*)::int from d), 0, 'Consulta no borra archivos del bucket');
select throws_ok($$select public.eliminar_documento('f3000000-0000-0000-0000-000000000001')$$,
  '42501', 'Tu rol no puede eliminar documentos', 'Consulta no elimina documentos por la RPC');

-- ============================================================================
-- El resto de los roles sí
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(pg_temp.ciclo(1), 'ok', 'Administrador: ciclo completo de escritura y borrado');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(pg_temp.ciclo(2), 'ok', 'Operador: ciclo completo');
select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is(pg_temp.ciclo(3), 'ok', 'Mostrador: ciclo completo');
select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select is(pg_temp.ciclo(4), 'ok', 'Depósito: ciclo completo');
select pg_temp.como('d1000000-0000-0000-0000-000000000006');
select is(pg_temp.ciclo(5), 'ok', 'Administración: ciclo completo');
select pg_temp.como('d1000000-0000-0000-0000-000000000007');
select is(pg_temp.ciclo(6), 'ok', 'Técnico: ciclo completo');
select pg_temp.como('d1000000-0000-0000-0000-000000000008');
select ok(pg_temp.ciclo(7) like '42501:%', 'un miembro suspendido no escribe');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select lives_ok($$select public.eliminar_documento('f3000000-0000-0000-0000-000000000001')$$, 'Operador elimina un documento por la RPC');
select is((select count(*)::int from public.documentos where id = 'f3000000-0000-0000-0000-000000000001'), 0, 'y el documento y sus fragmentos se fueron');

-- ============================================================================
-- Otra organización y anon
-- ============================================================================
reset role;
insert into documentos (id, organizacion_id, nombre, subido_por) values
  ('f3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'doc2.pdf', 'd1000000-0000-0000-0000-000000000001');
insert into versiones_documento (id, documento_id, storage_path, estado, subida_por) values
  ('f4000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000002', 'x/y/z', 'procesando', 'd1000000-0000-0000-0000-000000000001');
insert into fragmentos_indexados (id, version_id, organizacion_id, texto, embedding, orden) values
  ('f5000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'otro', array_fill(0.1, array[1536])::vector, 0);

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.fragmentos_indexados), 0, 'el administrador de otra organización no ve los fragmentos ajenos');
select throws_ok(
  $$insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
    values ('f4000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'x', array_fill(0.1, array[1536])::vector, 1)$$,
  '42501', 'new row violates row-level security policy for table "fragmentos_indexados"', 'ni escribe fragmentos ajenos');
with d as (delete from public.fragmentos_indexados returning 1) select is((select count(*)::int from d), 0, 'ni los borra');
select throws_ok(
  $$insert into public.versiones_documento (documento_id, storage_path, estado) values ('f3000000-0000-0000-0000-000000000002', 'x', 'procesando')$$,
  '42501', 'new row violates row-level security policy for table "versiones_documento"', 'ni crea versiones en documentos ajenos');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('documentos-rag', '11111111-1111-1111-1111-111111111111/f3000000-0000-0000-0000-000000000002/ajeno')$$,
  '42501', 'new row violates row-level security policy for table "objects"', 'ni sube archivos a la carpeta de otra organización');
select throws_ok($$select public.eliminar_documento('f3000000-0000-0000-0000-000000000002')$$,
  '42501', 'Documento no encontrado', 'ni elimina un documento ajeno por la RPC');

reset role;
set local role anon;
select throws_ok($$insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden) values ('f4000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'x', array_fill(0.1, array[1536])::vector, 1)$$,
  '42501', 'permission denied for table fragmentos_indexados', 'anon no escribe fragmentos');
select throws_ok($$select public.eliminar_documento('f3000000-0000-0000-0000-000000000002')$$,
  '42501', 'permission denied for function eliminar_documento', 'anon no ejecuta eliminar_documento');

-- ============================================================================
-- Cliente de servicio (la función Edge): escribe y borra fragmentos de una versión
-- ============================================================================
reset role;
select is(has_table_privilege('service_role', 'public.fragmentos_indexados', 'insert')
      and has_table_privilege('service_role', 'public.fragmentos_indexados', 'delete'), true, 'service_role tiene grants explícitos sobre fragmentos_indexados');
set local role service_role;
select lives_ok(
  $$insert into public.fragmentos_indexados (version_id, organizacion_id, texto, embedding, orden)
    values ('f4000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'desde servicio', array_fill(0.1, array[1536])::vector, 1)$$,
  'el cliente de servicio escribe fragmentos de la versión autorizada');
with d as (delete from public.fragmentos_indexados where version_id = 'f4000000-0000-0000-0000-000000000002' returning 1)
  select is((select count(*)::int from d), 2, 'y los borra por version_id');
reset role;

select * from finish();
rollback;
