-- F-SVC-10 (MSF-390, épica MSF-217, FR-004, SC-002): dos repuestos del último artículo.
-- Un solo backend de pgTAP no puede simular dos transacciones simultáneas (patrón de
-- stock_lotes_concurrencia.test.sql). Se prueba (1) el contrato observable: de dos cargas del último artículo gana
-- una, la otra recibe «No hay stock suficiente» y el saldo nunca baja de 0; y (2) que la barrera es la de
-- `aplicar_movimiento_deposito`, que toma el `for update` de `existencias` por producto ANTES de leer el
-- disponible: con dos sesiones reales la segunda espera y ve el resultado de la primera.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Último artículo', 'ULT-1', 100, true);

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
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

-- La barrera serializa por producto antes de mirar el disponible.
select ok(
  (select position('for update' in p.prosrc) > 0
      and position('dominio.existencias e' in p.prosrc) < position('for update' in p.prosrc)
      and position('for update' in p.prosrc) < position('v_disponible - v_necesita < 0' in p.prosrc)
     from pg_proc p where p.oid = 'private.aplicar_movimiento_deposito(uuid,uuid,uuid,integer,integer,boolean)'::regprocedure),
  'aplicar_movimiento_deposito toma el for update de existencias antes de comparar el disponible');
select ok(
  (select position('mover_stock_reparacion' in p.prosrc) > position('insert into dominio.reparacion_items' in p.prosrc)
      and position('insert into dominio.reparacion_items' in p.prosrc) > 0
     from pg_proc p where p.oid = 'public.agregar_item_reparacion(uuid,text,text,uuid,numeric,numeric,uuid)'::regprocedure),
  'agregar_item_reparacion descuenta por la rutina compartida, en la misma función que inserta el ítem');
select ok(
  (select position('aplicar_movimiento_deposito' in p.prosrc) > 0
     from pg_proc p where p.oid = 'private.mover_stock_reparacion(uuid,uuid,uuid,uuid,uuid,integer,text)'::regprocedure),
  'mover_stock_reparacion usa la barrera de aplicar_movimiento_deposito');

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select public.registrar_movimiento_stock('b1000000-0000-0000-0000-000000000001', 'entrada', 1, (select motivo_compra from datos));

insert into reps (clave, id)
select 'a', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;
insert into reps (clave, id)
select 'b', (public.crear_reparacion('a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos))->>'id')::uuid;

select lives_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'a'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 10)$$,
  'la primera carga del último artículo gana');
select throws_ok(
  $$select public.agregar_item_reparacion((select id from reps where clave = 'b'), 'repuesto', '', 'b1000000-0000-0000-0000-000000000001', 1, 10)$$,
  '23514', 'No hay stock suficiente', 'la segunda carga recibe «No hay stock suficiente»');

reset role;
select is(
  (select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000001'),
  0, 'el saldo queda en 0, nunca negativo');
select is(
  (select cantidad from dominio.existencias_deposito where producto_id = 'b1000000-0000-0000-0000-000000000001'),
  0, 'el saldo del depósito queda en 0');
select is(
  (select count(*) from dominio.movimientos_stock where origen = 'service')::int,
  1, 'solo la carga ganadora dejó movimiento');
select is(
  (select count(*) from dominio.reparacion_items where producto_id = 'b1000000-0000-0000-0000-000000000001')::int,
  1, 'solo la carga ganadora dejó ítem');

select * from finish();

rollback;
