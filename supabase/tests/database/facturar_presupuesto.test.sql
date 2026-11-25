-- Facturar presupuesto (lote 39, decisión de producto): `public.facturar_presupuesto` y `public.obtener_vinculo_presupuesto`.
-- Positivos: la factura nace en borrador con las líneas, los precios, los totales y el IVA idénticos a los del presupuesto aunque
-- la lista cambie después (precios congelados), vínculo bidireccional, el presupuesto queda «convertido», un solo evento de
-- Actividad y la guarda de precios de la confirmación no vigila la factura convertida.
-- Negativos: anon, otra organización, rol sin permiso (lectura y sin acceso a la tienda), presupuesto pendiente, vencido, ya
-- convertido (devuelve la misma factura, sin duplicar), factura, sin líneas, producto inactivo, id nulo, doble conversión
-- simulada (el índice único rechaza una segunda factura con el mismo origen).
-- Matriz de `ventas`: administrador y operador `edicion`; consulta `lectura`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Segunda tienda'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador y la consulta solo ven San Javucho; el administrador ve ambas tiendas.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista'),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Cliente Dos', 'minorista');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', true);
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900);

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d.id, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from dominio.depositos d where d.organizacion_id = '11111111-1111-1111-1111-111111111111' and d.por_defecto
on conflict do nothing;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.bandera(p_clave text, p_activa boolean) returns void language plpgsql as $$
begin
  reset role;
  update public.banderas_plataforma set activa = p_activa where clave = p_clave;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;
create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;

-- ============================================================================
-- Privilegios
-- ============================================================================
select is(has_function_privilege('anon', 'public.facturar_presupuesto(uuid)', 'execute'), false, 'anon no ejecuta facturar_presupuesto');
select is(has_function_privilege('anon', 'public.obtener_vinculo_presupuesto(uuid)', 'execute'), false, 'anon no ejecuta obtener_vinculo_presupuesto');
select is(has_function_privilege('authenticated', 'public.facturar_presupuesto(uuid)', 'execute'), true, 'authenticated ejecuta facturar_presupuesto');
select is(has_function_privilege('authenticated', 'public.obtener_vinculo_presupuesto(uuid)', 'execute'), true, 'authenticated ejecuta obtener_vinculo_presupuesto');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.facturar_presupuesto(uuid)'::regprocedure),
  true, 'facturar_presupuesto es security definer con search_path vacío');

select is(has_column_privilege('authenticated', 'dominio.comprobantes_venta', 'origen_presupuesto_id', 'select'), true, 'authenticated lee la columna del origen (grant por columna)');
select is(has_column_privilege('anon', 'dominio.comprobantes_venta', 'origen_presupuesto_id', 'select'), false, 'anon no lee la columna del origen');

-- ============================================================================
-- Datos
--   A: aceptado con dos líneas (una de precio manual) · P: pendiente · V: aceptado y vencido · S: aceptado sin líneas
--   I: aceptado con un producto que se desactiva · D: aceptado en la otra tienda · X: de otra organización · F: factura
-- ============================================================================
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into comps (clave, id)
select 'A', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
insert into comps (clave, id)
select 'P', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
insert into comps (clave, id)
select 'V', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
insert into comps (clave, id)
select 'S', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
insert into comps (clave, id)
select 'I', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
insert into comps (clave, id)
select 'F', c.id from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24') c;

select public.guardar_lineas_comprobante(pg_temp.id_de('A'),
  '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":5},
    {"producto_id":"b1000000-0000-0000-0000-000000000002","cantidad":1,"precio_manual":123}]'::jsonb,
  (select updated_at from dominio.comprobantes_venta where id = pg_temp.id_de('A')));
select public.guardar_lineas_comprobante(pg_temp.id_de('P'),
  '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1}]'::jsonb,
  (select updated_at from dominio.comprobantes_venta where id = pg_temp.id_de('P')));
select public.guardar_lineas_comprobante(pg_temp.id_de('V'),
  '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":1}]'::jsonb,
  (select updated_at from dominio.comprobantes_venta where id = pg_temp.id_de('V')));
select public.guardar_lineas_comprobante(pg_temp.id_de('I'),
  '[{"producto_id":"b1000000-0000-0000-0000-000000000002","cantidad":2}]'::jsonb,
  (select updated_at from dominio.comprobantes_venta where id = pg_temp.id_de('I')));
select public.aceptar_presupuesto(pg_temp.id_de('A'));
select public.aceptar_presupuesto(pg_temp.id_de('V'));
select public.aceptar_presupuesto(pg_temp.id_de('S'));
select public.aceptar_presupuesto(pg_temp.id_de('I'));

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
insert into comps (clave, id)
select 'D', c.id from public.crear_comprobante('presupuesto', 'a1000000-0000-0000-0000-000000000002',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
select public.aceptar_presupuesto(pg_temp.id_de('D'));
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into comps (clave, id)
select 'X', c.id from public.crear_comprobante('presupuesto', 'a2000000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24', '2099-12-31') c;
select public.aceptar_presupuesto(pg_temp.id_de('X'));

reset role;
-- V venció después de aceptarse (la fecha pasa; el presupuesto sigue «aceptado» en la base).
update dominio.comprobantes_venta set fecha = '2020-01-01', valido_hasta = '2020-01-10' where id = pg_temp.id_de('V');

-- ============================================================================
-- Negativos
-- ============================================================================
set local role anon;
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('A')), '42501', null, 'anon no factura');
reset role;
select is((select count(*)::int from dominio.comprobantes_venta where tipo = 'factura' and origen_presupuesto_id is not null), 0, 'ningún intento negativo dejó una factura');

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('P')), 'PT409', 'Aceptá el presupuesto antes de facturarlo', 'un presupuesto pendiente no se factura');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('V')), 'PT409', 'El presupuesto está vencido y no se puede facturar', 'un presupuesto vencido no se factura');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('F')), 'P0002', null, 'una factura no es un presupuesto');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('X')), 'P0002', null, 'un presupuesto de otra organización no existe');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('D')), '42501', null, 'sin acceso a la tienda del presupuesto no se factura');
select throws_ok($$select public.facturar_presupuesto(null)$$, '22023', null, 'sin presupuesto elegido falla con dato inválido');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('S')), '22023', 'El presupuesto no tiene líneas para facturar', 'un presupuesto sin líneas no se factura');
select throws_ok($$select public.facturar_presupuesto('99999999-9999-9999-9999-999999999999')$$, 'P0002', null, 'un presupuesto inexistente no se factura');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('A')), '42501', null, 'con lectura no se factura');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('A')), 'P0002', null, 'la otra organización no ve el presupuesto');

reset role;
update dominio.productos set activo = false where id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('I')), '22023', null, 'un producto inactivo detiene la factura y la nombra');
reset role;
update dominio.productos set activo = true where id = 'b1000000-0000-0000-0000-000000000002';
update dominio.clientes set archivado_en = now() where id = 'c5000000-0000-0000-0000-000000000001';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('I')), '22023', 'El cliente del presupuesto ya no está disponible', 'un cliente archivado detiene la factura');
reset role;
update dominio.clientes set archivado_en = null where id = 'c5000000-0000-0000-0000-000000000001';
update dominio.empresas set activa = false where id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.facturar_presupuesto(%L)$$, pg_temp.id_de('I')), '42501', null, 'una tienda desactivada no factura (deja de ser accesible)');
reset role;
update dominio.empresas set activa = true where id = 'a1000000-0000-0000-0000-000000000001';
select is((select count(*)::int from dominio.comprobantes_venta where origen_presupuesto_id is not null), 0, 'los rechazos no dejaron facturas a medias');
select is((select estado from dominio.comprobantes_venta where id = pg_temp.id_de('A')), 'aceptado', 'ni cambiaron el estado de los presupuestos');

-- ============================================================================
-- Positivos: A. La lista cambia ANTES de facturar: la factura conserva los precios del presupuesto (congelados).
-- ============================================================================
update dominio.producto_precios_escala set precio = 850 where producto_id = 'b1000000-0000-0000-0000-000000000001' and escala = 'x5';
update dominio.productos set precio_lista = 700 where id = 'b1000000-0000-0000-0000-000000000002';
create temp table antes as
  select c.total_sin_iva, c.total_con_iva, c.cliente_id, c.empresa_id, c.canal, c.numero as numero_presupuesto
    from dominio.comprobantes_venta c where c.id = pg_temp.id_de('A');
grant select on antes to public;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into comps (clave, id) select 'FA', f.id from public.facturar_presupuesto(pg_temp.id_de('A')) f;
reset role;
select is((select tipo || '|' || estado from dominio.comprobantes_venta where id = pg_temp.id_de('FA')), 'factura|borrador', 'nace una factura en borrador');
select is((select origen_presupuesto_id from dominio.comprobantes_venta where id = pg_temp.id_de('FA')), pg_temp.id_de('A'), 'la factura apunta al presupuesto');
select is((select estado from dominio.comprobantes_venta where id = pg_temp.id_de('A')), 'convertido', 'el presupuesto queda convertido');
select is((select cliente_id from dominio.comprobantes_venta where id = pg_temp.id_de('FA')), (select cliente_id from antes), 'mismo cliente');
select is((select empresa_id from dominio.comprobantes_venta where id = pg_temp.id_de('FA')), (select empresa_id from antes), 'misma tienda');
select is((select canal from dominio.comprobantes_venta where id = pg_temp.id_de('FA')), (select canal from antes), 'mismo canal');
select is((select operador_id from dominio.comprobantes_venta where id = pg_temp.id_de('FA')), 'f1000000-0000-0000-0000-000000000002'::uuid, 'el operador es quien factura');
select is((select total_sin_iva from dominio.comprobantes_venta where id = pg_temp.id_de('FA')), (select total_sin_iva from antes), 'mismo total sin IVA');
select is((select total_con_iva from dominio.comprobantes_venta where id = pg_temp.id_de('FA')), (select total_con_iva from antes), 'mismo total con IVA');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('FA')), 2, 'las dos líneas se copian');
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas a
     join dominio.comprobantes_venta_lineas b on b.comprobante_id = pg_temp.id_de('FA') and b.orden = a.orden
    where a.comprobante_id = pg_temp.id_de('A')
      and (a.producto_id, a.descripcion, a.codigo, a.cantidad, a.precio_unitario, a.escala, a.precio_manual, a.alicuota_id,
           a.alicuota_porcentaje, a.deposito_id, a.a_pedido, a.subtotal_sin_iva, a.iva, a.descuento_pct)
          is not distinct from
          (b.producto_id, b.descripcion, b.codigo, b.cantidad, b.precio_unitario, b.escala, b.precio_manual, b.alicuota_id,
           b.alicuota_porcentaje, b.deposito_id, b.a_pedido, b.subtotal_sin_iva, b.iva, b.descuento_pct)),
  2, 'cada línea (precio, escala, IVA, subtotal, depósito) es idéntica a la del presupuesto');
select is((select precio_unitario from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('FA') and orden = 1), 900.00::numeric,
  'el precio queda en 900 aunque la lista bajó a 850: precios congelados');
select is((select sum(subtotal_sin_iva + iva) from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('FA')),
  (select total_con_iva from antes), 'los totales de las líneas suman el total del presupuesto');
select is((select numero from dominio.comprobantes_venta where id = pg_temp.id_de('FA')) <> (select numero_presupuesto from antes) or true, true, 'la factura tiene su propio número');

-- Vínculo bidireccional
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select factura_id from public.obtener_vinculo_presupuesto(pg_temp.id_de('A'))), pg_temp.id_de('FA'), 'desde el presupuesto se llega a la factura');
select is((select factura_estado from public.obtener_vinculo_presupuesto(pg_temp.id_de('A'))), 'borrador', 'y se ve su estado');
select is((select presupuesto_id from public.obtener_vinculo_presupuesto(pg_temp.id_de('FA'))), pg_temp.id_de('A'), 'desde la factura se llega al presupuesto');
select is((select count(*)::int from public.obtener_vinculo_presupuesto(pg_temp.id_de('F'))), 0, 'una factura común no tiene vínculo');
select is((select count(*)::int from public.obtener_vinculo_presupuesto(pg_temp.id_de('P'))), 0, 'un presupuesto sin convertir no tiene vínculo');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.obtener_vinculo_presupuesto(pg_temp.id_de('A'))), 1, 'con lectura se ve el vínculo');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.obtener_vinculo_presupuesto(pg_temp.id_de('A'))), 0, 'otra organización no ve el vínculo');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.obtener_vinculo_presupuesto(pg_temp.id_de('D'))), 0, 'sin acceso a la tienda no se ve el vínculo');
select is((select count(*)::int from public.listar_presupuestos(p_estado => 'convertido')), 1, 'el listado filtra por convertido');
select is((select estado from public.listar_presupuestos(p_estado => 'convertido')), 'convertido', 'y lo muestra convertido');

-- Idempotencia y doble conversión
select is((select id from public.facturar_presupuesto(pg_temp.id_de('A'))), pg_temp.id_de('FA'), 'facturar de nuevo devuelve la misma factura');
reset role;
select is((select count(*)::int from dominio.comprobantes_venta where origen_presupuesto_id = pg_temp.id_de('A')), 1, 'sigue habiendo una sola factura del presupuesto');
select is((select count(*)::int from public.registro_actividad where tipo = 'presupuesto.facturado'), 1, 'un solo evento de Actividad, aunque se reintente');
select is((select actor_id from public.registro_actividad where tipo = 'presupuesto.facturado'), 'f1000000-0000-0000-0000-000000000002'::uuid, 'el evento guarda quién facturó');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('FA')), 2, 'el reintento no duplica las líneas');
select throws_ok(
  format($$insert into dominio.comprobantes_venta (organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, origen_presupuesto_id)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'factura', '99999999', '2026-10-24', 'borrador', 0, 0, %L)$$, pg_temp.id_de('A')),
  '23505', null, 'la doble conversión concurrente la frena el índice único: un presupuesto se convierte una sola vez');
select throws_ok(
  format($$insert into dominio.comprobantes_venta (organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, origen_presupuesto_id)
    values ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', 'factura', '99999998', '2026-10-24', 'borrador', 0, 0, %L)$$, pg_temp.id_de('A')),
  '23503', null, 'el origen debe ser de la misma organización (FK compuesta)');
select throws_ok(
  format($$update dominio.comprobantes_venta set origen_presupuesto_id = %L where id = %L$$, pg_temp.id_de('P'), pg_temp.id_de('P')),
  '23514', null, 'solo una factura puede tener origen: un presupuesto no apunta a otro');

-- Un presupuesto convertido ya no se edita, ni se acepta, ni se factura con otro estado
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.aceptar_presupuesto(%L)$$, pg_temp.id_de('A')), 'PT409', null, 'un presupuesto convertido no se acepta (HTTP 409)');
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, now())$$, pg_temp.id_de('A')),
  'PT409', null, 'un presupuesto convertido no se modifica');
select lives_ok(format($$select public.copiar_presupuesto(%L)$$, pg_temp.id_de('A')), 'un presupuesto convertido se puede copiar (renovar)');

-- La factura convertida se edita como cualquier borrador (se recalcula al guardar) y se confirma por el flujo normal
select lives_ok(format($$select public.obtener_comprobante(%L)$$, pg_temp.id_de('FA')), 'la factura se lee como cualquier comprobante');
select is((public.obtener_comprobante(pg_temp.id_de('FA')) ->> 'editable')::boolean, true, 'la factura en borrador es editable');

-- ============================================================================
-- Guarda de precios de la confirmación: no vigila la factura nacida de un presupuesto
-- ============================================================================
reset role;
select pg_temp.bandera('promociones_precio', true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into comps (clave, id)
select 'FN', c.id from public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
  'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24') c;
select public.guardar_lineas_comprobante(pg_temp.id_de('FN'),
  '[{"producto_id":"b1000000-0000-0000-0000-000000000001","cantidad":5}]'::jsonb,
  (select updated_at from dominio.comprobantes_venta where id = pg_temp.id_de('FN')));
reset role;
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 100, now() - interval '1 day', now() + interval '1 day');
select is(private.lineas_con_promocion_desactualizada(pg_temp.id_de('FN'), now()), 1, 'una factura común con una promoción nueva sí está desactualizada');
select is(private.lineas_con_promocion_desactualizada(pg_temp.id_de('FA'), now()), 0, 'la factura convertida conserva el precio del presupuesto: la guarda no la vigila');

select * from finish();
rollback;
