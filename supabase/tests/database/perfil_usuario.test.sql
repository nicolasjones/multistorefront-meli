-- Fixture base de la spec 008. T006 agrega sobre estas identidades las
-- aserciones de RLS, Storage y eventos cuando exista la migración de perfil.
begin;

select plan(26);

create temp table perfil_usuario_fixture (
  user_id uuid primary key,
  organizacion_id uuid not null,
  rol_id text not null
);

insert into perfil_usuario_fixture (user_id, organizacion_id, rol_id) values
  ('81000000-0000-0000-0000-000000000001', '81111111-1111-1111-1111-111111111111', 'administrador'),
  ('81000000-0000-0000-0000-000000000002', '81111111-1111-1111-1111-111111111111', 'miembro'),
  ('82000000-0000-0000-0000-000000000001', '82222222-2222-2222-2222-222222222222', 'miembro');

select is(
  (select count(*) from perfil_usuario_fixture)::int,
  3,
  'el fixture contiene tres personas para probar aislamiento'
);

select is(
  (select count(distinct organizacion_id) from perfil_usuario_fixture)::int,
  2,
  'el fixture contiene dos organizaciones'
);

insert into public.organizaciones (id, nombre) values
  ('81111111-1111-1111-1111-111111111111', 'Organizacion A'),
  ('82222222-2222-2222-2222-222222222222', 'Organizacion B');

insert into auth.users (id, email) values
  ('81000000-0000-0000-0000-000000000001', 'admin-a@example.com'),
  ('81000000-0000-0000-0000-000000000002', 'miembro-a@example.com'),
  ('82000000-0000-0000-0000-000000000001', 'miembro-b@example.com');

insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id)
select user_id, organizacion_id, rol_id from perfil_usuario_fixture;

insert into public.perfiles_usuario (user_id, nombre, apellido, foto_path) values
  ('81000000-0000-0000-0000-000000000001', 'Ada', 'Admin', '81000000-0000-0000-0000-000000000001/avatar'),
  ('81000000-0000-0000-0000-000000000002', 'Mia', 'Miembro', '81000000-0000-0000-0000-000000000002/avatar'),
  ('82000000-0000-0000-0000-000000000001', 'Beto', 'Otra', '82000000-0000-0000-0000-000000000001/avatar');

insert into public.eventos_seguridad_usuario (user_id, tipo, created_at) values
  ('81000000-0000-0000-0000-000000000001', 'inicio_sesion', now() - interval '2 minutes'),
  ('81000000-0000-0000-0000-000000000001', 'contrasena_modificada', now() - interval '1 minute'),
  ('81000000-0000-0000-0000-000000000002', 'correo_modificado', now());

insert into storage.objects (bucket_id, name, owner_id) values
  ('fotos-perfil', '81000000-0000-0000-0000-000000000001/avatar', '81000000-0000-0000-0000-000000000001'),
  ('fotos-perfil', '81000000-0000-0000-0000-000000000002/avatar', '81000000-0000-0000-0000-000000000002'),
  ('fotos-perfil', '82000000-0000-0000-0000-000000000001/avatar', '82000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claims', json_build_object('sub', '81000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from public.perfiles_usuario)::int, 1, 'el titular solo puede leer su propio perfil');
select is((select nombre from public.perfiles_usuario), 'Ada', 'el titular recibe su propio perfil');
select is((select count(*) from public.eventos_seguridad_usuario)::int, 2, 'el titular solo puede leer sus propios eventos');
select is(
  (select array_agg(tipo order by created_at desc, id desc) from (
    select tipo, created_at, id
    from public.eventos_seguridad_usuario
    order by created_at desc, id desc
    limit 20
  ) avisos),
  array['contrasena_modificada', 'inicio_sesion']::text[],
  'los avisos propios se ordenan de más reciente a más antiguo y se limitan a 20'
);
select lives_ok($$insert into public.perfiles_usuario (user_id, nombre, apellido) values ('81000000-0000-0000-0000-000000000001', 'Ada', 'Nueva') on conflict (user_id) do update set nombre = excluded.nombre, apellido = excluded.apellido$$, 'el titular puede hacer upsert de su perfil');
select throws_ok($$update public.perfiles_usuario set nombre = '' where user_id = '81000000-0000-0000-0000-000000000001'$$, '42501', null, 'el titular no puede guardar datos personales vacios');
select throws_ok($$insert into public.perfiles_usuario (user_id, nombre, apellido) values ('81000000-0000-0000-0000-000000000002', 'Intento', 'Ajeno')$$, '42501', null, 'el titular no puede crear el perfil ajeno');
select is((select count(*) from storage.objects where bucket_id = 'fotos-perfil')::int, 2, 'el titular puede leer su foto y las fotos de su organizacion');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('fotos-perfil', '81000000-0000-0000-0000-000000000001/avatar', '81000000-0000-0000-0000-000000000001') on conflict (bucket_id, name) do update set updated_at = now()$$, 'el titular puede cargar o reemplazar su foto');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('fotos-perfil', '81000000-0000-0000-0000-000000000002/avatar', '81000000-0000-0000-0000-000000000001')$$, '42501', null, 'el titular no puede cargar una foto en la carpeta ajena');
reset role;
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos_perfil_delete_titular')::int, 1, 'la policy de Storage habilita el borrado exclusivo del titular');
select set_config('request.jwt.claims', json_build_object('sub', '81000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from public.perfiles_usuario)::int, 1, 'un integrante de la misma organizacion no puede leer el perfil ajeno');
select is((select count(*) from public.eventos_seguridad_usuario)::int, 1, 'un integrante de la misma organizacion no puede leer eventos ajenos');
select is((select count(*) from storage.objects where bucket_id = 'fotos-perfil')::int, 1, 'un integrante de la misma organizacion solo puede obtener fotos autorizadas');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '82000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'fotos-perfil')::int, 1, 'otra organizacion no puede obtener fotos ajenas');

reset role;
select is(has_table_privilege('authenticated', 'public.eventos_seguridad_usuario', 'INSERT'), false, 'authenticated no tiene grant de insercion de eventos');
select is(has_function_privilege('authenticated', 'public.registrar_inicio_sesion(jsonb)', 'EXECUTE'), false, 'authenticated no puede ejecutar el hook de Auth');
select is(has_function_privilege('anon', 'public.registrar_inicio_sesion(jsonb)', 'EXECUTE'), false, 'anon no puede ejecutar el hook de Auth');
select is(has_function_privilege('supabase_auth_admin', 'public.registrar_inicio_sesion(jsonb)', 'EXECUTE'), true, 'solo supabase_auth_admin puede ejecutar el hook de Auth');

select lives_ok($$select public.registrar_inicio_sesion(jsonb_build_object('user_id', '81000000-0000-0000-0000-000000000001', 'authentication_method', 'password', 'claims', '{}'::jsonb))$$, 'el hook registra un inicio de sesion');
select public.registrar_inicio_sesion(jsonb_build_object('user_id', '81000000-0000-0000-0000-000000000001', 'authentication_method', 'token_refresh', 'claims', '{}'::jsonb));
select is((select count(*) from public.eventos_seguridad_usuario where user_id = '81000000-0000-0000-0000-000000000001' and tipo = 'inicio_sesion')::int, 2, 'el hook excluye token_refresh y conserva solo el nuevo inicio de sesion');

update auth.users set encrypted_password = 'hash-modificado' where id = '81000000-0000-0000-0000-000000000001';
update auth.users set email = 'admin-a-nuevo@example.com' where id = '81000000-0000-0000-0000-000000000001';
select ok((select count(*) from public.eventos_seguridad_usuario where user_id = '81000000-0000-0000-0000-000000000001' and tipo = 'contrasena_modificada') >= 1 and (select count(*) from public.eventos_seguridad_usuario where user_id = '81000000-0000-0000-0000-000000000001' and tipo = 'correo_modificado') >= 1, 'los cambios efectivos de contrasena y correo generan eventos minimos');
select is((select count(*) from public.eventos_seguridad_usuario where tipo not in ('inicio_sesion', 'contrasena_modificada', 'correo_modificado'))::int, 0, 'no se registran eventos operativos fuera del contrato');

insert into public.eventos_seguridad_usuario (user_id, tipo, created_at)
select
  '81000000-0000-0000-0000-000000000001',
  'inicio_sesion',
  now() + make_interval(secs => serie)
from generate_series(1, 21) as serie;

select set_config('request.jwt.claims', json_build_object('sub', '81000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::int from (
    select id
    from public.eventos_seguridad_usuario
    order by created_at desc, id desc
    limit 20
  ) avisos),
  20,
  'la consulta del titular puede limitar los avisos a los 20 más recientes'
);
reset role;

select * from finish();

rollback;
