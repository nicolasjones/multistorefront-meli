-- Lote 92 (MSF-731; migración 20270508100000): purga por antigüedad de los envíos de correo a proveedores.
-- Todo con objetos reales y el rol del CI (no superusuario): nada se omite con skip. Datos inventados.
-- Las edades se miden contra `now()`, que dentro de una transacción es constante: la frontera exacta (p_dias días justos) es determinista.
-- Mutaciones propias: `<` por `<=` en el borrado, el piso 30 (`< 30` por `< 29` o `<= 30`), el techo 36500, `is null`, el defecto 365,
-- `security definer`, `search_path`, el `revoke` y el `grant` de la migración; cada una pone al menos una aserción en rojo.
begin;

select plan(32);

-- ===== Estructura y ACL =====
select has_function('private', 'purgar_correo_proveedor_envios', array['integer'], 'la función de purga existe en private');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'private.purgar_correo_proveedor_envios(int)'::regprocedure),
  true, 'es security definer con search_path vacío');
select is(
  (select p.prorettype::regtype::text from pg_proc p where p.oid = 'private.purgar_correo_proveedor_envios(int)'::regprocedure),
  'bigint', 'devuelve bigint (cuántas filas borró)');
select is(
  (select bool_or(has_function_privilege(r, 'private.purgar_correo_proveedor_envios(int)', 'execute')) from unnest(array['anon', 'authenticated']) r),
  false, 'anon y authenticated no ejecutan la función');
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.oid = 'private.purgar_correo_proveedor_envios(int)'::regprocedure and a.grantee = 0),
  0, 'la función no se otorga a PUBLIC');
select is(
  (select array_agg(distinct r.rolname::text order by r.rolname::text)
     from pg_proc p, aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
    where p.oid = 'private.purgar_correo_proveedor_envios(int)'::regprocedure),
  (select array_agg(x order by x) from unnest(array[(select rolname::text from pg_roles where oid = (select proowner from pg_proc where oid = 'private.purgar_correo_proveedor_envios(int)'::regprocedure)), 'service_role']) x),
  'solo el dueño y service_role tienen EXECUTE');
select is(has_function_privilege('service_role', 'private.purgar_correo_proveedor_envios(int)', 'execute'), true, 'service_role ejecuta la función');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p where p.oid = 'private.purgar_correo_proveedor_envios(int)'::regprocedure),
  'p_dias integer DEFAULT 365', 'el defecto es 365 días');

-- ===== Purga por defecto (365 días): n-1 / n / n+1 en UNA tabla =====
-- Una fila por edad. `n` justos se conserva (el borrado es estrictamente anterior); un segundo más viejo se borra.
insert into private.correo_proveedor_envios (usuario_id, proveedor_id, resultado, creado_en)
select 'c9200000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-0000000000a1', resultado, now() - edad
  from (values
    ('enviado', interval '0'),
    ('fallido', interval '364 days'),
    ('enviado', interval '365 days' - interval '1 second'),
    ('fallido', interval '365 days'),
    ('enviado', interval '365 days' + interval '1 second'),
    ('fallido', interval '366 days'),
    ('enviado', interval '1000 days')
  ) v(resultado, edad);
select is((select count(*)::int from private.correo_proveedor_envios), 7, 'hay 7 filas de prueba');
select is(private.purgar_correo_proveedor_envios(), 3::bigint, 'la purga por defecto borra lo de más de 365 días: 365 d + 1 s, 366 d y 1000 d');
select is(
  (select array_agg(round(extract(epoch from now() - creado_en))::bigint order by creado_en desc) from private.correo_proveedor_envios),
  array[0::bigint, 31449600, 31535999, 31536000], 'queda lo reciente, 364 días, 365 días menos 1 segundo y los 365 días justos (frontera n-1 / n)');
select is(private.purgar_correo_proveedor_envios(), 0::bigint, 'repetir la purga es idempotente: 0 filas');
select is(private.purgar_correo_proveedor_envios(365), 0::bigint, 'pasar 365 explícito equivale al defecto');
select is((select count(*)::int from private.correo_proveedor_envios), 4, 'siguen las 4 filas');

-- ===== Purga con el piso (30 días): n-1 / n / n+1 =====
delete from private.correo_proveedor_envios;
insert into private.correo_proveedor_envios (usuario_id, proveedor_id, resultado, creado_en)
select 'c9200000-0000-0000-0000-000000000002', 'c9200000-0000-0000-0000-0000000000a2', 'enviado', now() - edad
  from (values (interval '29 days'), (interval '30 days'), (interval '30 days' + interval '1 second'), (interval '31 days')) v(edad);
select is(private.purgar_correo_proveedor_envios(30), 2::bigint, 'con 30 días borra 30 d + 1 s y 31 d');
select is(
  (select array_agg(round(extract(epoch from now() - creado_en))::bigint order by creado_en desc) from private.correo_proveedor_envios),
  array[2505600::bigint, 2592000], 'conserva 29 días y los 30 justos');
select is(private.purgar_correo_proveedor_envios(31), 0::bigint, 'con 31 días no queda nada que borrar (29 y 30 son más nuevos)');
select is(private.purgar_correo_proveedor_envios(30), 0::bigint, 'idempotente también con 30');

-- ===== Techo (36500) y argumentos inválidos: código Y mensaje; no borran nada =====
select lives_ok($$ select private.purgar_correo_proveedor_envios(36499) $$, '36499 (techo - 1) es válido');
select lives_ok($$ select private.purgar_correo_proveedor_envios(36500) $$, '36500 (el techo) es válido');
select throws_ok($$ select private.purgar_correo_proveedor_envios(36501) $$, '22023',
  'purgar_correo_proveedor_envios: los días deben ser un entero entre 30 y 36500', '36501 (techo + 1) se rechaza');
select throws_ok($$ select private.purgar_correo_proveedor_envios(29) $$, '22023',
  'purgar_correo_proveedor_envios: los días deben ser un entero entre 30 y 36500', '29 (piso - 1) se rechaza');
select throws_ok($$ select private.purgar_correo_proveedor_envios(0) $$, '22023',
  'purgar_correo_proveedor_envios: los días deben ser un entero entre 30 y 36500', '0 se rechaza');
select throws_ok($$ select private.purgar_correo_proveedor_envios(-1) $$, '22023',
  'purgar_correo_proveedor_envios: los días deben ser un entero entre 30 y 36500', 'negativo se rechaza');
select throws_ok($$ select private.purgar_correo_proveedor_envios(2147483647) $$, '22023',
  'purgar_correo_proveedor_envios: los días deben ser un entero entre 30 y 36500', 'el máximo de int se rechaza (no desborda la fecha)');
select throws_ok($$ select private.purgar_correo_proveedor_envios(null) $$, '22023',
  'purgar_correo_proveedor_envios: los días deben ser un entero entre 30 y 36500', 'nulo se rechaza');
select is((select count(*)::int from private.correo_proveedor_envios), 2, 'las purgas inválidas no borraron nada');

-- ===== Un usuario autenticado y anon no llegan a nada; service_role purga de verdad =====
create or replace function pg_temp.como(p_rol text, p_user uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_rol)::text, true);
  execute format('set local role %I', p_rol);
end $f$;

select pg_temp.como('authenticated', 'c9200000-0000-0000-0000-000000000001');
select throws_ok($$ select private.purgar_correo_proveedor_envios(30) $$, '42501', 'permission denied for function purgar_correo_proveedor_envios', 'authenticated no purga');
select pg_temp.como('anon', null);
select throws_ok($$ select private.purgar_correo_proveedor_envios(30) $$, '42501', 'permission denied for schema private', 'anon no purga');
reset role;

insert into private.correo_proveedor_envios (usuario_id, proveedor_id, resultado, creado_en)
values ('c9200000-0000-0000-0000-000000000003', 'c9200000-0000-0000-0000-0000000000a3', 'enviado', now() - interval '400 days');
select pg_temp.como('service_role', null);
select throws_ok($$ delete from private.correo_proveedor_envios $$, '42501', 'permission denied for table correo_proveedor_envios', 'service_role no borra directo: solo por la función');
select is(private.purgar_correo_proveedor_envios(), 1::bigint, 'service_role purga por la función y borra la fila de 400 días');
select is((select count(*)::int from private.correo_proveedor_envios), 2, 'service_role ve las 2 filas que quedan');
reset role;

select * from finish();
rollback;
