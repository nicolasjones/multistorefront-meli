-- MSF-467 · Opiniones, Fase 3 (T018). Caso borde: fusión de clientes. Antes de dar de baja la cuenta web no elegida, sus opiniones se
--   reasignan a la cuenta que se mantiene de la misma tienda; si chocan en (cuenta, producto) se conserva la más reciente (empate: la
--   de la cuenta que se mantiene). Nada sin conflicto se pierde.
begin;

select plan(6);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'cli-a@example.com'),
  ('f5000000-0000-0000-0000-000000000002', 'cli-b@example.com'),
  ('f5000000-0000-0000-0000-000000000003', 'suspendida@example.com'),
  ('f5000000-0000-0000-0000-000000000004', 'nohabilitada@example.com'),
  ('f5000000-0000-0000-0000-000000000005', 'panel@example.com'),
  ('f5000000-0000-0000-0000-000000000006', 'cli-x@example.com'),
  ('f5000000-0000-0000-0000-000000000007', 'cli-a2@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f5000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda pausada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'opi-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'opi-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'opi-p.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'opi-x.ejemplo.com');
-- P1 y P2 visibles en A y B; P3 oculto en A; P4 inactivo; P5 de otra organización.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'SKU-BETA', 2000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 'SKU-OCU', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'SKU-INA', 500, 'ARS', false),
  ('a2000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Otra organización', 'SKU-OTR', 500, 'ARS', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'Masivo ' || n, 'MAS-' || n, 100, 'ARS', true
  from generate_series(1, 60) n;
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a2000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false, false);
insert into dominio.existencias (producto_id, organizacion_id, cantidad)
select p.id, p.organizacion_id, 7 from dominio.productos p
on conflict (producto_id) do update set cantidad = excluded.cantidad;

insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Valeria Sánchez', 'v@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Bruno Díaz', 'b@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 912, 'Suspendida Ejemplo', 'su@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 913, 'No habilitada', 'nh@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 914, 'Carla Gómez', 'c@example.com', 'minorista'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 910, 'Xavier Otro', 'x@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000003', 'suspendida'),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000004', 'activa'),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000007', 'activa'),
  ('ca000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'c2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000006', 'activa');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.anonimo() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;
create temp table res (k text primary key, v jsonb);
grant all on res to public;
select set_config('request.headers', '{"x-forwarded-for":"10.5.0.1"}', true);

update public.banderas_plataforma set activa = true where clave = 'tienda_opiniones';
-- Caso 1, tienda A: Valeria (cuenta 1) y Carla (cuenta 5) opinaron Alfa; solo Carla opinó Beta. Mismo instante: gana la cuenta que se mantiene.
insert into dominio.opiniones_producto (id, organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, creada_en, actualizada_en) values
  ('0d000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 5, 'Opinión de Valeria sobre Alfa', '2027-03-10 10:00+00', '2027-03-10 10:00+00'),
  ('0d000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 3, 'Opinión de Carla sobre Alfa', '2027-03-10 10:00+00', '2027-03-10 10:00+00'),
  ('0d000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', 4, 'Opinión de Carla sobre Beta', '2027-03-10 10:00+00', '2027-03-10 10:00+00');
-- Caso 2, tienda B: Bruno (cuenta 2) y Dora (cuenta nueva) opinaron Alfa; la de Dora es MÁS RECIENTE. Dora también opinó Beta.
insert into auth.users (id, email) values ('f5000000-0000-0000-0000-000000000009', 'dora@example.com');
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 920, 'Dora Pérez', 'dora@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000009', 'activa');
insert into dominio.opiniones_producto (id, organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado, moderada_por, moderada_en, creada_en, actualizada_en) values
  ('0d000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 2, 'Bruno opinó antes sobre Alfa', 'pendiente', null, null, '2027-03-01 10:00+00', '2027-03-01 10:00+00'),
  ('0d000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000001', 5, 'Dora opinó después sobre Alfa', 'aceptada', 'f5000000-0000-0000-0000-000000000005', '2027-03-12 10:00+00', '2027-03-11 10:00+00', '2027-03-12 10:00+00'),
  ('0d000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000002', 4, 'Dora también opinó sobre Beta', 'pendiente', null, null, '2027-03-11 10:00+00', '2027-03-11 10:00+00');

-- La fusión mueve o da de baja CUENTAS: ninguna opinión sin conflicto se pierde y la unicidad (cuenta, producto) no se rompe.
select pg_temp.como('f5000000-0000-0000-0000-000000000005');
select public.fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000001');
select public.fusionar_clientes('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000002');
reset role;
select is((select array_agg(id::text order by id) from dominio.opiniones_producto where empresa_id = 'e1000000-0000-0000-0000-000000000001'),
  array['0d000000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-000000000003'], 'caso 1: queda la de Valeria sobre Alfa y la de Carla sobre Beta');
select is((select cuenta_cliente_id from dominio.opiniones_producto where id = '0d000000-0000-0000-0000-000000000003'), 'ca000000-0000-0000-0000-000000000001'::uuid, 'caso 1: la opinión sobre Beta pasó a la cuenta que se mantiene');
select is((select count(*)::int from dominio.opiniones_producto where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000005'), 0, 'caso 1: la cuenta dada de baja no deja opiniones');
select is((select array_agg(id::text order by id) from dominio.opiniones_producto where empresa_id = 'e1000000-0000-0000-0000-000000000002'),
  array['0d000000-0000-0000-0000-000000000012', '0d000000-0000-0000-0000-000000000013'], 'caso 2: gana la más reciente (la de Dora sobre Alfa) y la de Bruno se descarta');
select is((select count(*)::int from dominio.opiniones_producto where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000002'), 2, 'caso 2: las dos quedan en la cuenta que se mantiene');
select is((select estado from dominio.opiniones_producto where id = '0d000000-0000-0000-0000-000000000012'), 'aceptada', 'caso 2: la opinión movida conserva su estado de moderación');

select * from finish();
rollback;
