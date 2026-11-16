-- Seguridad retroactiva de las órdenes de compra: una persona acotada a la empresa A no ve, no recibe ni anula las órdenes de
-- la empresa B de su misma organización; y la fecha de recepción no puede ser futura ni anterior a la de la orden.
begin;

select plan(14);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador-a@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B', true);
insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador');
insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor Uno', '20123456786', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, proveedor_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Uno', 'P-1', 50, 'f1000000-0000-0000-0000-000000000001');

insert into dominio.ordenes_compra (id, organizacion_id, empresa_id, proveedor_id, fecha) values
  ('0a000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a',
   'f1000000-0000-0000-0000-000000000001', current_date - 5),
  ('0b000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000b',
   'f1000000-0000-0000-0000-000000000001', current_date - 5);
insert into dominio.ordenes_compra_items (orden_id, organizacion_id, producto_id, cantidad) values
  ('0a000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 3),
  ('0b000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 4);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Persona acotada a la empresa A.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is((select count(*)::int from dominio.ordenes_compra), 1, 'solo ve la orden de su empresa (política)');
select is((select count(*)::int from dominio.ordenes_compra_items), 1, 'solo ve las líneas de su empresa (política)');
select is((select count(*)::int from public.listar_ordenes_compra()), 1, 'el listado trae solo su empresa');
select isnt(public.detalle_orden_compra('0a000000-0000-0000-0000-00000000000a'), null, 've el detalle de la orden de su empresa');
select is(public.detalle_orden_compra('0b000000-0000-0000-0000-00000000000b'), null, 'no ve el detalle de la orden de la otra empresa');
select throws_ok(
  $q$select public.cambiar_estado_orden_compra('0b000000-0000-0000-0000-00000000000b', 'recibida')$q$,
  '22023', 'La orden no existe', 'no puede recibir la orden de la otra empresa');
select throws_ok(
  $q$select public.cambiar_estado_orden_compra('0b000000-0000-0000-0000-00000000000b', 'anulada', null, 'Motivo válido')$q$,
  '22023', 'La orden no existe', 'no puede anular la orden de la otra empresa');

-- Fecha de recepción.
select throws_ok(
  $q$select public.cambiar_estado_orden_compra('0a000000-0000-0000-0000-00000000000a', 'recibida', current_date + 1)$q$,
  '22023', null, 'la recepción no puede ser futura');
select throws_ok(
  $q$select public.cambiar_estado_orden_compra('0a000000-0000-0000-0000-00000000000a', 'recibida', current_date - 6)$q$,
  '22023', null, 'la recepción no puede ser anterior a la fecha de la orden');
select lives_ok(
  $q$select public.cambiar_estado_orden_compra('0a000000-0000-0000-0000-00000000000a', 'recibida', current_date - 2)$q$,
  'una fecha válida se acepta');

-- La orden de B quedó intacta.
reset role;
select is((select estado from dominio.ordenes_compra where id = '0b000000-0000-0000-0000-00000000000b'), 'emitida', 'la orden de la otra empresa no cambió');

-- El administrador ve todas las empresas.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.listar_ordenes_compra()), 2, 'el administrador ve las órdenes de ambas empresas');
select isnt(public.detalle_orden_compra('0b000000-0000-0000-0000-00000000000b'), null, 'el administrador ve el detalle de la empresa B');
select lives_ok(
  $q$select public.cambiar_estado_orden_compra('0b000000-0000-0000-0000-00000000000b', 'anulada', null, 'Motivo válido')$q$,
  'el administrador anula la orden de la empresa B');

select * from finish();
rollback;
