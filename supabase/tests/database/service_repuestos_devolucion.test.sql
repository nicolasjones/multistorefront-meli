-- F-SVC-11 (MSF-402, épica MSF-217): devolución de repuestos al quitar un ítem (SC-004).
-- Cubre: devolución al depósito original (FR-020), idempotencia (FR-021: segundo intento P0002 e índice único de
-- `referencia`), pendientes / libres / mano de obra sin movimiento (FR-024), devolución a un depósito hoy inactivo
-- (FR-026), gate por rol, `anon` y aislamiento entre organizaciones.
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
  (select count(*) from unnest(array['public.quitar_item_reparacion(uuid)']) as f
    where has_function_privilege('anon', f::regprocedure, 'execute'))::int,
  0, 'anon no ejecuta quitar_item_reparacion');
select ok(
  not has_function_privilege('authenticated', 'private.devolver_stock_item_reparacion(uuid,uuid)'::regprocedure, 'execute'),
  'la función interna de devolución no se ejecuta desde la API');

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
from unnest(array['r1','r2']) as c;


-- Dos repuestos descontados (Principio 2 u. y Local 1 u.), uno libre y uno de mano de obra.
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 2, 50);
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', 'Del local', 'b1000000-0000-0000-0000-000000000001', 1, 60, 'd1000000-0000-0000-0000-000000000002');
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'repuesto', 'Tornillo libre', null, 4, 5);
select public.agregar_item_reparacion((select id from reps where clave = 'r1'), 'mano_obra', 'Cambio de pantalla', null, 1, 200);

create temp table items (clave text primary key, id uuid);
grant select, insert on items to public;
insert into items (clave, id)
select case when i.deposito_id = (select principal from datos) then 'principal'
            when i.deposito_id is not null then 'local'
            when i.tipo = 'mano_obra' then 'mano' else 'libre' end, i.id
  from dominio.reparacion_items i where i.reparacion_id = (select id from reps where clave = 'r1');

select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 5,
  'punto de partida: 8 − 3 descontadas = 5 en total');

-- ============================================================================
-- Devolución al quitar (FR-020, FR-026)
-- ============================================================================

select lives_ok($$select public.quitar_item_reparacion((select id from items where clave = 'principal'))$$,
  'quitar un repuesto descontado funciona');
select is(
  (select cantidad from dominio.existencias_deposito
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and deposito_id = (select principal from datos)),
  5, 'las 2 unidades vuelven al depósito original (3 + 2)');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 7,
  'el total de existencias sube lo mismo');
select is(
  (select tipo || ':' || diferencia || ':' || origen || ':' || (reparacion_id = (select id from reps where clave = 'r1'))::text
          || ':' || (deposito_id = (select principal from datos))::text
     from dominio.movimientos_stock where referencia like '%' || (select id from items where clave = 'principal') || ':devolucion'),
  'entrada:2:service:true:true', 'el libro registra una entrada con origen service, la reparación y el depósito');
select is(
  (select count(*) from dominio.reparacion_items where id = (select id from items where clave = 'principal'))::int,
  0, 'el ítem se borró');
select is(
  (select total_repuestos from dominio.reparaciones where id = (select id from reps where clave = 'r1')),
  80.00::numeric, 'los totales se recalcularon (60 + 4 × 5)');

-- ============================================================================
-- Idempotencia (FR-021)
-- ============================================================================

select throws_ok($$select public.quitar_item_reparacion((select id from items where clave = 'principal'))$$,
  'P0002', null, 'el segundo intento sobre el mismo ítem es P0002');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'), 7,
  'el segundo intento no devuelve de nuevo');
reset role;
select throws_ok(
  $$insert into dominio.movimientos_stock (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha, origen, referencia)
    select organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha, origen, referencia
      from dominio.movimientos_stock where referencia like '%:devolucion' limit 1$$,
  '23505', null, 'la referencia única impide una segunda entrada');
select pg_temp.como('e1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Devolución a un depósito hoy inactivo (FR-026)
-- ============================================================================

reset role;
update dominio.depositos set activo = false where id = 'd1000000-0000-0000-0000-000000000002';
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.quitar_item_reparacion((select id from items where clave = 'local'))$$,
  'quitar con el depósito original inactivo funciona');
select is(
  (select cantidad from dominio.existencias_deposito
    where producto_id = 'b1000000-0000-0000-0000-000000000001' and deposito_id = 'd1000000-0000-0000-0000-000000000002'),
  3, 'la unidad vuelve al depósito original aunque esté inactivo (2 + 1)');

-- ============================================================================
-- Sin movimiento (FR-024)
-- ============================================================================

select lives_ok($$select public.quitar_item_reparacion((select id from items where clave = 'libre'))$$, 'quitar un repuesto libre funciona');
select lives_ok($$select public.quitar_item_reparacion((select id from items where clave = 'mano'))$$, 'quitar mano de obra funciona');
select is(
  (select count(*) from dominio.movimientos_stock where origen = 'service' and tipo = 'entrada')::int,
  2, 'solo los dos repuestos descontados dejaron entrada; libre y mano de obra no mueven stock');

-- ============================================================================
-- Permisos y aislamiento
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select public.agregar_item_reparacion((select id from reps where clave = 'r2'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 50);
insert into items (clave, id) select 'r2', id from dominio.reparacion_items where reparacion_id = (select id from reps where clave = 'r2');

select pg_temp.como('e1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.quitar_item_reparacion((select id from items where clave = 'r2'))$$,
  '42501', null, 'consulta (lectura) no quita ítems');
select pg_temp.como('e1000000-0000-0000-0000-000000000005');
select throws_ok($$select public.quitar_item_reparacion((select id from items where clave = 'r2'))$$,
  '42501', null, 'depósito (ninguno) no quita ítems');
select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.quitar_item_reparacion((select id from items where clave = 'r2'))$$,
  'P0002', null, 'otra organización no ve el ítem');
reset role;
set local role anon;
select throws_ok($$select public.quitar_item_reparacion(gen_random_uuid())$$,
  '42501', null, 'anon no ejecuta quitar_item_reparacion');
reset role;
select is((select cantidad from dominio.existencias_deposito
            where producto_id = 'b1000000-0000-0000-0000-000000000001' and deposito_id = (select principal from datos)), 4,
  'los intentos rechazados no movieron stock (5 − 1 del r2)');

select * from finish();
rollback;
