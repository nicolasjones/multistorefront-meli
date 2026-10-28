-- F-SVC-10 (MSF-390, épica MSF-217): repuestos que descuentan stock del depósito elegido (SC-001).
-- Cubre: columnas y `check` de reparacion_items / movimientos_stock (FR-001), descuento por depósito con el libro en
-- origen `service` (FR-002, FR-007), rechazo «No hay stock suficiente» sin ítem ni movimiento (FR-003), «a pedido» /
-- libre / mano de obra sin movimiento (FR-005), `depositos_para_repuesto` (FR-006), `obtener_reparacion` con depósito
-- y estado (FR-008), función interna sin `grant` (FR-010), gate por rol, `anon` y aislamiento entre organizaciones
-- (FR-011). La concurrencia (FR-004) está en service_repuestos_concurrencia.test.sql.
-- Matriz vigente de `service_tecnico`: administrador `edicion`; operador `edicion` (y Stock `edicion`);
-- consulta `lectura`; depósito `ninguno`.
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
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, activo, disponibilidad_manual) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pantalla Switch', 'PAN-1', 100, true, null),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Bisagra a pedido', 'BIS-1', 100, true, 'a_pedido'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto de la Dos', 'DOS-1', 100, true, null);

-- Depósitos: el principal ya lo siembra la organización; se suman uno activo y uno inactivo, y el de la otra org.
insert into dominio.depositos (id, organizacion_id, nombre, activo) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Local', true),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cerrado', false);

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal,
    (select id from dominio.depositos where organizacion_id = '22222222-2222-2222-2222-222222222222' and por_defecto) as deposito_dos,
    (select id from dominio.motivos_movimiento where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = 'Compra a proveedor') as motivo_compra;
grant select on datos to public;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Privilegios y diseño (FR-010, FR-011)
-- ============================================================================

select is(
  (select count(*) from unnest(array[
    'public.agregar_item_reparacion(uuid,text,text,uuid,numeric,numeric,uuid,boolean)',
    'public.depositos_para_repuesto(uuid)'
  ]) as f where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de repuestos con stock');
select ok(
  has_function_privilege('authenticated', 'public.agregar_item_reparacion(uuid,text,text,uuid,numeric,numeric,uuid,boolean)'::regprocedure, 'execute')
  and has_function_privilege('authenticated', 'public.depositos_para_repuesto(uuid)'::regprocedure, 'execute'),
  'authenticated ejecuta las RPC de repuestos');
select ok(
  not has_function_privilege('authenticated', 'private.mover_stock_reparacion(uuid,uuid,uuid,uuid,uuid,integer,text)'::regprocedure, 'execute')
  and not has_function_privilege('anon', 'private.mover_stock_reparacion(uuid,uuid,uuid,uuid,uuid,integer,text)'::regprocedure, 'execute'),
  'la función interna de movimiento no se ejecuta desde la API');
select is(
  (select count(*) from pg_proc where proname = 'agregar_item_reparacion' and pronamespace = 'public'::regnamespace)::int,
  1, 'desaparece la firma de 6 parámetros: queda una sola agregar_item_reparacion');
select ok(
  (select relrowsecurity from pg_class where oid = 'dominio.movimientos_stock'::regclass)
  and (select relrowsecurity from pg_class where oid = 'dominio.reparacion_items'::regclass),
  'movimientos_stock y reparacion_items mantienen RLS');

-- ============================================================================
-- Columnas y checks (FR-001, FR-007)
-- ============================================================================

select is(
  (select column_default from information_schema.columns
    where table_schema = 'dominio' and table_name = 'reparacion_items' and column_name = 'stock_estado'),
  '''sin_movimiento''::text', 'los ítems sin dato de stock (previos a la épica) quedan sin_movimiento');
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'dominio' and table_name = 'reparacion_items' and column_name in ('deposito_id', 'stock_estado'))::int,
  2, 'reparacion_items gana deposito_id y stock_estado');
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'dominio' and table_name = 'movimientos_stock' and column_name in ('origen', 'reparacion_id', 'referencia'))::int,
  3, 'movimientos_stock gana origen, reparacion_id y referencia');
select throws_ok(
  $$insert into dominio.movimientos_stock (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha, origen)
    values ('11111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-000000000001', 'salida', 1, -1, 0,
            (select motivo_compra from datos), current_date, 'otro')$$,
  '23514', null, 'el origen solo admite service');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'reparacion_items_stock_estado_check'),
  'CHECK ((stock_estado = ANY (ARRAY[''sin_movimiento''::text, ''descontado''::text, ''pendiente''::text, ''consumido''::text, ''devuelto''::text])))',
  'stock_estado solo admite los cinco valores');

-- ============================================================================
-- Stock inicial: Principal 5 y Local 3 de la Pantalla (por la vía de Stock)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select public.registrar_movimiento_stock('b1000000-0000-0000-0000-000000000001', 'entrada', 5,
  (select motivo_compra from datos), null, current_date, (select principal from datos));
select public.registrar_movimiento_stock('b1000000-0000-0000-0000-000000000001', 'entrada', 3,
  (select motivo_compra from datos), null, current_date, 'd1000000-0000-0000-0000-000000000002');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into reps (clave, id)
select 'r1', (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid;

-- ============================================================================
-- Selector de depósito (FR-006)
-- ============================================================================

select is(
  jsonb_array_length(public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000001')),
  2, 'depositos_para_repuesto devuelve solo los depósitos activos');
select is(
  public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000001')->0->>'nombre',
  'Depósito principal', 'el depósito por defecto va primero');
select is(
  (public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000001')->0->>'disponible')::int,
  5, 'devuelve el disponible del depósito principal');
select is(
  (public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000001')->1->>'disponible')::int,
  3, 'devuelve el disponible del otro depósito');
select is(
  (public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000003')->0->>'disponible')::int,
  0, 'un producto sin existencias en el depósito muestra disponible 0');
select throws_ok(
  $$select public.depositos_para_repuesto('b2000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'un producto de otra organización es P0002');

-- ============================================================================
-- Descuento al agregar (FR-002, FR-007)
-- ============================================================================

-- Sin depósito: usa el por defecto.
select public.agregar_item_reparacion(
  (select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 2, 50);

select is(
  (select cantidad from dominio.existencias_deposito
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and deposito_id = (select principal from datos)),
  3, 'sin p_deposito_id se descuenta del depósito por defecto (5 − 2)');
select is(
  (select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'),
  6, 'el total de existencias baja lo mismo (8 − 2)');
select is(
  (select stock_estado || ':' || (deposito_id = (select principal from datos))::text from dominio.reparacion_items
    where reparacion_id = (select id from reps where clave = 'r1') and producto_id = 'b1000000-0000-0000-0000-000000000001'),
  'descontado:true', 'el ítem queda descontado con su depósito');
select is(
  (select total_repuestos from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  100.00::numeric, 'los totales se recalculan en la misma operación');

-- Con depósito elegido.
select public.agregar_item_reparacion(
  (select id from reps where clave = 'r1'), 'repuesto', 'Pantalla del local', 'b1000000-0000-0000-0000-000000000001', 1, 60,
  'd1000000-0000-0000-0000-000000000002');
select is(
  (select cantidad from dominio.existencias_deposito
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and deposito_id = 'd1000000-0000-0000-0000-000000000002'),
  2, 'con p_deposito_id se descuenta del depósito elegido (3 − 1)');

select is(
  (select count(*) from dominio.movimientos_stock
    where origen = 'service' and reparacion_id = (select id from reps where clave = 'r1'))::int,
  2, 'cada descuento deja un movimiento con origen service y la reparación');
select is(
  (select tipo || ':' || diferencia || ':' || cantidad || ':' || (actor_id = 'e1000000-0000-0000-0000-000000000001')::text
     || ':' || (deposito_id = (select principal from datos))::text
   from dominio.movimientos_stock
   where origen = 'service' and producto_id = 'b1000000-0000-0000-0000-000000000001' and cantidad = 2),
  'salida:-2:2:true:true', 'el movimiento es una salida con diferencia negativa, actor y depósito');
select is(
  (select saldo from dominio.movimientos_stock where origen = 'service' and cantidad = 2),
  6, 'el saldo del libro es el total único tras el movimiento');
select is(
  (select m.referencia = 'reparacion:' || i.reparacion_id || ':item:' || i.id || ':salida'
     from dominio.movimientos_stock m
     join dominio.reparacion_items i on i.reparacion_id = m.reparacion_id and i.producto_id = m.producto_id and i.cantidad = m.cantidad
    where m.origen = 'service' and m.cantidad = 2),
  true, 'la referencia sigue el formato reparacion:<id>:item:<item>:salida');
select is(
  (select nombre from dominio.motivos_movimiento m
    where m.id = (select motivo_id from dominio.movimientos_stock where origen = 'service' and cantidad = 2)),
  'Repuesto de reparación', 'el movimiento usa el motivo de sistema «Repuesto de reparación»');

-- ============================================================================
-- Barrera «No hay stock suficiente» (FR-003)
-- ============================================================================

reset role;
create temp table antes as
  select (select count(*) from dominio.movimientos_stock) as movimientos,
         (select count(*) from dominio.reparacion_items) as items,
         (select total_repuestos from dominio.reparaciones where id = (select id from reps where clave = 'r1')) as total,
         (select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001') as stock;
grant select on antes to public;
select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 3, 10, 'd1000000-0000-0000-0000-000000000002')$$,
  '23514', 'No hay stock suficiente', 'pedir más que el disponible del depósito es 23514');
select is(
  (select count(*) from dominio.movimientos_stock)::int, (select movimientos from antes)::int, 'el rechazo no deja movimiento');
select is(
  (select count(*) from dominio.reparacion_items)::int, (select items from antes)::int, 'el rechazo no deja ítem');
select is(
  (select total_repuestos from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  (select total from antes), 'el rechazo no cambia los totales');
select is(
  (select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'),
  (select stock from antes), 'el rechazo no cambia el stock');

-- El stock de otro depósito no alcanza para cubrir el elegido: Local tiene 2, el principal 3.
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 4, 10)$$,
  '23514', null, 'el disponible que cuenta es el del depósito elegido, no el total');

-- ============================================================================
-- Sin movimiento (FR-005)
-- ============================================================================

select public.agregar_item_reparacion(
  (select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000003', 50, 10);
select public.agregar_item_reparacion(
  (select id from reps where clave = 'r1'), 'repuesto', 'Cinta flex libre', null, 99, 10, (select principal from datos));
select public.agregar_item_reparacion(
  (select id from reps where clave = 'r1'), 'mano_obra', 'Diagnóstico', null, 1, 500, (select principal from datos));

select is(
  (select count(*) from dominio.reparacion_items
    where reparacion_id = (select id from reps where clave = 'r1')
      and descripcion in ('Bisagra a pedido', 'Cinta flex libre', 'Diagnóstico')
      and stock_estado = 'sin_movimiento' and deposito_id is null)::int,
  3, '«a pedido», repuesto libre y mano de obra quedan sin_movimiento y sin depósito');
select is(
  (select count(*) from dominio.movimientos_stock)::int, (select movimientos from antes)::int,
  'esos tres ítems no dejaron movimientos de stock');

-- ============================================================================
-- Depósito inválido (FR-002) y validaciones previas
-- ============================================================================

select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 10, 'd1000000-0000-0000-0000-000000000003')$$,
  '22023', null, 'un depósito inactivo se rechaza');
select throws_ok(
  format($$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 10, %L)$$,
    (select deposito_dos from datos)),
  '22023', null, 'un depósito de otra organización se rechaza');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 10, gen_random_uuid())$$,
  '22023', null, 'un depósito inexistente se rechaza');
select is(
  (select count(*) from dominio.movimientos_stock)::int, (select movimientos from antes)::int,
  'los depósitos inválidos no dejaron movimientos');

-- ============================================================================
-- obtener_reparacion (FR-008)
-- ============================================================================

select is(
  (select e->>'deposito_nombre' || ':' || (e->>'stock_estado')
     from jsonb_array_elements(public.obtener_reparacion((select id from reps where clave = 'r1'))->'items') e
    where e->>'descripcion' = 'Pantalla del local'),
  'Local:descontado', 'obtener_reparacion devuelve deposito_nombre y stock_estado del ítem');
select is(
  (select (e->'deposito_nombre')::text || ':' || (e->>'stock_estado')
     from jsonb_array_elements(public.obtener_reparacion((select id from reps where clave = 'r1'))->'items') e
    where e->>'descripcion' = 'Diagnóstico'),
  'null:sin_movimiento', 'un ítem sin movimiento devuelve deposito_nombre nulo');
select ok(
  (select e ? 'deposito_id' and e ? 'sku' and e ? 'subtotal'
     from jsonb_array_elements(public.obtener_reparacion((select id from reps where clave = 'r1'))->'items') e limit 1),
  'las claves vigentes del ítem no cambian');

-- ============================================================================
-- Roles y aislamiento (FR-011)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 10)$$,
  '42501', null, 'con lectura no se agregan repuestos');
select is(
  jsonb_array_length(public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000001')),
  2, 'con lectura se consulta el selector de depósitos (sin exigir Stock)');

select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 10)$$,
  '42501', null, 'sin acceso a Service no se agregan repuestos');
select throws_ok(
  $$select public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'sin acceso a Service no se consulta el selector');

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select is(
  jsonb_array_length(public.depositos_para_repuesto('b2000000-0000-0000-0000-000000000001')),
  1, 'la otra organización ve solo sus depósitos');
select throws_ok(
  $$select public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'la otra organización no consulta productos ajenos');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b2000000-0000-0000-0000-000000000001', 1, 10)$$,
  'P0002', null, 'la otra organización no agrega ítems a una reparación ajena');
select is(
  (select count(*) from dominio.movimientos_stock where origen = 'service')::int,
  0, 'la otra organización no lee los movimientos de Service de la primera');

reset role;
set local role anon;
select throws_ok(
  $$select public.agregar_item_reparacion(gen_random_uuid(), 'mano_obra', 'X', null, 1, 10)$$,
  '42501', null, 'anon no ejecuta agregar_item_reparacion');
select throws_ok(
  $$select public.depositos_para_repuesto('b1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon no ejecuta depositos_para_repuesto');

reset role;
select * from finish();

rollback;
