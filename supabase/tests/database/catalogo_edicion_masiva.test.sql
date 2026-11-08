-- F-CAT-12 (MSF-392, épica MSF-218): edición masiva de productos. Cubre FR-006 / SC-001:
-- las RPC `mover_productos_categoria`, `cambiar_estado_productos` y `definir_empresas_productos`
-- (security invoker): aislamiento entre dos organizaciones, permisos por rol (consulta rechazada,
-- anon sin ejecución), atomicidad (un id inválido no cambia nada), tope de 100, idempotencia y un
-- evento de Actividad por producto con cambio real. `rls_en_toda_tabla` (global) sigue verde: la
-- migración no crea tablas. El fixture corre como postgres y las verificaciones como "authenticated".
begin;

select plan(45);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cables'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Categoría Dos');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Funda', 'FUN-1', 5),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.empresas_de(p_producto uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(empresa_id order by empresa_id), '{}'::uuid[])
    from dominio.producto_empresa where producto_id = p_producto
$$;

create function pg_temp.eventos(p_tipo text) returns integer language sql as $$
  select count(*)::int from registro_actividad
   where tipo = p_tipo and organizacion_id = '11111111-1111-1111-1111-111111111111'
$$;

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.mover_productos_categoria(uuid[], uuid)', 'EXECUTE'), false, 'anon no ejecuta mover_productos_categoria');
select is(has_function_privilege('anon', 'public.cambiar_estado_productos(uuid[], boolean)', 'EXECUTE'), false, 'anon no ejecuta cambiar_estado_productos');
select is(has_function_privilege('anon', 'public.definir_empresas_productos(uuid[], uuid[], uuid[])', 'EXECUTE'), false, 'anon no ejecuta definir_empresas_productos');
select is(
  (select count(*)::int from pg_proc
    where oid in ('public.mover_productos_categoria(uuid[], uuid)'::regprocedure,
                  'public.cambiar_estado_productos(uuid[], boolean)'::regprocedure,
                  'public.definir_empresas_productos(uuid[], uuid[], uuid[])'::regprocedure)
      and prosecdef = false),
  3, 'las tres RPC son security invoker (rige la RLS)'
);

-- ============================================================================
-- Consulta (solo lectura): rechazada
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001']::uuid[], 'c1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'consulta no puede mover de categoría'
);
select throws_ok(
  $$select public.cambiar_estado_productos(array['a1000000-0000-0000-0000-000000000001']::uuid[], false)$$,
  '42501', null, 'consulta no puede cambiar el estado'
);
select throws_ok(
  $$select public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001']::uuid[], array['e1000000-0000-0000-0000-000000000001']::uuid[], '{}')$$,
  '42501', null, 'consulta no puede cambiar empresas'
);

-- ============================================================================
-- Mover de categoría
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], 'c1000000-0000-0000-0000-000000000001'),
  2, 'mover dos productos devuelve 2'
);
reset role;
select is(
  (select count(*)::int from dominio.productos where categoria_id = 'c1000000-0000-0000-0000-000000000001'),
  2, 'los dos productos quedan en la categoría'
);
select is(pg_temp.eventos('producto.categoria_asignada'), 2, 'un evento por producto movido');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], 'c1000000-0000-0000-0000-000000000001'),
  0, 'repetir el movimiento no cambia nada (idempotente)'
);
reset role;
select is(pg_temp.eventos('producto.categoria_asignada'), 2, 'repetir no deja eventos nuevos');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[], 'c1000000-0000-0000-0000-000000000001'),
  1, 'solo cuenta el producto que cambió de verdad'
);
reset role;
select is(pg_temp.eventos('producto.categoria_asignada'), 3, 'el evento sale solo para el que cambió');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001']::uuid[], 'c1000000-0000-0000-0000-000000000002')$$,
  'P0002', null, 'un producto de otra organización falla toda la operación'
);
reset role;
select is(
  (select categoria_id from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  'c1000000-0000-0000-0000-000000000001'::uuid, 'el producto válido no cambió (atomicidad)'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001']::uuid[], 'c2000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'una categoría de otra organización se rechaza'
);
select throws_ok(
  $$select public.mover_productos_categoria('{}'::uuid[], 'c1000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'la lista vacía se rechaza'
);
select throws_ok(
  $$select public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001']::uuid[], null)$$,
  '22023', null, 'la categoría es obligatoria'
);
select throws_ok(
  $$select public.mover_productos_categoria((select array_agg(gen_random_uuid()) from generate_series(1, 101)), 'c1000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'más de 100 ids se rechaza'
);
select throws_ok(
  $$select public.mover_productos_categoria((select array_agg(gen_random_uuid()) from generate_series(1, 100)), 'c1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'con 100 ids el tope no salta (falla por inexistentes)'
);

-- ============================================================================
-- Cambiar estado
-- ============================================================================

select is(
  public.cambiar_estado_productos(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], false),
  2, 'desactivar dos productos devuelve 2'
);
reset role;
select is(
  (select count(*)::int from dominio.productos where id in ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002') and not activo),
  2, 'los dos quedan inactivos'
);
select is(pg_temp.eventos('producto.desactivado'), 2, 'un evento producto.desactivado por producto');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.cambiar_estado_productos(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], false),
  0, 'repetir el estado no cambia nada (idempotente)'
);
select throws_ok(
  $$select public.cambiar_estado_productos(array['a1000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001']::uuid[], false)$$,
  'P0002', null, 'un producto de otra organización falla toda la operación'
);
reset role;
select is(
  (select activo from dominio.productos where id = 'a1000000-0000-0000-0000-000000000003'),
  true, 'el producto válido sigue activo (atomicidad)'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.cambiar_estado_productos(array['a1000000-0000-0000-0000-000000000001']::uuid[], null)$$,
  '22023', null, 'el estado es obligatorio'
);
select is(
  public.cambiar_estado_productos(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], true),
  2, 'activar los dos devuelve 2'
);
reset role;
select is(pg_temp.eventos('producto.activado'), 2, 'un evento producto.activado por producto');

-- ============================================================================
-- Cambiar empresas
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], array['e1000000-0000-0000-0000-000000000001']::uuid[], '{}'),
  2, 'agregar una empresa a dos productos devuelve 2'
);
select is(
  public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001']::uuid[], array['e1000000-0000-0000-0000-000000000002']::uuid[], '{}'),
  1, 'agregar otra empresa a uno devuelve 1'
);
reset role;
select is(
  pg_temp.empresas_de('a1000000-0000-0000-0000-000000000001'),
  array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002']::uuid[],
  'agregar conserva los vínculos que ya tenía'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], '{}', array['e1000000-0000-0000-0000-000000000001']::uuid[]),
  2, 'quitar una empresa de dos productos devuelve 2'
);
reset role;
select is(
  pg_temp.empresas_de('a1000000-0000-0000-0000-000000000001'),
  array['e1000000-0000-0000-0000-000000000002']::uuid[], 'quitar deja solo los demás vínculos'
);
select is(pg_temp.empresas_de('a1000000-0000-0000-0000-000000000002'), '{}'::uuid[], 'el otro producto queda sin empresas');
select is(pg_temp.eventos('producto.empresas_actualizadas'), 5, 'un evento por producto con cambio real');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], '{}', array['e1000000-0000-0000-0000-000000000001']::uuid[]),
  0, 'repetir no cambia nada (idempotente)'
);
reset role;
select is(pg_temp.eventos('producto.empresas_actualizadas'), 5, 'repetir no deja eventos nuevos');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001']::uuid[], array['e1000000-0000-0000-0000-000000000001']::uuid[], array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '22023', null, 'una empresa en agregar y quitar se rechaza'
);
select throws_ok(
  $$select public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001']::uuid[], '{}', '{}')$$,
  '22023', null, 'ambas listas vacías se rechazan'
);
select throws_ok(
  $$select public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001']::uuid[], array['e2000000-0000-0000-0000-000000000001']::uuid[], '{}')$$,
  '22023', null, 'una empresa de otra organización se rechaza'
);
select throws_ok(
  $$select public.definir_empresas_productos(array['a1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001']::uuid[], array['e1000000-0000-0000-0000-000000000001']::uuid[], '{}')$$,
  'P0002', null, 'un producto de otra organización falla toda la operación'
);
reset role;
select is(
  pg_temp.empresas_de('a1000000-0000-0000-0000-000000000001'),
  array['e1000000-0000-0000-0000-000000000002']::uuid[], 'el producto válido no cambió (atomicidad)'
);

-- ============================================================================
-- Aislamiento: otra organización no toca productos ajenos
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.mover_productos_categoria(array['a1000000-0000-0000-0000-000000000001']::uuid[], 'c2000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'el administrador de otra organización no ve los productos ajenos'
);

select * from finish();
rollback;
