-- MSF-302 · F-ROL-05 (FR-007, FR-009, SC-002): solicitudes de acceso.
-- Cubre un pedido por persona/sección/día, aislamiento entre organizaciones,
-- rechazo sin sesión / sin membresía / sección inválida / acceso ya otorgado,
-- escritura directa cerrada y `anon` sin ejecución. Corre como postgres para
-- armar el fixture y como "authenticated" (request.jwt.claims, igual que
-- PostgREST) para verificar. El recorrido de RLS de toda tabla lo hace
-- rls_en_toda_tabla.test.sql, que incluye public.solicitudes_acceso.
begin;

select plan(25);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'operador-uno@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'consulta-uno@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('c2000000-0000-0000-0000-000000000002', 'operador-dos@example.com'),
  ('c9000000-0000-0000-0000-000000000009', 'sin-organizacion@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador'),
  ('c2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'operador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-009)
-- ============================================================================

select ok(
  (select relrowsecurity from pg_class where oid = 'public.solicitudes_acceso'::regclass),
  'solicitudes_acceso tiene RLS habilitada'
);
select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'public.solicitudes_acceso'::regclass),
  'public',
  'solicitudes_acceso vive en public (plataforma, Principio VII)'
);
select is(has_table_privilege('anon', 'public.solicitudes_acceso', 'select'), false, 'anon no lee solicitudes_acceso');
select is(has_table_privilege('authenticated', 'public.solicitudes_acceso', 'insert'), false, 'authenticated no inserta directo');
select is(has_table_privilege('authenticated', 'public.solicitudes_acceso', 'update'), false, 'authenticated no actualiza directo');
select is(has_table_privilege('authenticated', 'public.solicitudes_acceso', 'delete'), false, 'authenticated no borra directo');
select is(has_function_privilege('anon', 'public.solicitar_acceso(text)', 'EXECUTE'), false, 'anon no ejecuta solicitar_acceso');
select is(has_function_privilege('authenticated', 'public.solicitar_acceso(text)', 'EXECUTE'), true, 'authenticated ejecuta solicitar_acceso');

-- ============================================================================
-- Un pedido por persona, sección y día (escenarios 2 y 3)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000002');

select is(
  (select (public.solicitar_acceso('rentabilidad')->>'nuevo')::boolean),
  true,
  'el operador sin acceso a rentabilidad registra el pedido (nuevo)'
);
select is(
  (select (public.solicitar_acceso('rentabilidad')->>'nuevo')::boolean),
  false,
  'repetir el mismo día no es nuevo (no duplica)'
);
select is(
  (select (public.solicitar_acceso('rentabilidad')->>'correo_enviado')::boolean),
  false,
  'mientras el correo no salió, el pedido repetido lo informa para poder reintentar'
);
select is(
  (select count(*)::int from public.solicitudes_acceso where seccion = 'rentabilidad'),
  1,
  'queda un único registro por persona, sección y día'
);
reset role;

update solicitudes_acceso set correo_enviado_en = now() where seccion = 'rentabilidad';

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is(
  (select (public.solicitar_acceso('rentabilidad')->>'correo_enviado')::boolean),
  true,
  'una vez enviado el correo, el pedido repetido lo informa y no hace falta reenviar'
);
select is(
  (select (public.solicitar_acceso('proveedores')->>'nuevo')::boolean),
  true,
  'otra sección el mismo día es otro pedido'
);

-- ============================================================================
-- Rechazos (escenario 6 y bordes)
-- ============================================================================

select throws_ok(
  $$select public.solicitar_acceso('no_existe')$$,
  '22023', 'Sección inválida',
  'una sección fuera del catálogo se rechaza'
);
select throws_ok(
  $$select public.solicitar_acceso('productos')$$,
  '22023', 'Ya tienes acceso a esta sección',
  'una sección a la que ya tiene acceso se rechaza'
);
select throws_ok(
  $$insert into public.solicitudes_acceso (organizacion_id, usuario_id, seccion)
    values ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'ventas')$$,
  '42501', null,
  'no se puede insertar directo por la API'
);
reset role;

select pg_temp.como('c9000000-0000-0000-0000-000000000009');
select throws_ok(
  $$select public.solicitar_acceso('rentabilidad')$$,
  '42501', 'No perteneces a una organización activa',
  'sin membresía se rechaza'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.solicitar_acceso('rentabilidad')$$,
  '42501', 'Se requiere una sesión',
  'sin sesión se rechaza'
);
reset role;

-- ============================================================================
-- Aislamiento entre organizaciones (escenario 5)
-- ============================================================================

select pg_temp.como('c2000000-0000-0000-0000-000000000002');
select is(
  (select (public.solicitar_acceso('rentabilidad')->>'nuevo')::boolean),
  true,
  'la misma sección en otra organización es un pedido propio de esa organización'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.solicitudes_acceso),
  2,
  'el administrador de la organización uno ve los 2 pedidos de su organización'
);
select is(
  (select count(*)::int from public.solicitudes_acceso where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'y ninguno de la organización dos'
);
reset role;

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.solicitudes_acceso),
  1,
  'el administrador de la organización dos ve solo su pedido'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.solicitudes_acceso),
  0,
  'una persona sin rol de administración no ve pedidos ajenos'
);
reset role;

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.solicitudes_acceso),
  2,
  'el solicitante ve solo sus propios pedidos'
);
reset role;

select * from finish();
rollback;
