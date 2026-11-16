-- F-CAT-18 (MSF-416, épica MSF-229): productos relacionados. Cubre FR-013, FR-017, FR-018, SC-003 y FR-011:
-- orden persistido y leído igual por la vista, autorrelación/duplicado/cruce de organización rechazados,
-- aislamiento entre organizaciones, anon sin acceso, lectura sin escribir, cascada al borrar un producto,
-- reemplazo idempotente con evento solo ante cambio real.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated".
begin;

select plan(32);

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

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consola', 'CON-1', 300),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Vidrio templado', 'VID-1', 10),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Funda', 'FUN-1', 15),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 5),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.producto_relacionados'::regclass),
  true, 'producto_relacionados (dominio) tiene RLS'
);
select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'dominio.producto_relacionados'::regclass),
  'dominio', 'producto_relacionados vive en el esquema dominio'
);
select is(has_table_privilege('anon', 'dominio.producto_relacionados', 'SELECT'), false, 'anon no lee producto_relacionados');
select is(has_table_privilege('anon', 'dominio.producto_relacionados', 'INSERT'), false, 'anon no inserta en producto_relacionados');
select is(has_table_privilege('anon', 'public.v_producto_relacionados', 'SELECT'), false, 'anon no lee v_producto_relacionados');
select is(
  has_function_privilege('anon', 'public.guardar_relacionados(uuid, uuid[])', 'EXECUTE'),
  false, 'anon no ejecuta guardar_relacionados'
);
select is(
  has_function_privilege('authenticated', 'public.guardar_relacionados(uuid, uuid[])', 'EXECUTE'),
  true, 'authenticated ejecuta guardar_relacionados'
);

-- ============================================================================
-- Administrador: guarda, reordena y lee en el mismo orden (SC-003)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  public.guardar_relacionados('a1000000-0000-0000-0000-000000000001',
    array['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[]),
  '{"relacionados": [{"id": "a1000000-0000-0000-0000-000000000002", "orden": 1}, {"id": "a1000000-0000-0000-0000-000000000003", "orden": 2}]}'::jsonb,
  'guarda dos relacionados y devuelve id y orden'
);
select is(
  (select array_agg(relacionado_id order by orden) from public.v_producto_relacionados
    where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[],
  'la vista lee el orden guardado'
);
select is(
  (select nombre || '|' || sku || '|' || precio::text || '|' || moneda || '|' || activo::text from public.v_producto_relacionados
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and orden = 1),
  'Vidrio templado|VID-1|10.00|USD|true', 'la vista trae nombre, SKU, precio, moneda y estado'
);

reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.relacionados_editados'),
  1, 'el cambio real deja producto.relacionados_editados'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.guardar_relacionados('a1000000-0000-0000-0000-000000000001',
    array['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[]) -> 'relacionados' -> 0 ->> 'orden',
  '1', 'repetir la misma lista es idempotente'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.relacionados_editados'),
  1, 'sin cambios reales no se registra otro evento'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.guardar_relacionados('a1000000-0000-0000-0000-000000000001',
  array['a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002']::uuid[]);
select is(
  (select array_agg(relacionado_id order by orden) from public.v_producto_relacionados
    where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  array['a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002']::uuid[],
  'reordenar y agregar: la vista lee el nuevo orden'
);
select is(
  (select count(*)::int from dominio.producto_relacionados where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  3, 'el reemplazo no duplica vínculos'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.relacionados_editados'),
  2, 'reordenar suma un único evento'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'producto.relacionados_editados' and detalle ~* '(precio|costo|usd|ars|\$|300)'),
  0, 'el evento no lleva precios ni costo'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.guardar_relacionados('a1000000-0000-0000-0000-000000000001', array['a1000000-0000-0000-0000-000000000004']::uuid[]);
select is(
  (select count(*)::int from public.v_producto_relacionados where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'quitar relacionados borra de verdad el vínculo'
);
select is(
  (select count(*)::int from public.v_producto_relacionados where producto_id = 'a1000000-0000-0000-0000-000000000004'),
  0, 'es unidireccional: el relacionado no queda relacionado de vuelta'
);

-- ============================================================================
-- Rechazos de base (FR-013)
-- ============================================================================

select throws_ok(
  $$select public.guardar_relacionados('a1000000-0000-0000-0000-000000000001', array['a1000000-0000-0000-0000-000000000001']::uuid[])$$,
  '22023', null, 'rechaza relacionar un producto consigo mismo'
);
select throws_ok(
  $$select public.guardar_relacionados('a1000000-0000-0000-0000-000000000001', array['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002']::uuid[])$$,
  '22023', null, 'rechaza un relacionado repetido'
);
select throws_ok(
  $$select public.guardar_relacionados('a1000000-0000-0000-0000-000000000001', array['b2000000-0000-0000-0000-000000000001']::uuid[])$$,
  'P0002', null, 'rechaza un relacionado de otra organización'
);
select throws_ok(
  $$select public.guardar_relacionados('b2000000-0000-0000-0000-000000000001', '{}'::uuid[])$$,
  'P0002', null, 'rechaza un producto de otra organización'
);
select throws_ok(
  $$insert into dominio.producto_relacionados (producto_id, relacionado_id, organizacion_id, orden)
    values ('a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1)$$,
  '23514', null, 'la tabla rechaza la autorrelación (check)'
);
select throws_ok(
  $$insert into dominio.producto_relacionados (producto_id, relacionado_id, organizacion_id, orden)
    values ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 2)$$,
  '23505', null, 'la tabla rechaza el vínculo duplicado (PK)'
);
select throws_ok(
  $$insert into dominio.producto_relacionados (producto_id, relacionado_id, organizacion_id, orden)
    values ('a1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2)$$,
  '23503', null, 'la FK compuesta rechaza cruzar organizaciones'
);

-- ============================================================================
-- Consulta: lee sin escribir
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.v_producto_relacionados where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  1, 'consulta lee los relacionados'
);
select throws_ok(
  $$select public.guardar_relacionados('a1000000-0000-0000-0000-000000000001', '{}'::uuid[])$$,
  '42501', null, 'consulta no puede guardar relacionados'
);

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.v_producto_relacionados), 0, 'otra organización no ve relacionados ajenos'
);
select is(
  (select count(*)::int from dominio.producto_relacionados), 0, 'otra organización no lee la tabla ajena'
);

-- ============================================================================
-- Cascada al borrar un producto
-- ============================================================================

reset role;
delete from dominio.productos where id = 'a1000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from dominio.producto_relacionados where relacionado_id = 'a1000000-0000-0000-0000-000000000004'),
  0, 'borrar el producto relacionado borra el vínculo (cascada)'
);

insert into dominio.producto_relacionados (producto_id, relacionado_id, organizacion_id, orden)
values ('a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 1);
delete from dominio.productos where id = 'a1000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from dominio.producto_relacionados where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  0, 'borrar el producto de origen borra sus vínculos (cascada)'
);

select * from finish();
rollback;
