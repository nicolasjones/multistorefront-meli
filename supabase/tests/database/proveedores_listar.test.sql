-- F-PRV-02 (MSF-351, épica MSF-205): listado y búsqueda de proveedores (SC-003).
-- Cubre búsqueda por razón social (parcial, sin mayúsculas ni tildes) y por CUIT (con o
-- sin guiones), estado, orden estable, paginación y tope, aislamiento por organización y
-- por nivel de sección, y `anon` sin ejecución.
-- CUIT válidos (mismos vectores que proveedores.test.sql): 20123456786, 30701234568,
-- 33555555550, 30700000040.
begin;

select plan(28);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- Datos de prueba (como postgres, sin RLS).
insert into dominio.proveedores (organizacion_id, razon_social, cuit, correo, telefono, activo) values
  ('11111111-1111-1111-1111-111111111111', 'Álamos Distribuidora', '20123456786', 'a@alamos.example.com', '11 1111', true),
  ('11111111-1111-1111-1111-111111111111', 'Bermúdez e Hijos', '30701234568', null, null, true),
  ('11111111-1111-1111-1111-111111111111', 'bermudez Logística', '33555555550', null, null, true),
  ('11111111-1111-1111-1111-111111111111', 'Zeta 50% Desc_uento', '30700000040', null, null, true),
  ('22222222-2222-2222-2222-222222222222', 'Álamos Dos', '20123456786', null, null, true);
-- Un inactivo (otro CUIT válido).
insert into dominio.proveedores (organizacion_id, razon_social, cuit, activo) values
  ('11111111-1111-1111-1111-111111111111', 'Inactiva SA', '27000000006', false);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Estado
select is((select count(*)::int from public.listar_proveedores()), 4, 'por defecto solo activos');
select results_eq(
  $$select razon_social from public.listar_proveedores(null, 'inactivos')$$,
  $$values ('Inactiva SA'::text)$$, 'inactivos: solo los desactivados');
select is((select count(*)::int from public.listar_proveedores(null, 'todos')), 5, 'todos: activos e inactivos');
select throws_ok($$select * from public.listar_proveedores(null, 'otro')$$, '22023', null, 'un estado desconocido se rechaza');

-- Orden estable por razón social
select results_eq(
  $$select razon_social from public.listar_proveedores()$$,
  $$values ('Álamos Distribuidora'::text), ('Bermúdez e Hijos'), ('bermudez Logística'), ('Zeta 50% Desc_uento')$$,
  'ordenado por razón social sin distinguir mayúsculas');

-- Búsqueda por razón social
select results_eq($$select razon_social from public.listar_proveedores('distri')$$,
  $$values ('Álamos Distribuidora'::text)$$, 'razón social parcial');
select results_eq($$select razon_social from public.listar_proveedores('DISTRI')$$,
  $$values ('Álamos Distribuidora'::text)$$, 'sin distinguir mayúsculas');
select results_eq($$select razon_social from public.listar_proveedores('alamos')$$,
  $$values ('Álamos Distribuidora'::text)$$, 'sin tildes: «alamos» encuentra «Álamos»');
select is((select count(*)::int from public.listar_proveedores('bermúdez')), 2,
  'con tilde en la búsqueda encuentra también la razón social sin tilde');
select is((select count(*)::int from public.listar_proveedores('no-existe-xyz')), 0, 'sin coincidencias no hay filas');
select is((select count(*)::int from public.listar_proveedores('   ')), 4, 'un texto de solo espacios equivale a no buscar');

-- Comodines literales
select results_eq($$select razon_social from public.listar_proveedores('50%')$$,
  $$values ('Zeta 50% Desc_uento'::text)$$, '«%» se busca literal');
select results_eq($$select razon_social from public.listar_proveedores('desc_u')$$,
  $$values ('Zeta 50% Desc_uento'::text)$$, '«_» se busca literal');
select is((select count(*)::int from public.listar_proveedores('\')), 0, 'una barra invertida no rompe la consulta');

-- Búsqueda por CUIT
select results_eq($$select razon_social from public.listar_proveedores('20123456786')$$,
  $$values ('Álamos Distribuidora'::text)$$, 'CUIT completo sin guiones');
select results_eq($$select razon_social from public.listar_proveedores('20-12345678-6')$$,
  $$values ('Álamos Distribuidora'::text)$$, 'CUIT completo con guiones');
select results_eq($$select razon_social from public.listar_proveedores('30-7012')$$,
  $$values ('Bermúdez e Hijos'::text)$$, 'CUIT parcial con guiones');
select results_eq($$select cuit from public.listar_proveedores('Distribuidora 2012')$$,
  $$select null::text where false$$, 'un texto mixto no busca por CUIT');

-- Paginación, total y tope
select is((select count(*)::int from public.listar_proveedores(null, 'activos', 1, 3)), 3, 'la página trae el tamaño pedido');
select is((select max(total_filas)::int from public.listar_proveedores(null, 'activos', 1, 3)), 4,
  'total_filas cuenta todas las coincidencias, no solo la página');
select is(
  (select count(distinct id)::int from (
    select id from public.listar_proveedores(null, 'activos', 1, 3)
    union all select id from public.listar_proveedores(null, 'activos', 2, 3)) t),
  4, 'las páginas no repiten ni omiten proveedores');
select is((select count(*)::int from public.listar_proveedores(null, 'activos', 99, 3)), 0, 'página fuera de rango: sin filas');
select is((select count(*)::int from public.listar_proveedores(null, 'activos', 0, 0)), 1, 'página y tamaño inválidos se acotan (mínimo 1)');

-- Aislamiento y niveles de sección
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select results_eq($$select razon_social from public.listar_proveedores()$$,
  $$values ('Álamos Dos'::text)$$, 'cada organización lista solo los suyos');

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.listar_proveedores()), 0, 'operador (sección en «ninguno»): no lista proveedores');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.listar_proveedores()), 0, 'consulta (sección en «ninguno»): no lista proveedores');
reset role;
update permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'proveedores';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.listar_proveedores()), 4, 'con lectura: lista los proveedores de su organización');

-- anon sin ejecución
reset role;
select ok(
  not has_function_privilege('anon', 'public.listar_proveedores(text,text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.listar_proveedores(text,text,integer,integer)', 'execute'),
  '«anon» no ejecuta listar_proveedores; «authenticated» sí');

select * from finish();
rollback;
