-- F-STK-14 (MSF-316, devolución del Revisor): anular un ingreso saca el stock del depósito donde
-- entró, aunque el depósito por defecto haya cambiado entre el ingreso y la anulación.
begin;

select plan(6);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno', true);
insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor Uno', '20123456786', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Uno', 'P-1', 50);

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select public.registrar_ingreso_mercaderia(
  'e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', current_date, 'R-1',
  jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 5, 'costo_unitario_usd', 10)),
  false, '10000000-0000-4000-8000-000000000001'
);

select is(
  (select x.cantidad from dominio.existencias_deposito x join dominio.depositos d on d.id = x.deposito_id where d.por_defecto),
  5, 'el ingreso entra al depósito por defecto original'
);

-- El por defecto pasa a otro depósito (sin stock) antes de anular.
select public.crear_deposito('Depósito Nuevo');
select public.definir_deposito_por_defecto((select id from dominio.depositos where nombre = 'Depósito Nuevo'));

select lives_ok(
  $$select public.anular_ingreso_mercaderia((select id from dominio.ingresos_mercaderia limit 1), 'Carga equivocada')$$,
  'anular funciona aunque el por defecto cambió'
);
select is(
  (select coalesce(sum(x.cantidad), 0)::int from dominio.existencias_deposito x
    join dominio.depositos d on d.id = x.deposito_id where d.nombre = 'Depósito Nuevo'),
  0, 'el depósito nuevo no recibe la salida'
);
select is(
  (select coalesce(sum(x.cantidad), 0)::int from dominio.existencias_deposito x
    join dominio.depositos d on d.id = x.deposito_id where d.nombre <> 'Depósito Nuevo'),
  0, 'el depósito original vuelve a 0'
);
select is(
  (select m.deposito_id from dominio.movimientos_stock m where m.tipo = 'salida'),
  (select m.deposito_id from dominio.movimientos_stock m where m.tipo = 'entrada'),
  'la salida de anulación queda en el depósito de la entrada'
);
select is((select cantidad from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000001'), 0, 'el total vuelve a 0');

select * from finish();
rollback;
