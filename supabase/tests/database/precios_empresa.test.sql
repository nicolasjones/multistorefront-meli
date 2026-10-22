-- F-PRE-07 (MSF-172, épica MSF-114): regla de precio por empresa.
-- Cubre FR-008…FR-011 / SC-003: aislamiento entre organizaciones en `precios_empresa`, permisos
-- por rol, redondeo «Al $ 10 más cercano», ajuste + y −, dos empresas con reglas distintas,
-- conflicto de edición, rango del ajuste, evento de actividad y `anon` sin ejecución.
-- `rls_en_toda_tabla` cubre además que la tabla nueva tenga RLS.
begin;

select plan(64);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- E1 Mundo JC · E2 San Javucho · E4 sin regla (org 1) · E3 (org 2).
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Sin Regla'),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- P1: USD 20 → central 29.300 con dólar 1.465 · P2: ARS 1000 (org 1).
-- P3: ARS 500 · P4: USD 10 sin cotización (org 2).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'USD', 20),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 1000),
  ('a2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 500),
  ('a2000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Mouse', 'MOU-1', 'USD', 10);
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1465);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Administrador (org 1): sin regla la empresa es «Igual al central»
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(
  (select central_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  29300.00, 'el central del producto en USD sale del dólar vigente'
);
select is(
  (select neto_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  29300.00, 'empresa sin regla: el neto es igual al central'
);
select is(
  private.precio_neto_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004'),
  29300.00, 'private.precio_neto_empresa: empresa sin regla ≡ igual al central'
);

-- Ajuste +8 % en Mundo JC: 29.300 × 1,08 = 31.644 → 31.640.
select lives_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 8, null)$$,
  'administrador: crea la regla de Mundo JC (+8 %)'
);
select is(
  (select neto_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  31640::numeric, 'ajuste +8 %: 31.644 redondea al $ 10 más cercano (31.640)'
);
select is(
  (select neto_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  1080::numeric, 'ajuste +8 % sobre un producto en pesos'
);
select is(
  private.precio_neto_empresa('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'),
  31640::numeric, 'private.precio_neto_empresa coincide con la vista'
);
select is(
  (select neto_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  29300.00, 'dos empresas: San Javucho sigue igual al central'
);

-- Ajuste −5 % en San Javucho: 29.300 × 0,95 = 27.835 → 27.840 (mitad hacia arriba).
select lives_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000002', 'central_ajuste', -5, null)$$,
  'administrador: crea la regla de San Javucho (−5 %)'
);
select is(
  (select neto_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  27840::numeric, 'ajuste −5 %: 27.835 redondea al $ 10 más cercano (27.840)'
);
select is(
  (select neto_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  950::numeric, 'ajuste −5 % sobre un producto en pesos'
);
select is(
  (select neto_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  31640::numeric, 'dos empresas con reglas distintas: cada una muestra su propio neto'
);

-- Empresa o producto de otra organización: sin precio inventado.
select is(
  private.precio_neto_empresa('a1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003'),
  null, 'empresa de otra organización: sin precio'
);
select is(
  private.precio_neto_empresa('a2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001'),
  null, 'producto de otra organización: sin precio'
);

-- ============================================================================
-- Vista previa (sin guardar) y redondeo
-- ============================================================================

select is(
  (select neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 12.5)
    where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  1130::numeric, 'vista previa: 1.125 redondea hacia arriba al $ 10 más cercano (1.130)'
);
select is(
  (select neto_ars from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central', 50)
    where producto_id = 'a1000000-0000-0000-0000-000000000002'),
  1000.00, 'vista previa con base «Igual al central»: el ajuste no rige'
);
select is(
  (select count(*)::int from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 8)),
  2, 'vista previa: muestra los productos de la organización (solo los suyos)'
);
select is(
  (select ajuste_pct from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  8.000, 'la vista previa no guarda nada'
);
select throws_ok(
  $$select * from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', -100)$$,
  '23514', null, 'vista previa: ajuste −100 % rechazado'
);
select throws_ok(
  $$select * from public.previsualizar_precios_empresa('e2000000-0000-0000-0000-000000000003', 'central', 0)$$,
  'P0002', null, 'vista previa: empresa de otra organización rechazada'
);

-- ============================================================================
-- Rango y formato del ajuste
-- ============================================================================

select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000004', 'central_ajuste', -100, null)$$,
  '23514', null, 'ajuste −100 %: rechazado'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000004', 'central_ajuste', -150, null)$$,
  '23514', null, 'ajuste menor a −100 %: rechazado'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000004', 'central_ajuste', null, null)$$,
  '23514', null, 'ajuste vacío con «Central con ajuste»: rechazado'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000004', 'central_ajuste', 1.2345, null)$$,
  '23514', null, 'ajuste con más de 3 decimales: rechazado'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000004', 'central_ajuste', 20000, null)$$,
  '22003', null, 'ajuste fuera de rango: rechazado'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000004', 'otra', 5, null)$$,
  '23514', null, 'base inválida: rechazada'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e2000000-0000-0000-0000-000000000003', 'central', 0, null)$$,
  'P0002', null, 'empresa de otra organización: rechazada'
);
select is(
  (select count(*)::int from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000004'),
  0, 'los rechazos no dejaron regla guardada'
);

-- ============================================================================
-- Bloqueo optimista e idempotencia
-- ============================================================================

select set_config('prueba.ts_viejo',
  (select updated_at::text from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'), true);

select lives_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 9,
      current_setting('prueba.ts_viejo')::timestamptz)$$,
  'edición con el updated_at vigente: guardada (+9 %)'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 10,
      current_setting('prueba.ts_viejo')::timestamptz)$$,
  '40001', null, 'edición con updated_at viejo: conflicto'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 10, null)$$,
  '40001', null, 'regla existente sin updated_at: conflicto'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000004', 'central_ajuste', 3, now())$$,
  '40001', null, 'empresa sin regla pero con updated_at: conflicto'
);
select is(
  (select ajuste_pct from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  9.000, 'el conflicto no pisó el valor guardado'
);

select set_config('prueba.ts_actual',
  (select updated_at::text from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'), true);
select lives_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 9,
      current_setting('prueba.ts_viejo')::timestamptz)$$,
  'idempotente: repetir lo ya guardado no da conflicto aunque el updated_at sea viejo'
);
select is(
  (select updated_at::text from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  current_setting('prueba.ts_actual'), 'idempotente: updated_at no avanza'
);

-- «Igual al central» deja el ajuste en 0 y el neto vuelve al central.
select lives_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000002', 'central', 99,
      (select updated_at from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000002'))$$,
  'administrador: vuelve San Javucho a «Igual al central»'
);
select is(
  (select ajuste_pct from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  0.000, 'base «Igual al central»: el ajuste queda en 0'
);
select is(
  (select neto_ars from public.precios_empresa_neto
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  29300.00, 'base «Igual al central»: neto = central'
);

-- ============================================================================
-- Evento de actividad (solo ante cambios reales)
-- ============================================================================

reset role;
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'empresa.regla_precio_actualizada' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  2, 'Mundo JC: dos cambios reales (+8 % y +9 %), dos eventos; repetir no suma'
);
select ok(
  (select bool_or(strpos(detalle, 'Mundo JC: Igual al central → Central con ajuste +8 %') > 0)
     from registro_actividad where tipo = 'empresa.regla_precio_actualizada'),
  'el evento registra la empresa, el antes y el después'
);
select ok(
  (select bool_or(strpos(detalle, 'Central con ajuste -5 % → Igual al central') > 0)
     from registro_actividad where tipo = 'empresa.regla_precio_actualizada'),
  'el evento registra la vuelta a «Igual al central»'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'empresa.regla_precio_actualizada' and actor_id is not null),
  4, 'cada evento deja al actor'
);

-- ============================================================================
-- Operador (empresas = ninguno): sin lectura ni escritura
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000004', 'central', 0, null)$$,
  '42501', null, 'operador: no guarda la regla'
);
select throws_ok(
  $$select * from public.previsualizar_precios_empresa('e1000000-0000-0000-0000-000000000001', 'central', 0)$$,
  '42501', null, 'operador: no ve la vista previa'
);
select is((select count(*)::int from dominio.precios_empresa), 0, 'operador: no lee reglas');
select is((select count(*)::int from public.precios_empresa_neto), 0, 'operador: la vista no devuelve filas (sin precio engañoso)');
select throws_ok(
  $$insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct)
    values ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'central', 0)$$,
  '42501', null, 'operador: no inserta directo'
);
reset role;

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');

select is((select count(*)::int from dominio.precios_empresa), 0, 'org 2 no ve las reglas de la org 1');
select is(
  (select count(*)::int from public.precios_empresa_neto where organizacion_id <> '22222222-2222-2222-2222-222222222222'),
  0, 'org 2: la vista solo devuelve su organización'
);
select is(
  (select neto_ars from public.precios_empresa_neto where producto_id = 'a2000000-0000-0000-0000-000000000004'),
  null, 'producto en USD sin cotización: no hay precio'
);
select throws_ok(
  $$select public.guardar_regla_precio_empresa('e1000000-0000-0000-0000-000000000001', 'central_ajuste', 1, null)$$,
  'P0002', null, 'org 2 no edita la regla de una empresa de la org 1'
);
select throws_ok(
  $$insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct)
    values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central', 0)$$,
  '42501', null, 'org 2 no inserta con la organización ajena'
);
select throws_ok(
  $$insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct)
    values ('e1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'central', 0)$$,
  '23503', null, 'FK compuesta: una regla no apunta a una empresa de otra organización'
);
reset role;

-- ============================================================================
-- Administrador: sin DELETE ni cambio de claves
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$delete from dominio.precios_empresa where empresa_id = 'e1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'administrador: no borra reglas (sin DELETE)'
);
select throws_ok(
  $$update dominio.precios_empresa set organizacion_id = '22222222-2222-2222-2222-222222222222'
    where empresa_id = 'e1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'administrador: no cambia la organización de una regla'
);
reset role;

select throws_ok(
  $$insert into dominio.precios_empresa (empresa_id, organizacion_id, redondeo_pesos)
    values ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 5)$$,
  '23514', null, 'el redondeo del lanzamiento es siempre $ 10'
);
select throws_ok(
  $$insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct)
    values ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'central_ajuste', -100)$$,
  '23514', null, 'la tabla también rechaza un ajuste ≤ −100 %'
);

-- ============================================================================
-- anon sin privilegios
-- ============================================================================

select is(has_function_privilege('anon', 'public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz)', 'EXECUTE'), false, 'anon no ejecuta guardar_regla_precio_empresa');
select is(has_function_privilege('authenticated', 'public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz)', 'EXECUTE'), true, 'authenticated ejecuta guardar_regla_precio_empresa');
select is(has_function_privilege('anon', 'public.previsualizar_precios_empresa(uuid, text, numeric, integer)', 'EXECUTE'), false, 'anon no ejecuta previsualizar_precios_empresa');
select is(has_function_privilege('anon', 'private.precio_neto_empresa(uuid, uuid)', 'EXECUTE'), false, 'anon no ejecuta private.precio_neto_empresa');
select is(has_function_privilege('anon', 'private.aplicar_regla_precio(numeric, text, numeric, integer)', 'EXECUTE'), false, 'anon no ejecuta private.aplicar_regla_precio');
select is(has_table_privilege('anon', 'dominio.precios_empresa', 'SELECT'), false, 'anon no lee precios_empresa');
select is(has_table_privilege('anon', 'public.precios_empresa_neto', 'SELECT'), false, 'anon no lee la vista de precios por empresa');

select * from finish();
rollback;
