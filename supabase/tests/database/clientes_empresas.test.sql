-- F-CLI-05 (MSF-180 fidelidad, spec 20261018-070000-clientes-empresas):
-- clientes habilitados en empresas/tiendas. Cubre FR-001…FR-006 y FR-013:
-- la relación cliente↔empresa (N:M) por organización, la escritura solo por RPC
-- con permiso de edición, la validación de pertenencia (RPC y disparador), la
-- lectura por RLS y `buscar_clientes` exponiendo las tiendas.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como
-- "authenticated" vía request.jwt.claims, igual que PostgREST.
begin;

select plan(21);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'consulta-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'deposito-uno@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente sin tiendas', 'minorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Desde la aplicación (administrador de la Uno): lectura y escritura por RPC
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select is(
  (select empresas from buscar_clientes() where nombre = 'Cliente sin tiendas'),
  '[]'::jsonb,
  'un cliente sin tiendas aparece con empresas = [] (nunca null)'
);

select is(
  public.guardar_empresas_de_cliente(
    'c5000000-0000-0000-0000-000000000001',
    array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[]
  ),
  2,
  'el administrador habilita el cliente en dos tiendas y la RPC devuelve dos'
);

select results_eq(
  $$select e.nombre from clientes_empresas ce join dominio.empresas e on e.id = ce.empresa_id
     where ce.cliente_id = 'c5000000-0000-0000-0000-000000000001' order by e.nombre$$,
  $$values ('Mundo JC'::text), ('San Javucho'::text)$$,
  'las tiendas guardadas se leen desde la aplicación'
);

select is(
  (select empresas from buscar_clientes('Distribuidora') where id = 'c5000000-0000-0000-0000-000000000001'),
  '[{"id": "a1000000-0000-0000-0000-000000000002", "nombre": "Mundo JC"}, {"id": "a1000000-0000-0000-0000-000000000001", "nombre": "San Javucho"}]'::jsonb,
  'buscar_clientes expone las tiendas (id y nombre), ordenadas por nombre'
);

select is(
  public.guardar_empresas_de_cliente(
    'c5000000-0000-0000-0000-000000000001',
    array['a1000000-0000-0000-0000-000000000002']::uuid[]
  ),
  1,
  'la RPC reemplaza el conjunto de tiendas (no acumula)'
);

select is(
  public.guardar_empresas_de_cliente(
    'c5000000-0000-0000-0000-000000000001',
    array['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002']::uuid[]
  ),
  1,
  'las tiendas repetidas se normalizan (queda una sola fila)'
);

select throws_ok(
  $$select public.guardar_empresas_de_cliente(
      'c5000000-0000-0000-0000-000000000001',
      array['a2000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', null,
  'no acepta una tienda de otra organización'
);

select throws_ok(
  $$select public.guardar_empresas_de_cliente(
      '00000000-0000-0000-0000-000000000000',
      array['a1000000-0000-0000-0000-000000000001']::uuid[])$$,
  'P0002', null,
  'el cliente tiene que existir y ser de tu organización'
);

-- ============================================================================
-- Otros roles: la escritura exige edición; la lectura, al menos lectura
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002'); -- consulta (lectura)

select throws_ok(
  $$select public.guardar_empresas_de_cliente(
      'c5000000-0000-0000-0000-000000000001',
      array['a1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', null,
  'Consulta (lectura) no puede cambiar las tiendas'
);

select is(
  (select count(*)::int from clientes_empresas),
  1,
  'Consulta ve las tiendas del cliente (RLS de lectura)'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000003'); -- depósito (ninguno)

select throws_ok(
  $$select public.guardar_empresas_de_cliente(
      'c5000000-0000-0000-0000-000000000001',
      array['a1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', null,
  'Depósito (ninguno) no puede cambiar las tiendas'
);

select is(
  (select count(*)::int from clientes_empresas),
  0,
  'Depósito (ninguno) no ve ninguna tienda (RLS)'
);

select pg_temp.como('e2000000-0000-0000-0000-000000000001'); -- administrador de la Dos

select is(
  (select count(*)::int from clientes_empresas),
  0,
  'el administrador de la Dos no ve tiendas de la Uno'
);

select throws_ok(
  $$select public.guardar_empresas_de_cliente(
      'c5000000-0000-0000-0000-000000000001',
      array['a2000000-0000-0000-0000-000000000001']::uuid[])$$,
  'P0002', null,
  'no puede tocar las tiendas de un cliente de otra organización'
);

-- ============================================================================
-- Limpiar las tiendas (arreglo vacío y null) — vuelve el administrador de la Uno
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select is(
  public.guardar_empresas_de_cliente('c5000000-0000-0000-0000-000000000001', '{}'::uuid[]),
  0,
  'un arreglo vacío deja al cliente sin tiendas'
);

select is(
  public.guardar_empresas_de_cliente('c5000000-0000-0000-0000-000000000001', null),
  0,
  'null también limpia las tiendas'
);

-- ============================================================================
-- Defensa en la tabla (FR-002) y unicidad (FR-001)
-- ============================================================================

reset role;

select throws_ok(
  $$insert into clientes_empresas (cliente_id, empresa_id, organizacion_id)
    values ('c6000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222')$$,
  '23514', null,
  'el disparador rechaza una tienda que no es de la organización de la fila'
);

insert into clientes_empresas (cliente_id, empresa_id, organizacion_id)
  values ('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$insert into clientes_empresas (cliente_id, empresa_id, organizacion_id)
    values ('c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111')$$,
  '23505', null,
  'un cliente no repite la misma tienda (clave primaria compuesta)'
);

-- ============================================================================
-- `anon` sin acceso (FR-013)
-- ============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guardar_empresas_de_cliente'
      and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'anon no puede ejecutar la RPC de tiendas'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guardar_empresas_de_cliente'
      and has_function_privilege('authenticated', p.oid, 'execute')),
  1,
  'authenticated sí puede ejecutar la RPC de tiendas'
);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'clientes_empresas'
      and has_table_privilege('anon', 'public.clientes_empresas', 'select')),
  0,
  'anon no lee la tabla de tiendas'
);

select * from finish();
rollback;
