-- MSF-176 · Tienda compra y cuentas, historia A «Mi cuenta» (F-CLI-20 · MSF-452), T014. FR-003 a FR-006, FR-011, FR-014, D-10;
-- amenazas 3.1 a 3.6; escenarios A-1 a A-5 y A-7.
--   * `publico.mis_compras_por_dominio`: solo comprobantes del cliente y de la tienda (cualquier canal), sin borradores,
--     notas de crédito con signo negativo, estado público derivado (factura `deuda`/`cobrado`/… → confirmada; presupuesto
--     vencido por `valido_hasta` < hoy en Buenos Aires), cursor (fecha, id) que solo ordena, límite acotado a 1–50,
--     suspensión inmediata, bandera apagada = `sin_acceso`.
--   * `publico.mi_compra_por_dominio`: IDOR (id de otro cliente, de otra tienda, de otra organización, un borrador y un id
--     inexistente dan la MISMA respuesta `no_encontrada`), lista blanca exacta por claves (ni costo, margen, descuento,
--     precio manual, depósito ni operador).
--   * Grants: `anon` sin execute; `authenticated` con execute; `security definer` con `search_path = ''`; ninguna recibe
--     cliente, cuenta, empresa ni organización.
begin;

select plan(85);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'mayorista@example.com'),
  ('f3000000-0000-0000-0000-000000000002', 'minorista@example.com'),
  ('f3000000-0000-0000-0000-000000000003', 'suspendida@example.com'),
  ('f3000000-0000-0000-0000-000000000004', 'sin-compras@example.com'),
  ('f3000000-0000-0000-0000-000000000005', 'muchas@example.com'),
  ('f3000000-0000-0000-0000-000000000006', 'empates@example.com'),
  ('f3000000-0000-0000-0000-000000000007', 'panel-uno@example.com'),
  ('f3000000-0000-0000-0000-000000000008', 'panel-dos@example.com'),
  ('f3000000-0000-0000-0000-000000000009', 'cliente-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f3000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f3000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'his-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'his-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'his-x.ejemplo.com');

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 920, 'Mayorista', 'my@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 921, 'Minorista', 'mn@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 922, 'Suspendida', 'su@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 923, 'Sin compras', 'sc@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 924, 'Muchas compras', 'mc@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 925, 'Empates de fecha', 'em@example.com', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 920, 'Cliente Dos', 'c2@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000003', 'suspendida'),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000004', 'activa'),
  ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000005', 'activa'),
  ('ca000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000006', 'activa'),
  ('ca000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000009', 'activa');

update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';

-- Comprobantes del mayorista en A (todos los estados y canales). Fechas relativas a «hoy» en Buenos Aires.
-- id fijo con el sufijo del orden para que el orden (fecha desc, id desc) sea predecible.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, canal, valido_hasta, operador_id)
values
  -- facturas: cualquier estado confirmado o posterior se ve «confirmada»; cobro y despacho no se exponen
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000001', private.hoy_argentina() - 20, 'deuda', 1000, 1210, 'mostrador', null, 'f3000000-0000-0000-0000-000000000007'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000002', private.hoy_argentina() - 19, 'cobrado', 2000, 2420, 'tienda_online', null, null),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000003', private.hoy_argentina() - 18, 'confirmada', 3000, 3630, 'telefono_whatsapp', null, null),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000004', private.hoy_argentina() - 17, 'en_proceso', 4000, 4840, null, null, null),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000005', private.hoy_argentina() - 16, 'armando', 5000, 6050, null, null, null),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000006', private.hoy_argentina() - 15, 'incompleto', 6000, 7260, null, null, null),
  ('d1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000007', private.hoy_argentina() - 14, 'anulada', 7000, 8470, null, null, null),
  ('d1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000008', private.hoy_argentina() - 13, 'borrador', 8000, 9680, null, null, null),
  -- presupuestos
  ('d1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000011', private.hoy_argentina() - 5, 'pendiente', 100, 121, 'tienda_online', private.hoy_argentina() + 5, null),
  ('d1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000012', private.hoy_argentina() - 4, 'pendiente', 200, 242, 'mostrador', null, null),
  ('d1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000013', private.hoy_argentina() - 10, 'pendiente', 300, 363, 'mostrador', private.hoy_argentina() - 1, null),
  ('d1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000014', private.hoy_argentina() - 3, 'aceptado', 400, 484, 'mostrador', null, null),
  ('d1000000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000015', private.hoy_argentina() - 2, 'anulada', 500, 605, 'mostrador', null, null),
  ('d1000000-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000016', private.hoy_argentina() - 1, 'borrador', 600, 726, 'mostrador', null, null),
  -- presupuesto que vence hoy: todavía no está vencido
  ('d1000000-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'presupuesto', '00000017', private.hoy_argentina() - 1, 'pendiente', 700, 847, 'mostrador', private.hoy_argentina(), null),
  -- del mayorista en B (otra tienda de la misma organización), de otro cliente en A y de otra organización
  ('d1000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'factura', '00000021', private.hoy_argentina() - 6, 'cobrado', 9100, 11011, 'mostrador', null, null),
  ('d1000000-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'factura', '00000022', private.hoy_argentina() - 6, 'cobrado', 9200, 11132, 'mostrador', null, null),
  ('d2000000-0000-0000-0000-000000000023', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'factura', '00000023', private.hoy_argentina() - 6, 'cobrado', 9300, 11253, 'mostrador', null, null);
-- Nota de crédito de la factura 1 (importe con signo negativo en la lista)
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, canal, comprobante_origen_id, nc_tipo, nc_concepto)
values
  ('d1000000-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'nota_credito', '00000031', private.hoy_argentina() - 1, 'confirmada', 100, 121, 'mostrador', 'd1000000-0000-0000-0000-000000000001', 'devolucion_importe', 'Devolución parcial');

-- 60 facturas de un cliente (para el tope de 50 por llamada).
insert into dominio.comprobantes_venta
  (organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, canal)
select '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005',
       'factura', 'M' || lpad(n::text, 7, '0'), private.hoy_argentina() - n, 'cobrado', 100, 121, 'mostrador'
  from generate_series(1, 60) n;

-- Nueve facturas del MISMO día dadas de alta en orden mezclado: el desempate por id desc no puede depender del orden físico.
insert into dominio.comprobantes_venta
  (id, organizacion_id, empresa_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva, canal)
select ('d6000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
       'c1000000-0000-0000-0000-000000000006', 'factura', 'T' || n, private.hoy_argentina() - 30, 'cobrado', 10 * n, 12 * n, 'mostrador'
  from generate_series(1, 9) n
 order by (n * 4) % 9, n;

-- Líneas del presupuesto 11 y de la factura 1, con TODO lo interno (costo, descuento, precio manual) que no debe salir.
insert into dominio.comprobantes_venta_lineas
  (organizacion_id, comprobante_id, orden, descripcion, codigo, cantidad, precio_unitario, escala, precio_manual,
   alicuota_porcentaje, a_pedido, subtotal_sin_iva, iva, descuento_pct, sin_stock, costo_unitario, cotizacion)
values
  ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000011', 2, 'Segundo producto', 'SKU-2', 1, 40, 'x1', true, 21, true, 40, 8.4, 15, true, 12.5, 1200),
  ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000011', 1, 'Primer producto', 'SKU-1', 3, 20, 'x1', false, 21, false, 60, 12.6, 10, true, 7.25, null),
  ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001', 1, 'Producto de la factura', null, 2, 500, 'x5', false, 21, false, 1000, 210, 0, true, 300, null),
  ('11111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000031', 1, 'Devolución de la factura', 'SKU-NC', 1, 100, 'x1', false, 21, false, 100, 21, 0, true, null, null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- ============================================================================
-- Privilegios y diseño
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'publico.mis_compras_por_dominio(text, date, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'publico.mi_compra_por_dominio(text, uuid)', 'execute'),
  'anon no ejecuta mis_compras_por_dominio ni mi_compra_por_dominio');
select ok(
  has_function_privilege('authenticated', 'publico.mis_compras_por_dominio(text, date, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'publico.mi_compra_por_dominio(text, uuid)', 'execute'),
  'authenticated ejecuta ambas (grant explícito)');
select ok(
  not has_function_privilege('anon', 'private.estado_publico_comprobante(text, text, date)', 'execute')
  and not has_function_privilege('authenticated', 'private.estado_publico_comprobante(text, text, date)', 'execute'),
  'el helper interno no es ejecutable por la API');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'publico'::regnamespace
      and p.proname in ('mis_compras_por_dominio', 'mi_compra_por_dominio')
      and p.prosecdef and p.proconfig = array['search_path=""']),
  2, 'ambas son security definer con search_path vacío');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'publico'::regnamespace
      and p.proname in ('mis_compras_por_dominio', 'mi_compra_por_dominio')
      and (p.proargnames && array['cliente_id', 'cuenta_id', 'cuenta_cliente_id', 'empresa_id', 'organizacion_id'])),
  0, 'ninguna recibe cliente, cuenta, empresa ni organización: todo sale de la sesión');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'dominio' and tablename = 'comprobantes_venta'
            and indexname = 'comprobantes_venta_cliente_empresa_fecha_idx'
            and indexdef like '%(cliente_id, empresa_id, fecha DESC, id DESC)%'),
  'existe el índice de apoyo (cliente_id, empresa_id, fecha desc, id desc)');

-- ============================================================================
-- Llamadas (se guardan; las verificaciones corren después)
-- ============================================================================
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
insert into res values
  ('lista', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 50)),
  ('lista_b', publico.mis_compras_por_dominio('his-b.ejemplo.com', null, null, 50)),
  ('p1', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 5)),
  ('lim_enorme', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 100000)),
  ('lim_cero', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 0)),
  ('lim_nulo', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, null)),
  ('det_presupuesto', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000011')),
  ('det_factura', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000001')),
  ('det_nc', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000031')),
  ('det_vencido', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000013')),
  ('idor_otro_cliente', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000022')),
  ('idor_otra_tienda', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000021')),
  ('idor_otra_org', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd2000000-0000-0000-0000-000000000023')),
  ('idor_borrador', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000008')),
  ('idor_inexistente', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd9999999-9999-9999-9999-999999999999')),
  ('idor_nulo', publico.mi_compra_por_dominio('his-a.ejemplo.com', null)),
  ('det_en_b', publico.mi_compra_por_dominio('his-b.ejemplo.com', 'd1000000-0000-0000-0000-000000000021'));
insert into res
select 'p2', publico.mis_compras_por_dominio('his-a.ejemplo.com', (v -> 'siguiente' ->> 'fecha')::date, (v -> 'siguiente' ->> 'id')::uuid, 5)
  from res where k = 'p1';
insert into res
select 'p3', publico.mis_compras_por_dominio('his-a.ejemplo.com', (v -> 'siguiente' ->> 'fecha')::date, (v -> 'siguiente' ->> 'id')::uuid, 5)
  from res where k = 'p2';
-- Un cursor forjado (a una fecha futura) y uno a medias solo ordenan: nunca muestran lo de otro.
insert into res values
  ('cursor_futuro', publico.mis_compras_por_dominio('his-a.ejemplo.com', date '2999-01-01', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 50)),
  ('cursor_a_medias', publico.mis_compras_por_dominio('his-a.ejemplo.com', date '2000-01-01', null, 50));

select pg_temp.como('f3000000-0000-0000-0000-000000000002');
insert into res values
  ('min_lista', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 50)),
  ('min_ve_ajeno', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000011'));
select pg_temp.como('f3000000-0000-0000-0000-000000000003');
insert into res values
  ('susp_lista', publico.mis_compras_por_dominio('his-a.ejemplo.com')),
  ('susp_detalle', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000011'));
select pg_temp.como('f3000000-0000-0000-0000-000000000007');
insert into res values
  ('panel_lista', publico.mis_compras_por_dominio('his-a.ejemplo.com')),
  ('panel_detalle', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000011'));
select pg_temp.como('f3000000-0000-0000-0000-000000000008');
insert into res values
  ('panel2_lista', publico.mis_compras_por_dominio('his-a.ejemplo.com')),
  ('panel2_detalle', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000011'));
select pg_temp.como('f3000000-0000-0000-0000-000000000009');
insert into res values
  ('dos_en_uno', publico.mis_compras_por_dominio('his-a.ejemplo.com')),
  ('dos_en_suya', publico.mis_compras_por_dominio('his-x.ejemplo.com'));
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
insert into res values ('lim1_a', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 1));
insert into res
select 'lim1_b', publico.mis_compras_por_dominio('his-a.ejemplo.com', (v -> 'siguiente' ->> 'fecha')::date, (v -> 'siguiente' ->> 'id')::uuid, 1)
  from res where k = 'lim1_a';
select pg_temp.como('f3000000-0000-0000-0000-000000000006');
insert into res values ('emp_p1', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 3));
insert into res
select 'emp_p2', publico.mis_compras_por_dominio('his-a.ejemplo.com', (v -> 'siguiente' ->> 'fecha')::date, (v -> 'siguiente' ->> 'id')::uuid, 3)
  from res where k = 'emp_p1';
insert into res
select 'emp_p3', publico.mis_compras_por_dominio('his-a.ejemplo.com', (v -> 'siguiente' ->> 'fecha')::date, (v -> 'siguiente' ->> 'id')::uuid, 3)
  from res where k = 'emp_p2';
select pg_temp.como('f3000000-0000-0000-0000-000000000004');
insert into res values
  ('cero_lista', publico.mis_compras_por_dominio('his-a.ejemplo.com')),
  ('cero_detalle', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000011'));
select pg_temp.como('f3000000-0000-0000-0000-000000000005');
insert into res values
  ('mucho_enorme', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 100000)),
  ('mucho_51', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 51)),
  ('mucho_50', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 50));
select pg_temp.como('f3000000-0000-0000-0000-000000000002');
insert into res values
  ('host_desconocido', publico.mis_compras_por_dominio('desconocido.ejemplo.com')),
  ('min_en_b', publico.mis_compras_por_dominio('his-b.ejemplo.com'));
reset role;
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
insert into res values ('sin_sesion', publico.mis_compras_por_dominio('his-a.ejemplo.com'));
reset role;

-- ============================================================================
-- Solo los comprobantes del cliente y de la tienda, sin borradores (FR-003, escenario A-1)
-- ============================================================================
select is((select v ->> 'estado' from res where k = 'lista'), 'ok', 'la lista responde ok');
select is(
  (select array_agg(distinct c order by c) from res r, jsonb_object_keys(r.v) c where r.k = 'lista'),
  array['estado', 'filas', 'siguiente', 'total'], 'la respuesta tiene exactamente estado, total, filas y siguiente');
select is((select v ->> 'total' from res where k = 'lista'), '14',
  'total: los 14 comprobantes del mayorista en A (sin 3 borradores ni lo de otro cliente, tienda u organización)');
select is(
  (select array_agg(f ->> 'numero' order by ord) from res r, jsonb_array_elements(r.v -> 'filas') with ordinality as t(f, ord) where r.k = 'lista'),
  array['00000031', '00000017', '00000015', '00000014', '00000012', '00000011', '00000013', '00000007', '00000006', '00000005', '00000004', '00000003', '00000002', '00000001']::text[],
  'orden: fecha desc y, a igual fecha, id desc; ni borradores ni lo ajeno');
select is(
  (select array_agg(distinct c order by c) from res r, jsonb_array_elements(r.v -> 'filas') f, jsonb_object_keys(f) c where r.k = 'lista'),
  array['estado_publico', 'fecha', 'id', 'numero', 'tipo', 'total_con_iva'],
  'cada fila: solo id, numero, fecha, tipo, estado_publico y total_con_iva');
select is(
  (select f ->> 'numero' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista_b'),
  '00000021', 'en la otra tienda, la misma persona ve solo lo de esa tienda');
select is(
  (select jsonb_agg(f ->> 'numero') from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'min_lista'),
  '["00000022"]'::jsonb, 'otro cliente de la misma tienda ve solo lo suyo');

-- ============================================================================
-- Tipo y estado público (FR-004; escenarios A-2 y A-3). Cobro y despacho nunca se exponen
-- ============================================================================
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000001'),
  'confirmada', 'factura en deuda: confirmada');
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000002'),
  'confirmada', 'factura cobrada: confirmada (el cobro no se expone)');
select is(
  (select array_agg(distinct f ->> 'estado_publico') from res r, jsonb_array_elements(r.v -> 'filas') f
    where r.k = 'lista' and f ->> 'numero' in ('00000003', '00000004', '00000005', '00000006')),
  array['confirmada'], 'confirmada, en proceso, armando e incompleto: todas confirmada (el despacho no se expone)');
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000007'),
  'anulada', 'factura anulada: anulada');
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000011'),
  'pendiente', 'presupuesto pendiente con validez futura: pendiente');
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000012'),
  'pendiente', 'presupuesto pendiente sin fecha de validez: pendiente');
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000013'),
  'vencido', 'presupuesto pendiente con valido_hasta de ayer: vencido');
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000017'),
  'pendiente', 'presupuesto que vence hoy (día de Buenos Aires): todavía pendiente');
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000014'),
  'aceptado', 'presupuesto aceptado: aceptado');
select is(
  (select f ->> 'estado_publico' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000015'),
  'anulado', 'presupuesto anulado: anulado');
select is(
  (select array_agg(distinct f ->> 'tipo' order by f ->> 'tipo') from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista'),
  array['compra', 'nota_credito', 'presupuesto'], 'tipos: compra (factura), presupuesto y nota_credito');
select is(
  (select array_agg(distinct f ->> 'estado_publico' order by f ->> 'estado_publico') from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista'),
  array['aceptado', 'anulada', 'anulado', 'confirmada', 'nota_credito', 'pendiente', 'vencido'],
  'ningún estado interno (cobrado, deuda, en_proceso, armando, incompleto, borrador) llega al cliente');
select is(
  (select (f ->> 'total_con_iva')::numeric from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000031'),
  -121::numeric, 'la nota de crédito va con signo negativo');
select is(
  (select (f ->> 'total_con_iva')::numeric from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lista' and f ->> 'numero' = '00000001'),
  1210::numeric, 'una factura va con su total con IVA');

-- ============================================================================
-- Carga infinita: cursor (fecha, id) y límite acotado (FR-003, amenaza 3.5)
-- ============================================================================
select is((select jsonb_array_length(v -> 'filas') from res where k = 'p1'), 5, 'primera tanda de 5');
select isnt((select v -> 'siguiente' from res where k = 'p1'), 'null'::jsonb, 'quedan filas: hay siguiente');
select is(
  (select array_agg(f ->> 'numero' order by k.k, ord) from res k, jsonb_array_elements(k.v -> 'filas') with ordinality as t(f, ord) where k.k in ('p1', 'p2', 'p3')),
  (select array_agg(f ->> 'numero' order by ord) from res r, jsonb_array_elements(r.v -> 'filas') with ordinality as t(f, ord) where r.k = 'lista'),
  'las tandas encadenadas por el cursor reconstruyen la lista completa, sin repetir ni saltear');
select is((select v -> 'siguiente' from res where k = 'p3'), 'null'::jsonb, 'la última tanda no tiene siguiente');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'lim_enorme'), 14, 'un límite enorme se acota a 50 (acá devuelve las 14 que hay)');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'lim_cero'), 1, 'el límite mínimo es 1');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'lim_nulo'), 14, 'sin límite: 20 (acá devuelve las 14 que hay)');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'cursor_futuro'), 14, 'un cursor forjado solo ordena: sigue siendo la lista del propio cliente');
select is((select v ->> 'total' from res where k = 'cursor_futuro'), '14', 'el total no depende del cursor');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'cursor_a_medias'), 14, 'un cursor a medias (solo la fecha) se ignora');

-- ============================================================================
-- Tope de 50 por llamada, desempate por id y listas vacías
-- ============================================================================
select is((select jsonb_array_length(v -> 'filas') from res where k = 'mucho_enorme'), 50, 'con 60 comprobantes, un límite enorme devuelve a lo sumo 50');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'mucho_51'), 50, 'un límite de 51 también se acota a 50');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'mucho_50'), 50, 'un límite de 50 devuelve 50');
select isnt((select v -> 'siguiente' from res where k = 'mucho_enorme'), 'null'::jsonb, 'quedan 10: hay siguiente');
select is((select v ->> 'total' from res where k = 'mucho_enorme'), '60', 'el total cuenta los 60');
select is(
  (select f ->> 'numero' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lim1_a'),
  '00000031', 'dos comprobantes con la misma fecha, límite 1: primero el de id mayor');
select is(
  (select f ->> 'numero' from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'lim1_b'),
  '00000017', 'y el siguiente, por el cursor (fecha, id), es el de id menor de la misma fecha: sin repetir ni saltear');
select is(
  (select jsonb_agg(f ->> 'numero' order by k.k, ord)
     from res k, jsonb_array_elements(k.v -> 'filas') with ordinality t(f, ord) where k.k in ('emp_p1', 'emp_p2', 'emp_p3')),
  '["T9", "T8", "T7", "T6", "T5", "T4", "T3", "T2", "T1"]'::jsonb,
  'nueve comprobantes del mismo día, paginados de a 3: orden id desc estricto, sin repetir ni saltear');
select is((select v -> 'siguiente' from res where k = 'emp_p3'), 'null'::jsonb, 'la última página de los empates no tiene siguiente');
select is((select v from res where k = 'cero_lista'), '{"estado":"ok","total":0,"filas":[],"siguiente":null}'::jsonb, 'cliente sin comprobantes: lista vacía, total 0 y sin siguiente');
select is((select v from res where k = 'cero_detalle'), '{"estado":"no_encontrada"}'::jsonb, 'cliente sin comprobantes pidiendo uno ajeno: no_encontrada');

-- Trampa UTC vs ART: el «vencido» y todo «hoy» usan el día de Buenos Aires, nunca current_date ni now()::date.
select ok(
  (select p.prosrc ~ 'hoy_argentina' and p.prosrc !~* '(current_date|now\(\)|current_timestamp|localtimestamp)'
     from pg_proc p where p.oid = 'private.estado_publico_comprobante(text, text, date)'::regprocedure),
  'estado_publico_comprobante deriva el vencido con private.hoy_argentina(), no con current_date ni now()');
select ok(
  (select p.prosrc !~* '(current_date|now\(\)|current_timestamp)'
     from pg_proc p where p.oid = 'publico.mis_compras_por_dominio(text, date, uuid, integer)'::regprocedure)
  and (select p.prosrc !~* '(current_date|now\(\)|current_timestamp)'
     from pg_proc p where p.oid = 'publico.mi_compra_por_dominio(text, uuid)'::regprocedure),
  'las RPC del historial no usan la fecha del servidor (UTC)');
select ok(
  (select p.prosrc ~ 'least\(greatest\(coalesce\(limite, 20\), 1\), 50\)'
     from pg_proc p where p.oid = 'publico.mis_compras_por_dominio(text, date, uuid, integer)'::regprocedure),
  'el límite se acota con least(greatest(…, 1), 50)');

-- ============================================================================
-- Detalle: lista blanca exacta por claves (FR-005, escenario A-5, amenaza 3.2)
-- ============================================================================
select is((select v ->> 'estado' from res where k = 'det_presupuesto'), 'ok', 'el detalle de un comprobante propio responde ok');
select is(
  (select array_agg(c order by c) from res r, jsonb_object_keys(r.v) c where r.k = 'det_presupuesto'),
  array['estado', 'estado_publico', 'fecha', 'iva', 'lineas', 'numero', 'tipo', 'total_con_iva', 'total_sin_iva', 'valido_hasta'],
  'detalle: exactamente estado, numero, fecha, tipo, estado_publico, valido_hasta, totales y lineas (sin cliente, organización, operador, forma de pago ni envío)');
select is(
  (select array_agg(distinct c order by c) from res r, jsonb_array_elements(r.v -> 'lineas') l, jsonb_object_keys(l) c where r.k = 'det_presupuesto'),
  array['cantidad', 'codigo', 'descripcion', 'precio_unitario', 'subtotal'],
  'cada línea: exactamente descripcion, codigo, cantidad, precio_unitario y subtotal (sin costo, margen, descuento, precio manual ni depósito)');
select is(
  (select jsonb_agg(l ->> 'descripcion') from res r, jsonb_array_elements(r.v -> 'lineas') l where r.k = 'det_presupuesto'),
  '["Primer producto", "Segundo producto"]'::jsonb, 'las líneas van en su orden');
select is(
  (select l from res r, jsonb_array_elements(r.v -> 'lineas') l where r.k = 'det_presupuesto' and l ->> 'codigo' = 'SKU-1'),
  '{"cantidad": 3, "codigo": "SKU-1", "descripcion": "Primer producto", "subtotal": 60.00, "precio_unitario": 20.00}'::jsonb,
  'los valores de una línea: cantidad, precio unitario y subtotal');
select is(
  (select jsonb_build_array(v -> 'numero', v -> 'tipo', v -> 'estado_publico', v -> 'valido_hasta', v -> 'total_sin_iva', v -> 'iva', v -> 'total_con_iva') from res where k = 'det_presupuesto'),
  jsonb_build_array('00000011', 'presupuesto', 'pendiente', (private.hoy_argentina() + 5)::text, 100.00, 21.00, 121.00),
  'totales del presupuesto: sin IVA, IVA y con IVA');
select is((select v ->> 'tipo' from res where k = 'det_factura'), 'compra', 'una factura es una compra');
select is((select v -> 'valido_hasta' from res where k = 'det_factura'), 'null'::jsonb, 'una factura no tiene fecha de validez');
select is((select v ->> 'estado_publico' from res where k = 'det_vencido'), 'vencido', 'el detalle también deriva el vencido');
select is(
  (select l from res r, jsonb_array_elements(r.v -> 'lineas') l where r.k = 'det_nc'),
  '{"cantidad": 1, "codigo": "SKU-NC", "descripcion": "Devolución de la factura", "subtotal": -100.00, "precio_unitario": 100.00}'::jsonb,
  'nota de crédito: el subtotal de la línea va negado y el precio unitario positivo');
select is(
  (select sum((l ->> 'subtotal')::numeric) from res r, jsonb_array_elements(r.v -> 'lineas') l where r.k = 'det_nc'),
  (select (v ->> 'total_sin_iva')::numeric from res where k = 'det_nc'),
  'las líneas de la nota de crédito suman el total sin IVA con signo');
select is(
  (select jsonb_build_array(v -> 'tipo', v -> 'total_sin_iva', v -> 'iva', v -> 'total_con_iva') from res where k = 'det_nc'),
  jsonb_build_array('nota_credito', -100.00, -21.00, -121.00), 'la nota de crédito va con signo negativo en el detalle');
select is(
  (select v::text from res where k = 'det_presupuesto' and v::text ~* '(costo|margen|descuento|deposito|operador|cotizacion|precio_manual|organizacion|cliente_id|forma_pago|envio|cobr|despacho|deuda)'),
  null, 'nada interno aparece en el texto de la respuesta');

-- ============================================================================
-- IDOR: ajeno, de otra tienda, de otra organización, borrador e inexistente son indistinguibles (FR-006, escenario A-4)
-- ============================================================================
select is((select v from res where k = 'idor_inexistente'), '{"estado":"no_encontrada"}'::jsonb, 'un id inexistente: no_encontrada');
select is((select v from res where k = 'idor_otro_cliente'), (select v from res where k = 'idor_inexistente'), 'comprobante de otro cliente de la misma tienda: la misma respuesta');
select is((select v from res where k = 'idor_otra_tienda'), (select v from res where k = 'idor_inexistente'), 'comprobante propio pero de otra tienda: la misma respuesta');
select is((select v from res where k = 'idor_otra_org'), (select v from res where k = 'idor_inexistente'), 'comprobante de otra organización: la misma respuesta');
select is((select v from res where k = 'idor_borrador'), (select v from res where k = 'idor_inexistente'), 'un borrador propio: la misma respuesta');
select is((select v from res where k = 'idor_nulo'), (select v from res where k = 'idor_inexistente'), 'un id nulo: la misma respuesta');
select is((select v ->> 'estado' from res where k = 'det_en_b'), 'ok', 'el mismo comprobante sí se ve desde la tienda a la que pertenece');
select is((select v from res where k = 'min_ve_ajeno'), (select v from res where k = 'idor_inexistente'), 'otro cliente pidiendo un comprobante que no es suyo: la misma respuesta');

-- ============================================================================
-- Sin acceso: idéntico para todos (FR-002, FR-011, escenario A-7; amenaza 3.1)
-- ============================================================================
select is((select v from res where k = 'susp_lista'), '{"estado":"sin_acceso"}'::jsonb, 'cuenta suspendida: la lista da sin_acceso');
select is((select v from res where k = 'susp_detalle'), '{"estado":"sin_acceso"}'::jsonb, 'cuenta suspendida: el detalle da sin_acceso');
select is((select v from res where k = 'panel_lista'), '{"estado":"sin_acceso"}'::jsonb, 'usuario de panel sin cuenta web: sin_acceso');
select is((select v from res where k = 'panel_detalle'), '{"estado":"sin_acceso"}'::jsonb, 'usuario de panel (detalle): sin_acceso');
select is((select v from res where k = 'panel2_lista'), '{"estado":"sin_acceso"}'::jsonb, 'panel de otra organización: sin_acceso');
select is((select v from res where k = 'panel2_detalle'), '{"estado":"sin_acceso"}'::jsonb, 'panel de otra organización (detalle): sin_acceso');
select is((select v from res where k = 'dos_en_uno'), '{"estado":"sin_acceso"}'::jsonb, 'cuenta de otra organización en una tienda ajena: sin_acceso');
select is((select v ->> 'total' from res where k = 'dos_en_suya'), '1', 'la cuenta de la otra organización sí ve lo suyo en su tienda');
select is((select v from res where k = 'host_desconocido'), '{"estado":"sin_acceso"}'::jsonb, 'host desconocido: sin_acceso');
select is((select v from res where k = 'min_en_b'), '{"estado":"sin_acceso"}'::jsonb, 'cuenta de otra tienda de la organización: sin_acceso');
select is((select v from res where k = 'sin_sesion'), '{"estado":"sin_acceso"}'::jsonb, 'sin sesión: sin_acceso');

-- La suspensión rige en la próxima llamada, también con la lista ya abierta.
update cuentas_cliente set estado = 'suspendida' where id = 'ca000000-0000-0000-0000-000000000001';
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
delete from res where k in ('tras_suspender', 'tras_suspender_detalle');
insert into res values
  ('tras_suspender', publico.mis_compras_por_dominio('his-a.ejemplo.com', null, null, 5)),
  ('tras_suspender_detalle', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000011'));
reset role;
select is(
  (select jsonb_build_array(a.v, b.v) from res a, res b where a.k = 'tras_suspender' and b.k = 'tras_suspender_detalle'),
  '[{"estado":"sin_acceso"},{"estado":"sin_acceso"}]'::jsonb, 'al suspender la cuenta, la próxima llamada ya no muestra nada');
update cuentas_cliente set estado = 'activa' where id = 'ca000000-0000-0000-0000-000000000001';

-- ============================================================================
-- Bandera apagada: sin_acceso genérico sin tocar datos (FR-014)
-- ============================================================================
update public.banderas_plataforma set activa = false where clave = 'tienda_pedidos';
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
insert into res values
  ('apagada_lista', publico.mis_compras_por_dominio('his-a.ejemplo.com')),
  ('apagada_detalle', publico.mi_compra_por_dominio('his-a.ejemplo.com', 'd1000000-0000-0000-0000-000000000011'));
reset role;
select is(
  (select jsonb_build_array(a.v, b.v) from res a, res b where a.k = 'apagada_lista' and b.k = 'apagada_detalle'),
  '[{"estado":"sin_acceso"},{"estado":"sin_acceso"}]'::jsonb, 'bandera apagada: la lista y el detalle responden sin_acceso');
update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';

select * from finish();
rollback;
