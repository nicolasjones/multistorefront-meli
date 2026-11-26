-- Lote 91 (MSF-731; migración 20270508000000): registro de los envíos de correo a proveedores.
-- Todo con objetos reales y el rol del CI (no superusuario). Datos inventados.
-- Mutaciones propias: cada condición, restricción, política y GRANT/REVOKE de la migración se mutó y el test falla, salvo el
-- `revoke all on table ... from public, anon, authenticated`: equivalente declarado cuando el esquema private no tiene privilegios por defecto
-- (queda como defensa por si los tuviera; la ausencia de privilegios de anon y authenticated sí se verifica arriba).
begin;

select plan(38);

-- ===== Estructura y ACL =====
select has_table('private', 'correo_proveedor_envios', 'la tabla del registro existe en private');
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'private.correo_proveedor_envios'::regclass and attnum > 0 and not attisdropped),
  array['id', 'usuario_id', 'proveedor_id', 'resultado', 'creado_en'], 'columnas: solo usuario, proveedor, resultado y fecha (sin asunto, cuerpo ni dirección)');
select is(
  (select count(*)::int from pg_constraint where conrelid = 'private.correo_proveedor_envios'::regclass and contype = 'f'),
  0, 'sin claves foráneas: el rastro sobrevive al borrado del usuario y del proveedor');
select is((select relrowsecurity from pg_class where oid = 'private.correo_proveedor_envios'::regclass), true, 'RLS activado');
select is(
  (select array_agg(pg_get_expr(polqual, polrelid) || '/' || pg_get_expr(polwithcheck, polrelid) || '/' || polcmd::text order by polname)
     from pg_policy where polrelid = 'private.correo_proveedor_envios'::regclass),
  array['false/false/*'], 'una única política, para todo, que deniega todo');
select is(
  (select array_agg(r.rolname::text order by r.rolname::text) from pg_policy p, unnest(p.polroles) x(oid)
     join pg_roles r on r.oid = x.oid where p.polrelid = 'private.correo_proveedor_envios'::regclass),
  array['anon', 'authenticated'], 'la política cubre a anon y authenticated');
select is(
  (select bool_or(has_table_privilege(r, 'private.correo_proveedor_envios', p))
     from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p),
  false, 'anon y authenticated no tienen ningún privilegio sobre la tabla');
select is(has_table_privilege('service_role', 'private.correo_proveedor_envios', 'select'), true, 'service_role puede leer la tabla (soporte)');
select is(
  (select bool_or(has_table_privilege('service_role', 'private.correo_proveedor_envios', p)) from unnest(array['insert', 'update', 'delete', 'truncate']) p),
  false, 'service_role no escribe la tabla directamente: lo hace la función');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.registrar_envio_correo_proveedor(uuid,uuid,text)'::regprocedure),
  true, 'la función es security definer con search_path vacío');
select is(
  (select bool_or(has_function_privilege(r, 'public.registrar_envio_correo_proveedor(uuid,uuid,text)', 'execute')) from unnest(array['anon', 'authenticated']) r),
  false, 'anon y authenticated no ejecutan la función');
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.registrar_envio_correo_proveedor(uuid,uuid,text)'::regprocedure and a.grantee = 0),
  0, 'la función no se otorga a PUBLIC');
select is(has_function_privilege('service_role', 'public.registrar_envio_correo_proveedor(uuid,uuid,text)', 'execute'), true, 'service_role ejecuta la función');

-- ===== Registro =====
select lives_ok(
  $$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'enviado') $$,
  'registra un envío');
select lives_ok(
  $$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'fallido') $$,
  'registra un fallo');
select results_eq(
  $$ select usuario_id::text, proveedor_id::text, resultado from private.correo_proveedor_envios order by id $$,
  $$ values ('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'enviado'),
            ('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'fallido') $$,
  'quedan dos filas con quién, a qué proveedor y el resultado');
select is(
  (select bool_and(creado_en between now() - interval '1 minute' and now() + interval '1 minute') from private.correo_proveedor_envios),
  true, 'la fecha se completa sola');
select is((select count(distinct id)::int from private.correo_proveedor_envios), 2, 'cada fila tiene su propio id');

-- ===== Argumentos inválidos (código y mensaje) =====
select throws_ok($$ select public.registrar_envio_correo_proveedor(null, 'c9100000-0000-0000-0000-0000000000a1', 'enviado') $$,
  '22023', 'registrar_envio_correo_proveedor: falta el usuario', 'usuario nulo');
select throws_ok($$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', null, 'enviado') $$,
  '22023', 'registrar_envio_correo_proveedor: falta el proveedor', 'proveedor nulo');
select throws_ok($$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', null) $$,
  '22023', 'registrar_envio_correo_proveedor: el resultado debe ser enviado o fallido', 'resultado nulo');
select throws_ok($$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'otro') $$,
  '22023', 'registrar_envio_correo_proveedor: el resultado debe ser enviado o fallido', 'resultado desconocido');
select throws_ok($$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'Enviado') $$,
  '22023', 'registrar_envio_correo_proveedor: el resultado debe ser enviado o fallido', 'las mayúsculas no se normalizan');
select throws_ok($$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', '') $$,
  '22023', 'registrar_envio_correo_proveedor: el resultado debe ser enviado o fallido', 'resultado vacío');
select is((select count(*)::int from private.correo_proveedor_envios), 2, 'un argumento inválido no deja filas');
select throws_ok(
  $$ insert into private.correo_proveedor_envios (usuario_id, proveedor_id, resultado) values ('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'x') $$,
  '23514', 'new row for relation "correo_proveedor_envios" violates check constraint "correo_proveedor_envios_resultado_valido"', 'la restricción de la tabla también rechaza un resultado inválido');

-- ===== Un usuario autenticado y anon no llegan a nada =====
create or replace function pg_temp.como(p_rol text, p_user uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_rol)::text, true);
  execute format('set local role %I', p_rol);
end $f$;

select pg_temp.como('authenticated', 'c9100000-0000-0000-0000-000000000001');
select throws_ok($$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'enviado') $$,
  '42501', 'permission denied for function registrar_envio_correo_proveedor', 'authenticated no registra envíos');
select throws_ok($$ select * from private.correo_proveedor_envios $$, '42501', 'permission denied for table correo_proveedor_envios', 'authenticated no lee el registro');
select pg_temp.como('anon', null);
select throws_ok($$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-0000000000a1', 'enviado') $$,
  '42501', 'permission denied for function registrar_envio_correo_proveedor', 'anon no registra envíos');
select throws_ok($$ select * from private.correo_proveedor_envios $$, '42501', 'permission denied for schema private', 'anon no lee el registro');

-- service_role sí: registra por la función y lee la tabla, pero no escribe directo.
select pg_temp.como('service_role', null);
select lives_ok(
  $$ select public.registrar_envio_correo_proveedor('c9100000-0000-0000-0000-000000000002', 'c9100000-0000-0000-0000-0000000000a2', 'enviado') $$,
  'service_role registra por la función');
select is((select count(*)::int from private.correo_proveedor_envios where usuario_id = 'c9100000-0000-0000-0000-000000000002'), 1, 'service_role lee el registro');
select throws_ok($$ insert into private.correo_proveedor_envios (usuario_id, proveedor_id, resultado) values ('c9100000-0000-0000-0000-000000000002', 'c9100000-0000-0000-0000-0000000000a2', 'enviado') $$,
  '42501', 'permission denied for table correo_proveedor_envios', 'service_role no escribe la tabla directamente');
select throws_ok($$ delete from private.correo_proveedor_envios $$, '42501', 'permission denied for table correo_proveedor_envios', 'service_role no borra filas');
reset role;

-- ===== El tope por usuario y hora reutiliza el cupo del lote 90 con la funcionalidad correo-proveedor =====
insert into auth.users (id, email) values ('c9100000-0000-0000-0000-000000000003', 'correo-proveedor-l91@example.com');
select results_eq(
  $$ select se_consumio, usos_actuales from public.consumir_cupo_ia('c9100000-0000-0000-0000-000000000003', 'correo-proveedor', 2) $$,
  $$ values (true, 1) $$, 'cupo correo-proveedor: uso 1 de 2');
select results_eq(
  $$ select se_consumio, usos_actuales from public.consumir_cupo_ia('c9100000-0000-0000-0000-000000000003', 'correo-proveedor', 2) $$,
  $$ values (true, 2) $$, 'cupo correo-proveedor: uso 2 de 2 (el límite)');
select results_eq(
  $$ select se_consumio, usos_actuales from public.consumir_cupo_ia('c9100000-0000-0000-0000-000000000003', 'correo-proveedor', 2) $$,
  $$ values (false, 2) $$, 'cupo correo-proveedor: uso 3 de 2 (límite + 1) se rechaza');
select results_eq(
  $$ select se_consumio from public.consumir_cupo_ia('c9100000-0000-0000-0000-000000000003', 'chat-ia', 2) $$,
  $$ values (true) $$, 'el cupo de correos no gasta el de otra funcionalidad del mismo usuario');

select * from finish();
rollback;
