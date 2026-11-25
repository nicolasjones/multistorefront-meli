-- MSF-467 · Opiniones de productos, Fase 2 «Moderación» (T007). RF-OPI-13, RF-OPI-14, CA-OPI-7, CA-OPI-8, CA-OPI-9, CA-OPI-11, D10, D13.
--   * Solo el Administrador lista y modera (otro rol, otra organización y anon: 42501 / sin execute).
--   * Contadores del ámbito de la tienda, filtros de estado, cursor (creada_en, id) con desempate, nombre completo del cliente.
--   * Moderar: aceptar / rechazar con motivo, idempotencia sin evento duplicado, bloqueo optimista (PT412), evento de Actividad sin texto.
--   * Con la bandera apagada solo se permite rechazar (aceptar -> 55000, también sobre una opinión ya aceptada: D11).
--   * Decisión nula inválida; motivo sin saltos de línea, enlaces ni marcas ocultas; repetir «rechazar» no cambia el motivo.
begin;

select plan(57);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f4000000-0000-0000-0000-000000000001', 'cli-a@example.com'),
  ('f4000000-0000-0000-0000-000000000002', 'cli-b@example.com'),
  ('f4000000-0000-0000-0000-000000000003', 'admin-uno@example.com'),
  ('f4000000-0000-0000-0000-000000000004', 'miembro-uno@example.com'),
  ('f4000000-0000-0000-0000-000000000005', 'admin-dos@example.com'),
  ('f4000000-0000-0000-0000-000000000006', 'cli-c@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f4000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f4000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('f4000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'SKU-BETA', 1000, 'ARS', true);
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Valeria Sánchez', 'v@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Bruno Díaz', 'b@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 912, 'Carla Gómez', 'c@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000006', 'activa');

-- Tienda A: O1 y O2 pendientes con la MISMA fecha (desempate por id), O3 aceptada más vieja.
-- Tienda B: O4 pendiente, O5 rechazada con motivo.
insert into dominio.opiniones_producto (id, organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado, motivo_rechazo, moderada_por, moderada_en, creada_en, actualizada_en) values
  ('01000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 4, 'Muy buen producto, lo recomiendo', 'pendiente', null, null, null, '2027-03-10 10:00+00', '2027-03-10 10:00+00'),
  ('01000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 1, 'Texto secreto del comentario', 'pendiente', null, null, null, '2027-03-10 10:00+00', '2027-03-10 10:00+00'),
  ('01000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 5, 'Opinión ya aceptada antes', 'aceptada', null, 'f4000000-0000-0000-0000-000000000003', '2027-03-02 10:00+00', '2027-03-01 10:00+00', '2027-03-02 10:00+00'),
  ('01000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 3, 'Opinión de la tienda B pendiente', 'pendiente', null, null, null, '2027-03-11 10:00+00', '2027-03-11 10:00+00'),
  ('01000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 2, 'Opinión de la tienda B rechazada', 'rechazada', 'Spam', 'f4000000-0000-0000-0000-000000000003', '2027-03-05 10:00+00', '2027-03-04 10:00+00', '2027-03-05 10:00+00');

update public.banderas_plataforma set activa = true where clave = 'tienda_opiniones';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- Privilegios
select is(has_function_privilege('anon', 'public.listar_opiniones(text, uuid, timestamptz, uuid, integer)', 'execute'), false, 'anon no lista');
select is(has_function_privilege('anon', 'public.moderar_opinion(uuid, text, text, timestamptz)', 'execute'), false, 'anon no modera');
select is(has_function_privilege('authenticated', 'public.listar_opiniones(text, uuid, timestamptz, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.moderar_opinion(uuid, text, text, timestamptz)', 'execute'), true, 'authenticated ejecuta ambas');

-- Solo el Administrador (CA-OPI-8)
select pg_temp.como('f4000000-0000-0000-0000-000000000004');
select throws_ok($$select public.listar_opiniones()$$, '42501', null, 'un miembro no lista');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000001', 'rechazar', null, '2027-03-10 10:00+00')$$, '42501', null, 'un miembro no modera');
select pg_temp.como('f4000000-0000-0000-0000-000000000001');
select throws_ok($$select public.listar_opiniones()$$, '42501', null, 'una cuenta web de cliente no lista');
select pg_temp.como('f4000000-0000-0000-0000-000000000005');
select throws_ok($$select public.listar_opiniones('pendiente', 'e1000000-0000-0000-0000-000000000001')$$, '42501', null, 'el admin de otra organización no ve tiendas ajenas');
select is((public.listar_opiniones('todas')->'contadores'), '{"pendientes":0,"aceptadas":0,"rechazadas":0}'::jsonb, 'el admin de otra organización no ve nada');
select is(public.moderar_opinion('01000000-0000-0000-0000-000000000001', 'rechazar', null, '2027-03-10 10:00+00')->>'estado', 'no_encontrada', 'ni moderar opiniones ajenas');

-- Listado y contadores (CA-OPI-11)
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
select is(public.listar_opiniones()->'contadores', '{"pendientes":3,"aceptadas":1,"rechazadas":1}'::jsonb, 'contadores de todas las tiendas');
select is(public.listar_opiniones('pendiente', 'e1000000-0000-0000-0000-000000000001')->'contadores', '{"pendientes":2,"aceptadas":1,"rechazadas":0}'::jsonb, 'contadores acotados a la tienda A');
select is(public.listar_opiniones('pendiente', 'e1000000-0000-0000-0000-000000000002')->'contadores', '{"pendientes":1,"aceptadas":0,"rechazadas":1}'::jsonb, 'contadores acotados a la tienda B');
select is(jsonb_array_length(public.listar_opiniones('pendiente')->'filas'), 3, 'por defecto solo pendientes');
select is(jsonb_array_length(public.listar_opiniones('todas')->'filas'), 5, 'todas');
select is(jsonb_array_length(public.listar_opiniones('aceptada')->'filas'), 1, 'filtro aceptadas');
select is(jsonb_array_length(public.listar_opiniones('todas', 'e1000000-0000-0000-0000-000000000002')->'filas'), 2, 'filtro por tienda');
select throws_ok($$select public.listar_opiniones('publicada')$$, '22023', null, 'estado desconocido');
select is(public.listar_opiniones('pendiente', 'e1000000-0000-0000-0000-000000000001')->'filas'->0->>'cliente_nombre', 'Carla Gómez', 'el administrador ve el nombre completo (no solo el de pila)');
select is(public.listar_opiniones('pendiente', 'e1000000-0000-0000-0000-000000000001')->'filas'->0->>'producto_nombre', 'Alfa', 'trae el producto');
select is(public.listar_opiniones('pendiente', 'e1000000-0000-0000-0000-000000000001')->'filas'->0->>'empresa_nombre', 'Tienda A', 'trae la tienda');

-- Cursor con desempate: O2 y O1 comparten fecha; orden por id desc -> O2 primero
select is(public.listar_opiniones('todas', 'e1000000-0000-0000-0000-000000000001', null, null, 1)->'filas'->0->>'id', '01000000-0000-0000-0000-000000000002', 'primera tanda: id mayor con la misma fecha');
insert into res select 'p1', public.listar_opiniones('todas', 'e1000000-0000-0000-0000-000000000001', null, null, 1);
insert into res select 'p2', public.listar_opiniones('todas', 'e1000000-0000-0000-0000-000000000001',
  ((select v from res where k = 'p1')->'siguiente'->>'creada')::timestamptz, ((select v from res where k = 'p1')->'siguiente'->>'id')::uuid, 1);
select is((select v from res where k = 'p2')->'filas'->0->>'id', '01000000-0000-0000-0000-000000000001', 'segunda tanda: no se repite ni se salta la de la misma fecha');
insert into res select 'p3', public.listar_opiniones('todas', 'e1000000-0000-0000-0000-000000000001',
  ((select v from res where k = 'p2')->'siguiente'->>'creada')::timestamptz, ((select v from res where k = 'p2')->'siguiente'->>'id')::uuid, 1);
select is((select v from res where k = 'p3')->'filas'->0->>'id', '01000000-0000-0000-0000-000000000003', 'tercera tanda: la vieja');
select is((select v from res where k = 'p3')->'siguiente', 'null'::jsonb, 'fin de lista: sin siguiente');

-- Sin filtro de tienda y con 'todas': tandas de limite + 1 filas; los contadores no dependen del tamaño de la tanda
select is(jsonb_array_length(public.listar_opiniones('todas', null, null, null, 2)->'filas'), 2, 'global: la tanda trae solo el límite');
select isnt(public.listar_opiniones('todas', null, null, null, 2)->'siguiente', 'null'::jsonb, 'global: hay siguiente si sobran filas');
select is(public.listar_opiniones('todas', null, null, null, 2)->'contadores', '{"pendientes":3,"aceptadas":1,"rechazadas":1}'::jsonb, 'global: los contadores no cambian con la tanda');
select is(public.listar_opiniones('todas', null, null, null, 5)->'siguiente', 'null'::jsonb, 'global: justo el total, sin siguiente');

-- Moderar
select is(public.moderar_opinion('01000000-0000-0000-0000-000000000001', 'aceptar', null, '2027-03-10 10:00+00')->'opinion'->>'estado', 'aceptada', 'aceptar');
reset role;
select is((select estado from dominio.opiniones_producto where id = '01000000-0000-0000-0000-000000000001'), 'aceptada', 'queda aceptada en la tabla');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
reset role;
select is((select moderada_por from dominio.opiniones_producto where id = '01000000-0000-0000-0000-000000000001'), 'f4000000-0000-0000-0000-000000000003'::uuid, 'queda quién moderó');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
select is(public.listar_opiniones()->'contadores'->>'pendientes', '2', 'el contador de pendientes baja');
-- Idempotencia: repetir no duplica el evento
select public.moderar_opinion('01000000-0000-0000-0000-000000000001', 'aceptar', null, '2027-03-10 10:00+00');
reset role;
select is((select count(*)::int from public.registro_actividad where tipo = 'opinion.aceptada'), 1, 'repetir la decisión no duplica el evento');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
-- Rechazar con motivo
select is(public.moderar_opinion('01000000-0000-0000-0000-000000000002', 'rechazar', '  Contenido ajeno al producto  ', '2027-03-10 10:00+00')->'opinion'->>'estado', 'rechazada', 'rechazar con motivo');
reset role;
select is((select motivo_rechazo from dominio.opiniones_producto where id = '01000000-0000-0000-0000-000000000002'), 'Contenido ajeno al producto', 'motivo recortado');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
-- Repetir «rechazar» con otro motivo es idempotente a propósito: responde ok y conserva el motivo guardado
select is(public.moderar_opinion('01000000-0000-0000-0000-000000000002', 'rechazar', 'Otro motivo distinto', '2027-03-10 10:00+00')->>'estado', 'ok', 'rechazar de nuevo con otro motivo: ok');
reset role;
select is((select motivo_rechazo from dominio.opiniones_producto where id = '01000000-0000-0000-0000-000000000002'), 'Contenido ajeno al producto', 'repetir rechazar no cambia el motivo guardado');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
-- Evento sin texto
reset role;
select is((select count(*)::int from public.registro_actividad where tipo in ('opinion.aceptada', 'opinion.rechazada') and (detalle like '%secreto%' or detalle like '%Contenido ajeno%' or detalle like '%recomiendo%')), 0, 'el evento no lleva el texto ni el motivo');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
reset role;
select alike((select detalle from public.registro_actividad where tipo = 'opinion.rechazada' limit 1), '%1 estrella sobre «Alfa» rechazada', 'el evento lleva producto y puntuación');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
-- Despublicar una aceptada
select is(public.moderar_opinion('01000000-0000-0000-0000-000000000003', 'rechazar', null, '2027-03-02 10:00+00')->'opinion'->>'estado', 'rechazada', 'rechazar una aceptada la despublica');
-- Aceptar una rechazada (la limpia de motivo)
select is(public.moderar_opinion('01000000-0000-0000-0000-000000000005', 'aceptar', null, '2027-03-05 10:00+00')->'opinion'->>'estado', 'aceptada', 'aceptar una rechazada');
reset role;
select is((select motivo_rechazo from dominio.opiniones_producto where id = '01000000-0000-0000-0000-000000000005'), null, 'aceptar limpia el motivo');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
-- Bloqueo optimista (CA-OPI-7)
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'aceptar', null, '2027-03-01 00:00+00')$$, 'PT412', 'conflicto', 'fecha vieja: conflicto');
reset role;
select is((select estado from dominio.opiniones_producto where id = '01000000-0000-0000-0000-000000000004'), 'pendiente', 'el conflicto no pisa la fila');
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'aceptar', null, null)$$, '22023', null, 'sin fecha esperada: inválido');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'borrar', null, '2027-03-11 10:00+00')$$, '22023', null, 'decisión desconocida');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', null, null, '2027-03-11 10:00+00')$$, '22023', 'Decisión de moderación inválida', 'decisión nula: inválida, no un rechazo silencioso');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'rechazar', repeat('x', 201), '2027-03-11 10:00+00')$$, '22023', 'El motivo admite hasta 200 caracteres', 'motivo de más de 200: mensaje de largo');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'rechazar', E'Primera línea\nsegunda línea', '2027-03-11 10:00+00')$$, '22023', 'El motivo tiene caracteres no permitidos (saltos de línea, enlaces o marcas ocultas)', 'motivo con salto de línea: mensaje de caracteres no permitidos, no de largo');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'rechazar', 'Mirá http://spam.example ahora', '2027-03-11 10:00+00')$$, '22023', 'El motivo tiene caracteres no permitidos (saltos de línea, enlaces o marcas ocultas)', 'motivo con enlace');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'rechazar', 'Motivo ' || chr(8238) || 'invertido', '2027-03-11 10:00+00')$$, '22023', 'El motivo tiene caracteres no permitidos (saltos de línea, enlaces o marcas ocultas)', 'motivo con marca de dirección');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'aceptar', 'motivo', '2027-03-11 10:00+00')$$, '22023', null, 'motivo solo al rechazar');
select is(public.moderar_opinion(gen_random_uuid(), 'rechazar', null, now())->>'estado', 'no_encontrada', 'inexistente: no_encontrada');

-- Bandera apagada: solo se puede rechazar (CA-OPI-9)
reset role;
update public.banderas_plataforma set activa = false where clave = 'tienda_opiniones';
select pg_temp.como('f4000000-0000-0000-0000-000000000003');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'aceptar', null, '2027-03-11 10:00+00')$$, '55000', null, 'apagada: aceptar se rechaza');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000001', 'aceptar', null, '2027-03-10 10:00+00')$$, '55000', null, 'apagada: aceptar una ya aceptada tampoco es ok idempotente (D11)');
select is(public.moderar_opinion('01000000-0000-0000-0000-000000000004', 'rechazar', null, '2027-03-11 10:00+00')->'opinion'->>'estado', 'rechazada', 'apagada: rechazar se permite');
select is(jsonb_array_length(public.listar_opiniones('todas')->'filas'), 5, 'apagada: el panel sigue listando');

select * from finish();
rollback;
