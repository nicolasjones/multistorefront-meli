-- F-CAT-02 (MSF-458, épica MSF-456): alta de producto.
-- Cubre SC-002: aislamiento entre dos organizaciones, permisos por rol sobre
-- `dominio.productos` y `dominio.producto_costos` (Operador: 0 filas de costo;
-- Consulta sin escritura), `anon` sin privilegios, sin DELETE, validaciones de
-- la RPC y evento `producto.creado` en Actividad sin costo.
-- Corre como postgres para armar el fixture y como "authenticated"
-- (request.jwt.claims, igual que PostgREST) para verificar.
begin;

select plan(34);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Administrador: alta con costo
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.crear_producto('  Joystick Pro  ', 'Mando inalámbrico', 'JOY-1', array[' PS5 ', 'PS5', '', ' Xbox'], 'USD', 49.90, 1500.50)$$,
  'administrador: crea un producto con costo'
);
select is(
  (select nombre || '|' || activo::text || '|' || moneda from dominio.productos where sku = 'JOY-1'),
  'Joystick Pro|true|USD', 'el producto nace activo y con el nombre recortado'
);
select is(
  (select compatible_con from dominio.productos where sku = 'JOY-1'),
  array['PS5', 'Xbox'], '«Compatible con» se recorta y no repite valores'
);
select throws_ok(
  $$select public.crear_producto('Largo', null, null, array[repeat('x', 101)], 'USD', 10, null)$$,
  '22023', null, 'un valor de «Compatible con» de más de 100 caracteres se rechaza, no se descarta'
);
select throws_ok(
  $$select public.crear_producto('Enorme', null, null, '{}', 'USD', 10000000000000, null)$$,
  '22003', null, 'un precio de más de 12 enteros desborda numeric(14,2) y se rechaza'
);
select is(
  (select costo from dominio.producto_costos c join dominio.productos p on p.id = c.producto_id where p.sku = 'JOY-1'),
  1500.50::numeric, 'el costo se guarda aparte'
);
reset role;

-- ============================================================================
-- Operador: crea sin costo; no ve ni escribe costos
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.crear_producto('Cable HDMI', null, '   ', '{}', 'ARS', 8000, null)$$,
  'operador: crea un producto sin costo (SKU vacío se autogenera, F-CAT-03)'
);
select throws_ok(
  $$select public.crear_producto('Con costo', null, 'X-1', '{}', 'USD', 10, 5)$$,
  '42501', null, 'operador: enviar costo por la RPC se rechaza'
);
select is((select count(*)::int from dominio.producto_costos), 0, 'operador: 0 filas en producto_costos');
select is((select count(*)::int from dominio.productos), 2, 'operador: ve los productos de su organización');
select throws_ok(
  $$insert into dominio.producto_costos (producto_id, organizacion_id, costo)
    select id, organizacion_id, 1 from dominio.productos limit 1$$,
  '42501', null, 'operador: insertar un costo por llamada directa se rechaza'
);
reset role;

-- ============================================================================
-- Consulta y Administración
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.crear_producto('No debería', null, null, '{}', 'USD', 10, null)$$,
  '42501', null, 'consulta: crear por la RPC se rechaza'
);
select throws_ok(
  $$insert into dominio.productos (organizacion_id, nombre, precio_lista)
    values ('11111111-1111-1111-1111-111111111111', 'Directo', 10)$$,
  '42501', null, 'consulta: insertar por llamada directa se rechaza'
);
select is((select count(*)::int from dominio.productos), 2, 'consulta: lee los productos');
select is((select count(*)::int from dominio.producto_costos), 0, 'consulta: no ve costos (Rentabilidad en ninguno)');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000006');
select is((select count(*)::int from dominio.producto_costos), 1, 'administración: lee costos (Rentabilidad en lectura)');
select throws_ok(
  $$select public.crear_producto('Con costo ajeno', null, null, '{}', 'USD', 10, 5)$$,
  '42501', null, 'administración: sin edición en Productos ni Rentabilidad no crea ni carga costo'
);
reset role;

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.productos), 0, 'otra organización: 0 productos de la primera');
select is((select count(*)::int from dominio.producto_costos), 0, 'otra organización: 0 costos de la primera');
select lives_ok(
  $$update dominio.productos set nombre = 'Pisado'$$,
  'otra organización: el update sobre productos ajenos no falla (RLS lo filtra)'
);
select throws_ok(
  $$insert into dominio.productos (organizacion_id, nombre, precio_lista)
    values ('11111111-1111-1111-1111-111111111111', 'Intruso', 10)$$,
  '42501', null, 'otra organización: no inserta en la primera'
);
reset role;
select is(
  (select count(*)::int from dominio.productos where nombre = 'Pisado'),
  0, 'otra organización: ningún producto quedó actualizado'
);

-- ============================================================================
-- Validaciones de la RPC
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.crear_producto('   ', null, null, '{}', 'USD', 10, null)$$,
  '22023', null, 'nombre solo con espacios: rechazado'
);
select throws_ok(
  $$select public.crear_producto('Precio cero', null, null, '{}', 'USD', 0, null)$$,
  '22023', null, 'precio cero: rechazado'
);
select throws_ok(
  $$select public.crear_producto('Tres decimales', null, null, '{}', 'USD', 10.123, null)$$,
  '22023', null, 'precio con más de 2 decimales: rechazado'
);
select throws_ok(
  $$select public.crear_producto('Euros', null, null, '{}', 'EUR', 10, null)$$,
  '22023', null, 'moneda distinta de USD/ARS: rechazada'
);
select throws_ok(
  $$delete from dominio.productos$$,
  '42501', null, 'nadie borra productos (sin DELETE)'
);
reset role;

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_table_privilege('anon', 'dominio.productos', 'SELECT'), false, 'anon no lee productos');
select is(has_table_privilege('anon', 'dominio.producto_costos', 'SELECT'), false, 'anon no lee costos');
select is(has_function_privilege('anon', 'public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text, text)', 'EXECUTE'), false, 'anon no ejecuta crear_producto');
select is(has_function_privilege('authenticated', 'public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text, text)', 'EXECUTE'), true, 'authenticated ejecuta crear_producto');
select hasnt_column('dominio', 'productos', 'stock', 'el alta no guarda stock inicial');

-- ============================================================================
-- Actividad
-- ============================================================================

select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.creado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'cada alta deja un evento producto.creado'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.creado' and (detalle like '%1500%' or detalle like '%49.9%')),
  0, 'el detalle de la actividad no incluye costo ni precio'
);

select * from finish();

rollback;
