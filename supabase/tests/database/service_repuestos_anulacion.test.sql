-- F-SVC-11 (MSF-402, épica MSF-217): devolución de repuestos al anular una reparación (SC-005).
-- Cubre: devolución de lo descontado (FR-022), «consumido, no se devuelve» (FR-023), `22023` con un consumido ajeno
-- o no descontado, pendientes / libres / mano de obra sin movimiento (FR-024), anulada no se re-anula, gate y `anon`.
-- Una reparación entregada conserva el comportamiento de MSF-182 pero no devuelve stock (ver la migración).
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


select is(
  (select count(*) from pg_proc where proname = 'anular_reparacion' and pronamespace = 'public'::regnamespace)::int,
  1, 'desaparece la firma (uuid, text): queda una sola anular_reparacion');
select ok(
  has_function_privilege('authenticated', 'public.anular_reparacion(uuid,text,uuid[])'::regprocedure, 'execute')
  and not has_function_privilege('anon', 'public.anular_reparacion(uuid,text,uuid[])'::regprocedure, 'execute'),
  'authenticated ejecuta anular_reparacion y anon no');

-- Stock inicial: Principal 5 y Local 3 de la Pantalla (por la vía de Stock).
select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select public.registrar_movimiento_stock('b1000000-0000-0000-0000-000000000001', 'entrada', 5,
  (select motivo_compra from datos), null, current_date, (select principal from datos));
select public.registrar_movimiento_stock('b1000000-0000-0000-0000-000000000001', 'entrada', 3,
  (select motivo_compra from datos), null, current_date, 'd1000000-0000-0000-0000-000000000002');

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into reps (clave, id)
select c, (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid
from unnest(array['r1','r2','r3','r4']) as c;


create temp table items (clave text primary key, id uuid);
grant select, insert on items to public;

-- r1: dos repuestos descontados (principal 2 u., local 1 u.) + libre + mano de obra.
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', 'Principal', 'b1000000-0000-0000-0000-000000000001', 2, 50);
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', 'Local', 'b1000000-0000-0000-0000-000000000001', 1, 60, 'd1000000-0000-0000-0000-000000000002');
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', 'Libre', null, 1, 5);
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'Mano', null, 1, 200);
insert into items (clave, id)
select 'r1-' || lower(i.descripcion), i.id from dominio.reparacion_items i where i.reparacion_id = (select id from reps where clave = 'r1');

-- r2: un repuesto descontado (principal 1 u.), para el rechazo de un consumido ajeno.
select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'repuesto', 'Principal', 'b1000000-0000-0000-0000-000000000001', 1, 50);
insert into items (clave, id)
select 'r2-principal', i.id from dominio.reparacion_items i where i.reparacion_id = (select id from reps where clave = 'r2');

select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 4,
  'punto de partida: 8 − 4 descontadas = 4 en total');

-- ============================================================================
-- Consumidos inválidos (22023): no se anula nada
-- ============================================================================

select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r1'), 'Duplicada', array[(select id from items where clave = 'r2-principal')])$$,
  '22023', null, 'un consumido de otra reparación es 22023');
select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r1'), 'Duplicada', array[(select id from items where clave = 'r1-libre')])$$,
  '22023', null, 'un consumido que no estaba descontado es 22023');
select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r1'), 'Duplicada',
      array[(select id from items where clave = 'r1-local'), (select id from items where clave = 'r1-local')])$$,
  '22023', null, 'un consumido repetido es 22023');
select is(
  (select (anulada_en is null)::text || ':' || (select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001')
     from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  'true:4', 'los rechazos no anulan ni mueven stock');

-- ============================================================================
-- Anulación con un consumido (FR-022, FR-023, FR-024)
-- ============================================================================

select lives_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r1'), 'Cliente desistió', array[(select id from items where clave = 'r1-local')])$$,
  'anular marcando el repuesto del local como consumido');
select is(
  (select cantidad from dominio.existencias_deposito
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and deposito_id = (select principal from datos)),
  4, 'el repuesto no consumido vuelve a su depósito (2 + 2)');
select is(
  (select cantidad from dominio.existencias_deposito
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and deposito_id = 'd1000000-0000-0000-0000-000000000002'),
  2, 'el consumido no vuelve al stock (sigue en 3 − 1)');
select is(
  (select string_agg(descripcion || '=' || stock_estado, ',' order by descripcion) from dominio.reparacion_items
    where reparacion_id = (select id from reps where clave = 'r1')),
  'Libre=sin_movimiento,Local=consumido,Mano=sin_movimiento,Principal=devuelto',
  'las filas quedan marcadas: devuelto, consumido y sin movimiento para libre y mano de obra');
select is(
  (select count(*) from dominio.movimientos_stock
    where origen = 'service' and tipo = 'entrada' and reparacion_id = (select id from reps where clave = 'r1'))::int,
  1, 'una sola entrada en el libro (solo el repuesto devuelto)');
select ok(
  (select anulada_en is not null from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  'la reparación queda anulada');
select throws_ok(
  $$select public.anular_reparacion((select id from reps where clave = 'r1'), 'Otra vez')$$,
  '55000', null, 'una anulada no se re-anula');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 6,
  'el intento de re-anular no devuelve de nuevo');

-- ============================================================================
-- Anulación sin consumidos: se devuelve todo (FR-022)
-- ============================================================================

select lives_ok($$select public.anular_reparacion((select id from reps where clave = 'r2'), 'Error de carga')$$,
  'anular sin consumidos');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 7,
  'el repuesto vuelve al stock');
select is((select stock_estado from dominio.reparacion_items where id = (select id from items where clave = 'r2-principal')),
  'devuelto', 'la fila queda devuelta');

-- ============================================================================
-- Pendientes sin movimiento y permisos (FR-024)
-- ============================================================================

reset role;
insert into dominio.reparacion_items (organizacion_id, reparacion_id, tipo, descripcion, producto_id, cantidad, precio_unitario, stock_estado)
values ('11111111-1111-1111-1111-111111111111', (select id from reps where clave = 'r3'), 'repuesto', 'Pendiente',
        'b1000000-0000-0000-0000-000000000001', 1, 10, 'pendiente');
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.anular_reparacion((select id from reps where clave = 'r3'), 'Sin repuesto')$$, 'anular con un pendiente');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 7,
  'un pendiente no mueve stock al anular');

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.anular_reparacion((select id from reps where clave = 'r4'), 'x')$$,
  '42501', null, 'consulta (lectura) no anula');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.anular_reparacion((select id from reps where clave = 'r4'), 'x')$$,
  'P0002', null, 'otra organización no ve la reparación');
reset role;
set local role anon;
select throws_ok($$select public.anular_reparacion(gen_random_uuid(), 'x')$$,
  '42501', null, 'anon no ejecuta anular_reparacion');
reset role;

select * from finish();
rollback;
