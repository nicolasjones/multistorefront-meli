-- F-SVC-06 (MSF-362, épica MSF-199): ítems y costos de la reparación (SC-004).
-- Cubre: totales tras agregar/quitar, bloqueo de fila (`for update`) contra cargas simultáneas, cantidad y
-- precio inválidos, entregada/anulada rechazadas (55000), producto ajeno/inactivo, ganancia enmascarada
-- sin `ver_costos`, aislamiento entre organizaciones, `anon` sin ejecución, ningún movimiento de stock y
-- actividad `reparacion.item_*`. La concurrencia real no cabe en una transacción: se prueba el bloqueo de
-- fila en el código de la compuerta común.
-- Matriz vigente de `service_tecnico`: administrador `edicion` + `ver_costos`; operador `edicion`;
-- consulta y administración `lectura`; depósito `ninguno`.
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

-- El operador y la consulta solo acceden a San Javucho.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null),
  ('c6000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 10, 'Cliente de la Dos', 'minorista', null);

-- «A pedido»: no mueve stock (el descuento de los demás productos lo cubre service_repuestos_stock.test.sql).
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, activo, disponibilidad_manual) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pantalla Switch', 'PAN-1', 100, true, 'a_pedido'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Producto inactivo', 'INA-1', 100, false, null),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de la Dos', 'DOS-1', 100, true, null);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' and cierra order by orden limit 1) as cierra_uno;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

create temp table items (clave text primary key, id uuid);
grant select, insert on items to public;

-- ============================================================================
-- Privilegios y diseño
-- ============================================================================

select is(
  (select count(*) from unnest(array[
    'public.agregar_item_reparacion(uuid,text,text,uuid,numeric,numeric,uuid,boolean)',
    'public.quitar_item_reparacion(uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de ítems');
select is(
  (select count(*) from unnest(array[
    'public.agregar_item_reparacion(uuid,text,text,uuid,numeric,numeric,uuid,boolean)',
    'public.quitar_item_reparacion(uuid)'
  ]) as f where has_function_privilege('authenticated', f::regprocedure, 'execute'))::int,
  2, 'authenticated ejecuta las dos RPC de ítems');
select ok(
  (select prosrc like '%for update%' from pg_proc where oid = 'private.bloquear_reparacion_para_items(uuid)'::regprocedure),
  'la compuerta común bloquea la reparación (for update): dos cargas simultáneas se serializan');
select ok(
  (select bool_and(prosrc like '%bloquear_reparacion_para_items%' and prosrc like '%recalcular_totales_reparacion%')
     from pg_proc where oid in ('public.agregar_item_reparacion(uuid,text,text,uuid,numeric,numeric,uuid,boolean)'::regprocedure,
                                'public.quitar_item_reparacion(uuid)'::regprocedure)),
  'las dos RPC bloquean y recalculan en la misma transacción');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'dominio' and table_name = 'reparacion_items'
      and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT')::int,
  0, 'reparacion_items no admite escritura directa');
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'dominio' and table_name = 'reparacion_items' and grantee = 'anon')::int,
  0, 'anon no tiene ningún privilegio sobre reparacion_items');
select ok(
  (select relrowsecurity from pg_class where oid = 'dominio.reparacion_items'::regclass),
  'reparacion_items tiene RLS activada');
select is(
  (select count(*) from information_schema.column_privileges
    where table_schema = 'dominio' and table_name = 'reparaciones'
      and column_name in ('total_mano_obra', 'total_repuestos')
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE'))::int,
  0, 'los totales no se escriben directamente');

-- ============================================================================
-- Totales tras agregar y quitar
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into reps (clave, id)
select 'r1', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'r2', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'otra_tienda', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;

select is(
  (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'total_cliente')::numeric,
  0::numeric, 'una reparación sin ítems tiene total 0');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r1'))->'items',
  '[]'::jsonb, 'una reparación sin ítems devuelve una lista vacía');

insert into items (clave, id)
select 'mo1', (public.agregar_item_reparacion(
  (select id from reps where clave = 'r1'), 'mano_obra', '  Cambio de pantalla  ', null, 2, 1500.50
)->'items'->0->>'id')::uuid;

select is(
  (select total_mano_obra from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  3001.00::numeric, 'el total de mano de obra suma cantidad × precio');
select is(
  (select descripcion from dominio.reparacion_items where id = (select id from items where clave = 'mo1')),
  'Cambio de pantalla', 'la descripción se recorta');
select is(
  (select subtotal from dominio.reparacion_items where id = (select id from items where clave = 'mo1')),
  3001.00::numeric, 'el subtotal es cantidad × precio con dos decimales');

insert into items (clave, id)
select 'rep1', (select (e->>'id')::uuid from jsonb_array_elements(public.agregar_item_reparacion(
  (select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 3, 0.10
)->'items') e where e->>'tipo' = 'repuesto');

select is(
  (select descripcion from dominio.reparacion_items where id = (select id from items where clave = 'rep1')),
  'Pantalla Switch', 'sin descripción, el repuesto toma el nombre del producto');
select is(
  (select subtotal from dominio.reparacion_items where id = (select id from items where clave = 'rep1')),
  0.30::numeric, 'el subtotal redondea a dos decimales (3 × 0,10)');

insert into items (clave, id)
select 'rep2', (select (e->>'id')::uuid from jsonb_array_elements(public.agregar_item_reparacion(
  (select id from reps where clave = 'r1'), 'repuesto', 'Cinta flex libre', null, 1, 200
)->'items') e where e->>'descripcion' = 'Cinta flex libre');

select is(
  (select total_repuestos from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  200.30::numeric, 'el total de repuestos suma los dos repuestos');
select is(
  (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'total_cliente')::numeric,
  3201.30::numeric, 'total al cliente = mano de obra + repuestos');
select is(
  jsonb_array_length(public.obtener_reparacion((select id from reps where clave = 'r1'))->'items'),
  3, 'obtener_reparacion devuelve los tres ítems');
select is(
  (select e->>'sku' from jsonb_array_elements(public.obtener_reparacion((select id from reps where clave = 'r1'))->'items') e
    where e->>'descripcion' = 'Pantalla Switch'),
  'PAN-1', 'el ítem vinculado devuelve el SKU del producto');

select public.quitar_item_reparacion((select id from items where clave = 'rep2'));
select is(
  (select total_repuestos from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  0.30::numeric, 'quitar un ítem recalcula el total de repuestos');
select throws_ok(
  $$select public.quitar_item_reparacion((select id from items where clave = 'rep2'))$$,
  'P0002', null, 'quitar un ítem ya quitado es P0002');

-- ============================================================================
-- Validaciones
-- ============================================================================

select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', null, 0, 10)$$,
  '22023', null, 'cantidad 0 se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', null, 10000, 10)$$,
  '22023', null, 'cantidad 10000 se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', null, 1.5, 10)$$,
  '22023', null, 'cantidad decimal se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', null, null, 10)$$,
  '22023', null, 'cantidad nula se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', null, 1, -1)$$,
  '22023', null, 'precio negativo se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', null, 1, 100000000)$$,
  '22023', null, 'precio mayor al máximo se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', null, 1, 99999999.995)$$,
  '22023', null, 'precio que redondea por encima del máximo se rechaza con 22023 (no overflow 22003)');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', null, 1, null)$$,
  '22023', null, 'precio nulo se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', '   ', null, 1, 10)$$,
  '22023', null, 'descripción vacía se rechaza');
select throws_ok(
  format($$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', %L, null, 1, 10)$$, repeat('a', 201)),
  '22023', null, 'descripción de más de 200 caracteres se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'otro', 'X', null, 1, 10)$$,
  '22023', null, 'tipo inválido se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'X', 'b1000000-0000-0000-0000-000000000001', 1, 10)$$,
  '22023', null, 'una mano de obra no se vincula a un producto');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'repuesto', 'X', 'b2000000-0000-0000-0000-000000000001', 1, 10)$$,
  '22023', null, 'un producto de otra organización se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'repuesto', 'X', 'b1000000-0000-0000-0000-000000000002', 1, 10)$$,
  '22023', null, 'un producto inactivo se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'repuesto', 'X', gen_random_uuid(), 1, 10)$$,
  '22023', null, 'un producto inexistente se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion(gen_random_uuid(), 'mano_obra', 'X', null, 1, 10)$$,
  'P0002', null, 'una reparación inexistente se rechaza');
select is(
  (select count(*) from dominio.reparacion_items where reparacion_id = (select id from reps where clave = 'r2'))::int,
  0, 'ningún intento inválido dejó un ítem');
select is(
  (select total_mano_obra + total_repuestos from dominio.reparaciones where id = (select id from reps where clave = 'r2')),
  0::numeric, 'ningún intento inválido movió los totales');

-- Un precio 0 y el máximo de cantidad son válidos.
select lives_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'mano_obra', 'Cortesía', null, 9999, 0)$$,
  'precio 0 y cantidad 9999 son válidos');

-- ============================================================================
-- Ganancia estimada y costos internos
-- ============================================================================

select public.actualizar_reparacion(
  (select id from reps where clave = 'r1'),
  (select updated_at from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos),
  p_costo_mano_obra => 1000, p_costo_repuestos => 100);
select is(
  (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'ganancia_estimada')::numeric,
  1901.30::numeric, 'con ver_costos la ganancia es total al cliente − costos internos');

-- ============================================================================
-- Roles: operador (edición sin ver_costos), consulta, depósito
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select is(
  public.obtener_reparacion((select id from reps where clave = 'r1'))->'ganancia_estimada',
  'null'::jsonb, 'sin ver_costos la ganancia llega nula');
select is(
  (public.obtener_reparacion((select id from reps where clave = 'r1'))->>'total_cliente')::numeric,
  3001.30::numeric, 'sin ver_costos el total al cliente se ve igual');
select lives_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'Limpieza', null, 1, 50)$$,
  'el operador (edición) agrega ítems');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'otra_tienda'), 'mano_obra', 'X', null, 1, 10)$$,
  'P0002', null, 'el operador no carga ítems en una tienda a la que no accede (como inexistente)');

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'X', null, 1, 10)$$,
  '42501', null, 'con lectura no se agregan ítems');
select throws_ok(
  $$select public.quitar_item_reparacion((select id from items where clave = 'mo1'))$$,
  '42501', null, 'con lectura no se quitan ítems');
select is(
  (select count(*) from dominio.reparacion_items where reparacion_id = (select id from reps where clave = 'r1'))::int,
  3, 'con lectura se leen los ítems de sus tiendas');
select is(
  (select count(*) from dominio.reparacion_items where reparacion_id = (select id from reps where clave = 'otra_tienda'))::int,
  0, 'con lectura no se leen los ítems de una tienda inaccesible');
select throws_ok(
  $$insert into dominio.reparacion_items (reparacion_id, tipo, descripcion, cantidad, precio_unitario)
    values ((select id from reps where clave = 'r1'), 'mano_obra', 'X', 1, 1)$$,
  '42501', null, 'no hay insert directo en reparacion_items');

select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'X', null, 1, 10)$$,
  '42501', null, 'sin acceso a Service técnico no se agregan ítems');
select is(
  (select count(*) from dominio.reparacion_items)::int,
  0, 'sin acceso a Service técnico no se leen ítems');

-- ============================================================================
-- Entregada y anulada: solo lectura
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into reps (clave, id)
select 'entregada', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;
insert into reps (clave, id)
select 'anulada', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;

insert into items (clave, id)
select 'ent1', (public.agregar_item_reparacion(
  (select id from reps where clave = 'entregada'), 'mano_obra', 'Antes de entregar', null, 1, 100
)->'items'->0->>'id')::uuid;
insert into items (clave, id)
select 'anu1', (public.agregar_item_reparacion(
  (select id from reps where clave = 'anulada'), 'mano_obra', 'Antes de anular', null, 1, 100
)->'items'->0->>'id')::uuid;

select public.registrar_entrega_reparacion(
  (select id from reps where clave = 'entregada'), (select cierra_uno from datos), (now() at time zone 'America/Argentina/Buenos_Aires')::date, 'Ana');
select public.anular_reparacion((select id from reps where clave = 'anulada'), 'Duplicada');

select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'entregada'), 'mano_obra', 'X', null, 1, 10)$$,
  '55000', null, 'una reparación entregada no admite ítems nuevos');
select throws_ok(
  $$select public.quitar_item_reparacion((select id from items where clave = 'ent1'))$$,
  '55000', null, 'una reparación entregada no permite quitar ítems');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'anulada'), 'mano_obra', 'X', null, 1, 10)$$,
  '55000', null, 'una reparación anulada no admite ítems nuevos');
select throws_ok(
  $$select public.quitar_item_reparacion((select id from items where clave = 'anu1'))$$,
  '55000', null, 'una reparación anulada no permite quitar ítems');
select is(
  (select total_mano_obra from dominio.reparaciones where id = (select id from reps where clave = 'entregada')),
  100::numeric, 'los rechazos no mueven los totales');

-- ============================================================================
-- Actividad y stock
-- ============================================================================

-- Altas válidas: mo1, rep1, rep2, Cortesía, Limpieza, ent1 y anu1.
select is(
  (select count(*) from public.registro_actividad where tipo = 'reparacion.item_agregado' and organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  7, 'cada alta de ítem registra reparacion.item_agregado (y ningún intento inválido)');
select is(
  (select count(*) from public.registro_actividad where tipo = 'reparacion.item_quitado' and organizacion_id = '11111111-1111-1111-1111-111111111111')::int,
  1, 'cada baja registra reparacion.item_quitado');
select ok(
  (select bool_and(detalle like '%R-%' and detalle !~ '[0-9a-f]{8}-[0-9a-f]{4}')
     from public.registro_actividad where tipo like 'reparacion.item_%'),
  'el detalle de la actividad usa el código visible, no ids');
select is(
  (select count(*) from public.registro_actividad where tipo like 'reparacion.item_%' and empresa_id is null)::int,
  0, 'la actividad de ítems lleva la tienda de la reparación');

-- MSF-217 (F-SVC-10): los repuestos del catálogo SÍ descuentan stock; lo cubre service_repuestos_stock.test.sql.

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from dominio.reparacion_items)::int,
  0, 'la otra organización no ve ítems ajenos');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'X', null, 1, 10)$$,
  'P0002', null, 'la otra organización no carga ítems en una reparación ajena');
select throws_ok(
  $$select public.quitar_item_reparacion((select id from items where clave = 'mo1'))$$,
  'P0002', null, 'la otra organización no quita ítems ajenos');

-- ============================================================================
-- anon
-- ============================================================================

reset role;
set local role anon;
select throws_ok(
  $$select public.agregar_item_reparacion(gen_random_uuid(), 'mano_obra', 'X', null, 1, 10)$$,
  '42501', null, 'anon no ejecuta agregar_item_reparacion');
select throws_ok(
  $$select count(*) from dominio.reparacion_items$$,
  '42501', null, 'anon no lee reparacion_items');
reset role;

-- RLS en todas las tablas expuestas, incluida la nueva.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio') and c.relkind = 'r' and not c.relrowsecurity)::int,
  0, 'toda tabla de public y dominio tiene RLS (incluida reparacion_items)');

select * from finish();
rollback;
