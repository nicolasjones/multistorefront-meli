-- F-REN-01 (MSF-204, épica MSF-120): margen por producto y canal.
-- Cubre FR-001…FR-006 y FR-008 / SC-001: columnas y filas de `analitica.margen_producto_canal`,
-- fórmula (neto, costo, margen, %), conversión USD/ARS con la misma cotización, sin costo / sin
-- cotización / producto o empresa inactivos → sin fila, estados en los bordes (< 0, = 0, = umbral),
-- umbral por defecto y cambiado, rango inválido, idempotencia, evento de actividad, y `anon` /
-- `authenticated` sin acceso a `analitica` (solo el rol de Superset, de solo lectura).
-- `rls_en_toda_tabla` cubre además que la tabla nueva tenga RLS.
begin;

select plan(68);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- E1 Mundo JC · E2 San Javucho (regla +10 %) · E4 pausada (org 1) · E3 (org 2).
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'San Javucho', true),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Pausada', false),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Empresa Dos', true);

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10);

-- Org 1 (dólar 1.000): A1 ARS 10.000 con costo 6.000 · A2 USD 20 con costo USD 10 · A3 sin costo ·
-- A4 costo 9.500 (5 %) · A5 costo 10.000 (0 %) · A6 costo 10.500 (−5 %) · A7 costo 9.000 (10 % justo) ·
-- A8 inactivo. Org 2 (sin cotización): B1 ARS 500 con costo 100 · B2 USD 10 con costo USD 5.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable USB', 'CAB-1', 'USD', 20, true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sin costo', 'SIN-1', 'ARS', 5000, true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Margen bajo', 'BAJ-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Margen cero', 'CER-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Margen negativo', 'NEG-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Margen justo', 'JUS-1', 'ARS', 10000, true),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'INA-1', 'ARS', 10000, false),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado', 'TEC-1', 'ARS', 500, true),
  ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Mouse', 'MOU-1', 'USD', 10, true);

insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6000),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 10),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 9500),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 10000),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 10500),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 9000),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 1000),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 100),
  ('a2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 5);

insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1000);

create temporary table t_ts (clave text primary key, val timestamptz);
grant all on t_ts to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Contrato de la vista (FR-001)
-- ============================================================================

select has_view('analitica', 'margen_producto_canal', 'existe analitica.margen_producto_canal');
select columns_are(
  'analitica', 'margen_producto_canal',
  array['organizacion_id', 'empresa_id', 'empresa_nombre', 'producto_id', 'producto_nombre', 'sku',
        'precio_neto', 'costo', 'comision', 'margen', 'margen_pct', 'estado'],
  'la vista expone exactamente las columnas del contrato'
);

-- ============================================================================
-- Fórmula (FR-002): 10.000 − 6.000 = 4.000 → 40 %, comisión 0
-- ============================================================================

select is(
  (select precio_neto from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  10000.00, 'precio neto sin IVA de la tienda'
);
select is(
  (select costo from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  6000.00, 'costo en pesos'
);
select is(
  (select margen from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  4000.00, 'margen = neto − costo − comisión'
);
select is(
  (select margen_pct from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0.4, 'margen % = margen / neto (40 %)'
);
select is(
  (select comision from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0::numeric, 'la comisión de una tienda es 0'
);
select is(
  (select estado from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'ok', 'margen del 40 % → estado ok'
);

-- Datos de identidad de la fila.
select is(
  (select row(organizacion_id, empresa_nombre, producto_nombre, sku)::text from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  '(11111111-1111-1111-1111-111111111111,"Mundo JC",Joystick,JOY-1)',
  'la fila trae organización, tienda, producto y SKU'
);

-- Conversión USD → ARS con la misma cotización para precio y costo.
select is(
  (select precio_neto from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  20000.00, 'USD 20 × 1.000 = $ 20.000 de neto'
);
select is(
  (select costo from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  10000.00, 'costo USD 10 × 1.000 = $ 10.000 (misma cotización)'
);
select is(
  (select margen_pct from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000002' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  0.5, 'margen del producto en USD: 50 %'
);

-- La regla de precio de la tienda (+10 %) se refleja en el neto: 11.000 − 6.000 = 5.000.
select is(
  (select precio_neto from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  11000.00, 'el neto sale de la regla de precio de cada tienda'
);
select is(
  (select margen from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  5000.00, 'margen de la misma mercadería en otra tienda'
);

-- ============================================================================
-- Sin dato → sin fila (FR-003)
-- ============================================================================

select is(
  (select count(*)::int from analitica.margen_producto_canal where producto_id = 'a1000000-0000-0000-0000-000000000003'),
  0, 'sin costo cargado no hay fila (no cuenta como «con margen calculado»)'
);
select is(
  (select count(*)::int from analitica.margen_producto_canal where producto_id = 'a2000000-0000-0000-0000-000000000002'),
  0, 'producto en USD sin cotización: no se inventa un margen'
);
select is(
  (select count(*)::int from analitica.margen_producto_canal where producto_id = 'a1000000-0000-0000-0000-000000000008'),
  0, 'un producto inactivo no tiene margen'
);
select is(
  (select count(*)::int from analitica.margen_producto_canal where empresa_id = 'e1000000-0000-0000-0000-000000000004'),
  0, 'una tienda pausada no tiene margen'
);
select is(
  (select count(*)::int from analitica.margen_producto_canal where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  12, 'org 1: 6 productos con margen × 2 tiendas activas'
);
select is(
  (select count(*)::int from analitica.margen_producto_canal where organizacion_id = '22222222-2222-2222-2222-222222222222'),
  1, 'org 2: solo el producto en pesos (el de USD no tiene cotización)'
);

-- ============================================================================
-- Estados (FR-004): umbral por defecto 10 %
-- ============================================================================

select is(
  (select estado from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000004' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'bajo', '5 % con umbral 10 % → bajo'
);
select is(
  (select estado from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000005' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'bajo', 'margen exactamente 0 → bajo (no negativo)'
);
select is(
  (select estado from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000006' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'negativo', 'margen < 0 → negativo'
);
select is(
  (select estado from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000007' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'ok', 'margen = umbral (10 % justo) → ok'
);

-- ============================================================================
-- Umbral: configurar (FR-005) y evento de actividad (FR-006)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is(public.leer_umbral_margen_bajo(), 0.10, 'sin fila rige el umbral por defecto (10 %)');

insert into t_ts select 'alta', public.guardar_umbral_margen_bajo(0.15, null);
select isnt((select val from t_ts where clave = 'alta'), null, 'guardar devuelve el updated_at vigente');
select is(public.leer_umbral_margen_bajo(), 0.15, 'el umbral nuevo (15 %) queda leído');

-- Idempotente: repetir lo mismo devuelve lo mismo, sin conflicto ni evento nuevo.
select is(
  public.guardar_umbral_margen_bajo(0.15, null),
  (select val from t_ts where clave = 'alta'),
  'guardar el mismo valor es idempotente (aunque no mande updated_at)'
);

reset role;
select is(
  (select estado from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000007' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'bajo', 'con umbral 15 %, el 10 % pasa a bajo (estados recalculados)'
);
select is(
  (select estado from analitica.margen_producto_canal
    where producto_id = 'a1000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  'ok', 'el 40 % sigue ok con umbral 15 %'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'rentabilidad.umbral_actualizado'),
  1, 'un cambio real deja un evento; repetir el mismo valor no suma'
);
select ok(
  (select bool_and(strpos(detalle, '10 % → 15 %') > 0 and actor_id = 'd1000000-0000-0000-0000-000000000001'
                   and organizacion_id = '11111111-1111-1111-1111-111111111111')
     from registro_actividad where tipo = 'rentabilidad.umbral_actualizado'),
  'el evento registra organización, actor y antes/después'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
insert into t_ts select 'cambio', public.guardar_umbral_margen_bajo(0.20, (select val from t_ts where clave = 'alta'));
select is(public.leer_umbral_margen_bajo(), 0.20, 'segundo cambio con el updated_at leído');
select throws_ok(
  $$select public.guardar_umbral_margen_bajo(0.25, (select val from t_ts where clave = 'alta'))$$,
  '40001', null, 'bloqueo optimista: un updated_at viejo se rechaza'
);
select throws_ok(
  $$select public.guardar_umbral_margen_bajo(0.25, null)$$,
  '40001', null, 'con fila existente, sin updated_at y valor distinto se rechaza'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'rentabilidad.umbral_actualizado'),
  2, 'el segundo cambio suma su evento'
);
select ok(
  exists (select 1 from registro_actividad where tipo = 'rentabilidad.umbral_actualizado' and strpos(detalle, '15 % → 20 %') > 0),
  'el evento del segundo cambio muestra 15 % → 20 %'
);

-- Rango inválido (≤ 0, > 100 %, vacío, demasiados decimales): rechazado con 23514.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_umbral_margen_bajo(0, null)$$, '23514', null, 'umbral 0 % rechazado');
select throws_ok($$select public.guardar_umbral_margen_bajo(-0.05, null)$$, '23514', null, 'umbral negativo rechazado');
select throws_ok($$select public.guardar_umbral_margen_bajo(1.5, null)$$, '23514', null, 'umbral > 100 % rechazado');
select throws_ok($$select public.guardar_umbral_margen_bajo(null, null)$$, '23514', null, 'umbral vacío rechazado');
select throws_ok($$select public.guardar_umbral_margen_bajo(0.12345, null)$$, '23514', null, 'más de 2 decimales en % rechazado');
select lives_ok($$select public.guardar_umbral_margen_bajo(0.20, null)$$, 'repetir el valor vigente sigue siendo idempotente');

-- Org 2 guarda justo el valor por defecto: se crea la fila pero no es un cambio → sin evento.
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select lives_ok($$select public.guardar_umbral_margen_bajo(0.10, null)$$, 'org 2 guarda el 10 % por defecto');
reset role;
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'rentabilidad.umbral_actualizado' and organizacion_id = '22222222-2222-2222-2222-222222222222'),
  0, 'guardar el valor por defecto no es un cambio: sin evento'
);
select is(
  (select umbral_margen_bajo from dominio.rentabilidad_config where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  0.20, 'cada organización tiene su propio umbral (org 1: 20 %)'
);
select is(
  (select estado from analitica.margen_producto_canal
    where producto_id = 'a2000000-0000-0000-0000-000000000001' and empresa_id = 'e2000000-0000-0000-0000-000000000003'),
  'ok', 'el umbral de org 1 no afecta a org 2 (80 % → ok)'
);

-- ============================================================================
-- Acceso (FR-008): solo el rol de Superset lee analitica
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.rentabilidad_config'::regclass),
  true, 'dominio.rentabilidad_config tiene RLS'
);
select is(
  (select relnamespace::regnamespace::text from pg_class where oid = 'dominio.rentabilidad_config'::regclass),
  'dominio', 'esquema declarado: dominio (regla de negocio de la organización)'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'analitica' and c.relkind in ('r', 'p')),
  0, 'analitica no tiene tablas: solo vistas'
);

select ok(not has_schema_privilege('anon', 'analitica', 'USAGE'), 'anon sin uso del esquema analitica');
select ok(not has_schema_privilege('authenticated', 'analitica', 'USAGE'), 'authenticated sin uso del esquema analitica');
select ok(not has_table_privilege('anon', 'analitica.margen_producto_canal', 'SELECT'), 'anon sin select sobre la vista');
select ok(not has_table_privilege('authenticated', 'analitica.margen_producto_canal', 'SELECT'), 'authenticated sin select sobre la vista');

set local role authenticated;
select throws_ok($$select 1 from analitica.margen_producto_canal$$, '42501', null, 'authenticated: permiso denegado al leer la vista');
reset role;
set local role anon;
select throws_ok($$select 1 from analitica.margen_producto_canal$$, '42501', null, 'anon: permiso denegado al leer la vista');
reset role;

select ok(has_table_privilege('superset_analitica', 'analitica.margen_producto_canal', 'SELECT'), 'el rol de Superset lee la vista');
select ok(
  (select not rolcanlogin from pg_roles where rolname = 'superset_analitica'),
  'el rol de Superset nace nologin (la habilita el despliegue)'
);
select ok(
  not has_table_privilege('superset_analitica', 'analitica.margen_producto_canal', 'INSERT')
  and not has_table_privilege('superset_analitica', 'analitica.margen_producto_canal', 'UPDATE')
  and not has_table_privilege('superset_analitica', 'analitica.margen_producto_canal', 'DELETE'),
  'el rol de Superset es de solo lectura'
);
select ok(
  not has_table_privilege('superset_analitica', 'dominio.productos', 'SELECT')
  and not has_table_privilege('superset_analitica', 'dominio.producto_costos', 'SELECT')
  and not has_table_privilege('superset_analitica', 'dominio.rentabilidad_config', 'SELECT')
  and not has_table_privilege('superset_analitica', 'public.reportes', 'SELECT'),
  'el rol de Superset no toca tablas de dominio ni de public'
);
select ok(not has_schema_privilege('superset_analitica', 'dominio', 'USAGE'), 'el rol de Superset no tiene uso del esquema dominio');
select ok(
  not has_function_privilege('superset_analitica', 'analitica.neto_empresa(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('superset_analitica', 'analitica.a_pesos(numeric, text, uuid)', 'EXECUTE'),
  'el rol de Superset no ejecuta las funciones de apoyo por fuera de la vista (solo select)'
);

-- El rol nace nologin y el usuario del runner no es superusuario: se lo hace miembro dentro de la
-- transacción (se revierte). Bajo ese rol no se pueden llamar funciones de pgTAP: se guarda el
-- resultado en un parámetro de sesión y se afirma tras `reset role`.
grant superset_analitica to current_user;
set local role superset_analitica;
select set_config(
  'test.filas_superset',
  (select count(*)::text from analitica.margen_producto_canal where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  true
);
reset role;
select is(
  current_setting('test.filas_superset')::int,
  12, 'el rol de Superset ve las filas de la vista (el filtro por organización lo pone el token)'
);

-- ============================================================================
-- RPC: anon sin ejecución
-- ============================================================================

select ok(not has_function_privilege('anon', 'public.leer_umbral_margen_bajo()', 'EXECUTE'), 'anon no ejecuta leer_umbral_margen_bajo');
select ok(
  not has_function_privilege('anon', 'public.guardar_umbral_margen_bajo(numeric, timestamptz)', 'EXECUTE'),
  'anon no ejecuta guardar_umbral_margen_bajo'
);
select ok(not has_table_privilege('anon', 'dominio.rentabilidad_config', 'SELECT'), 'anon sin privilegios sobre la tabla del umbral');
select ok(
  not has_function_privilege('authenticated', 'analitica.neto_empresa(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'analitica.a_pesos(numeric, text, uuid)', 'EXECUTE'),
  'las funciones de apoyo de analitica no son ejecutables por authenticated'
);
select ok(
  has_function_privilege('authenticated', 'public.leer_umbral_margen_bajo()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.guardar_umbral_margen_bajo(numeric, timestamptz)', 'EXECUTE'),
  'authenticated ejecuta las RPC del umbral (la autorización la hace cada función)'
);

select * from finish();
rollback;
