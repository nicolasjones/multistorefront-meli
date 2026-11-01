-- MSF-656: comprobantes, líneas, RMA e ítems solo se leen de las empresas accesibles (además de organización y
-- sección `ventas`). Persona de una sola tienda (A) no ve lo de B; el administrador ve ambas; org ajena no ve nada.
begin;

select plan(14);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'tienda-a@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador');

insert into clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente', 'minorista');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000);

insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Depósito X')
on conflict do nothing;

-- Un comprobante por tienda y uno heredado sin empresa.
insert into dominio.comprobantes_venta (id, organizacion_id, cliente_id, empresa_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', 'factura', 'A-1', current_date - 1, 'confirmado', 100, 100),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000b', 'factura', 'B-1', current_date - 1, 'confirmado', 100, 100),
  ('e1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', null, 'factura', 'S-1', current_date - 1, 'confirmado', 100, 100);

insert into dominio.comprobantes_venta_lineas (id, organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
select ('1a000000-0000-0000-0000-00000000000' || x.k)::uuid, '11111111-1111-1111-1111-111111111111', x.c, 1,
       'b1000000-0000-0000-0000-000000000001', 'Joystick', 1, 100, 'x1',
       (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' limit 1), 100, 0
from (values ('a', 'e1000000-0000-0000-0000-00000000000a'::uuid), ('b', 'e1000000-0000-0000-0000-00000000000b'::uuid)) x(k, c);

insert into dominio.rma (id, organizacion_id, empresa_id, comprobante_id, numero, forma_rma, motivo) values
  ('f9000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'RMA-0001', 'cambio_directo', 'Falla'),
  ('f9000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'RMA-0002', 'cambio_directo', 'Falla');

insert into dominio.rma_items (organizacion_id, rma_id, comprobante_linea_id, producto_id, cantidad) values
  ('11111111-1111-1111-1111-111111111111', 'f9000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 1),
  ('11111111-1111-1111-1111-111111111111', 'f9000000-0000-0000-0000-00000000000b', '1a000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001', 1);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Persona de una sola tienda (A)
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.rma), 1, 'tienda A: solo ve el RMA de su tienda');
select is((select count(*)::int from dominio.rma where empresa_id = 'a1000000-0000-0000-0000-00000000000b'), 0, 'tienda A: no ve el RMA de B');
select is((select count(*)::int from dominio.rma_items), 1, 'tienda A: solo ve los ítems de RMA de su tienda');
select is((select count(*)::int from dominio.comprobantes_venta_lineas), 1, 'tienda A: solo ve las líneas de su tienda');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = 'e1000000-0000-0000-0000-00000000000b'), 0, 'tienda A: no ve líneas de B');
select is((select count(*)::int from dominio.comprobantes_venta where empresa_id = 'a1000000-0000-0000-0000-00000000000b'), 0, 'tienda A: no ve comprobantes de B');
select is((select count(*)::int from dominio.comprobantes_venta), 2, 'tienda A: ve el de A y el heredado sin empresa');

-- Administrador: todas las tiendas de su organización
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.rma), 2, 'administrador: ve los RMA de ambas tiendas');
select is((select count(*)::int from dominio.rma_items), 2, 'administrador: ve los ítems de ambas tiendas');
select is((select count(*)::int from dominio.comprobantes_venta_lineas), 2, 'administrador: ve las líneas de ambas tiendas');
select is((select count(*)::int from dominio.comprobantes_venta), 3, 'administrador: ve todos los comprobantes');

-- Otra organización
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.rma), 0, 'otra organización: no ve RMA');
select is((select count(*)::int from dominio.comprobantes_venta_lineas), 0, 'otra organización: no ve líneas');
select is((select count(*)::int from dominio.comprobantes_venta), 0, 'otra organización: no ve comprobantes');

select * from finish();
rollback;
