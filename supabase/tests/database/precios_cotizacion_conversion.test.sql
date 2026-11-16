-- F-PRE-01 (MSF-115, épica MSF-114): cotización inicial, conversión a pesos, costo y margen.
-- Cubre FR-001…FR-004 / SC-001: aislamiento entre organizaciones en `cotizacion_inicial`,
-- permisos por rol, conversión USD/ARS, sin cotización → sin precio, costo y margen solo con
-- `rentabilidad`, evento `producto.precio_actualizado` (solo ante cambios reales) y `anon`
-- sin ejecución. `rls_en_toda_tabla` cubre además que la tabla nueva tenga RLS.
begin;

select plan(56);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'administracion@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- P1: USD 20 costo 12 · P2: ARS 1000 costo 600 (org 1) · P3: USD 10 sin costo (org 2).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'USD', 20),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 1000),
  ('a2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'USD', 10);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 12),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 600);
-- La organización 2 ya tiene su cotización (la carga el superusuario para el aislamiento).
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('22222222-2222-2222-2222-222222222222', 1000);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Administrador (org 1): sin cotización no se inventa un valor
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select precio_central_ars from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  null, 'sin cotización: un producto en USD no tiene precio en pesos'
);
select is(
  (select precio_central_ars from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  1000.00, 'sin cotización: un producto en ARS se muestra tal cual'
);
select throws_ok($$select public.fijar_cotizacion_inicial(0)$$, '23514', null, 'cotización cero: rechazada');
select throws_ok($$select public.fijar_cotizacion_inicial(-5)$$, '23514', null, 'cotización negativa: rechazada');
select throws_ok($$select public.fijar_cotizacion_inicial(1465.00001)$$, '23514', null, 'más de 4 decimales: rechazada');
select lives_ok($$select public.fijar_cotizacion_inicial(1465)$$, 'administrador: fija la cotización inicial');
select is(
  (select valor from dominio.cotizacion_inicial where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1465::numeric, 'la cotización quedó guardada'
);

-- Conversión: 20 USD × 1465 = 29.300; costo 12 × 1465 = 17.580; margen 40 %.
select is(
  (select precio_central_ars from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  29300.00, 'USD × cotización: precio central en pesos'
);
select is(
  (select costo_ars from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  17580.00, 'USD × cotización: costo en pesos'
);
select is(
  (select margen from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0.4::numeric, 'margen = (neto − costo) / neto'
);
select is(
  (select margen from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  0.4::numeric, 'ARS: el margen se calcula sin conversión'
);
select is(
  private.precio_central_ars('a1000000-0000-0000-0000-000000000001'),
  29300.00, 'private.precio_central_ars devuelve el precio de lista en pesos'
);

-- Idempotencia: fijar el mismo valor no mueve updated_at; un valor nuevo sí.
reset role;
create temp table cot1 as
  select updated_at from dominio.cotizacion_inicial where organizacion_id = '11111111-1111-1111-1111-111111111111';
grant select on cot1 to authenticated;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.fijar_cotizacion_inicial(1465)$$, 'administrador: fijar el mismo valor no falla');
select is(
  (select updated_at from dominio.cotizacion_inicial where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  (select updated_at from cot1), 'el mismo valor no mueve updated_at'
);
select lives_ok($$select public.fijar_cotizacion_inicial(1500)$$, 'administrador: cambia la cotización');
select ok(
  (select updated_at from dominio.cotizacion_inicial where organizacion_id = '11111111-1111-1111-1111-111111111111')
    > (select updated_at from cot1), 'un valor nuevo avanza updated_at'
);
select is((select count(*)::int from dominio.cotizacion_inicial), 1, 'solo ve la cotización de su organización');
select is((select count(*)::int from public.productos_precio_costo), 2, 'la vista solo devuelve productos de su organización');
reset role;

-- ============================================================================
-- Operador: sin `rentabilidad` (ve el precio, no costo ni margen) y sin `empresas`
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(
  (select precio_central_ars from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  30000.00, 'operador: ve el precio central en pesos'
);
select is(
  (select costo_ars from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  null, 'operador: no ve el costo en pesos'
);
select is(
  (select margen from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  null, 'operador: no ve el margen'
);
select throws_ok($$select public.fijar_cotizacion_inicial(1)$$, '42501', null, 'operador: no fija la cotización');
-- RLS filtra la fila: el UPDATE no falla pero no cambia nada (se verifica más abajo con el 1500 intacto).
select lives_ok(
  $$update dominio.cotizacion_inicial set valor = 1$$,
  'operador: el UPDATE directo no alcanza ninguna fila'
);
reset role;

-- ============================================================================
-- Administración (lectura de `rentabilidad`): ve costo y margen, no edita la cotización
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is(
  (select costo_ars from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  18000.00, 'administración: ve el costo en pesos'
);
select is(
  (select margen from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0.4::numeric, 'administración: ve el margen'
);
select throws_ok($$select public.fijar_cotizacion_inicial(1)$$, '42501', null, 'administración: no fija la cotización');
reset role;

-- ============================================================================
-- Consulta
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select precio_central_ars from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  30000.00, 'consulta: ve el precio central en pesos'
);
select throws_ok($$select public.fijar_cotizacion_inicial(1)$$, '42501', null, 'consulta: no fija la cotización');
reset role;

-- ============================================================================
-- Otra organización: aislamiento
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.productos_precio_costo), 1, 'org 2: la vista solo devuelve sus productos');
select is(
  (select precio_central_ars from public.productos_precio_costo where producto_id = 'a2000000-0000-0000-0000-000000000003'),
  10000.00, 'org 2: convierte con SU cotización'
);
select is(
  (select valor from dominio.cotizacion_inicial), 1000::numeric,
  'org 2: solo ve su cotización, no la de la organización 1'
);
select lives_ok($$select public.fijar_cotizacion_inicial(1200)$$, 'org 2: su administrador fija su cotización');
reset role;
select is(
  (select valor from dominio.cotizacion_inicial where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1500::numeric, 'la cotización de la organización 1 no cambió'
);
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.productos_precio_costo where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  0, 'org 2: no ve productos de la organización 1'
);
reset role;

-- ============================================================================
-- Evento `producto.precio_actualizado` (FR-004): solo ante cambios reales, sin importes de costo
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, 'USD', 25, null)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'administrador: cambia el precio de lista'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_actualizado'),
  1, 'el cambio de lista dejó un evento'
);
select ok(
  (select detalle like '%USD 20,00 → USD 25,00%' from registro_actividad where tipo = 'producto.precio_actualizado'),
  'el evento registra el antes y el después'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, 'USD', 25, 12)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'administrador: guardar sin cambios de precio ni costo'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_actualizado'),
  1, 'sin cambio real no hay evento'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, 'USD', 25, 15)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'administrador: cambia el costo'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_actualizado'),
  2, 'el cambio de costo dejó un evento'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'producto.precio_actualizado' and detalle like 'Cambió el costo de%' and detalle !~ '[0-9]'),
  1, 'el evento de costo no incluye importes'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, 'USD', 25, 15)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'administrador: repite el mismo costo'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_actualizado'),
  2, 'repetir el costo no deja evento'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.actualizar_producto(id, updated_at, nombre, descripcion, sku, compatible_con, 'ARS', 25, null)
    from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'administrador: cambia la moneda'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_actualizado'),
  3, 'el cambio de moneda dejó un evento'
);

-- Alta de un producto con costo: no hay «antes», no deja evento.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$with p as (
      insert into dominio.productos (id, organizacion_id, nombre, moneda, precio_lista)
      values ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Nuevo', 'USD', 5)
      returning id, organizacion_id)
    insert into dominio.producto_costos (producto_id, organizacion_id, costo)
    select id, organizacion_id, 2 from p$$,
  'administrador: crea un producto con costo'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.precio_actualizado'),
  3, 'crear un producto no deja evento de precio'
);

-- ============================================================================
-- Privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.fijar_cotizacion_inicial(numeric)', 'EXECUTE'), false, 'anon no ejecuta fijar_cotizacion_inicial');
select is(has_function_privilege('authenticated', 'public.fijar_cotizacion_inicial(numeric)', 'EXECUTE'), true, 'authenticated ejecuta fijar_cotizacion_inicial');
select is(has_function_privilege('anon', 'private.a_pesos(numeric, text, uuid)', 'EXECUTE'), false, 'anon no ejecuta private.a_pesos');
select is(has_function_privilege('anon', 'private.precio_central_ars(uuid)', 'EXECUTE'), false, 'anon no ejecuta private.precio_central_ars');
select is(has_table_privilege('anon', 'dominio.cotizacion_inicial', 'SELECT'), false, 'anon no lee cotizacion_inicial');
select is(has_table_privilege('anon', 'public.productos_precio_costo', 'SELECT'), false, 'anon no lee la vista de precio y costo');
select is(has_table_privilege('authenticated', 'dominio.cotizacion_inicial', 'DELETE'), false, 'nadie borra cotizacion_inicial');
select ok(
  (select relrowsecurity from pg_class where oid = 'dominio.cotizacion_inicial'::regclass),
  'cotizacion_inicial tiene RLS activado'
);

select * from finish();
