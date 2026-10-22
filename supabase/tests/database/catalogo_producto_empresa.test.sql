-- F-CAT-07 (MSF-276, épica MSF-160): empresas que venden el producto. Cubre SC-003 / FR-009…FR-014:
-- aislamiento entre organizaciones, FK compuesta que impide cruzar organizaciones, permisos por rol
-- (Administrador edita, Consulta solo lee, anon nada), RPC `definir_empresas_producto` atómica e
-- idempotente (22023 empresa ajena, P0002 producto inexistente), evento `producto.empresas_actualizadas`
-- solo ante cambios reales y sin precios, y la columna `empresa_ids` de `v_productos_listado`.
-- `rls_en_toda_tabla` (global) recorre `public` + `dominio`: acá se verifica además la tabla propia.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated".
begin;

select plan(42);

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

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10),
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
  (select relrowsecurity from pg_class where oid = 'dominio.producto_empresa'::regclass),
  true, 'producto_empresa (dominio) tiene RLS'
);
select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'dominio.producto_empresa'::regclass),
  'dominio', 'producto_empresa vive en el esquema dominio'
);
select is(has_table_privilege('anon', 'dominio.producto_empresa', 'SELECT'), false, 'anon no lee producto_empresa');
select is(has_table_privilege('anon', 'dominio.producto_empresa', 'INSERT'), false, 'anon no inserta en producto_empresa');
select is(has_table_privilege('authenticated', 'dominio.producto_empresa', 'UPDATE'), false, 'nadie actualiza producto_empresa (sin UPDATE)');
select is(
  has_function_privilege('anon', 'public.definir_empresas_producto(uuid, uuid[])', 'EXECUTE'),
  false, 'anon no ejecuta definir_empresas_producto'
);
select is(
  has_function_privilege('authenticated', 'public.definir_empresas_producto(uuid, uuid[])', 'EXECUTE'),
  true, 'authenticated ejecuta definir_empresas_producto'
);
select is(has_table_privilege('anon', 'public.v_productos_listado', 'SELECT'), false, 'anon no lee v_productos_listado');
select is(
  (select attname::text from pg_attribute
    where attrelid = 'public.v_productos_listado'::regclass and attnum > 0 and not attisdropped
    order by attnum limit 1 offset 7),
  'empresa_ids', 'empresa_ids sigue en su posición (la categoría se agrega después)'
);

-- ============================================================================
-- Administrador: la RPC define las empresas y deja el evento
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.v_productos_listado where id = 'a1000000-0000-0000-0000-000000000001'
     and empresa_ids = '{}'::uuid[]),
  1, 'un producto nuevo no se vende en ninguna empresa (empresa_ids vacío)'
);
select is(
  public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001', array['e1000000-0000-0000-0000-000000000001']::uuid[]),
  1, 'administrador: define San Javucho para el producto'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.empresas_actualizadas'),
  1, 'el cambio real deja producto.empresas_actualizadas'
);
select is(
  (select detalle from registro_actividad where tipo = 'producto.empresas_actualizadas'),
  'Cambió las empresas del producto Joystick (SKU JOY-1): agregó San Javucho',
  'el detalle nombra producto, SKU y la empresa agregada'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001', array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001']::uuid[]),
  1, 'repetir la misma lista (con repetidos) es idempotente'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.empresas_actualizadas'),
  1, 'sin cambios reales no se registra otro evento'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001', array['e1000000-0000-0000-0000-000000000002']::uuid[]),
  1, 'administrador: cambia San Javucho por Mundo JC'
);
reset role;
select is(
  (select count(*)::int from registro_actividad
    where detalle = 'Cambió las empresas del producto Joystick (SKU JOY-1): agregó Mundo JC; quitó San Javucho'),
  1, 'un solo evento combina lo agregado y lo quitado'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.empresas_actualizadas'),
  2, 'el cambio mixto suma un único evento'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001', '{}'::uuid[]),
  0, 'administrador: quita todas las empresas'
);
reset role;
select is(
  (select count(*)::int from registro_actividad
    where detalle = 'Cambió las empresas del producto Joystick (SKU JOY-1): quitó Mundo JC'),
  1, 'quitar todas deja el evento solo con lo quitado'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'producto.empresas_actualizadas' and detalle ~* '(precio|costo|usd|ars|\$|49)'),
  0, 'los eventos no llevan precios ni costo'
);

-- ============================================================================
-- Rechazos de la RPC y de la tabla (sin cambios parciales)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001', array['e2000000-0000-0000-0000-000000000001']::uuid[])$$,
  '22023', null, 'una empresa de otra organización se rechaza'
);
select throws_ok(
  $$select public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001',
      array['e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001']::uuid[])$$,
  '22023', null, 'una lista con una empresa válida y una ajena se rechaza entera'
);
select is(
  (select count(*)::int from dominio.producto_empresa where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'atomicidad: el rechazo no dejó la empresa válida a medias'
);
select throws_ok(
  $$select public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001', array[null]::uuid[])$$,
  '22023', null, 'un valor vacío en la lista se rechaza'
);
select throws_ok(
  $$select public.definir_empresas_producto('a9000000-0000-0000-0000-000000000009', array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  'P0002', null, 'un producto inexistente se rechaza'
);
select throws_ok(
  $$select public.definir_empresas_producto('b2000000-0000-0000-0000-000000000001', array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  'P0002', null, 'un producto de otra organización se ve como inexistente'
);
select throws_ok(
  $$insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
      ('a1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')$$,
  '23503', null, 'la FK compuesta impide asociar una empresa de otra organización'
);
select throws_ok(
  $$insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
      ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222')$$,
  '42501', null, 'RLS impide escribir filas de otra organización'
);

-- Alta directa (sin la RPC) también deja su evento.
select lives_ok(
  $$insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
      ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')$$,
  'administrador: alta directa permitida por RLS'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.empresas_actualizadas'),
  4, 'la alta directa registra su evento (una sola vez)'
);

-- ============================================================================
-- Lectura de la vista y permisos de solo lectura
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001',
    array['e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001']::uuid[]),
  2, 'administrador: deja el producto en las dos empresas'
);
select is(
  (select empresa_ids from public.v_productos_listado where id = 'a1000000-0000-0000-0000-000000000001'),
  array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002']::uuid[],
  'la vista expone empresa_ids del producto'
);
select is(
  (select count(*)::int from public.v_productos_listado where empresa_ids @> array['e1000000-0000-0000-0000-000000000002']::uuid[]),
  1, 'el filtro por empresa (contiene) trae solo lo que esa empresa vende'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from dominio.producto_empresa), 2, 'consulta: lee las empresas del producto'
);
select throws_ok(
  $$select public.definir_empresas_producto('a1000000-0000-0000-0000-000000000001', '{}'::uuid[])$$,
  '42501', null, 'consulta: no puede definir empresas (RPC)'
);
select throws_ok(
  $$insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
      ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'consulta: no puede insertar (llamada directa)'
);
delete from dominio.producto_empresa;
select is(
  (select count(*)::int from dominio.producto_empresa), 2, 'consulta: no puede borrar (llamada directa)'
);
select throws_ok(
  $$update dominio.producto_empresa set creado_en = now()$$,
  '42501', null, 'nadie actualiza producto_empresa'
);

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.producto_empresa), 0, 'otra organización no ve filas ajenas'
);
select is(
  (select count(*)::int from public.v_productos_listado where id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'otra organización no ve el producto en la vista'
);

-- Borrar una empresa limpia sus asignaciones (cascada).
reset role;
delete from dominio.empresas where id = 'e1000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from dominio.producto_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  0, 'borrar una empresa quita sus asignaciones'
);

select * from finish();
rollback;
