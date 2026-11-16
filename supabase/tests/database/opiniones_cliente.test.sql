-- MSF-467 · Opiniones, Fase 3 «Opinar» (T013, T014, T019). RF-OPI-2 a RF-OPI-8, CA-OPI-1, 2, 3, 5.
--   * Alta pendiente, idempotencia, edición que vuelve a pendiente y limpia la moderación, borrado idempotente.
--   * sin_acceso idéntico (otra tienda, suspendida, no habilitada, panel, otra organización, host desconocido, tienda pausada).
--   * Validación, producto visible, aislamiento por tienda, topes 50 y 10 pendientes, Mis opiniones con cursor.
begin;

select plan(70);

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
create function pg_temp.ip(n integer) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', '10.9.0.' || n)::text, true);
$$;

-- Privilegios (RF-OPI-16)
select is(has_function_privilege('anon', 'publico.guardar_opinion_por_dominio(text, uuid, integer, text)', 'execute')
  or has_function_privilege('anon', 'publico.borrar_opinion_por_dominio(text, uuid)', 'execute')
  or has_function_privilege('anon', 'publico.mis_opiniones_por_dominio(text, timestamptz, uuid, integer)', 'execute'), false, 'anon no ejecuta ninguna RPC de cuenta de opiniones');
select is(has_function_privilege('authenticated', 'publico.guardar_opinion_por_dominio(text, uuid, integer, text)', 'execute')
  and has_function_privilege('authenticated', 'publico.borrar_opinion_por_dominio(text, uuid)', 'execute')
  and has_function_privilege('authenticated', 'publico.mis_opiniones_por_dominio(text, timestamptz, uuid, integer)', 'execute'), true, 'authenticated ejecuta las tres');
select is((select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
             from pg_proc p where p.pronamespace = 'publico'::regnamespace
              and p.proname in ('guardar_opinion_por_dominio', 'borrar_opinion_por_dominio', 'mis_opiniones_por_dominio')),
  true, 'security definer con search_path vacío');

-- sin_acceso idéntico en todos los casos (CA-OPI-5, RF-OPI-7)
select pg_temp.ip(1);
select pg_temp.como('f5000000-0000-0000-0000-000000000002');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 5, 'Excelente producto, muy recomendable'),
  '{"estado":"sin_acceso"}'::jsonb, 'la cuenta de la tienda B no opina en la tienda A');
select pg_temp.como('f5000000-0000-0000-0000-000000000003');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 5, 'Excelente producto, muy recomendable'),
  '{"estado":"sin_acceso"}'::jsonb, 'cuenta suspendida');
select pg_temp.como('f5000000-0000-0000-0000-000000000004');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 5, 'Excelente producto, muy recomendable'),
  '{"estado":"sin_acceso"}'::jsonb, 'cliente no habilitado en la tienda');
select pg_temp.como('f5000000-0000-0000-0000-000000000005');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 5, 'Excelente producto, muy recomendable'),
  '{"estado":"sin_acceso"}'::jsonb, 'usuario del panel');
select pg_temp.como('f5000000-0000-0000-0000-000000000006');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 5, 'Excelente producto, muy recomendable'),
  '{"estado":"sin_acceso"}'::jsonb, 'cuenta de otra organización');
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.guardar_opinion_por_dominio('desconocido.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 5, 'Excelente producto, muy recomendable'),
  '{"estado":"sin_acceso"}'::jsonb, 'host desconocido');
select is(publico.guardar_opinion_por_dominio('opi-p.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 5, 'Excelente producto, muy recomendable'),
  '{"estado":"sin_acceso"}'::jsonb, 'tienda pausada');
select is(publico.borrar_opinion_por_dominio('opi-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'), '{"estado":"sin_acceso"}'::jsonb, 'borrar con otra tienda: sin_acceso');
select is(publico.mis_opiniones_por_dominio('opi-b.ejemplo.com'), '{"estado":"sin_acceso"}'::jsonb, 'mis opiniones con otra tienda: sin_acceso');
reset role;
select is((select count(*)::int from dominio.opiniones_producto), 0, 'ningún intento sin acceso guardó nada');

-- Alta (RF-OPI-2, CA-OPI-1)
select pg_temp.ip(2);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
insert into res select 'alta', publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 4, '  Muy buen producto, lo recomiendo  ');
select is((select v->>'estado' from res where k = 'alta'), 'ok', 'alta: ok');
select is((select v->'opinion'->>'estado' from res where k = 'alta'), 'pendiente', 'una opinión nueva nace pendiente');
select is((select v->'opinion'->>'comentario' from res where k = 'alta'), 'Muy buen producto, lo recomiendo', 'el comentario se guarda recortado');
reset role;
select is((select count(*)::int from dominio.opiniones_producto where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000001' and empresa_id = 'e1000000-0000-0000-0000-000000000001'), 1, 'queda atada a la cuenta y a la tienda de la sesión');
create temp table antes as select actualizada_en, creada_en from dominio.opiniones_producto;
grant all on antes to public;

-- Idempotencia: el mismo contenido no cambia nada
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 4, 'Muy buen producto, lo recomiendo')->>'estado', 'ok', 'reenviar lo mismo: ok');
reset role;
select is((select count(*)::int from dominio.opiniones_producto), 1, 'reenviar lo mismo no crea otra fila');
select is((select o.actualizada_en = a.actualizada_en from dominio.opiniones_producto o, antes a), true, 'reenviar lo mismo no cambia la fecha');

-- Editar contenido distinto: sigue una sola fila y vuelve a pendiente (D6)
update dominio.opiniones_producto set estado = 'aceptada', moderada_por = 'f5000000-0000-0000-0000-000000000005', moderada_en = now();
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 4, 'Muy buen producto, lo recomiendo')->'opinion'->>'estado', 'aceptada', 'el mismo contenido sobre una aceptada la deja aceptada');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 2, 'Cambié de idea, ya no me gusta')->'opinion'->>'estado', 'pendiente', 'editar una aceptada la devuelve a pendiente');
reset role;
select is((select count(*)::int from dominio.opiniones_producto), 1, 'editar no crea otra fila (D2)');
select is((select moderada_por is null and moderada_en is null and motivo_rechazo is null and puntuacion = 2 from dominio.opiniones_producto), true, 'editar limpia la moderación y guarda lo nuevo');
update dominio.opiniones_producto set estado = 'rechazada', motivo_rechazo = 'Spam', moderada_por = 'f5000000-0000-0000-0000-000000000005', moderada_en = now();
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 2, 'Cambié de idea, ya no me gusta')->'opinion'->>'estado', 'rechazada', 'reenviar lo mismo sobre una rechazada no la reabre');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 3, 'Cambié de idea, ahora es regular')->'opinion'->>'estado', 'pendiente', 'editar una rechazada la devuelve a pendiente');
reset role;
select is((select motivo_rechazo is null from dominio.opiniones_producto), true, 'editar una rechazada limpia el motivo');

-- Validación (CA-OPI-3): inválido con los campos erróneos y sin guardar
select pg_temp.ip(3);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 0, 'Un comentario válido y largo'), '{"estado":"invalido","campos":["puntuacion"]}'::jsonb, 'puntuación 0');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 6, 'Un comentario válido y largo')->>'estado', 'invalido', 'puntuación 6');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, '123456789'), '{"estado":"invalido","campos":["comentario"]}'::jsonb, 'comentario de 9 caracteres');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, repeat('a', 1001))->>'estado', 'invalido', 'comentario de 1.001 caracteres');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, 'Mirá https://ejemplo.com ahora')->>'estado', 'invalido', 'comentario con enlace');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 5, E'Comentario con\x01control')->>'estado', 'invalido', 'comentario con caracteres de control');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 9, '123')->'campos', '["puntuacion","comentario"]'::jsonb, 'ambos campos erróneos');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', null, null)->>'estado', 'invalido', 'nulos: inválido');
reset role;
select is((select count(*)::int from dominio.opiniones_producto), 1, 'nada inválido se guardó');

-- Producto visible (RF-OPI-6): todos los casos responden igual
select pg_temp.ip(4);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000003', 5, 'Un comentario válido y largo'), '{"estado":"no_encontrado"}'::jsonb, 'producto oculto en la tienda');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000004', 5, 'Un comentario válido y largo'), '{"estado":"no_encontrado"}'::jsonb, 'producto inactivo');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'a2000000-0000-0000-0000-000000000005', 5, 'Un comentario válido y largo'), '{"estado":"no_encontrado"}'::jsonb, 'producto de otra organización');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', '99999999-9999-9999-9999-999999999999', 5, 'Un comentario válido y largo'), '{"estado":"no_encontrado"}'::jsonb, 'producto inexistente');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', null, 5, 'Un comentario válido y largo'), '{"estado":"no_encontrado"}'::jsonb, 'producto nulo');

-- Aislamiento entre tiendas (CA-OPI-5): la cuenta B opina lo suyo y no toca lo de A
select pg_temp.como('f5000000-0000-0000-0000-000000000002');
select is(publico.guardar_opinion_por_dominio('opi-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 5, 'Opinión de la tienda B, genial')->>'estado', 'ok', 'la cuenta B opina en B');
select is(publico.guardar_opinion_por_dominio('opi-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000003', 5, 'Opinión sobre producto de A, no visible en B')->>'estado', 'no_encontrado', 'en B no se opina un producto que B no vende');
select is(jsonb_array_length(publico.mis_opiniones_por_dominio('opi-b.ejemplo.com')->'filas'), 1, 'B lista solo la suya');
select is(publico.borrar_opinion_por_dominio('opi-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000002'), '{"estado":"ok"}'::jsonb, 'borrar una que no es mía: ok (idempotente)');
reset role;
select is((select count(*)::int from dominio.opiniones_producto), 2, 'borrar sin tener opinión no tocó la de nadie');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 5, 'Fila con tienda ajena a su cuenta')$$,
  '23503', null, 'la FK compuesta impide una fila con tienda distinta de la de su cuenta');

-- Mis opiniones (RF-OPI-8)
select pg_temp.ip(5);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.mis_opiniones_por_dominio('opi-a.ejemplo.com')->>'total', '1', 'mis opiniones: total');
select is(publico.mis_opiniones_por_dominio('opi-a.ejemplo.com')->'filas'->0 ?& array['id','producto_id','producto_nombre','puntuacion','comentario','estado','motivo_rechazo','creada_en','actualizada_en'], true, 'trae las claves del contrato');
select is(publico.mis_opiniones_por_dominio('opi-a.ejemplo.com')->'filas'->0->>'producto_nombre', 'Alfa', 'trae el nombre del producto');
reset role;
update dominio.opiniones_producto set estado = 'rechazada', motivo_rechazo = 'Contenido ajeno', moderada_por = 'f5000000-0000-0000-0000-000000000005', moderada_en = now() where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000001';
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is(publico.mis_opiniones_por_dominio('opi-a.ejemplo.com')->'filas'->0->>'motivo_rechazo', 'Contenido ajeno', 'la cuenta ve el motivo del rechazo (D5)');
reset role;
-- Cursor con desempate (misma fecha) y producto oculto no listado
insert into dominio.opiniones_producto (id, organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, creada_en, actualizada_en)
select ('0a000000-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000005',
       p, 3, 'Opinión de prueba número ' || n, '2027-03-20 10:00+00', '2027-03-20 10:00+00'
  from (values (1, 'a1000000-0000-0000-0000-000000000001'::uuid), (2, 'a1000000-0000-0000-0000-000000000002'::uuid), (3, 'a1000000-0000-0000-0000-000000000003'::uuid)) v(n, p);
select pg_temp.como('f5000000-0000-0000-0000-000000000007');
select is(publico.mis_opiniones_por_dominio('opi-a.ejemplo.com')->>'total', '2', 'un producto oculto no se lista ni se cuenta');
insert into res select 'm1', publico.mis_opiniones_por_dominio('opi-a.ejemplo.com', null, null, 1);
insert into res select 'm2', publico.mis_opiniones_por_dominio('opi-a.ejemplo.com',
  ((select v from res where k = 'm1')->'siguiente'->>'creada')::timestamptz, ((select v from res where k = 'm1')->'siguiente'->>'id')::uuid, 1);
select is((select v->'filas'->0->>'id' from res where k = 'm1'), '0a000000-0000-0000-0000-000000000002', 'primera tanda: id mayor con la misma fecha');
select is((select v->'filas'->0->>'id' from res where k = 'm2'), '0a000000-0000-0000-0000-000000000001', 'segunda tanda: no se repite ni se salta');
select is((select v->'siguiente' from res where k = 'm2'), 'null'::jsonb, 'fin de lista');
select is(jsonb_array_length(publico.mis_opiniones_por_dominio('opi-a.ejemplo.com', null, null, 999)->'filas'), 2, 'límite acotado');
-- Borrado
select is(publico.borrar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'), '{"estado":"ok"}'::jsonb, 'borrar la propia: ok');
select is(publico.borrar_opinion_por_dominio('opi-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001'), '{"estado":"ok"}'::jsonb, 'borrar de nuevo: ok (idempotente)');
reset role;
select is((select count(*)::int from dominio.opiniones_producto where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000005' and producto_id = 'a1000000-0000-0000-0000-000000000001'), 0, 'la fila ya no existe');
select is((select count(*)::int from dominio.opiniones_producto where cuenta_cliente_id <> 'ca000000-0000-0000-0000-000000000005' and producto_id = 'a1000000-0000-0000-0000-000000000001'), 2, 'borrar no tocó las de otras cuentas');

-- Topes (CA-OPI-2): 39 aceptadas + 10 pendientes = 49 (+ la oculta de arriba no cuenta)
delete from dominio.opiniones_producto where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000005';
insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado, moderada_por, moderada_en)
select '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000005',
       ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 4, 'Opinión masiva número ' || n,
       case when n <= 39 then 'aceptada' else 'pendiente' end,
       case when n <= 39 then 'f5000000-0000-0000-0000-000000000005'::uuid end,
       case when n <= 39 then now() end
  from generate_series(1, 49) n;
select pg_temp.ip(6);
select pg_temp.como('f5000000-0000-0000-0000-000000000007');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000050', 5, 'La undécima pendiente de golpe'), '{"estado":"limite_pendientes"}'::jsonb, 'la 11.ª pendiente: limite_pendientes');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000001', 1, 'Editar una aceptada ocupa un cupo pendiente')->>'estado', 'limite_pendientes', 'editar una aceptada con 10 pendientes: limite_pendientes');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000040', 2, 'Editar una pendiente no ocupa otro cupo')->'opinion'->>'estado', 'pendiente', 'editar una pendiente con 10 pendientes: ok');
select is(publico.borrar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000049'), '{"estado":"ok"}'::jsonb, 'libera un cupo pendiente');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000050', 5, 'Ahora sí entra la opinión número 49')->>'estado', 'ok', 'con 9 pendientes entra una');
select pg_temp.ip(7);
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000051', 5, 'La número 50 de la cuenta, aún entra')->>'estado', 'limite_pendientes', 'con 10 pendientes de nuevo: limite_pendientes');
reset role;
update dominio.opiniones_producto set estado = 'aceptada', moderada_por = 'f5000000-0000-0000-0000-000000000005', moderada_en = now() where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000005' and estado = 'pendiente';
select pg_temp.como('f5000000-0000-0000-0000-000000000007');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000051', 5, 'La número 50 de la cuenta, aún entra')->>'estado', 'ok', 'la opinión 50 entra');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000052', 5, 'La número 51 ya no entra por tope')->>'estado', 'limite_opiniones', 'la 51.ª: limite_opiniones');
select is(publico.guardar_opinion_por_dominio('opi-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000051', 5, 'La número 50 de la cuenta, aún entra')->>'estado', 'ok', 'reenviar la misma con el tope lleno: ok');
reset role;
select is((select count(*)::int from dominio.opiniones_producto where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000005'), 50, 'quedaron exactamente 50');

select * from finish();
rollback;
