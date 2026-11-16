-- MSF-467 · Opiniones, Cierre (T029, hallazgo H-1). El resumen de la ficha (promedio y cantidad) tiene que salir del MISMO
--   conjunto de opiniones aceptadas que la lista, y ese resumen no puede obligar a leer el heap de cada opinión aceptada.
--   Vigila: (a) el índice parcial cubriente del resumen, (b) que la agregación no use uniones redundantes con
--   `public.cuentas_cliente`/`dominio.clientes` (las FK ya garantizan que existen) y (c) que el resumen coincida exactamente
--   con las aceptadas de ese producto en esa tienda.
begin;

select plan(12);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'res-a1@example.com'),
  ('f5000000-0000-0000-0000-000000000002', 'res-a2@example.com'),
  ('f5000000-0000-0000-0000-000000000003', 'res-a3@example.com'),
  ('f5000000-0000-0000-0000-000000000004', 'res-a4@example.com'),
  ('f5000000-0000-0000-0000-000000000005', 'res-a5@example.com'),
  ('f5000000-0000-0000-0000-000000000006', 'res-a6@example.com'),
  ('f5000000-0000-0000-0000-000000000007', 'res-b1@example.com'),
  ('f5000000-0000-0000-0000-000000000009', 'admin@example.com');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'res-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'res-b.ejemplo.com');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
-- El trigger `productos_crear_existencias` ya dejó la fila de existencias del producto: se actualiza, no se inserta.
insert into dominio.existencias (producto_id, organizacion_id, cantidad)
values ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 7)
on conflict (producto_id) do update set cantidad = excluded.cantidad;

-- Siete clientes: seis de la tienda A (tres con opinión aceptada, una pendiente, una rechazada y uno sin opinión) y uno de
-- la tienda B. Una opinión por cuenta y producto (índice único): cada cuenta opina una sola vez.
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Valeria Sánchez', 'v1@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Bruno Díaz', 'v2@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 912, 'Carla Gómez', 'v3@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 913, 'Dora Pérez', 'v4@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 914, 'Elena Soto', 'v5@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 915, 'Franco Ruiz', 'v6@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 916, 'Gina Salas', 'v7@example.com', 'minorista');
-- Las filas van una por una (las dos tablas): el seed deja clientes de las organizaciones de demostración (Mundo JC y San
-- Javucho) en `dominio.clientes`, y un `insert … select` los traería con la organización equivocada (el disparador
-- `validar_cliente_empresa` los rechaza: «El cliente no pertenece a la organización»).
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000003', 'activa'),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000004', 'activa'),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000005', 'activa'),
  ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000006', 'activa'),
  ('ca000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000007', 'activa');

create function pg_temp.anonimo() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;
create function pg_temp.ip(n integer) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', '10.9.0.' || n)::text, true);
$$;
create temp table res (k text primary key, v jsonb);
grant all on res to public;

update public.banderas_plataforma set activa = true where clave = 'tienda_opiniones';

-- Tienda A: 3 aceptadas (5, 4, 4), 1 pendiente y 1 rechazada (no cuentan). Tienda B: 1 aceptada (2) del mismo producto.
insert into dominio.opiniones_producto (id, organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado, motivo_rechazo, moderada_por, moderada_en, creada_en, actualizada_en) values
  ('0d000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 5, 'Aceptada de la tienda A, primera', 'aceptada', null, 'f5000000-0000-0000-0000-000000000009', now(), '2027-03-10 10:00+00', '2027-03-10 10:00+00'),
  ('0d000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 4, 'Aceptada de la tienda A, segunda', 'aceptada', null, 'f5000000-0000-0000-0000-000000000009', now(), '2027-03-09 10:00+00', '2027-03-09 10:00+00'),
  ('0d000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 4, 'Aceptada de la tienda A, tercera', 'aceptada', null, 'f5000000-0000-0000-0000-000000000009', now(), '2027-03-08 10:00+00', '2027-03-08 10:00+00'),
  ('0d000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 1, 'Pendiente que no cuenta', 'pendiente', null, null, null, '2027-03-11 10:00+00', '2027-03-11 10:00+00'),
  ('0d000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 1, 'Rechazada que no cuenta', 'rechazada', 'Spam', 'f5000000-0000-0000-0000-000000000009', now(), '2027-03-12 10:00+00', '2027-03-12 10:00+00'),
  ('0d000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000001', 2, 'Aceptada de la tienda B solamente', 'aceptada', null, 'f5000000-0000-0000-0000-000000000009', now(), '2027-03-10 11:00+00', '2027-03-10 11:00+00');

-- (a) El índice parcial cubriente del resumen existe y cubre `puntuacion` (agregación index-only).
select ok(to_regclass('dominio.opiniones_producto_resumen_idx') is not null, 'existe el índice parcial del resumen');
select ok((select pg_get_indexdef('dominio.opiniones_producto_resumen_idx'::regclass) ilike '%include (puntuacion)%'), 'el índice del resumen cubre `puntuacion`');
select ok((select pg_get_indexdef('dominio.opiniones_producto_resumen_idx'::regclass) ilike '%where (estado = ''aceptada''%'), 'el índice del resumen es parcial: solo las aceptadas');

-- (b) La agregación del resumen no usa uniones con `cuentas_cliente`/`clientes` (las FK ya garantizan que existen):
-- si vuelven, el resumen vuelve a leer el heap de cada opinión aceptada en cada visita a la ficha.
select is(
  coalesce((select (regexp_match(p.prosrc, 'select round\(avg.*?;', 'ns'))[1] ilike '%join%'
              from pg_proc p where p.oid = 'publico.opiniones_producto_por_dominio(text,uuid,timestamptz,uuid,integer)'::regprocedure), false),
  false,
  'el resumen se calcula solo sobre la tabla de opiniones (sin uniones redundantes)');

-- (c) El resumen coincide exactamente con las aceptadas de ese producto en esa tienda (SC-002, CA-OPI-4).
select pg_temp.ip(1);
select pg_temp.anonimo();
insert into res select 'a', publico.opiniones_producto_por_dominio('res-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001');
select is((select v->'resumen' from res where k = 'a'), '{"promedio":4.3,"cantidad":3}'::jsonb, 'promedio y cantidad exactos: solo las 3 aceptadas de la tienda A');
select is((select jsonb_array_length(v->'filas') from res where k = 'a'), 3, 'la lista trae las mismas 3 aceptadas que cuenta el resumen');
reset role;
select is((select (v->'resumen'->>'cantidad')::int from res where k = 'a'),
  (select count(*)::int from dominio.opiniones_producto o
     join public.cuentas_cliente cc on cc.id = o.cuenta_cliente_id
     join dominio.clientes cl on cl.id = cc.cliente_id and cl.organizacion_id = cc.organizacion_id
    where o.empresa_id = 'e1000000-0000-0000-0000-000000000001'
      and o.organizacion_id = '11111111-1111-1111-1111-111111111111'
      and o.producto_id = 'a1000000-0000-0000-0000-000000000001'
      and o.estado = 'aceptada'),
  'el resumen cuenta el mismo conjunto que la lista con sus uniones (mismo resultado, sin el costo)');
select pg_temp.ip(2);
select pg_temp.anonimo();
insert into res select 'b', publico.opiniones_producto_por_dominio('res-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001');
select is((select v->'resumen' from res where k = 'b'), '{"promedio":2.0,"cantidad":1}'::jsonb, 'la tienda B ve solo lo suyo (D8)');

-- El resumen no se recalcula con las filas de la página: con cursor sigue siendo el total de aceptadas.
select pg_temp.ip(3);
insert into res select 'c1', publico.opiniones_producto_por_dominio('res-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', null, null, 1);
select is((select v->'resumen' from res where k = 'c1'), '{"promedio":4.3,"cantidad":3}'::jsonb, 'con una sola fila por tanda, el resumen sigue siendo el total');
insert into res select 'c2', publico.opiniones_producto_por_dominio('res-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001',
  ((select v from res where k = 'c1')->'siguiente'->>'creada')::timestamptz, ((select v from res where k = 'c1')->'siguiente'->>'id')::uuid, 1);
select is((select v->'resumen' from res where k = 'c2'), '{"promedio":4.3,"cantidad":3}'::jsonb, 'en la segunda tanda, el resumen no cambia (no se recalcula sobre la página)');

-- Con la bandera apagada: resumen vacío y sin tocar datos.
select pg_temp.ip(4);
reset role;
update public.banderas_plataforma set activa = false where clave = 'tienda_opiniones';
select pg_temp.anonimo();
select is(publico.opiniones_producto_por_dominio('res-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'resumen', '{"promedio":null,"cantidad":0}'::jsonb, 'con la bandera apagada, el resumen va vacío');
reset role;
select is((select count(*)::int from dominio.opiniones_producto), 6, 'la bandera apagada no toca los datos');

select * from finish();
rollback;
