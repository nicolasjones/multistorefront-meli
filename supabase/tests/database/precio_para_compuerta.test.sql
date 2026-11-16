-- MSF-176 · `private.precio_para` pasó a ser un envoltorio SECURITY DEFINER con execute para `authenticated` (migración 20270322100000).
-- Este test fija, en un solo lugar y con fixtures mínimos, las dos cosas que lo hacen seguro:
--   * la COMPUERTA `private.precio_sesion_alcanza` (tabla de verdad: ventas o empresas en lectura/edición, y producto y empresa de la
--     organización de la sesión; sin sesión o sin pertenecer a la organización = false), y
--   * la ACL: `precio_para` solo para su dueño y `authenticated`; la compuerta y el cálculo sin sesión, sin execute para ningún rol de API.
-- La paridad de precios y el resto de la compuerta (mutantes por sección) viven en `precio_sin_sesion.test.sql`.
begin;

select plan(25);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('d9000000-0000-0000-0000-000000000009', 'cliente-web@example.com');   -- no es miembro de ninguna organización
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion in ('ventas', 'empresas');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto uno', 'PC-1', 'ARS', 1000),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto dos', 'PC-2', 'ARS', 700);

create function pg_temp.sesion(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_user is null then json_build_object('role', 'anon')::text
                                               else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform pg_temp.sesion(p_user);
  set local role authenticated;
end $$;

-- ============================================================================
-- ACL y atributos
-- ============================================================================
select is(
  (select array_agg(g order by g) from (select distinct (case when a.grantee = 0 then 'public' else a.grantee::regrole::text end)::text as g
     from pg_proc p, aclexplode(p.proacl) a where p.oid = 'private.precio_para(uuid, uuid, text)'::regprocedure) t),
  array['authenticated', 'postgres']::text[], 'precio_para: solo su dueño y authenticated tienen execute');
select is(has_function_privilege('anon', 'private.precio_para(uuid, uuid, text)', 'execute'), false, 'precio_para: anon no ejecuta');
select is(has_function_privilege('service_role', 'private.precio_para(uuid, uuid, text)', 'execute'), false, 'precio_para: service_role no ejecuta');
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'private.precio_sesion_alcanza(uuid, uuid)'::regprocedure and a.grantee <> p.proowner), 0,
  'precio_sesion_alcanza: ningún grantee fuera de su dueño (ni public, ni anon, ni authenticated, ni service_role)');
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'private.precio_para_calculo(uuid, uuid, text, uuid)'::regprocedure and a.grantee <> p.proowner), 0,
  'precio_para_calculo (sin sesión): ningún grantee fuera de su dueño');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
     from pg_proc p where p.oid in ('private.precio_para(uuid, uuid, text)'::regprocedure,
                                    'private.precio_sesion_alcanza(uuid, uuid)'::regprocedure,
                                    'private.precio_para_calculo(uuid, uuid, text, uuid)'::regprocedure)),
  'precio_para, la compuerta y el cálculo: security definer con search_path vacío');
select ok(
  (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'precio_sesion_alcanza'
     from pg_proc p where p.oid = 'private.precio_para(uuid, uuid, text)'::regprocedure),
  'precio_para consulta la compuerta precio_sesion_alcanza (si alguien la quita, este test cae)');

-- ============================================================================
-- Tabla de verdad de la compuerta (como dueño, con la sesión simulada por claims)
-- ============================================================================
select pg_temp.sesion('d1000000-0000-0000-0000-000000000001');
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'), true,
  'administrador de la organización 1: producto y empresa propios = true');
select is(private.precio_sesion_alcanza('b2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'), false,
  'administrador 1: producto de otra organización = false');
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001'), false,
  'administrador 1: empresa de otra organización = false');
select is(private.precio_sesion_alcanza('b9999999-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-00000000000a'), false,
  'administrador 1: producto inexistente = false');
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e9999999-0000-0000-0000-000000000000'), false,
  'administrador 1: empresa inexistente = false');
select is(private.precio_sesion_alcanza(null, 'e1000000-0000-0000-0000-00000000000a'), false, 'producto nulo = false');
select pg_temp.sesion('d2000000-0000-0000-0000-000000000001');
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'), false,
  'administrador de la organización 2 sobre producto y empresa de la 1 = false');
select is(private.precio_sesion_alcanza('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001'), true,
  'administrador 2 sobre lo suyo = true');
select pg_temp.sesion('d1000000-0000-0000-0000-000000000003');
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'), false,
  'rol sin ventas ni empresas = false');
update public.permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'), true,
  'solo ventas en lectura = true');
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
update public.permisos_rol set nivel = 'edicion'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'empresas';
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'), true,
  'solo empresas en edición = true');
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'empresas';
select pg_temp.sesion('d9000000-0000-0000-0000-000000000009');
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'), false,
  'cliente web (cuenta de tienda, sin membresía) = false');
select pg_temp.sesion(null);
select is(private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'), false,
  'sin sesión (anon) = false');

-- ============================================================================
-- Con roles reales: precio_para como authenticated respeta la compuerta
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 1,
  'authenticated con permiso: precio_para devuelve su precio');
select is((select count(*)::int from private.precio_para('b2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'authenticated: producto de otra organización = vacío');
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'authenticated sin ventas ni empresas: vacío');
select throws_ok($$select private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'authenticated no puede llamar a la compuerta directamente');
reset role;
select pg_temp.como('d9000000-0000-0000-0000-000000000009');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'cliente web autenticado: precio_para vacío');
reset role;

select * from finish();
rollback;
