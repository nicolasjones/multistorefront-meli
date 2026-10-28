-- F-SVC-13 (MSF-418, épica MSF-232): cobro de la reparación mediante un comprobante de Ventas (SC-001).
-- Cubre FR-001, FR-002, FR-004, FR-005, FR-007 y FR-008: comprobante `borrador` con cliente, tienda, origen y
-- una línea `sin_stock` por ítem (alícuota del producto o general), totales de Ventas, idempotencia (también el
-- respaldo del índice único parcial), regenerar tras anular, sin ítems / anulada / cliente archivado rechazadas,
-- permisos (`service_tecnico` + `ventas` en edición), tienda y organización ajenas, `anon` sin ejecución,
-- `comprobante_de_reparacion`, `obtener_comprobante` con origen y actividad `reparacion.comprobante_generado`.
-- La concurrencia real no cabe en una transacción: se prueba el bloqueo de fila (`for update`) en el código y el
-- índice único parcial, además de la segunda llamada secuencial.
-- Matriz vigente: administrador y operador `edicion` en `service_tecnico` y `ventas`; consulta `lectura` en ambas;
-- depósito `ninguno` en `service_tecnico`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- El operador, la consulta y el depósito (Ventas en lectura, sin Service) solo acceden a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('e1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente a archivar', 'minorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

-- Las categorías nacen en 21 % (F-PRE-12); el repuesto vinculado tiene IVA propio de 10,5 %.
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Repuestos');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, categoria_id, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pantalla Switch', 'PAN-1', 100, 'c1000000-0000-0000-0000-000000000001', true);
update dominio.productos
   set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                           where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.porcentaje = 10.5 and not a.exento)
 where id = 'b1000000-0000-0000-0000-000000000001';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

create temp table comps (clave text primary key, id uuid);
grant select, insert on comps to public;

-- ============================================================================
-- Privilegios y diseño
-- ============================================================================

select is(
  (select count(*) from unnest(array[
    'public.generar_comprobante_reparacion(uuid)', 'public.comprobante_de_reparacion(uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC del cobro de Service');
select is(
  (select count(*) from unnest(array[
    'public.generar_comprobante_reparacion(uuid)', 'public.comprobante_de_reparacion(uuid)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  2, 'authenticated ejecuta las dos RPC del cobro de Service');
select is(
  has_function_privilege('authenticated', 'private.alicuota_general(uuid)', 'execute'), false,
  'private.alicuota_general no es ejecutable por authenticated');
select ok(
  (select prosrc like '%for update%' from pg_proc where oid = 'public.generar_comprobante_reparacion(uuid)'::regprocedure),
  'generar_comprobante_reparacion bloquea la reparación (for update): dos generaciones simultáneas se serializan');
select ok(
  (select indexdef like '%UNIQUE%' and indexdef like '%origen_id%' and indexdef like '%anulada%'
     from pg_indexes where indexname = 'comprobantes_venta_origen_vigente_uk'),
  'el índice único parcial por origen vigente existe');

-- ============================================================================
-- Reparaciones de la prueba (las crea el administrador)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select c, (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid
from unnest(array['r1', 'sin_items', 'anulada']) c;
insert into reps (clave, id)
select 'archivado', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'otra_tienda', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;

-- Dos ítems en r1: mano de obra (2 × 1.500,50) y un repuesto del catálogo (1 × 100).
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'Cambio de pantalla', null, 2, 1500.50);
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 100);
select public.agregar_item_reparacion((select id from reps where clave = 'anulada'), 'mano_obra', 'Limpieza', null, 1, 500);
select public.agregar_item_reparacion((select id from reps where clave = 'archivado'), 'mano_obra', 'Limpieza', null, 1, 500);
select public.agregar_item_reparacion((select id from reps where clave = 'otra_tienda'), 'mano_obra', 'Limpieza', null, 1, 500);
select public.anular_reparacion((select id from reps where clave = 'anulada'), 'Se canceló');

reset role;
update public.clientes set archivado_en = now() where id = 'c5000000-0000-0000-0000-000000000002';

-- ============================================================================
-- Rechazos
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');

select throws_ok(
  format($$select public.generar_comprobante_reparacion(%L)$$, (select id from reps where clave = 'sin_items')),
  '22023', null, 'una reparación sin ítems no genera comprobante');
select throws_ok(
  format($$select public.generar_comprobante_reparacion(%L)$$, (select id from reps where clave = 'anulada')),
  '55000', null, 'una reparación anulada no genera comprobante');
select throws_ok(
  format($$select public.generar_comprobante_reparacion(%L)$$, (select id from reps where clave = 'archivado')),
  '22023', null, 'un cliente archivado no permite generar el comprobante');
select throws_ok(
  format($$select public.generar_comprobante_reparacion(%L)$$, (select id from reps where clave = 'otra_tienda')),
  'P0002', null, 'una reparación de una tienda no accesible se rechaza');
select throws_ok(
  $$select public.generar_comprobante_reparacion('00000000-0000-0000-0000-000000000000')$$,
  'P0002', null, 'una reparación inexistente se rechaza');

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  format($$select public.generar_comprobante_reparacion(%L)$$, (select id from reps where clave = 'r1')),
  '42501', null, 'la consulta (lectura) no genera comprobantes');

select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(
  format($$select public.generar_comprobante_reparacion(%L)$$, (select id from reps where clave = 'r1')),
  '42501', null, 'depósito (sin service_tecnico) no genera comprobantes');
select throws_ok(
  format($$select public.comprobante_de_reparacion(%L)$$, (select id from reps where clave = 'r1')),
  '42501', null, 'depósito (sin service_tecnico) no consulta el comprobante asociado');

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(
  format($$select public.generar_comprobante_reparacion(%L)$$, (select id from reps where clave = 'r1')),
  'P0002', null, 'la organización dos no genera el comprobante de una reparación de la uno');
select throws_ok(
  format($$select public.comprobante_de_reparacion(%L)$$, (select id from reps where clave = 'r1')),
  'P0002', null, 'la organización dos no consulta el comprobante de una reparación de la uno');

reset role;
select is((select count(*)::int from dominio.comprobantes_venta where origen_tipo is not null), 0,
  'ningún rechazo dejó un comprobante a medias');

-- ============================================================================
-- Generación
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(public.comprobante_de_reparacion((select id from reps where clave = 'r1')), null::jsonb,
  'sin comprobante, comprobante_de_reparacion devuelve null (lectura alcanza)');

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into comps (clave, id)
select 'c1', (public.generar_comprobante_reparacion((select id from reps where clave = 'r1'))->>'comprobante_id')::uuid;

select is(
  (public.generar_comprobante_reparacion((select id from reps where clave = 'r1'))->>'creado')::boolean, false,
  'la segunda llamada no crea otro: devuelve el vigente (creado = false)');
select is(
  (public.generar_comprobante_reparacion((select id from reps where clave = 'r1'))->>'comprobante_id')::uuid,
  (select id from comps where clave = 'c1'), 'la segunda llamada devuelve el mismo comprobante');

reset role;
select is((select count(*)::int from dominio.comprobantes_venta where origen_id = (select id from reps where clave = 'r1')), 1,
  'hay un solo comprobante por la reparación');
select is(
  (select tipo || '/' || estado || '/' || origen_tipo || '/' || canal from dominio.comprobantes_venta where id = (select id from comps where clave = 'c1')),
  'factura/borrador/reparacion/mostrador', 'es una factura en borrador con origen reparacion');
select is(
  (select empresa_id from dominio.comprobantes_venta where id = (select id from comps where clave = 'c1')),
  'a1000000-0000-0000-0000-000000000001'::uuid, 'nace en la tienda de la reparación');
select is(
  (select cliente_id from dominio.comprobantes_venta where id = (select id from comps where clave = 'c1')),
  'c5000000-0000-0000-0000-000000000001'::uuid, 'nace con el cliente de la reparación');
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas
    where comprobante_id = (select id from comps where clave = 'c1') and sin_stock and producto_id is null and deposito_id is null and not a_pedido),
  2, 'una línea sin_stock por ítem, sin producto ni depósito');
select is(
  (select string_agg(descripcion || ':' || cantidad || ':' || precio_unitario || ':' || alicuota_porcentaje, '|' order by descripcion)
     from dominio.comprobantes_venta_lineas where comprobante_id = (select id from comps where clave = 'c1')),
  'Cambio de pantalla:2:1500.50:21.00|Pantalla Switch:1:100.00:10.50',
  'la mano de obra va con la alícuota general (21 %) y el repuesto con la del producto (10,5 %)');
select is(
  (select total_sin_iva::text || '/' || total_con_iva::text from dominio.comprobantes_venta where id = (select id from comps where clave = 'c1')),
  '3101.00/3741.71', 'los totales suman subtotal e IVA por línea');
select is(
  (select count(*)::int from public.registro_actividad where tipo = 'reparacion.comprobante_generado'), 1,
  'se registra una sola actividad reparacion.comprobante_generado (la repetición no duplica)');
select is(
  (select count(*)::int from dominio.movimientos_stock), 0, 'generar el comprobante no mueve stock');

-- ============================================================================
-- Lectura: comprobante asociado y origen en Ventas
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(
  (public.comprobante_de_reparacion((select id from reps where clave = 'r1'))->>'id')::uuid,
  (select id from comps where clave = 'c1'), 'comprobante_de_reparacion devuelve el vigente');
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.comprobante_de_reparacion((select id from reps where clave = 'r1'))) k),
  'empresa,empresa_id,estado,id,numero,tipo,total', 'comprobante_de_reparacion expone solo cabecera');
select is(
  (public.comprobante_de_reparacion((select id from reps where clave = 'r1'))->>'empresa')::text, 'San Javucho',
  'comprobante_de_reparacion expone la tienda del comprobante');
select is(
  (public.comprobante_de_reparacion((select id from reps where clave = 'r1'))->>'total')::numeric, 3741.71,
  'el total es el total con IVA');

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(public.obtener_comprobante((select id from comps where clave = 'c1'))->>'origen_tipo', 'reparacion',
  'obtener_comprobante expone el tipo de origen');
select is((public.obtener_comprobante((select id from comps where clave = 'c1'))->>'origen_id')::uuid,
  (select id from reps where clave = 'r1'), 'obtener_comprobante expone el id de origen');
select ok(public.obtener_comprobante((select id from comps where clave = 'c1'))->>'origen_numero' ~ '^R-[0-9]{4}$',
  'obtener_comprobante expone el número R-000N de la reparación');
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select is(private.nivel_seccion('ventas'), 'lectura', 'el depósito ve Ventas en lectura');
select is(private.nivel_seccion('service_tecnico'), 'ninguno', 'el depósito no tiene Service');
select is(public.obtener_comprobante((select id from comps where clave = 'c1'))->>'origen_numero', null,
  'con Ventas y sin service_tecnico, obtener_comprobante no devuelve el número de la reparación');
select is(public.obtener_comprobante((select id from comps where clave = 'c1'))->>'origen_tipo', 'reparacion',
  'con Ventas y sin service_tecnico, el origen_tipo sí sale');
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(jsonb_array_length(public.obtener_comprobante((select id from comps where clave = 'c1'))->'lineas'), 2,
  'obtener_comprobante devuelve las dos líneas sin depósito');
select is(public.obtener_comprobante((select id from comps where clave = 'c1'))->'lineas'->0->>'sin_stock', 'true',
  'cada línea informa sin_stock');

-- ============================================================================
-- Regenerar tras anular y respaldo del índice único
-- ============================================================================

reset role;
select throws_ok(
  format($$insert into dominio.comprobantes_venta (organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
    total_sin_iva, total_con_iva, canal, origen_tipo, origen_id)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001',
    'factura', '99999999', 99999999, current_date, 'borrador', 0, 0, 'mostrador', 'reparacion', %L)$$,
    (select id from reps where clave = 'r1')),
  '23505', null, 'el índice impide un segundo comprobante vigente del mismo origen');

update dominio.comprobantes_venta set estado = 'anulada' where id = (select id from comps where clave = 'c1');

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select is(public.comprobante_de_reparacion((select id from reps where clave = 'r1')), null::jsonb,
  'con el comprobante anulado, la reparación vuelve a no tener comprobante vigente');

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into comps (clave, id)
select 'c2', (public.generar_comprobante_reparacion((select id from reps where clave = 'r1'))->>'comprobante_id')::uuid;
select isnt((select id from comps where clave = 'c2'), (select id from comps where clave = 'c1'),
  'tras anular, se genera un comprobante nuevo');
reset role;
select is((select count(*)::int from dominio.comprobantes_venta where origen_id = (select id from reps where clave = 'r1')), 2,
  'el anulado queda como historial junto al nuevo');

-- ============================================================================
-- Aislamiento, anon y RLS
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
-- authenticated lee la factura por columna (sin origen_tipo): se mira por id, que sí está concedida.
select is((select count(*)::int from dominio.comprobantes_venta where id in (select id from comps)), 0,
  'la organización dos no ve comprobantes con origen de la uno');

reset role;
set local role anon;
select throws_ok(
  $$select public.generar_comprobante_reparacion('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'anon no ejecuta generar_comprobante_reparacion');
select throws_ok(
  $$select public.comprobante_de_reparacion('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'anon no ejecuta comprobante_de_reparacion');
reset role;

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio') and c.relkind = 'r' and not c.relrowsecurity)::int,
  0, 'toda tabla de public y dominio tiene RLS');

select * from finish();
rollback;
