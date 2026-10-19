-- MSF-524 (seguimiento de MSF-205): «Compra para» en el proveedor.
-- Cubre la relación dominio.proveedores_empresas (N:M por organización), la escritura solo por
-- RPC con permiso de edición, la validación de pertenencia (RPC y disparador), la lectura por
-- RLS, `listar_proveedores` con `empresas` y filtro por tienda, y `anon` sin ejecución.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como "authenticated".
begin;

select plan(18);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000011', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000012', 'consulta-uno@example.com'),
  ('d2000000-0000-0000-0000-000000000011', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit) values
  ('b1000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'Proveedor Con Tiendas', '20123456786'),
  ('b1000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'Proveedor Sin Tiendas', '30701234568'),
  ('b2000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Proveedor De La Dos', '33555555550');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Administrador de la Uno: lectura y escritura por RPC
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000011');

select is(
  (select empresas from public.listar_proveedores() where razon_social = 'Proveedor Sin Tiendas'),
  '[]'::jsonb,
  'un proveedor sin tiendas aparece con empresas = [] (nunca null)'
);

select is(
  public.guardar_empresas_de_proveedor(
    'b1000000-0000-0000-0000-0000000000b1',
    array['a1000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a2']::uuid[]),
  2,
  'el administrador marca dos tiendas y la RPC devuelve dos'
);

select is(
  (select empresas from public.listar_proveedores() where razon_social = 'Proveedor Con Tiendas'),
  '[{"id": "a1000000-0000-0000-0000-0000000000a2", "nombre": "Mundo JC"}, {"id": "a1000000-0000-0000-0000-0000000000a1", "nombre": "San Javucho"}]'::jsonb,
  'listar_proveedores expone las tiendas (id y nombre), ordenadas por nombre'
);

select is(
  (select count(*)::int from public.listar_proveedores(null, 'activos', 1, 25, 'a1000000-0000-0000-0000-0000000000a1')),
  1,
  'el filtro por tienda devuelve solo los proveedores que compran para esa tienda'
);

select is(
  (select total_filas::int from public.listar_proveedores(null, 'activos', 1, 25, 'a1000000-0000-0000-0000-0000000000a1') limit 1),
  1,
  'el total refleja el filtro por tienda'
);

select is(
  (select count(*)::int from public.listar_proveedores(null, 'activos', 1, 25, 'a2000000-0000-0000-0000-0000000000a1')),
  0,
  'filtrar por una tienda de otra organización no devuelve nada'
);

select is(
  public.guardar_empresas_de_proveedor('b1000000-0000-0000-0000-0000000000b1', array['a1000000-0000-0000-0000-0000000000a2']::uuid[]),
  1,
  'la RPC reemplaza el conjunto (no acumula)'
);

select is(
  public.guardar_empresas_de_proveedor(
    'b1000000-0000-0000-0000-0000000000b1',
    array['a1000000-0000-0000-0000-0000000000a2', 'a1000000-0000-0000-0000-0000000000a2']::uuid[]),
  1,
  'las tiendas repetidas se normalizan'
);

select is(
  public.guardar_empresas_de_proveedor('b1000000-0000-0000-0000-0000000000b1', null),
  0,
  'un arreglo nulo deja al proveedor sin tiendas'
);

select throws_ok(
  $$select public.guardar_empresas_de_proveedor(
      'b1000000-0000-0000-0000-0000000000b1', array['a2000000-0000-0000-0000-0000000000a1']::uuid[])$$,
  '42501', null,
  'no acepta una tienda de otra organización'
);

select throws_ok(
  $$select public.guardar_empresas_de_proveedor(
      'b2000000-0000-0000-0000-0000000000b1', array['a1000000-0000-0000-0000-0000000000a1']::uuid[])$$,
  'P0002', null,
  'no acepta un proveedor de otra organización'
);

-- ============================================================================
-- Consulta (solo lectura): ve, pero no escribe
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000012');

select throws_ok(
  $$select public.guardar_empresas_de_proveedor(
      'b1000000-0000-0000-0000-0000000000b1', array['a1000000-0000-0000-0000-0000000000a1']::uuid[])$$,
  '42501', null,
  'sin edición en Proveedores no se escriben las tiendas'
);

select throws_ok(
  $$insert into dominio.proveedores_empresas (proveedor_id, empresa_id, organizacion_id)
    values ('b1000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null,
  'tampoco hay escritura directa sobre la tabla'
);

-- ============================================================================
-- Otra organización: aislamiento
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000011');

select is(
  (select count(*)::int from dominio.proveedores_empresas),
  0,
  'la otra organización no ve las tiendas de la Uno (RLS)'
);

-- ============================================================================
-- Disparador: protege la tabla ante escrituras que no pasan por la RPC
-- ============================================================================

reset role;

select throws_ok(
  $$insert into dominio.proveedores_empresas (proveedor_id, empresa_id, organizacion_id)
    values ('b1000000-0000-0000-0000-0000000000b1', 'a2000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111')$$,
  '23514', null,
  'el disparador rechaza una empresa de otra organización'
);

select throws_ok(
  $$insert into dominio.proveedores_empresas (proveedor_id, empresa_id, organizacion_id)
    values ('b2000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111')$$,
  '23514', null,
  'el disparador rechaza un proveedor de otra organización'
);

-- ============================================================================
-- anon: sin ejecución ni acceso
-- ============================================================================

select is(
  has_function_privilege('anon', 'public.guardar_empresas_de_proveedor(uuid, uuid[])', 'execute')
    or has_function_privilege('anon', 'public.listar_proveedores(text, text, integer, integer, uuid)', 'execute'),
  false,
  'anon no ejecuta las RPC nuevas'
);

select is(
  has_table_privilege('anon', 'dominio.proveedores_empresas', 'select'),
  false,
  'anon no tiene privilegios sobre la tabla'
);

select * from finish();
rollback;
