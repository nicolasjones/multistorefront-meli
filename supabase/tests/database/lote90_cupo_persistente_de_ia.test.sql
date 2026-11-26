-- Lote 90 (MSF-727; migración 20270507900000): cupo persistente de uso de IA por usuario, funcionalidad y hora.
-- Todo con objetos reales y el rol del CI (no superusuario): nada se omite con skip. Datos inventados.
begin;

select plan(68);

insert into auth.users (id, email) values
  ('c9000000-0000-0000-0000-000000000001', 'cupo-a-l90@example.com'),
  ('c9000000-0000-0000-0000-000000000002', 'cupo-b-l90@example.com');

-- ===== Estructura y ACL =====
select has_table('private', 'ia_cupo_uso', 'la tabla del cupo existe en private (no expuesta por PostgREST)');
select col_is_pk('private', 'ia_cupo_uso', array['usuario_id', 'funcionalidad', 'ventana'], 'clave primaria (usuario, funcionalidad, ventana)');
select is((select relrowsecurity from pg_class where oid = 'private.ia_cupo_uso'::regclass), true, 'RLS activado');
select is(
  (select array_agg(pg_get_expr(polqual, polrelid) || '/' || pg_get_expr(polwithcheck, polrelid) || '/' || polcmd::text order by polname)
     from pg_policy where polrelid = 'private.ia_cupo_uso'::regclass),
  array['false/false/*'], 'una única política, para todo, que deniega todo (using false / with check false)');
select is(
  (select array_agg(r.rolname::text order by r.rolname::text) from pg_policy p, unnest(p.polroles) x(oid)
     join pg_roles r on r.oid = x.oid where p.polrelid = 'private.ia_cupo_uso'::regclass),
  array['anon', 'authenticated'], 'la política cubre a anon y authenticated');
select is(
  (select bool_or(has_table_privilege(r, 'private.ia_cupo_uso', p))
     from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p),
  false, 'anon y authenticated no tienen ningún privilegio sobre la tabla');
select is(has_table_privilege('service_role', 'private.ia_cupo_uso', 'select'), true, 'service_role puede leer la tabla (soporte)');
select is(
  (select bool_or(has_table_privilege('service_role', 'private.ia_cupo_uso', p)) from unnest(array['insert', 'update', 'delete', 'truncate']) p),
  false, 'service_role no escribe la tabla directamente: lo hacen las funciones');
select is(
  (select count(*)::int from pg_attribute where attrelid = 'private.ia_cupo_uso'::regclass and attnum > 0 and not attisdropped),
  4, 'la tabla tiene exactamente usuario, funcionalidad, ventana y usos');

select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'private.consumir_cupo_ia(uuid,text,int)'::regprocedure),
  true, 'private.consumir_cupo_ia es security definer con search_path vacío');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.consumir_cupo_ia(uuid,text,int)'::regprocedure),
  true, 'public.consumir_cupo_ia es security definer con search_path vacío');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'private.purgar_cupo_ia(int)'::regprocedure),
  true, 'private.purgar_cupo_ia es security definer con search_path vacío');

select is(
  (select bool_or(has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated']) r,
          unnest(array['private.consumir_cupo_ia(uuid,text,int)', 'public.consumir_cupo_ia(uuid,text,int)', 'private.purgar_cupo_ia(int)']) f),
  false, 'anon y authenticated no ejecutan ninguna de las tres funciones');
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
    where p.oid in ('private.consumir_cupo_ia(uuid,text,int)'::regprocedure, 'public.consumir_cupo_ia(uuid,text,int)'::regprocedure, 'private.purgar_cupo_ia(int)'::regprocedure)
      and a.grantee = 0),
  0, 'ninguna de las tres funciones se otorga a PUBLIC');
select is(
  (select array_agg(distinct r.rolname::text order by r.rolname::text)
     from pg_proc p, aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
    where p.oid in ('private.consumir_cupo_ia(uuid,text,int)'::regprocedure, 'public.consumir_cupo_ia(uuid,text,int)'::regprocedure, 'private.purgar_cupo_ia(int)'::regprocedure)),
  array[(select rolname::text from pg_roles where oid = (select proowner from pg_proc where oid = 'private.purgar_cupo_ia(int)'::regprocedure)), 'service_role']
    , 'solo el dueño y service_role tienen EXECUTE');
select is(has_function_privilege('service_role', 'public.consumir_cupo_ia(uuid,text,int)', 'execute'), true, 'service_role ejecuta el envoltorio público');

-- ===== Consumo: límite - 1, límite y límite + 1 (tope 3) =====
select is((select se_consumio from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 3)), true, 'uso 1 de 3: consume');
select is((select usos_actuales from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 3)), 2, 'uso 2 de 3 (límite - 1): consume y cuenta 2');
select results_eq(
  $$ select se_consumio, usos_actuales from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 3) $$,
  $$ values (true, 3) $$, 'uso 3 de 3 (exactamente el límite): consume');
select results_eq(
  $$ select se_consumio, usos_actuales from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 3) $$,
  $$ values (false, 3) $$, 'uso 4 de 3 (límite + 1): se agotó, no consume');
select results_eq(
  $$ select se_consumio, usos_actuales from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 3) $$,
  $$ values (false, 3) $$, 'el intento 5 tampoco consume');
select is(
  (select usos from private.ia_cupo_uso where usuario_id = 'c9000000-0000-0000-0000-000000000001' and funcionalidad = 'chat-ia'),
  3, 'lo guardado se queda en el tope: los rechazos no incrementan');
select is(
  (select segundos_hasta_reinicio between 1 and 3600 from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 3)),
  true, 'segundos_hasta_reinicio está entre 1 y 3600');
select is(
  (select segundos_hasta_reinicio from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 3)),
  (ceil(extract(epoch from ((date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') + interval '1 hour' - now())))::int),
  'segundos_hasta_reinicio es lo que falta para la próxima hora en punto UTC');

-- Tope 1: el primero consume y el segundo no.
select is((select se_consumio from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000002', 'tope-uno', 1)), true, 'con tope 1 el primer uso consume');
select is((select se_consumio from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000002', 'tope-uno', 1)), false, 'con tope 1 el segundo no consume');

-- Usuarios y funcionalidades distintas no comparten contador.
select results_eq(
  $$ select se_consumio, usos_actuales from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000002', 'chat-ia', 3) $$,
  $$ values (true, 1) $$, 'otro usuario con el tope del primero agotado arranca en 1');
select results_eq(
  $$ select se_consumio, usos_actuales from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'busqueda-documental', 3) $$,
  $$ values (true, 1) $$, 'otra funcionalidad del mismo usuario arranca en 1 con chat-ia agotado');
select is(
  (select count(*)::int from private.ia_cupo_uso where usuario_id in ('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002')),
  4, 'una fila por usuario y funcionalidad (chat-ia x2, busqueda-documental, tope-uno)');

-- Ventanas distintas: el tope agotado de la hora anterior no cuenta en la hora actual.
insert into private.ia_cupo_uso (usuario_id, funcionalidad, ventana, usos) values
  ('c9000000-0000-0000-0000-000000000002', 'ventana', (date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') - interval '1 hour', 5);
select results_eq(
  $$ select se_consumio, usos_actuales from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000002', 'ventana', 5) $$,
  $$ values (true, 1) $$, 'con la hora anterior agotada, la hora actual arranca de cero');
select is(
  (select usos from private.ia_cupo_uso where usuario_id = 'c9000000-0000-0000-0000-000000000002' and funcionalidad = 'ventana'
      and ventana = (date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') - interval '1 hour'),
  5, 'la ventana anterior no se toca');

-- Un tope más bajo que lo ya usado tampoco consume ni retrocede.
select results_eq(
  $$ select se_consumio, usos_actuales from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 2) $$,
  $$ values (false, 3) $$, 'con el tope bajado a 2 y 3 usos: no consume y informa 3');

-- ===== Argumentos inválidos =====
select throws_ok($$ select * from private.consumir_cupo_ia(null, 'chat-ia', 3) $$, '22023', 'consumir_cupo_ia: falta el usuario', 'usuario nulo');
select throws_ok($$ select * from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', null, 3) $$, '22023', 'consumir_cupo_ia: falta la funcionalidad', 'funcionalidad nula');
select throws_ok($$ select * from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', '   ', 3) $$, '22023', 'consumir_cupo_ia: falta la funcionalidad', 'funcionalidad en blanco');
select throws_ok($$ select * from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', null) $$, '22023', 'consumir_cupo_ia: el límite debe ser un entero mayor o igual a 1', 'límite nulo');
select throws_ok($$ select * from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 0) $$, '22023', 'consumir_cupo_ia: el límite debe ser un entero mayor o igual a 1', 'límite 0');
select throws_ok($$ select * from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', -5) $$, '22023', 'consumir_cupo_ia: el límite debe ser un entero mayor o igual a 1', 'límite negativo');
select is((select count(*)::int from private.ia_cupo_uso where funcionalidad = '   '), 0, 'un argumento inválido no deja filas');
select throws_ok(
  $$ select * from private.consumir_cupo_ia('c9000000-0000-0000-0000-0000000000ff', 'chat-ia', 3) $$,
  '23503', 'insert or update on table "ia_cupo_uso" violates foreign key constraint "ia_cupo_uso_usuario_id_fkey"', 'un usuario inexistente falla (no consume en silencio)');

-- ===== Restricciones de la tabla =====
select throws_ok(
  $$ insert into private.ia_cupo_uso values ('c9000000-0000-0000-0000-000000000001', 'x', (date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') + interval '1 minute', 1) $$,
  '23514', 'new row for relation "ia_cupo_uso" violates check constraint "ia_cupo_uso_ventana_horaria"', 'la ventana debe ser una hora en punto UTC');
select throws_ok(
  $$ insert into private.ia_cupo_uso values ('c9000000-0000-0000-0000-000000000001', 'x', date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC', 0) $$,
  '23514', 'new row for relation "ia_cupo_uso" violates check constraint "ia_cupo_uso_usos_positivos"', 'usos >= 1');
select throws_ok(
  $$ insert into private.ia_cupo_uso values ('c9000000-0000-0000-0000-000000000001', ' ', date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC', 1) $$,
  '23514', 'new row for relation "ia_cupo_uso" violates check constraint "ia_cupo_uso_funcionalidad_valida"', 'funcionalidad no vacía');
select throws_ok(
  $$ insert into private.ia_cupo_uso values ('c9000000-0000-0000-0000-000000000001', repeat('x', 65), date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC', 1) $$,
  '23514', 'new row for relation "ia_cupo_uso" violates check constraint "ia_cupo_uso_funcionalidad_valida"', 'funcionalidad de hasta 64 caracteres');
select throws_ok(
  $$ insert into private.ia_cupo_uso values ('c9000000-0000-0000-0000-000000000001', 'chat-ia', date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC', 1) $$,
  '23505', 'duplicate key value violates unique constraint "ia_cupo_uso_pkey"', 'no hay dos filas para la misma clave');

-- ===== Un usuario autenticado y anon no llegan a nada =====
create or replace function pg_temp.como(p_rol text, p_user uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_rol)::text, true);
  execute format('set local role %I', p_rol);
end $f$;

select pg_temp.como('authenticated', 'c9000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 1000) $$, '42501', 'permission denied for function consumir_cupo_ia', 'authenticated no ejecuta el envoltorio público');
select throws_ok($$ select * from private.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 1000) $$, '42501', 'permission denied for function consumir_cupo_ia', 'authenticated no ejecuta la función privada');
select throws_ok($$ select private.purgar_cupo_ia(1) $$, '42501', 'permission denied for function purgar_cupo_ia', 'authenticated no purga');
select throws_ok($$ select * from private.ia_cupo_uso $$, '42501', 'permission denied for table ia_cupo_uso', 'authenticated no lee la tabla');
select pg_temp.como('anon', null);
select throws_ok($$ select * from public.consumir_cupo_ia('c9000000-0000-0000-0000-000000000001', 'chat-ia', 1000) $$, '42501', 'permission denied for function consumir_cupo_ia', 'anon no ejecuta el envoltorio público');
select throws_ok($$ select * from private.ia_cupo_uso $$, '42501', 'permission denied for schema private', 'anon no lee la tabla');

-- service_role sí: el envoltorio público consume y la tabla se puede leer.
select pg_temp.como('service_role', null);
select results_eq(
  $$ select se_consumio, usos_actuales from public.consumir_cupo_ia('c9000000-0000-0000-0000-000000000002', 'via-service-role', 2) $$,
  $$ values (true, 1) $$, 'service_role consume por el envoltorio público');
select is((select count(*)::int from private.ia_cupo_uso where funcionalidad = 'via-service-role'), 1, 'service_role lee la tabla');
select throws_ok($$ insert into private.ia_cupo_uso values ('c9000000-0000-0000-0000-000000000002', 'directo', date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC', 1) $$, '42501', 'permission denied for table ia_cupo_uso', 'service_role no escribe la tabla directamente');
select is((select se_consumio from public.consumir_cupo_ia('c9000000-0000-0000-0000-000000000002', 'via-service-role', 2)), true, 'service_role: segundo uso de 2');
select is((select se_consumio from public.consumir_cupo_ia('c9000000-0000-0000-0000-000000000002', 'via-service-role', 2)), false, 'service_role: tercer uso de 2 se rechaza');
reset role;

-- ===== Purga =====
delete from private.ia_cupo_uso;
insert into private.ia_cupo_uso (usuario_id, funcionalidad, ventana, usos)
select 'c9000000-0000-0000-0000-000000000001', f, (date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') - h, 1
  from (values ('actual', interval '0'), ('hace-1-dia', interval '1 day'), ('hace-2-dias', interval '2 days'),
               ('hace-2-dias-y-1-hora', interval '2 days 1 hour'), ('hace-5-dias', interval '5 days')) v(f, h);
select is(private.purgar_cupo_ia(), 2::bigint, 'la purga por defecto (2 días) borra las ventanas más viejas que 2 días: 2 filas');
select is(
  (select array_agg(funcionalidad order by funcionalidad) from private.ia_cupo_uso),
  array['actual', 'hace-1-dia', 'hace-2-dias'], 'queda la ventana de exactamente 2 días (límite) y las más nuevas');
select is(private.purgar_cupo_ia(), 0::bigint, 'repetir la purga es idempotente: 0 filas');
select is(private.purgar_cupo_ia(1), 1::bigint, 'con 1 día borra la de exactamente 2 días y deja la de hace 1 día');
select is((select array_agg(funcionalidad order by funcionalidad) from private.ia_cupo_uso), array['actual', 'hace-1-dia'], 'quedan la actual y la de hace 1 día');
select is(private.purgar_cupo_ia(1), 0::bigint, 'idempotente también con otro valor');
select throws_ok($$ select private.purgar_cupo_ia(0) $$, '22023', 'purgar_cupo_ia: los días deben ser un entero mayor o igual a 1', 'días = 0');
select throws_ok($$ select private.purgar_cupo_ia(-1) $$, '22023', 'purgar_cupo_ia: los días deben ser un entero mayor o igual a 1', 'días negativos');
select throws_ok($$ select private.purgar_cupo_ia(null) $$, '22023', 'purgar_cupo_ia: los días deben ser un entero mayor o igual a 1', 'días nulos');
select is((select count(*)::int from private.ia_cupo_uso), 2, 'las purgas inválidas no borraron nada');
select pg_temp.como('service_role', null);
select is(private.purgar_cupo_ia(), 0::bigint, 'service_role puede purgar');
reset role;

-- ===== Borrado en cascada con el usuario =====
delete from auth.users where id = 'c9000000-0000-0000-0000-000000000001';
select is((select count(*)::int from private.ia_cupo_uso), 0, 'al borrar el usuario se borran sus contadores');

select * from finish();
rollback;
