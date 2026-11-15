-- MSF-467 · Opiniones, Fase 4 (T021, T022, T019). RF-OPI-9, RF-OPI-10, CA-OPI-4, CA-OPI-6, SC-001, SC-002, D7, D8, D9.
--   Solo aceptadas de la tienda, promedio y cantidad exactos, lista blanca por claves, cursor con desempate, producto no visible,
--   barrido por rol (anon, autores, panel), es_mia, cuenta suspendida.
begin;

select plan(44);

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

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
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
-- Muestra mixta en la tienda A sobre P1: 3 aceptadas (5, 4, 4 -> 4,3), 1 pendiente (1), 1 rechazada (1). En B sobre P1: 1 aceptada (2).
insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 915, 'Dora Pérez', 'v6@example.com', 'minorista');
insert into auth.users (id, email) values ('f5000000-0000-0000-0000-000000000008', 'cli-6@example.com');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000008', 'activa');
insert into dominio.opiniones_producto (id, organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado, motivo_rechazo, moderada_por, moderada_en, creada_en, actualizada_en) values
  ('0c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 5, 'Excelente, <script>alert(1)</script> lo recomiendo', 'aceptada', null, 'f5000000-0000-0000-0000-000000000005', now(), '2027-03-10 10:00+00', '2027-03-10 10:00+00'),
  ('0c000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 4, 'Aceptada de una cuenta suspendida', 'aceptada', null, 'f5000000-0000-0000-0000-000000000005', now(), '2027-03-10 10:00+00', '2027-03-10 10:00+00'),
  ('0c000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 4, 'Aceptada de Carla con nombre de pila', 'aceptada', null, 'f5000000-0000-0000-0000-000000000005', now(), '2027-03-09 10:00+00', '2027-03-09 10:00+00'),
  ('0c000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 1, 'Pendiente que nadie debe ver', 'pendiente', null, null, null, '2027-03-11 10:00+00', '2027-03-11 10:00+00'),
  ('0c000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', 1, 'Rechazada que nadie debe ver', 'rechazada', 'Spam', 'f5000000-0000-0000-0000-000000000005', now(), '2027-03-12 10:00+00', '2027-03-12 10:00+00'),
  ('0c000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 2, 'Aceptada de la tienda B solamente', 'aceptada', null, 'f5000000-0000-0000-0000-000000000005', now(), '2027-03-10 11:00+00', '2027-03-10 11:00+00');
create function pg_temp.ip(n integer) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', '10.7.0.' || n)::text, true);
$$;

-- Privilegios: anon y authenticated leen; la tabla sigue cerrada
select is(has_function_privilege('anon', 'publico.opiniones_producto_por_dominio(text, uuid, timestamptz, uuid, integer)', 'execute')
  and has_function_privilege('anon', 'publico.capacidades_opiniones_por_dominio(text)', 'execute')
  and has_function_privilege('authenticated', 'publico.opiniones_producto_por_dominio(text, uuid, timestamptz, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'publico.capacidades_opiniones_por_dominio(text)', 'execute'), true, 'las dos funciones de lectura son ejecutables por anon y authenticated');
select is((select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
             from pg_proc p where p.pronamespace = 'publico'::regnamespace
              and p.proname in ('opiniones_producto_por_dominio', 'capacidades_opiniones_por_dominio')), true, 'security definer con search_path vacío');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%opinion%' and has_function_privilege('anon', p.oid, 'execute')), 0, 'ninguna función de public sobre opiniones es ejecutable por anon (SC-003)');

-- Resumen y filas (SC-002, CA-OPI-4)
select pg_temp.ip(1);
select pg_temp.anonimo();
insert into res select 'a', publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001');
select is((select v->>'estado' from res where k = 'a'), 'ok', 'anon lee la ficha');
select is((select v->'resumen' from res where k = 'a'), '{"promedio":4.3,"cantidad":3}'::jsonb, 'promedio (un decimal) y cantidad exactos: solo las 3 aceptadas de la tienda A');
select is((select jsonb_array_length(v->'filas') from res where k = 'a'), 3, 'la lista trae solo las aceptadas');
select is((select count(*)::int from res r, jsonb_array_elements(r.v->'filas') f where r.k = 'a' and (f->>'comentario' like '%nadie debe ver%' or f->>'comentario' like '%tienda B%')), 0, 'ni pendientes, ni rechazadas, ni opiniones de otra tienda');
select is((select array_agg(x order by x) from res r, jsonb_array_elements(r.v->'filas') f, jsonb_object_keys(f) x where r.k = 'a' and f->>'id' = '0c000000-0000-0000-0000-000000000001'),
  array['comentario','es_mia','fecha','id','nombre_pila','puntuacion'], 'LISTA BLANCA exacta de claves por fila');
select is((select array_agg(x order by x) from res r, jsonb_object_keys(r.v) x where r.k = 'a'), array['estado','filas','resumen','siguiente'], 'claves de primer nivel exactas');
select is((select f->>'nombre_pila' from res r, jsonb_array_elements(r.v->'filas') f where r.k = 'a' and f->>'id' = '0c000000-0000-0000-0000-000000000001'), 'Valeria', 'solo el nombre de pila (CA-OPI-6)');
select is((select r.v::text !~ '(Sánchez|Díaz|Gómez|@example|ca000000|e1000000|11111111|c1000000)' from res r where r.k = 'a'), true, 'sin apellido, correo ni ids de cuenta, tienda, organización o cliente');
select is((select f->>'fecha' from res r, jsonb_array_elements(r.v->'filas') f where r.k = 'a' and f->>'id' = '0c000000-0000-0000-0000-000000000001'), '2027-03-10', 'fecha como día');
select is((select f->>'comentario' from res r, jsonb_array_elements(r.v->'filas') f where r.k = 'a' and f->>'id' = '0c000000-0000-0000-0000-000000000001'), 'Excelente, <script>alert(1)</script> lo recomiendo', 'el texto se devuelve literal (CA-OPI-3 se completa en el front)');
select is((select bool_or((f->>'es_mia')::boolean) from res r, jsonb_array_elements(r.v->'filas') f where r.k = 'a'), false, 'anon: nada es «mía»');
select is((select r.v->'filas'->>1 is not null and (r.v->'filas'->0->>'id') <> (r.v->'filas'->1->>'id') from res r where r.k = 'a'), true, 'orden estable');
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')->'resumen', '{"promedio":null,"cantidad":0}'::jsonb, 'sin aceptadas: promedio null y cantidad 0');
select is(publico.opiniones_producto_por_dominio('opi-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'resumen', '{"promedio":2.0,"cantidad":1}'::jsonb, 'la tienda B ve solo lo suyo (D8)');

-- Cursor con desempate (dos aceptadas de la misma fecha) y cursor a medias
select pg_temp.ip(2);
insert into res select 'c1', publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', null, null, 1);
insert into res select 'c2', publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001',
  ((select v from res where k = 'c1')->'siguiente'->>'creada')::timestamptz, ((select v from res where k = 'c1')->'siguiente'->>'id')::uuid, 1);
insert into res select 'c3', publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001',
  ((select v from res where k = 'c2')->'siguiente'->>'creada')::timestamptz, ((select v from res where k = 'c2')->'siguiente'->>'id')::uuid, 1);
select is((select v->'filas'->0->>'id' from res where k = 'c1'), '0c000000-0000-0000-0000-000000000002', 'tanda 1: de la misma fecha, el id mayor primero');
select is((select v->'filas'->0->>'id' from res where k = 'c2'), '0c000000-0000-0000-0000-000000000001', 'tanda 2: no se salta ni repite la de la misma fecha');
select is((select v->'filas'->0->>'id' from res where k = 'c3'), '0c000000-0000-0000-0000-000000000003', 'tanda 3: la más vieja');
select is((select v->'siguiente' from res where k = 'c3'), 'null'::jsonb, 'fin: sin siguiente');
select is(jsonb_array_length(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', '2027-03-10 10:00+00', null, 10)->'filas'), 3, 'un cursor a medias se ignora');
select is(jsonb_array_length(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', null, null, 1000)->'filas'), 3, 'límite acotado a 50');
select is(jsonb_array_length(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', null, null, null)->'filas'), 3, 'límite por defecto (10)');

-- Producto no visible / inexistente / host desconocido
select pg_temp.ip(3);
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000003'), '{"estado":"no_encontrado"}'::jsonb, 'producto oculto: no_encontrado');
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000004'), '{"estado":"no_encontrado"}'::jsonb, 'producto inactivo: no_encontrado');
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a2000000-0000-0000-0000-000000000005'), '{"estado":"no_encontrado"}'::jsonb, 'producto de otra organización: no_encontrado');
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', '99999999-9999-9999-9999-999999999999'), '{"estado":"no_encontrado"}'::jsonb, 'inexistente: no_encontrado');
select is(publico.opiniones_producto_por_dominio('desconocido.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'), '{"estado":"error"}'::jsonb, 'host desconocido: error');
select is(publico.opiniones_producto_por_dominio('opi-p.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'), '{"estado":"error"}'::jsonb, 'tienda pausada: error');

-- Barrido por rol (SC-001): nadie ve pendientes ni rechazadas por ninguna RPC
reset role;
select pg_temp.ip(4);
select pg_temp.como('f5000000-0000-0000-0000-000000000004');
select is((select count(*)::int from jsonb_array_elements(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'filas') f where f->>'comentario' like '%nadie debe ver%'), 0, 'el autor de la pendiente no la ve en la ficha');
select pg_temp.como('f5000000-0000-0000-0000-000000000008');
select is((select count(*)::int from jsonb_array_elements(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'filas') f where f->>'comentario' like '%nadie debe ver%'), 0, 'el autor de la rechazada no la ve en la ficha');
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')::text !~ '(Spam|pendiente|rechazada)', true, 'ni estado ni motivo en la respuesta');
select pg_temp.como('f5000000-0000-0000-0000-000000000005');
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'resumen'->>'cantidad', '3', 'un usuario del panel ve lo mismo que un visitante');
select throws_ok($$select count(*) from dominio.opiniones_producto$$, '42501', null, 'consulta directa a la tabla: sin privilegios (authenticated)');
select pg_temp.anonimo();
select throws_ok($$select count(*) from dominio.opiniones_producto$$, '42501', null, 'consulta directa a la tabla: sin privilegios (anon)');

-- es_mia con sesión; cuenta suspendida: su aceptada sigue visible
select pg_temp.ip(5);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is((select f->>'es_mia' from jsonb_array_elements(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'filas') f where f->>'id' = '0c000000-0000-0000-0000-000000000001'), 'true', 'es_mia con sesión sobre la propia');
select is((select count(*)::int from jsonb_array_elements(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'filas') f where (f->>'es_mia')::boolean), 1, 'solo una es mía');
select pg_temp.como('f5000000-0000-0000-0000-000000000003');
select is((select count(*)::int from jsonb_array_elements(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'filas') f where f->>'comentario' like '%cuenta suspendida%'), 1, 'lo aceptado de una cuenta suspendida sigue visible (caso borde)');
select is((select count(*)::int from jsonb_array_elements(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')->'filas') f where (f->>'es_mia')::boolean), 0, 'la suspendida ya no tiene «es_mia»');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, 'Un comentario válido y largo'), '{"estado":"sin_acceso"}'::jsonb, 'la suspendida no escribe');
select is(publico.borrar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'), '{"estado":"sin_acceso"}'::jsonb, 'ni borra');

-- Producto oculto: sus aceptadas no se ven (y no se borran)
reset role;
insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado, moderada_por, moderada_en)
values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 5, 'Aceptada sobre un producto oculto', 'aceptada', 'f5000000-0000-0000-0000-000000000005', now());
select pg_temp.ip(7);
select pg_temp.anonimo();
select is(publico.opiniones_producto_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000003'), '{"estado":"no_encontrado"}'::jsonb, 'producto oculto con aceptadas: no_encontrado');
reset role;
select is((select count(*)::int from dominio.opiniones_producto where producto_id = 'a1000000-0000-0000-0000-000000000003'), 1, 'la opinión del producto oculto no se borró');

select * from finish();
rollback;
