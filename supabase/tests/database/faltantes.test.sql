-- F-VTA-18 (MSF-201, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes): el registro de
-- faltantes del despacho.
--
-- Cubre T028 (FR-040), T029 (FR-041), T030 (FR-042) y T031/T032 (FR-043):
--   · La tabla `dominio.faltantes_venta`: columnas del contrato, `cantidad_faltante > 0`, un faltante ABIERTO
--     por línea, RLS activada, sin escritura directa y aislamiento por organización y por empresa (FR-040).
--   · `registrar_faltantes_despacho`: cantidad inválida, línea repetida, factura fuera de Armando, permiso
--     (sin la acción `despachar`), conflicto de edición, upsert sin duplicar, todo o nada, paso a Incompleto
--     y actividad `despacho.faltante_registrado` (FR-041).
--   · Al reanudar el armado (Incompleto → Armando) los faltantes abiertos pasan a `resuelto` (FR-042).
--   · `listar_faltantes`: los abiertos con cliente, producto, SKU, cantidad, comprobante, fecha del pedido,
--     «desde» y el stock de hoy; el filtro por tienda, el total, la paginación, la lectura sin `despachar`,
--     `anon` sin acceso y otra organización sin filas (FR-043).
--
-- El aislamiento por tienda se prueba con DOS tiendas de la misma organización (San Javucho y Sucursal Norte):
-- quien tiene Ventas en las dos ve los tres faltantes; quien tiene Ventas en una sola ve solo los de esa.
--
-- El recorrido de RLS de todas las tablas expuestas (`rls_en_toda_tabla.test.sql`) corre aparte y sigue verde:
-- `dominio.faltantes_venta` tiene RLS activada desde T028.
begin;

select no_plan();

-- ============================================================================
-- Datos: dos organizaciones, dos tiendas de una y una de la otra, el equipo y sus roles
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'deposito@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'deposito-dos@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'mostrador@example.com'),
  ('f1000000-0000-0000-0000-000000000005', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000007', 'miembro@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Dos tiendas en la organización Uno (San Javucho y Sucursal Norte): el listado separa los faltantes de cada
-- una y quien tiene Ventas en una sola no ve los de la otra (FR-043).
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sucursal Norte'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El Depósito (f1...002) trabaja en las dos tiendas de la organización; los demás, solo en San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administracion');

-- La empresa activa de cada uno: `ventas` se resuelve por empresa.
insert into public.usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001'),
  ('f1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Control', 'CTR-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true);

create temp table datos as
  select (select id from dominio.depositos
           where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from datos;

-- El depósito principal también sirve a la segunda tienda: sin este vínculo, sus facturas no tendrían
-- depósito de salida (`guardar_lineas_comprobante` busca el principal de la tienda).
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'
  from datos;

-- El trigger `productos_crear_existencias` ya crea la fila de existencias: se actualiza la cantidad.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select p.producto_id, '11111111-1111-1111-1111-111111111111', 100, 0
  from (values
    ('b1000000-0000-0000-0000-000000000001'::uuid),
    ('b1000000-0000-0000-0000-000000000002'::uuid)
  ) p(producto_id)
on conflict (producto_id) do update
   set cantidad = excluded.cantidad, reservado = 0, updated_at = now();

insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p.producto_id, principal, '11111111-1111-1111-1111-111111111111', 100, 0
  from (values
    ('b1000000-0000-0000-0000-000000000001'::uuid),
    ('b1000000-0000-0000-0000-000000000002'::uuid)
  ) p(producto_id)
  cross join datos;

-- ============================================================================
-- Ayudas
-- ============================================================================

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert on comps to public;

-- Factura con dos líneas: la 1 con `p_cantidad` unidades y la 2 con 2. `p_empresa` es la tienda (por defecto,
-- San Javucho): las facturas de la segunda tienda salen de acá.
create function pg_temp.armar(p_clave text, p_cantidad integer default 5, p_empresa uuid default 'a1000000-0000-0000-0000-000000000001') returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(
    'factura', p_empresa, 'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-12-14');
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', p_cantidad),
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000002', 'cantidad', 2)), v_c.updated_at);
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$
  select id from comps where clave = p_clave $$;

-- `updated_at` vigente: es el bloqueo optimista de las RPC de despacho.
create function pg_temp.actualizado(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;

-- Factura creada y confirmada: queda en Sin armar.
create function pg_temp.para_armar(p_clave text, p_cantidad integer default 5, p_empresa uuid default 'a1000000-0000-0000-0000-000000000001') returns void language plpgsql as $$
begin
  perform pg_temp.armar(p_clave, p_cantidad, p_empresa);
  perform public.confirmar_comprobante(pg_temp.id_de(p_clave));
end $$;

-- ============================================================================
-- FR-040 · La tabla de faltantes
-- ============================================================================

-- La tabla vive en el esquema del producto (Principio VII) y tiene las columnas del contrato.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'dominio' and table_name = 'faltantes_venta'
      and column_name in ('id', 'organizacion_id', 'empresa_id', 'comprobante_id', 'linea_orden', 'producto_id',
                          'deposito_id', 'cantidad_faltante', 'estado', 'registrado_por', 'creado_en',
                          'resuelto_en')),
  12, 'la tabla de faltantes tiene las columnas del contrato');

-- RLS activada (Principio VII).
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.faltantes_venta'::regclass),
  true, 'la tabla de faltantes tiene RLS activada');

-- Grants: el navegador solo lee; la escritura es de la RPC.
select is(has_table_privilege('authenticated', 'dominio.faltantes_venta', 'SELECT'), true,
  'authenticated lee los faltantes');
select is(has_table_privilege('authenticated', 'dominio.faltantes_venta', 'INSERT'), false,
  'authenticated no inserta faltantes directo');
select is(has_table_privilege('authenticated', 'dominio.faltantes_venta', 'UPDATE'), false,
  'authenticated no actualiza faltantes directo');
select is(has_table_privilege('authenticated', 'dominio.faltantes_venta', 'DELETE'), false,
  'authenticated no borra faltantes');
select is(has_table_privilege('anon', 'dominio.faltantes_venta', 'SELECT'), false,
  'anon no lee los faltantes');

-- Quién puede ejecutar las funciones de los faltantes.
select is(
  has_function_privilege('authenticated', 'public.registrar_faltantes_despacho(uuid, jsonb, timestamptz)', 'EXECUTE'),
  true, 'authenticated ejecuta registrar_faltantes_despacho');

select is(
  has_function_privilege('anon', 'public.registrar_faltantes_despacho(uuid, jsonb, timestamptz)', 'EXECUTE'),
  false, 'anon no ejecuta registrar_faltantes_despacho');

select is(
  has_function_privilege('authenticated', 'private.resolver_faltantes_al_reanudar()', 'EXECUTE'),
  false, 'authenticated no resuelve los faltantes por su cuenta: solo por el disparador');

-- ============================================================================
-- FR-041 · Registrar los faltantes de una factura
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.para_armar('f1');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f1')),
  'sin_armar', 'la factura confirmada arranca Sin armar');

-- A armar la factura (el Depósito despacha).
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f1'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f1'))),
  'armando', 'el Depósito arma la factura');

-- Registrar el faltante de la línea 1 (3 de las 5 unidades pedidas).
select is(
  (select estado_despacho from public.registrar_faltantes_despacho(
     pg_temp.id_de('f1'), jsonb_build_array(jsonb_build_object('linea_orden', 1, 'cantidad', 3)),
     pg_temp.actualizado('f1'))),
  'incompleto', 'registrar el faltante pasa la factura a Incompleto');

select is(
  (select count(*)::int from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  1, 'el faltante quedó registrado');

select is(
  (select cantidad_faltante from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  3, 'el faltante guarda la cantidad faltante');

select is(
  (select estado from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  'abierto', 'el faltante recién registrado está abierto');

select is(
  (select linea_orden from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  1, 'el faltante guarda la línea');

select is(
  (select producto_id from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  'b1000000-0000-0000-0000-000000000001', 'el faltante guarda el producto de la línea');

select is(
  (select empresa_id from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  'a1000000-0000-0000-0000-000000000001', 'el faltante guarda la tienda de la factura');

select is(
  (select registrado_por from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  'f1000000-0000-0000-0000-000000000002', 'el faltante recuerda quién lo registró');

-- ============================================================================
-- FR-040 · La cantidad siempre es mayor a cero y hay un solo faltante abierto por línea
-- ============================================================================

reset role;

select throws_ok(
  format($$insert into dominio.faltantes_venta
      (organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id, cantidad_faltante, estado)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', %L, 2,
      (select l.producto_id from dominio.comprobantes_venta_lineas l where l.comprobante_id = %L and l.orden = 2),
      (select l.deposito_id from dominio.comprobantes_venta_lineas l where l.comprobante_id = %L and l.orden = 2),
      0, 'abierto')$$,
    pg_temp.id_de('f1'), pg_temp.id_de('f1'), pg_temp.id_de('f1')),
  '23514', null, 'un faltante con cantidad 0 no se puede guardar');

select throws_ok(
  format($$insert into dominio.faltantes_venta
      (organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id, cantidad_faltante, estado)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', %L, 1,
      (select l.producto_id from dominio.comprobantes_venta_lineas l where l.comprobante_id = %L and l.orden = 1),
      (select l.deposito_id from dominio.comprobantes_venta_lineas l where l.comprobante_id = %L and l.orden = 1),
      2, 'abierto')$$,
    pg_temp.id_de('f1'), pg_temp.id_de('f1'), pg_temp.id_de('f1')),
  '23505', null, 'una línea no puede tener dos faltantes abiertos');

-- ============================================================================
-- FR-041 · Volver a registrar la misma línea actualiza el faltante (no lo duplica)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.registrar_faltantes_despacho(
     pg_temp.id_de('f1'), jsonb_build_array(jsonb_build_object('linea_orden', 1, 'cantidad', 4)),
     pg_temp.actualizado('f1'))),
  'incompleto', 'volver a registrar la línea 1 deja la factura en Incompleto');

select is(
  (select count(*)::int from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  1, 'el faltante de la línea 1 se actualiza: no se duplica');

select is(
  (select cantidad_faltante from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1')),
  4, 'el faltante abierto guarda la cantidad nueva');

-- ============================================================================
-- FR-041 · La factura tiene que estar en Armando (o Incompleto) y la lista tiene que ser válida
-- ============================================================================

-- Una factura nueva, en Armando, para probar las validaciones.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.para_armar('f2');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f2'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f2'))),
  'armando', 'la segunda factura queda en Armando');

-- Cantidad 0: inválida.
select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f2'), '[{"linea_orden": 1, "cantidad": 0}]', pg_temp.actualizado('f2')),
  '22023', null, 'una cantidad 0 se rechaza');

-- Cantidad mayor que lo pedido de la línea (5 unidades): inválida.
select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f2'), '[{"linea_orden": 1, "cantidad": 6}]', pg_temp.actualizado('f2')),
  '22023', null, 'una cantidad mayor que lo pedido se rechaza');

-- Cantidad que no es un número: inválida.
select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f2'), '[{"linea_orden": 1, "cantidad": "muchas"}]', pg_temp.actualizado('f2')),
  '22023', null, 'una cantidad que no es un número se rechaza');

-- Línea que no es de la factura: inválida.
select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f2'), '[{"linea_orden": 9, "cantidad": 1}]', pg_temp.actualizado('f2')),
  '22023', null, 'una línea que no es de la factura se rechaza');

-- La misma línea dos veces: inválida.
select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f2'), '[{"linea_orden": 1, "cantidad": 1}, {"linea_orden": 1, "cantidad": 2}]',
    pg_temp.actualizado('f2')),
  '22023', null, 'una línea repetida se rechaza');

-- Lista vacía: inválida.
select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f2'), '[]', pg_temp.actualizado('f2')),
  '22023', null, 'una lista de faltantes vacía se rechaza');

-- Conflictos de edición: un `updated_at` viejo choca (FR-041).
select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f2'), '[{"linea_orden": 1, "cantidad": 1}]', '2026-01-01T00:00:00Z'),
  '40001', null, 'un updated_at viejo da conflicto de edición');

-- Ninguna de esas validaciones dejó un faltante ni movió la factura.
select is(
  (select count(*)::int from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f2')),
  0, 'los intentos inválidos no dejaron ningún faltante');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f2')),
  'armando', 'los intentos inválidos no movieron la factura');

-- Una factura que no está en Armando ni en Incompleto: no se registran faltantes.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.para_armar('f3');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f3')),
  'sin_armar', 'la tercera factura quedó Sin armar');

select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f3'), '[{"linea_orden": 1, "cantidad": 1}]', pg_temp.actualizado('f3')),
  '55000', null, 'una factura que no está en Armando no registra faltantes');

-- ============================================================================
-- FR-041 · Todo o nada: una línea mala deshace el registro entero
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.para_armar('f4');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f4'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f4'))),
  'armando', 'la cuarta factura queda en Armando');

-- La primera línea es válida y la segunda no: no se registra ninguna.
select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f4'), '[{"linea_orden": 1, "cantidad": 2}, {"linea_orden": 2, "cantidad": 99}]',
    pg_temp.actualizado('f4')),
  '22023', null, 'una línea inválida rechaza el registro entero');

select is(
  (select count(*)::int from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f4')),
  0, 'con todo o nada no quedó el faltante de la línea válida');

select is(
  (select estado_despacho from dominio.comprobantes_venta where id = pg_temp.id_de('f4')),
  'armando', 'con todo o nada la factura sigue en Armando');

-- ============================================================================
-- FR-041 · Permisos: sin la acción `despachar` no se registran faltantes
-- ============================================================================

-- Consulta tiene Ventas en lectura pero NO la acción `despachar`.
select pg_temp.como('f1000000-0000-0000-0000-000000000005');

select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f4'), '[{"linea_orden": 1, "cantidad": 1}]', pg_temp.actualizado('f4')),
  '42501', null, 'Consulta no tiene la acción despachar y no registra faltantes');

-- Quien no tiene rol en la tienda tampoco.
select pg_temp.como('f1000000-0000-0000-0000-000000000007');

select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f4'), '[{"linea_orden": 1, "cantidad": 1}]', pg_temp.actualizado('f4')),
  '42501', null, 'quien no accede a la tienda no registra faltantes');

-- Otra organización: la factura no existe para esa sesión.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');

select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f4'), '[{"linea_orden": 1, "cantidad": 1}]', pg_temp.actualizado('f4')),
  'P0002', null, 'otra organización no registra faltantes de esta factura');

-- ============================================================================
-- FR-040 · Aislamiento: otra organización no ve los faltantes
-- ============================================================================

select is(
  (select count(*)::int from dominio.faltantes_venta),
  0, 'otra organización no ve los faltantes de esta factura');

-- ============================================================================
-- FR-042 · Al reanudar el armado los faltantes abiertos se resuelven
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f1'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f1'))),
  'armando', 'reanudar el armado devuelve la factura a Armando');

select is(
  (select estado from dominio.faltantes_venta where comprobante_id = pg_temp.id_de('f1') and linea_orden = 1),
  'resuelto', 'el faltante abierto pasa a resuelto al reanudar el armado');

select ok(
  (select resuelto_en is not null from dominio.faltantes_venta
    where comprobante_id = pg_temp.id_de('f1') and linea_orden = 1),
  'el faltante resuelto guarda el momento del cierre');

-- Un faltante ya resuelto no se vuelve a abrir.
select is(
  (select count(*)::int from dominio.faltantes_venta
    where comprobante_id = pg_temp.id_de('f1') and estado = 'resuelto'),
  1, 'el faltante resuelto queda como historial');

-- ============================================================================
-- FR-041 · La actividad del registro de faltantes
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.registro_actividad where tipo = 'despacho.faltante_registrado'),
  2, 'los registros de faltantes quedaron en la actividad');

select ok(
  exists (select 1 from public.registro_actividad
    where tipo = 'despacho.faltante_registrado' and detalle like '%línea 1: 3 unidades%'),
  'la actividad guarda la línea y la cantidad faltante');

-- ============================================================================
-- FR-043 · `listar_faltantes`: los faltantes abiertos de las empresas accesibles
-- ============================================================================

-- Dos faltantes ABIERTOS para el listado: el de la línea 1 de la quinta factura (Joystick) y el de la línea 2
-- de la segunda (Control). Con dos se puede probar también la paginación.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.para_armar('f5');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f5'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f5'))),
  'armando', 'la quinta factura queda en Armando');

select is(
  (select estado_despacho from public.registrar_faltantes_despacho(
     pg_temp.id_de('f5'), jsonb_build_array(jsonb_build_object('linea_orden', 1, 'cantidad', 2)),
     pg_temp.actualizado('f5'))),
  'incompleto', 'la quinta factura queda Incompleta con un faltante abierto');

-- La segunda factura seguía en Armando: se le registra un faltante de la línea 2.
select is(
  (select estado_despacho from public.registrar_faltantes_despacho(
     pg_temp.id_de('f2'), jsonb_build_array(jsonb_build_object('linea_orden', 2, 'cantidad', 1)),
     pg_temp.actualizado('f2'))),
  'incompleto', 'la segunda factura queda Incompleta con un faltante abierto');

-- La segunda tienda de la misma organización: su propia factura y su propio faltante (FR-043). El Depósito
-- tiene Ventas en las dos tiendas, así que los ve; quien solo tiene San Javucho, no.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.para_armar('f6', 5, 'a1000000-0000-0000-0000-000000000002');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select is(
  (select estado_despacho from public.cambiar_estado_despacho(
     pg_temp.id_de('f6'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('f6'))),
  'armando', 'la factura de la segunda tienda queda en Armando');

select is(
  (select estado_despacho from public.registrar_faltantes_despacho(
     pg_temp.id_de('f6'), jsonb_build_array(jsonb_build_object('linea_orden', 1, 'cantidad', 1)),
     pg_temp.actualizado('f6'))),
  'incompleto', 'la factura de la segunda tienda queda Incompleta con un faltante abierto');

-- El stock de hoy: el Joystick quedó sin stock y el Control tiene unidades.
reset role;
update dominio.existencias set cantidad = 0, reservado = 0
 where producto_id = 'b1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 100, reservado = 0
 where producto_id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- El listado trae los tres faltantes abiertos (dos de San Javucho y uno de Sucursal Norte); el resuelto de la
-- primera factura no se lista.
select is(
  (select count(*)::int from public.listar_faltantes(null, 1, 10)),
  3, 'el listado trae los tres faltantes abiertos de las dos tiendas');

select is(
  (select count(*)::int from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f1')),
  0, 'el faltante resuelto no se lista');

-- La fila del faltante: cliente, producto, SKU, cantidad, línea, comprobante, fecha del pedido y «desde».
select is(
  (select cliente from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  'Cliente Uno', 'el listado trae el cliente de la factura');

select is(
  (select producto from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  'Joystick', 'el listado trae el producto del faltante');

select is(
  (select sku from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  'JOY-1', 'el listado trae el SKU del producto');

select is(
  (select cantidad_faltante from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  2, 'el listado trae la cantidad faltante');

select is(
  (select linea_orden from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  1, 'el listado trae la línea del faltante');

select is(
  (select comprobante from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  (select numero from dominio.comprobantes_venta where id = pg_temp.id_de('f5')),
  'el listado trae el número del comprobante');

select is(
  (select empresa from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  'San Javucho', 'el listado trae la tienda del faltante');

select is(
  (select fecha from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  (select fecha from dominio.comprobantes_venta where id = pg_temp.id_de('f5')),
  'el listado trae la fecha del pedido');

select is(
  (select desde from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  (select creado_en from dominio.faltantes_venta
    where comprobante_id = pg_temp.id_de('f5') and linea_orden = 1),
  'el listado trae la fecha de registro del faltante');

-- «Stock hoy»: el estado y el disponible del producto, por la lectura de Stock existente.
select is(
  (select stock_estado from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  'sin_stock', 'el listado trae el estado del stock de hoy');

select is(
  (select stock_disponible from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f5')),
  0, 'el listado trae el disponible del stock de hoy');

select is(
  (select stock_estado from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f2')),
  'disponible', 'el listado trae el estado del stock de hoy del otro faltante');

select is(
  (select stock_disponible from public.listar_faltantes(null, 1, 10) where comprobante_id = pg_temp.id_de('f2')),
  100, 'el listado trae el disponible del stock de hoy del otro faltante');

-- El total del filtro y la paginación en el servidor. El total va en la columna `filas` de cada fila: se
-- toma con `limit 1` porque el listado devuelve más de una fila (una subconsulta escalar con varias filas
-- es un error en Postgres, no un valor).
select is(
  (select filas from public.listar_faltantes(null, 1, 10) limit 1),
  3::bigint, 'el listado trae el total de filas del filtro');

select is(
  (select count(*)::int from public.listar_faltantes(null, 1, 1)),
  1, 'la primera página trae una fila');

select is(
  (select filas from public.listar_faltantes(null, 2, 1) limit 1),
  3::bigint, 'la segunda página sabe cuántas filas hay en total');

select is(
  (select count(*)::int from public.listar_faltantes(null, 3, 1)),
  1, 'la tercera página trae la última fila');

select is(
  (select count(*)::int from public.listar_faltantes(null, 4, 1)),
  0, 'una página fuera de rango no trae filas');

select is(
  (select count(distinct comprobante_id)::int from (
     select comprobante_id from public.listar_faltantes(null, 1, 1)
     union all
     select comprobante_id from public.listar_faltantes(null, 2, 1)
     union all
     select comprobante_id from public.listar_faltantes(null, 3, 1)) p),
  3, 'las tres páginas cubren los tres faltantes');

-- El filtro por tienda: solo los faltantes de esa tienda, y el total del filtro también es el de esa tienda.
select is(
  (select count(*)::int from public.listar_faltantes('a1000000-0000-0000-0000-000000000001', 1, 10)),
  2, 'el filtro por tienda devuelve los faltantes de esa tienda');

select is(
  (select filas from public.listar_faltantes('a1000000-0000-0000-0000-000000000001', 1, 10) limit 1),
  2::bigint, 'el total del filtro es el de esa tienda');

select is(
  (select count(*)::int from public.listar_faltantes('a1000000-0000-0000-0000-000000000002', 1, 10)),
  1, 'el filtro por la otra tienda devuelve su faltante');

select is(
  (select filas from public.listar_faltantes('a1000000-0000-0000-0000-000000000002', 1, 10) limit 1),
  1::bigint, 'el total del filtro es el de la otra tienda');

-- Una tienda de otra organización: cero filas y ningún error (no se delata que exista).
select is(
  (select count(*)::int from public.listar_faltantes('a2000000-0000-0000-0000-000000000001', 1, 10)),
  0, 'una tienda de otra organización no devuelve filas');

-- Con Ventas en lectura (sin la acción `despachar`) el listado se puede ver: ve los dos faltantes de San
-- Javucho y NO el de Sucursal Norte, a la que no tiene acceso.
select pg_temp.como('f1000000-0000-0000-0000-000000000005');

select is(
  (select count(*)::int from public.listar_faltantes(null, 1, 10)),
  2, 'con Ventas en lectura se ven los faltantes aunque no se pueda despachar');

select is(
  (select count(*)::int from public.listar_faltantes(null, 1, 10)
    where comprobante_id = pg_temp.id_de('f6')),
  0, 'quien solo tiene una tienda no ve los faltantes de la otra');

-- Quien no accede a la tienda no ve sus faltantes.
select pg_temp.como('f1000000-0000-0000-0000-000000000007');

select is(
  (select count(*)::int from public.listar_faltantes(null, 1, 10)),
  0, 'quien no accede a la tienda no ve los faltantes');

-- Otra organización: no ve los faltantes.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.listar_faltantes(null, 1, 10)),
  0, 'otra organización no ve los faltantes');

-- Sin sesión con organización: no hay listado.
reset role;
select set_config('request.jwt.claims', '{}', true);

select throws_ok(
  $$select public.listar_faltantes(null, 1, 10)$$,
  '42501', null, 'sin sesión no hay listado de faltantes');

-- Los permisos de la RPC.
select is(
  has_function_privilege('authenticated', 'public.listar_faltantes(uuid, integer, integer)', 'EXECUTE'),
  true, 'authenticated ejecuta listar_faltantes');

select is(
  has_function_privilege('anon', 'public.listar_faltantes(uuid, integer, integer)', 'EXECUTE'),
  false, 'anon no ejecuta listar_faltantes');

-- ============================================================================
-- `anon` sin acceso
-- ============================================================================

reset role;
set local role anon;

select throws_ok(
  format($$select public.registrar_faltantes_despacho(%L, %L::jsonb, %L::timestamptz)$$,
    pg_temp.id_de('f1'), '[{"linea_orden": 1, "cantidad": 1}]', pg_temp.actualizado('f1')),
  '42501', null, 'anon no registra faltantes');

select throws_ok(
  $$select public.listar_faltantes(null, 1, 10)$$,
  '42501', null, 'anon no lista los faltantes');

reset role;

select * from finish();
rollback;
