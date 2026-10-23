-- F-PRE-15 (MSF-220, épica MSF-114): escalas de precio por cantidad y tipo de cliente.
-- Cubre FR-024…FR-027 / SC-007: aislamiento entre dos organizaciones en `producto_precios_escala`,
-- permisos por rol, escala faltante cae en la lista, escala inválida da error, `precio_para` con
-- regla de empresa e IVA, contrato `tipos_cliente.escala_precio` (tipo simulado «Mayorista» = x5)
-- y `anon` sin ejecución. `rls_en_toda_tabla` cubre además que la tabla nueva tenga RLS.
begin;

select plan(48);

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

-- E1 con regla (+10 %) · E2 sin regla (org 1) · E3 (org 2).
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- Las categorías nacen en 21 % (F-PRE-12): los productos heredan esa alícuota.
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Ajena');

-- P1 ARS 1.000 · P2 USD 10 (dólar a 1.500) · P3 de la org 2.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Auricular', 'AUR-1', 'USD', 10, 'c1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 500, 'c2000000-0000-0000-0000-000000000003');
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1500);

-- Contrato con Clientes y proveedores (FR-027): `tipos_cliente.escala_precio` todavía no existe
-- (es de otra historia); se simula un tipo «Mayorista» = x5 y el consumidor le pasa la escala a precio_para.
create temp table tipos_cliente_simulado (nombre text, escala_precio text);
insert into tipos_cliente_simulado values ('Minorista', 'x1'), ('Mayorista', 'x5');
select set_config('prueba.escala_mayorista',
  (select escala_precio from tipos_cliente_simulado where nombre = 'Mayorista'), true);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura (FR-024)
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.producto_precios_escala'::regclass),
  true, 'producto_precios_escala tiene RLS'
);
select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'dominio.producto_precios_escala'::regclass),
  'dominio', 'producto_precios_escala vive en el esquema dominio (dato de negocio del producto)'
);

-- ============================================================================
-- Administrador (org 1)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', 800, 700, null)$$,
  'administrador: guarda x5 y x10 de Joystick (x50 sin precio)'
);
select is(
  (select count(*)::int from dominio.producto_precios_escala where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2, 'solo quedan filas para las escalas con precio'
);
select lives_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000002', 5, null, null)$$,
  'administrador: guarda x5 de Auricular (USD)'
);

-- Escala pedida con precio: el de la escala, con IVA (21 %) y sin regla de empresa (E2).
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x1')),
  1000.00, 'x1 = precio de lista: neto 1.000'
);
select is(
  (select final from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x1')),
  1210.00, 'x1: final al 21 % = 1.210'
);
select is(
  (select escala_usada from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002')),
  'x1', 'sin indicar escala se usa x1'
);
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x5')),
  800.00, 'x5: neto de la escala 800'
);
select is(
  (select final from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x5')),
  968.00, 'x5: final al 21 % = 968'
);
select is(
  (select escala_usada from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x5')),
  'x5', 'x5: la escala usada es x5'
);

-- Escala sin precio cargado: cae en la lista y lo indica (US4-2).
select is(
  (select escala_usada from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x50')),
  'x1', 'x50 sin precio: la escala usada es x1 (lista)'
);
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x50')),
  1000.00, 'x50 sin precio: neto = precio de lista'
);

-- Con regla de empresa (+10 %, redondeo a $ 10) e IVA (US4-1, US4-4).
select lives_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 10, null)$$,
  'administrador: Mundo JC con ajuste +10 %'
);
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'x10')),
  770.00, 'x10 con regla de la empresa: 700 × 1,10 = 770'
);
select is(
  (select final from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'x10')),
  932.00, 'x10 con regla e IVA: 770 × 1,21 = 931,7 → 932'
);
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'x1')),
  1100.00, 'x1 con regla de la empresa: 1.000 × 1,10 = 1.100'
);

-- Moneda USD: el precio de la escala se convierte con el dólar (5 USD × 1.500).
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'x5')),
  7500.00, 'USD: x5 = 5 USD × 1.500 = 7.500'
);
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'x1')),
  15000.00, 'USD: x1 = lista 10 USD × 1.500 = 15.000'
);
select is(
  (select final from private.precio_para('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'x5')),
  9075.00, 'USD: x5 con IVA 21 % = 9.075'
);

-- Escala inexistente: error claro, no un precio (US4-3).
select throws_ok(
  $$select * from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x7')$$,
  '22023', 'La escala x7 no existe: usá x1, x5, x10 o x50', 'una escala inexistente (x7) da error claro'
);

-- Contrato con Clientes y proveedores (FR-027): Mayorista = x5.
select is(
  current_setting('prueba.escala_mayorista'), 'x5', 'tipo simulado «Mayorista» usa la escala x5'
);
select is(
  (select neto from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002',
      current_setting('prueba.escala_mayorista'))),
  800.00, 'Mayorista: precio_para con su escala devuelve el precio de x5'
);

-- Aislamiento en precio_para: producto o empresa de otra organización no devuelven filas.
select is(
  (select count(*)::int from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', 'x5')),
  0, 'una empresa de otra organización no devuelve precio'
);
select is(
  (select count(*)::int from private.precio_para('a2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'x5')),
  0, 'un producto de otra organización no devuelve precio'
);

-- Validaciones de la RPC.
select throws_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', -1, null, null)$$,
  '23514', null, 'un precio negativo se rechaza'
);
select throws_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', 10.123, null, null)$$,
  '23514', null, 'más de 2 decimales se rechaza'
);
select throws_ok(
  $$select public.guardar_precios_escala('a2000000-0000-0000-0000-000000000003', 100, null, null)$$,
  'P0002', null, 'no guarda escalas de un producto de otra organización'
);

-- Idempotencia: guardar lo mismo no toca la fila.
select set_config('prueba.escala_ts',
  (select updated_at::text from dominio.producto_precios_escala
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and escala = 'x5'), true);
select lives_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', 800, 700, null)$$,
  'repetir los mismos precios es idempotente'
);
select is(
  (select updated_at::text from dominio.producto_precios_escala
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and escala = 'x5'),
  current_setting('prueba.escala_ts'), 'idempotente: la fila no se toca'
);

-- Quitar una escala (precio nulo) vuelve a la lista.
select lives_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', 800, null, null)$$,
  'administrador: quita el precio de x10'
);
select is(
  (select escala_usada from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x10')),
  'x1', 'x10 quitada: cae en la lista'
);
reset role;

-- ============================================================================
-- Evento de actividad: solo ante cambios reales
-- ============================================================================

select is(
  (select count(*)::int from registro_actividad
    where tipo = 'producto.precio_actualizado' and detalle like 'Cambió el precio de la escala%'),
  4, 'cuatro cambios reales (x5 y x10 de Joystick, x5 de Auricular, x10 quitada); repetir no suma'
);

-- ============================================================================
-- Operador (productos = edición, empresas = ninguno)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', 800, null, null)$$,
  'operador: edita productos, puede guardar escalas'
);
select is(
  (select count(*)::int from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'x5')),
  0, 'operador (sin sección empresas): precio_para no devuelve un precio engañoso'
);
reset role;

-- ============================================================================
-- Consulta (productos = lectura)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from dominio.producto_precios_escala),
  3, 'consulta: ve las escalas de su organización (x10 quitada queda con precio nulo)'
);
select throws_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', 1, 1, 1)$$,
  '42501', null, 'consulta: no guarda escalas'
);
select results_eq(
  $$with u as (update dominio.producto_precios_escala set precio = 1 returning 1) select count(*)::int from u$$,
  $$values (0)$$, 'consulta: el UPDATE directo no toca ninguna fila'
);
select throws_ok(
  $$insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio)
    values ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'x10', 1)$$,
  '42501', null, 'consulta: el INSERT directo se rechaza'
);
select throws_ok(
  $$delete from dominio.producto_precios_escala$$,
  '42501', null, 'nadie borra escalas desde la app (sin DELETE)'
);
reset role;

-- ============================================================================
-- Aislamiento de la otra organización
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.producto_precios_escala),
  0, 'org 2 no ve las escalas de la org 1'
);
select throws_ok(
  $$select public.guardar_precios_escala('a1000000-0000-0000-0000-000000000001', 1, 1, 1)$$,
  'P0002', null, 'org 2 no guarda escalas de un producto de la org 1'
);
select is(
  (select count(*)::int from private.precio_para('a1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', 'x5')),
  0, 'org 2 no consulta el precio de un producto de la org 1'
);
reset role;

-- ============================================================================
-- anon sin privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.guardar_precios_escala(uuid, numeric, numeric, numeric)', 'EXECUTE'), false, 'anon no ejecuta guardar_precios_escala');
select is(has_function_privilege('anon', 'private.precio_para(uuid, uuid, text)', 'EXECUTE'), false, 'anon no ejecuta private.precio_para');
select is(has_table_privilege('anon', 'dominio.producto_precios_escala', 'SELECT'), false, 'anon no lee producto_precios_escala');
select is(has_table_privilege('anon', 'dominio.producto_precios_escala', 'INSERT'), false, 'anon no escribe producto_precios_escala');
select is(has_table_privilege('authenticated', 'dominio.producto_precios_escala', 'DELETE'), false, 'authenticated no tiene DELETE en producto_precios_escala');

select * from finish();
rollback;
