-- F-SVC-12 (MSF-412, épica MSF-217): repuesto pendiente de stock (SC-007).
-- Cubre: «dejar pendiente» sin movimiento (FR-030), con stock descuenta, sin la marca sigue el 23514, total al
-- cliente incluido, `pendientes_stock` del listado (FR-032), anuladas no cuentan, quitar un pendiente sin mover
-- stock, gate por rol, `anon` y aislamiento entre organizaciones.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('e1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, activo, disponibilidad_manual) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pantalla Switch', 'PAN-1', 100, true, null);

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal,
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

select is(
  (select count(*) from unnest(array['public.agregar_item_reparacion(uuid,text,text,uuid,numeric,numeric,uuid,boolean)',
                                     'public.listar_reparaciones(uuid,text,text,uuid,integer,integer)']) as f
    where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta las RPC de F-SVC-12');
select is(
  (select count(*) from pg_proc where proname = 'agregar_item_reparacion' and pronamespace = 'public'::regnamespace)::int,
  1, 'desaparece la firma de 7 parámetros: queda una sola agregar_item_reparacion');

-- Stock inicial: 1 unidad de la Pantalla en el depósito principal.
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select public.registrar_movimiento_stock('b1000000-0000-0000-0000-000000000001', 'entrada', 1,
  (select motivo_compra from datos), null, current_date, (select principal from datos));

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into reps (clave, id)
select c, (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid
from unnest(array['r1','r2','r3']) as c;

-- ============================================================================
-- Dejar pendiente (FR-030)
-- ============================================================================

select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 2, 50)$$,
  '23514', 'No hay stock suficiente', 'sin la marca, la falta de stock se rechaza');
select is((select count(*) from dominio.reparacion_items where reparacion_id = (select id from reps where clave = 'r1'))::int, 0,
  'el rechazo no deja ítem');

select lives_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 2, 50, null, true)$$,
  'con «dejar pendiente» y sin stock, el ítem se carga');
select is(
  (select stock_estado || ':' || (deposito_id = (select principal from datos))::text
     from dominio.reparacion_items where reparacion_id = (select id from reps where clave = 'r1')),
  'pendiente:true', 'queda pendiente y con el depósito elegido');
select is((select count(*) from dominio.movimientos_stock where origen = 'service')::int, 0, 'el pendiente no deja movimiento');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 1,
  'el stock no se tocó');
select is((select total_repuestos from dominio.reparaciones where id = (select id from reps where clave = 'r1')), 100.00::numeric,
  'el total al cliente incluye el pendiente (2 × 50)');

-- Con stock suficiente, «dejar pendiente» descuenta como siempre.
select lives_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 50, null, true)$$,
  'con stock y la marca, se carga');
select is((select stock_estado from dominio.reparacion_items where reparacion_id = (select id from reps where clave = 'r2')), 'descontado',
  'hay stock: descuenta y no queda pendiente');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 0, 'el stock bajó a 0');

-- ============================================================================
-- pendientes_stock del listado (FR-032)
-- ============================================================================

create function pg_temp.pendientes(p_clave text) returns int language sql as $$
  select (f->>'pendientes_stock')::int
    from jsonb_array_elements(public.listar_reparaciones(null, 'mes', null, null, 1, 200)->'filas') f
   where (f->>'id')::uuid = (select id from reps where clave = p_clave);
$$;

select is(pg_temp.pendientes('r1'), 1, 'la reparación con un repuesto pendiente cuenta 1');
select is(pg_temp.pendientes('r2'), 0, 'la que descontó no cuenta');
select is(pg_temp.pendientes('r3'), 0, 'la que no tiene repuestos no cuenta');

-- Quitar el pendiente no mueve stock y apaga el indicador.
select lives_ok($$select public.quitar_item_reparacion((select id from dominio.reparacion_items where reparacion_id = (select id from reps where clave = 'r1')))$$,
  'quitar el pendiente funciona');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 0, 'quitar el pendiente no devuelve stock');
select is(pg_temp.pendientes('r1'), 0, 'el indicador desaparece');

-- Anulada: no cuenta.
select public.agregar_item_reparacion((select id from reps where clave = 'r3'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 50, null, true);
select is(pg_temp.pendientes('r3'), 1, 'r3 tiene un pendiente');
select public.anular_reparacion((select id from reps where clave = 'r3'), 'Cliente desistió');
select is(pg_temp.pendientes('r3'), 0, 'una reparación anulada no cuenta como pendiente');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r3'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 50, null, true)$$,
  '55000', null, 'en una reparación anulada no se deja nada pendiente');

-- Entregada: no cuenta.
reset role;
update dominio.reparacion_items set stock_estado = 'pendiente'
 where reparacion_id = (select id from reps where clave = 'r2');
update dominio.reparaciones set entrega_real = now() where id = (select id from reps where clave = 'r2');
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(pg_temp.pendientes('r2'), 0, 'una reparación entregada no cuenta como pendiente');

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 50, null, true)$$,
  '42501', null, 'consulta (lectura) no deja pendientes');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 50, null, true)$$,
  'P0002', null, 'otra organización no ve la reparación');
select is(jsonb_array_length(public.listar_reparaciones(null, 'mes', null, null, 1, 200)->'filas'), 0, 'la otra organización no ve el listado');
reset role;
set local role anon;
select throws_ok($$select public.listar_reparaciones()$$, '42501', null, 'anon no lista reparaciones');
reset role;

select * from finish();
rollback;
