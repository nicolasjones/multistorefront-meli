-- MSF-621: `listar_movimientos_stock` devuelve en la nota el número del comprobante, no su referencia interna.
-- Cubre la referencia con y sin `:linea:N`, el comprobante que no existe, el de otra organización, una nota
-- sin referencia y que el resto de la nota se conserva.
begin;

select plan(15);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'deposito@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deposito');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'JOY-1', 50);

insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 101, 'Alfa', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 201, 'Beta', 'minorista');

insert into dominio.comprobantes_venta
  (id, organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'factura', 'FAC-0005', current_date, 'emitida', 100, 121),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', 'factura', 'FAC-9999', current_date, 'emitida', 100, 121);

insert into dominio.movimientos_stock
  (id, organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha, actor_nombre, creado_en, nota)
select v.id::uuid, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'salida', 1, -1, 0,
       (select m.id from dominio.motivos_movimiento m where m.organizacion_id = '11111111-1111-1111-1111-111111111111' order by m.nombre limit 1),
       current_date, 'administrador@example.com', now() - v.hace, v.nota
from (values
  ('b0000000-0000-0000-0000-000000000001', interval '5 hours', 'Reserva comprobante:e1000000-0000-0000-0000-000000000001:linea:1'),
  ('b0000000-0000-0000-0000-000000000002', interval '4 hours', 'Reserva comprobante:e1000000-0000-0000-0000-000000000001 · entregada por envío'),
  ('b0000000-0000-0000-0000-000000000003', interval '3 hours', 'Reserva comprobante:e3000000-0000-0000-0000-000000000009:linea:1'),
  ('b0000000-0000-0000-0000-000000000004', interval '2 hours', 'Reserva comprobante:e2000000-0000-0000-0000-000000000001:linea:1'),
  ('b0000000-0000-0000-0000-000000000005', interval '1 hour', 'Conteo de cierre'),
  ('b0000000-0000-0000-0000-000000000006', interval '30 minutes', 'Reserva comprobante:E1000000-0000-0000-0000-000000000001:linea:2'),
  ('b0000000-0000-0000-0000-000000000007', interval '20 minutes', 'Reserva precomprobante:e1000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000008', interval '10 minutes', 'Reservaécomprobante:e1000000-0000-0000-0000-000000000001:linea:1')
) as v(id, hace, nota);

-- Sin RLS (propietario) el cruce igual se limita a la organización del movimiento.
select is((select l.nota from public.listar_movimientos_stock(null, 25, 0) l where l.id = 'b0000000-0000-0000-0000-000000000004'),
  'Reserva comprobante:e2000000-0000-0000-0000-000000000001:linea:1', 'aun sin RLS, el cruce no usa comprobantes de otra organización');

create function pg_temp.como_deposito() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como_deposito() to public;

select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table leidos on commit drop as
  select l.id, l.nota from public.listar_movimientos_stock(null, 25, 0) l;
grant select on leidos to authenticated;

select is((select nota from leidos where id = 'b0000000-0000-0000-0000-000000000001'),
  'Reserva FAC-0005', 'la referencia con línea se reemplaza por el número del comprobante');
select is((select nota from leidos where id = 'b0000000-0000-0000-0000-000000000002'),
  'Reserva FAC-0005 · entregada por envío', 'sin línea también, y el resto de la nota se conserva');
select is((select nota from leidos where id = 'b0000000-0000-0000-0000-000000000003'),
  'Reserva comprobante:e3000000-0000-0000-0000-000000000009:linea:1', 'si el comprobante no existe, la nota queda como estaba');
select is((select nota from leidos where id = 'b0000000-0000-0000-0000-000000000004'),
  'Reserva comprobante:e2000000-0000-0000-0000-000000000001:linea:1', 'el número de un comprobante de otra organización no se usa');
select is((select nota from leidos where id = 'b0000000-0000-0000-0000-000000000005'),
  'Conteo de cierre', 'una nota sin referencia no cambia');
select is((select nota from leidos where id = 'b0000000-0000-0000-0000-000000000006'),
  'Reserva FAC-0005', 'un UUID en mayúsculas también se reemplaza');
select is((select nota from leidos where id = 'b0000000-0000-0000-0000-000000000007'),
  'Reserva precomprobante:e1000000-0000-0000-0000-000000000001', '«comprobante:» pegado a otra palabra no se toca');
select is((select nota from leidos where id = 'b0000000-0000-0000-0000-000000000008'),
  'ReservaéFAC-0005', 'una letra acentuada pegada antes de la referencia no depende del idioma de la base');
select is((select count(*) from leidos), 8::bigint, 'aparecen los ocho movimientos');

-- Paginación y total: el total es el de todo el filtro, no el de la página.
select is((select array_agg(l.id order by l.creado_en desc, l.id desc) from public.listar_movimientos_stock(null, 2, 2) l),
  array['b0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000005']::uuid[], 'la segunda página trae las filas 3 y 4 en orden');
select is((select min(l.total) from public.listar_movimientos_stock(null, 2, 2) l), 8::bigint, 'el total es el de todo el filtro');
select is((select count(*) from public.listar_movimientos_stock(null, 2, 20) l), 0::bigint, 'una página fuera de rango no trae filas');

-- Rol Depósito de la misma organización: con Ventas en lectura (matriz inicial) ve el número; sin Ventas, la
-- nota queda como estaba.
reset role;
select pg_temp.como_deposito();
select is((select l.nota from public.listar_movimientos_stock(null, 25, 0) l where l.id = 'b0000000-0000-0000-0000-000000000001'),
  'Reserva FAC-0005', 'Depósito con Ventas en lectura ve el número del comprobante');

reset role;
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'deposito' and seccion = 'ventas';
select pg_temp.como_deposito();
select is((select l.nota from public.listar_movimientos_stock(null, 25, 0) l where l.id = 'b0000000-0000-0000-0000-000000000001'),
  'Reserva comprobante:e1000000-0000-0000-0000-000000000001:linea:1', 'Depósito sin Ventas ve la nota como estaba');

select * from finish();
rollback;
