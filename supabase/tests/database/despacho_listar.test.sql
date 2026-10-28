-- F-VTA-17 (MSF-183, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes): el listado del tablero
-- de despacho `public.listar_despacho` (T021, FR-030; SC-006).
--
-- Cubre: facturas confirmadas no anuladas (borradores, presupuestos y anuladas fuera), búsqueda por cliente o
-- número, filtro de estado y de empresa, paginación, conteos por estado, `puede_despachar` por fila resuelto en la
-- EMPRESA de la factura, aislamiento por organización y por empresa, `ninguno` sin acceso y `anon` sin ejecutar.
--
-- El aislamiento por tienda se prueba con DOS tiendas de la misma organización (San Javucho y Sucursal Norte).
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

-- Segundo cliente, para probar la búsqueda por cliente.
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Mariángeles Pérez', 'minorista', null);

-- Un transporte de la tienda 1 para probar la columna de transporte y guía.
insert into dominio.transportes (id, organizacion_id, nombre, tipo, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Expreso Uno', 'expreso', true);

-- Factura confirmada de un cliente a elección (para probar la búsqueda por cliente).
create function pg_temp.para_armar_de(p_clave text, p_cliente uuid) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(
    'factura', 'a1000000-0000-0000-0000-000000000001', p_cliente, 'mostrador', '2026-12-14');
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(
    jsonb_build_object('producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 5)), v_c.updated_at);
  perform public.confirmar_comprobante(v_c.id);
end $$;

-- Número de una factura (las tablas se leen con la empresa activa, no con la del comprobante).
create function pg_temp.numero_de(p_clave text) returns text language sql security definer as $$
  select numero from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;

-- ============================================================================
-- Datos: facturas en distintos estados, en las dos tiendas
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.para_armar('a1');                                        -- San Javucho · Sin armar
select pg_temp.para_armar_de('a2', 'c5000000-0000-0000-0000-000000000002'); -- San Javucho · Armando
select pg_temp.para_armar('a3');                                        -- San Javucho · Anulada
select pg_temp.para_armar('b1', 5, 'a1000000-0000-0000-0000-000000000002'); -- Sucursal Norte · Sin armar
select pg_temp.armar('borrador');                                       -- factura sin confirmar
insert into comps (clave, id)
select 'presupuesto', (public.crear_comprobante(
  'presupuesto', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-12-14')).id;

-- a2 pasa a Armando con su responsable.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select public.cambiar_estado_despacho(
  pg_temp.id_de('a2'), 'armando', 'f1000000-0000-0000-0000-000000000002', pg_temp.actualizado('a2'));

-- a3 se anula.
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select public.anular_comprobante(pg_temp.id_de('a3'), 'Error de carga', pg_temp.actualizado('a3'));

-- El transporte y la guía de a1 (como el dueño de los datos: no se prueba acá la RPC de envío, que es de F-VTA-16).
reset role;
update dominio.comprobantes_venta
   set transporte_id = 'e1000000-0000-0000-0000-000000000001', guia = 'GUIA-77', fecha_envio = '2026-12-20'
 where id = pg_temp.id_de('a1');

-- ============================================================================
-- Permisos de ejecución
-- ============================================================================

select is(has_function_privilege('authenticated', 'public.listar_despacho(text, text, uuid, integer, integer)', 'EXECUTE'),
  true, 'authenticated ejecuta listar_despacho');
select is(has_function_privilege('anon', 'public.listar_despacho(text, text, uuid, integer, integer)', 'EXECUTE'),
  false, 'anon no ejecuta listar_despacho');

-- ============================================================================
-- FR-030 · Qué entra al tablero
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');

-- El Administrador ve las facturas confirmadas no anuladas de las dos tiendas: a1, a2 y b1. Quedan fuera la
-- anulada (a3), el borrador y el presupuesto.
select is(
  (select count(*)::int from public.listar_despacho() where id is not null),
  3, 'entran las tres facturas confirmadas no anuladas');

select is(
  (select count(*)::int from public.listar_despacho() where id = pg_temp.id_de('a3')),
  0, 'una factura anulada no entra al tablero');

select is(
  (select count(*)::int from public.listar_despacho() where id in (pg_temp.id_de('borrador'), pg_temp.id_de('presupuesto'))),
  0, 'un borrador y un presupuesto no entran al tablero');

select is(
  (select filas from public.listar_despacho() limit 1),
  3::bigint, '`filas` es el total del filtro actual');

-- Los datos de la fila: estado, responsable, transporte y guía.
select is(
  (select estado_despacho from public.listar_despacho() where id = pg_temp.id_de('a1')),
  'sin_armar', 'a1 está Sin armar');
select is(
  (select transporte || '|' || guia from public.listar_despacho() where id = pg_temp.id_de('a1')),
  'Expreso Uno|GUIA-77', 'la fila trae el transporte y la guía');
select is(
  (select fecha_envio from public.listar_despacho() where id = pg_temp.id_de('a1')),
  '2026-12-20'::date, 'la fila trae la fecha de envío');
select is(
  (select armo is not null from public.listar_despacho() where id = pg_temp.id_de('a2')),
  true, 'la fila trae quién armó');
select is(
  (select armo from public.listar_despacho() where id = pg_temp.id_de('a1')),
  null, 'una factura sin armar no tiene responsable');
select is(
  (select empresa from public.listar_despacho() where id = pg_temp.id_de('b1')),
  'Sucursal Norte', 'la fila trae la tienda');
select is(
  (select cliente from public.listar_despacho() where id = pg_temp.id_de('a2')),
  'Mariángeles Pérez', 'la fila trae el cliente');

-- ============================================================================
-- FR-030 · Conteos por estado
-- ============================================================================

select is(
  (select conteos from public.listar_despacho() limit 1),
  '{"sin_armar": 2, "armando": 1}'::jsonb, 'los conteos por estado cuentan las facturas del tablero');

-- Con el filtro de estado los conteos no se vacían: siguen siendo los de la empresa y la búsqueda.
select is(
  (select conteos from public.listar_despacho(null, 'armando') limit 1),
  '{"sin_armar": 2, "armando": 1}'::jsonb, 'elegir un estado no cambia los conteos');
select is(
  (select count(*)::int from public.listar_despacho(null, 'armando') where id is not null),
  1, 'el filtro de estado deja solo las facturas en ese estado');

-- Un filtro sin resultados devuelve una fila sin id con los conteos (la pantalla no los pierde).
select is(
  (select count(*)::int from public.listar_despacho(null, 'entregado')),
  1, 'un filtro sin resultados devuelve una sola fila');
select is(
  (select id from public.listar_despacho(null, 'entregado')),
  null, 'esa fila no trae id');
select is(
  (select filas from public.listar_despacho(null, 'entregado')),
  0::bigint, 'esa fila trae `filas` en 0');
select is(
  (select conteos from public.listar_despacho(null, 'entregado')),
  '{"sin_armar": 2, "armando": 1}'::jsonb, 'esa fila conserva los conteos');

select throws_ok(
  $$select * from public.listar_despacho(null, 'inventado')$$,
  '22023', null, 'un estado desconocido se rechaza');

-- ============================================================================
-- FR-030 · Búsqueda por cliente o número
-- ============================================================================

select is(
  (select count(*)::int from public.listar_despacho('mariangeles') where id is not null),
  1, 'la búsqueda por cliente ignora tildes y mayúsculas');
select is(
  (select id from public.listar_despacho('mariangeles')),
  pg_temp.id_de('a2'), 'la búsqueda por cliente encuentra la factura de ese cliente');
select is(
  (select count(*)::int from public.listar_despacho(pg_temp.numero_de('b1')) where id = pg_temp.id_de('b1')),
  1, 'la búsqueda por número encuentra la factura');
select is(
  (select count(*)::int from public.listar_despacho('%') where id is not null),
  0, 'el texto de búsqueda es literal: % no es un comodín');
select is(
  (select conteos from public.listar_despacho('mariangeles') limit 1),
  '{"armando": 1}'::jsonb, 'los conteos respetan la búsqueda');

-- ============================================================================
-- FR-030 · Filtro de empresa y paginación
-- ============================================================================

select is(
  (select count(*)::int from public.listar_despacho(null, null, 'a1000000-0000-0000-0000-000000000002') where id is not null),
  1, 'el filtro de empresa deja solo la tienda elegida');
select is(
  (select conteos from public.listar_despacho(null, null, 'a1000000-0000-0000-0000-000000000002') limit 1),
  '{"sin_armar": 1}'::jsonb, 'los conteos respetan la empresa');

select is(
  (select count(*)::int from public.listar_despacho(null, null, null, 1, 2) where id is not null),
  2, 'la primera página trae el tamaño pedido');
select is(
  (select count(*)::int from public.listar_despacho(null, null, null, 2, 2) where id is not null),
  1, 'la segunda página trae el resto');
select is(
  (select filas from public.listar_despacho(null, null, null, 2, 2) limit 1),
  3::bigint, '`filas` es el total, no el de la página');
select is(
  (select count(*)::int from public.listar_despacho(null, null, null, 9, 2) where id is not null),
  0, 'una página fuera de rango no trae facturas');
select is(
  (select conteos from public.listar_despacho(null, null, null, 9, 2) limit 1),
  '{"sin_armar": 2, "armando": 1}'::jsonb, 'una página fuera de rango conserva los conteos');

-- ============================================================================
-- Aislamiento por empresa
-- ============================================================================

-- Mostrador tiene Ventas solo en San Javucho: ve a1 y a2, nunca la factura de Sucursal Norte.
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from public.listar_despacho() where id is not null),
  2, 'quien tiene Ventas en una sola tienda ve solo sus facturas');
select is(
  (select count(*)::int from public.listar_despacho() where id = pg_temp.id_de('b1')),
  0, 'no ve la factura de la otra tienda');
select is(
  (select count(*)::int from public.listar_despacho(null, null, 'a1000000-0000-0000-0000-000000000002') where id is not null),
  0, 'pedir una tienda ajena devuelve cero filas, no un error');
select is(
  (select conteos from public.listar_despacho() limit 1),
  '{"sin_armar": 1, "armando": 1}'::jsonb, 'los conteos no cuentan la tienda ajena');

-- puede_despachar: se resuelve en la empresa de cada factura. El Depósito despacha en las dos tiendas;
-- Consulta (lectura) lee pero no despacha.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.listar_despacho() where puede_despachar),
  3, 'el Depósito puede despachar las tres facturas');

select pg_temp.como('f1000000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.listar_despacho() where id is not null),
  2, 'Consulta lee las facturas de su tienda');
select is(
  (select count(*)::int from public.listar_despacho() where puede_despachar),
  0, 'Consulta (lectura) no puede despachar ninguna');

-- Un Depósito de la segunda tienda sin acción en la primera: puede_despachar sigue a la empresa de la factura,
-- no a la empresa activa. El Depósito (...002) tiene como activa San Javucho y trabaja también en Norte.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(
  (select puede_despachar from public.listar_despacho() where id = pg_temp.id_de('b1')),
  true, 'puede_despachar de una factura de otra tienda sigue al rol en ESA tienda');

-- ============================================================================
-- Aislamiento por organización y `ninguno` sin acceso
-- ============================================================================

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.listar_despacho() where id is not null),
  0, 'otra organización no ve ninguna factura');

-- El miembro no tiene Ventas en ninguna tienda (`ninguno`): resultado vacío, sin error.
select pg_temp.como('f1000000-0000-0000-0000-000000000007');
select is(
  (select count(*)::int from public.listar_despacho() where id is not null),
  0, 'sin Ventas (ninguno) no se ve ninguna factura');
select is(
  (select filas from public.listar_despacho()),
  0::bigint, 'sin Ventas el total es cero');

-- ============================================================================
-- anon
-- ============================================================================

reset role;
set local role anon;
select throws_ok(
  $$select * from public.listar_despacho()$$,
  '42501', null, 'anon no lista el despacho');

reset role;

select * from finish();
rollback;
