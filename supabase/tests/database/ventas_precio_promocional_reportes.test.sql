-- MSF-816 / F-4 · T021 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, FR-021):
-- los reportes, la exportación, la API, el webhook y la IA NO cambian de contrato con el precio promocional.
--
-- Una venta real con promoción (bandera `promociones_precio` encendida, promoción cargada por la RPC del producto,
-- línea guardada y factura confirmada por las RPC de ventas) y se comprueba que:
--   · la rentabilidad REALIZADA (`analitica.rentabilidad_ventas_real`) usa lo cobrado: `vendido` = subtotal de la línea
--     (precio promocional × cantidad) y el costo es el congelado al confirmar; la nota de crédito parcial resta a precio
--     cobrado y NO re-precia con el normal;
--   · la promoción NO se valida contra el costo (S3): una promoción bajo el costo se carga, se cobra y la
--     rentabilidad realizada muestra el margen negativo (`estado = 'negativo'`);
--   · el margen «actual» (`analitica.margen_producto_canal`) queda con el PRECIO NORMAL aunque haya promoción
--     vigente (Decisión tomada 8): no lee `promociones_precio` y su `precio_neto` no cambia al encender la bandera;
--   · la exportación total incorpora las columnas nuevas de la línea por catálogo (`precio_referencia`,
--     `promocion_id`) y las filas exportadas las traen con su valor; el catálogo de columnas de la tabla de la línea
--     coincide con las columnas reales (nada se pierde ni se oculta);
--   · el evento `venta.registrada` conserva exactamente sus 8 claves y sus importes son los cobrados;
--   · `private.api_leer_ventas` (API pública `/v1/ventas`) conserva exactamente sus 8 claves;
--   · las vistas de consulta de IA (`public.ia_consulta_*`, 20270224110000) conservan sus columnas exactas y no
--     exponen la promoción ni la referencia ni el costo;
--   · `obtener_comprobante` es el único contrato que suma `precio_referencia` (F-1) y NO `promocion_id`.
-- `pnpm test:openapi` (sin diff) se corre aparte y se documenta en el PR.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador');
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', null);
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- P1 Joystick lista 1000, costo 600, promoción 800 · P2 Cable lista 500, costo 100, promoción 50 (bajo el costo, S3)
-- · P3 Teclado lista 700, costo 300, sin promoción (control).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 'ARS', 500, 'c1000000-0000-0000-0000-000000000001', null, true),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Teclado', 'TEC-1', 'ARS', 700, 'c1000000-0000-0000-0000-000000000001', null, true);
insert into dominio.producto_costos (producto_id, organizacion_id, costo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 600),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 100),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 300);

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 50, 0
  from generate_series(1, 3) n
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, (select principal from datos), '11111111-1111-1111-1111-111111111111', 50, 0
  from generate_series(1, 3) n
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

-- Conexión de exportaciones para la exportación total (como en exportacion_total.test.sql).
insert into sistemas_externos (id, descripcion) values ('historial-ventas', 'Prueba de la exportación total')
on conflict (id) do nothing;
insert into conexiones (id, organizacion_id, sistema_externo, credencial_vault_id)
values ('c1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'historial-ventas', gen_random_uuid());

grant select on dominio.comprobantes_venta_lineas to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.sesion(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;
create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.upd(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
grant execute on function pg_temp.id_de(text), pg_temp.upd(text) to public;
-- Una factura de `n` unidades de un producto: crea, guarda líneas y confirma (como el operador).
create function pg_temp.vender(p_clave text, p_producto integer, p_cantidad integer) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mostrador', (current_date - 1));
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(jsonb_build_object(
    'producto_id', 'b1000000-0000-0000-0000-' || lpad(p_producto::text, 12, '0'),
    'cantidad', p_cantidad, 'deposito_id', (select principal from datos))), v_c.updated_at);
  perform public.confirmar_comprobante(v_c.id);
end $$;
create function pg_temp.vista(p_producto integer, p_columna text) returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  execute format('select sum(%I) from analitica.rentabilidad_ventas_real where producto_id = $1', p_columna)
    into v using ('b1000000-0000-0000-0000-' || lpad(p_producto::text, 12, '0'))::uuid;
  return v;
end $$;
grant execute on function pg_temp.vista(integer, text) to public;

-- ============================================================================
-- Margen «actual» (Decisión 8): precio normal con la bandera apagada y con ella encendida y una promoción vigente
-- ============================================================================

select pg_temp.sesion('f1000000-0000-0000-0000-000000000001');
create temp table margen_antes on commit drop as
  select producto_id, precio_neto, margen, estado from analitica.margen_producto_canal
   where empresa_id = 'a1000000-0000-0000-0000-000000000001';
select cmp_ok((select count(*) from margen_antes)::int, '>=', 3, 'precondición: el margen actual tiene las filas de los tres productos');

update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
select lives_ok($$select public.guardar_promocion_precio(null, 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 800, now() - interval '1 day', now() + interval '1 day', null)$$,
  'se carga la promoción del joystick (800 contra lista 1000)');
select lives_ok($$select public.guardar_promocion_precio(null, 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 50, now() - interval '1 day', now() + interval '1 day', null)$$,
  'S3: una promoción BAJO EL COSTO (50 contra costo 100) se carga: no se valida contra el costo');

select is((select count(*)::int from (
             select producto_id, precio_neto, margen, estado from analitica.margen_producto_canal
              where empresa_id = 'a1000000-0000-0000-0000-000000000001'
             except select * from margen_antes) d), 0,
  'Decisión 8: con promociones vigentes y la bandera encendida el margen «actual» por producto/canal NO cambia (precio normal)');
select is((select precio_neto from analitica.margen_producto_canal
            where empresa_id = 'a1000000-0000-0000-0000-000000000001' and producto_id = 'b1000000-0000-0000-0000-000000000001'),
  1000::numeric, 'el precio_neto del joystick en el margen actual es el normal (1000), no el promocional (800)');
select is((select count(*)::int from pg_depend d
             join pg_rewrite r on r.oid = d.objid
             join pg_class v on v.oid = r.ev_class
             join pg_class t on t.oid = d.refobjid
            where v.oid = 'analitica.margen_producto_canal'::regclass and t.relname = 'promociones_precio'), 0,
  'la vista margen_producto_canal no depende de promociones_precio');

-- ============================================================================
-- La venta con promoción
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select lives_ok($$select pg_temp.vender('V1', 1, 3)$$, 'V1: 3 joysticks con la promoción (800) confirmados');
select lives_ok($$select pg_temp.vender('V2', 2, 2)$$, 'V2: 2 cables con la promoción bajo el costo (50) confirmados (S3)');
select lives_ok($$select pg_temp.vender('V3', 3, 1)$$, 'V3: 1 teclado sin promoción confirmado (control)');

reset role;
select is((select precio_unitario || '|' || precio_referencia || '|' || (promocion_id is not null) from dominio.comprobantes_venta_lineas
            where comprobante_id = pg_temp.id_de('V1')), '800.00|1000.00|true',
  'la línea de V1 guarda el precio promocional, la referencia y la promoción');
select is((select costo_unitario from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('V1')), 600.00,
  'y el costo congelado al confirmar (600): la promoción no cambia el costo');

-- ============================================================================
-- Rentabilidad realizada: lo cobrado
-- ============================================================================

select is(pg_temp.vista(1, 'vendido'), 2400::numeric, 'rentabilidad realizada: vendido = 3 × 800 (precio cobrado, no 3 × 1000)');
select is(pg_temp.vista(1, 'costo'), 1800::numeric, 'costo = 3 × 600');
select is(pg_temp.vista(1, 'margen'), 600::numeric, 'margen = 2400 − 1800 = 600');
select is((select estado from analitica.rentabilidad_ventas_real where producto_id = 'b1000000-0000-0000-0000-000000000001'), 'ok',
  'el joystick vendido con promoción queda en estado ok');
select is(pg_temp.vista(3, 'vendido'), 700::numeric, 'control: el teclado sin promoción vende 700');
select is(pg_temp.vista(2, 'vendido'), 100::numeric, 'S3: los cables se vendieron a 2 × 50 = 100');
select is(pg_temp.vista(2, 'margen'), -100::numeric, 'S3: el margen realizado es negativo (100 − 200): la rentabilidad lo muestra');
select is((select estado from analitica.rentabilidad_ventas_real where producto_id = 'b1000000-0000-0000-0000-000000000002'), 'negativo',
  'S3: estado negativo para la venta bajo el costo (la promoción no se validó contra el costo)');

-- Nota de crédito PARCIAL de 1 joystick: resta a precio cobrado (800), no a precio normal (1000).
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select lives_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('V1'),
  jsonb_build_array(jsonb_build_object('linea_id',
    (select l.id from dominio.comprobantes_venta_lineas l where l.comprobante_id = pg_temp.id_de('V1') and l.orden = 1), 'cantidad', 1))::text),
  'nota de crédito parcial de 1 joystick');
reset role;
select is(pg_temp.vista(1, 'vendido'), 1600::numeric, 'tras la nota: vendido = 2400 − 800 (la nota resta lo cobrado, no 1000)');
select is(pg_temp.vista(1, 'costo'), 1200::numeric, 'costo = 1800 − 600 (la nota copia el costo congelado)');
select is(pg_temp.vista(1, 'margen'), 400::numeric, 'margen realizado = 1600 − 1200 = 400');

-- ============================================================================
-- Exportación total: columnas nuevas por catálogo y en las filas exportadas
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select lives_ok($$select * from public.solicitar_exportacion_total()$$, 'el administrador pide la exportación total');
reset role;
create function pg_temp.ejecucion() returns uuid language sql security definer as $$
  select p.ejecucion_id from public.procesos_masivos p
   where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.funcionalidad = 'exportacion_total' limit 1 $$;
grant execute on function pg_temp.ejecucion() to public;

select ok((select 'precio_referencia' = any(columnas) and 'promocion_id' = any(columnas)
             from private.conjuntos_exportacion_total() where esquema = 'dominio' and tabla = 'comprobantes_venta_lineas'),
  'la exportación total incluye precio_referencia y promocion_id de la línea (por catálogo)');
select is((select array(select unnest(columnas) order by 1) from private.conjuntos_exportacion_total() where esquema = 'dominio' and tabla = 'comprobantes_venta_lineas'),
  (select array(select a.attname::text from pg_attribute a where a.attrelid = 'dominio.comprobantes_venta_lineas'::regclass and a.attnum > 0 and not a.attisdropped order by 1)),
  'el catálogo de columnas exportadas de la línea es exactamente el de la tabla (nada se pierde)');
select ok((select 'precio_promocional' = any(columnas) and 'desde' = any(columnas) and 'hasta' = any(columnas)
             from private.conjuntos_exportacion_total() where esquema = 'dominio' and tabla = 'promociones_precio'),
  'y la tabla de promociones se exporta completa');

select pg_temp.sesion('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int
             from jsonb_array_elements(private.filas_exportacion_total(pg_temp.ejecucion(), 'dominio', 'comprobantes_venta_lineas', 0, 100)) f
            where f->>'precio_referencia' = '1000.00' and f->>'precio_unitario' = '800.00' and f->>'promocion_id' is not null), 2,
  'las filas exportadas traen la línea promocional (factura y su nota de crédito heredera) con precio 800, referencia 1000 y su promoción');
select is(jsonb_array_length(private.filas_exportacion_total(pg_temp.ejecucion(), 'dominio', 'comprobantes_venta_lineas', 0, 100)), 4,
  'la exportación de líneas trae exactamente las 4 líneas de la organización del test (V1, su nota, V2 y V3), no las de otras organizaciones');
select is((select count(*)::int
             from jsonb_array_elements(private.filas_exportacion_total(pg_temp.ejecucion(), 'dominio', 'comprobantes_venta_lineas', 0, 100)) f
            where f ? 'precio_referencia' and f ? 'promocion_id'
              and f->>'organizacion_id' = '11111111-1111-1111-1111-111111111111'), 4,
  'las 4 filas exportadas de línea tienen las dos claves nuevas (null en las sin promoción)');

-- ============================================================================
-- Webhook venta.registrada: forma y valores
-- ============================================================================

select is((select array(select jsonb_object_keys(carga) order by 1)
             from public.cola_eventos where tipo = 'venta.registrada' and clave_idempotencia = pg_temp.id_de('V1')::text),
  array['comprobante_id', 'confirmado_en', 'numero', 'ocurrido_en', 'organizacion_id', 'tipo', 'total_con_iva', 'total_sin_iva'],
  'venta.registrada conserva exactamente sus 8 claves (sin referencia, promoción ni costo)');
select is((select (carga->>'total_sin_iva')::numeric from public.cola_eventos
            where tipo = 'venta.registrada' and clave_idempotencia = pg_temp.id_de('V1')::text), 2400::numeric,
  'venta.registrada lleva el total cobrado (3 × 800), no el de lista');
select is((select count(*)::int from public.cola_eventos where tipo = 'venta.registrada' and clave_idempotencia in
  (pg_temp.id_de('V1')::text, pg_temp.id_de('V2')::text, pg_temp.id_de('V3')::text)), 3, 'un evento por factura confirmada');

-- ============================================================================
-- API pública /v1/ventas
-- ============================================================================

select is((select array(select jsonb_object_keys(filas->0) order by 1)
             from private.api_leer_ventas('11111111-1111-1111-1111-111111111111', null, 50, null)),
  array['confirmado_en', 'empresa_id', 'estado', 'fecha', 'id', 'numero', 'total_con_iva', 'total_sin_iva'],
  'api_leer_ventas conserva exactamente sus 8 claves');
select is((select jsonb_array_length(filas) from private.api_leer_ventas('11111111-1111-1111-1111-111111111111', null, 50, null)), 3,
  'api_leer_ventas devuelve las tres facturas');
select is((select (f->>'total_sin_iva')::numeric from private.api_leer_ventas('11111111-1111-1111-1111-111111111111', null, 50, null) a,
                  jsonb_array_elements(a.filas) f where f->>'id' = pg_temp.id_de('V1')::text), 2400::numeric,
  'api_leer_ventas informa el total cobrado de la factura promocional');

-- API pública /v1/precios (private.api_leer_precios): forma exacta, sin promoción ni referencia.
select is((select array(select jsonb_object_keys(filas->0) order by 1)
             from private.api_leer_precios('11111111-1111-1111-1111-111111111111', null, 50, null)),
  array['actualizado_en', 'moneda', 'nombre', 'precio_lista', 'precio_x10', 'precio_x5', 'precio_x50', 'producto_id', 'sku'],
  'api_leer_precios conserva exactamente sus claves (sin promoción ni referencia)');
select is((select (f->>'precio_lista')::numeric from private.api_leer_precios('11111111-1111-1111-1111-111111111111', null, 50, null) a,
                  jsonb_array_elements(a.filas) f where f->>'sku' = 'JOY-1'), 1000::numeric,
  'api_leer_precios informa el precio de lista del joystick (1000), no el promocional');

-- ============================================================================
-- Vistas de consulta de IA (20270224110000)
-- ============================================================================

select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'ia_consulta_ventas'),
  array['organizacion_id', 'comprobante_id', 'numero', 'fecha', 'empresa_id', 'total_sin_iva', 'total_con_iva', 'estado', 'confirmado_en'],
  'ia_consulta_ventas conserva sus columnas exactas');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'ia_consulta_catalogo'),
  array['organizacion_id', 'producto_id', 'nombre', 'sku', 'categoria_id', 'categoria', 'activo', 'actualizado_en'],
  'ia_consulta_catalogo conserva sus columnas exactas');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'ia_consulta_stock'),
  array['organizacion_id', 'producto_id', 'nombre', 'sku', 'deposito_id', 'deposito', 'cantidad', 'reservado', 'disponible', 'actualizado_en'],
  'ia_consulta_stock conserva sus columnas exactas');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'ia_consulta_precios'),
  array['organizacion_id', 'producto_id', 'nombre', 'sku', 'moneda', 'precio_lista', 'precio_x5', 'precio_x10', 'precio_x50', 'actualizado_en'],
  'ia_consulta_precios conserva sus columnas exactas (sin promoción, referencia ni costo)');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name like 'ia\_consulta\_%'
              and (column_name ilike '%promo%' or column_name ilike '%referencia%' or column_name ilike '%costo%')), 0,
  'ninguna vista de consulta de IA expone promoción, referencia ni costo');
select is((select total_sin_iva from public.ia_consulta_ventas where comprobante_id = pg_temp.id_de('V1')), 2400::numeric,
  'ia_consulta_ventas informa el total cobrado');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.ia_consulta_ventas), 3, 'el operador de la tienda ve sus tres facturas en la vista de IA');

-- ============================================================================
-- obtener_comprobante: referencia sí, promoción no
-- ============================================================================

select is((select (l->>'precio_referencia')::numeric from jsonb_array_elements(public.obtener_comprobante(pg_temp.id_de('V1'))->'lineas') l limit 1), 1000::numeric,
  'obtener_comprobante expone precio_referencia (F-1)');
select is((select l ? 'promocion_id' from jsonb_array_elements(public.obtener_comprobante(pg_temp.id_de('V1'))->'lineas') l limit 1), false,
  'obtener_comprobante NO expone promocion_id');

select * from finish();
rollback;
