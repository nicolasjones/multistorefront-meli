-- MSF-467 · Opiniones de productos, Fase 1 «Base» (T001). RF-OPI-1, RF-OPI-4, D8, D11, SC-003.
--   * `dominio.opiniones_producto`: estructura, checks, FK compuestas (una fila con tienda ajena a la de su cuenta se rechaza),
--     unicidad (cuenta, producto), RLS activada sin políticas y sin privilegios para anon/authenticated/public.
--   * Bandera `tienda_opiniones` existe y está apagada por defecto.
begin;

select plan(21);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f4000000-0000-0000-0000-000000000001', 'cli-a@example.com'),
  ('f4000000-0000-0000-0000-000000000002', 'cli-b@example.com'),
  ('f4000000-0000-0000-0000-000000000003', 'admin@example.com');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 'SKU-AJE', 1000, 'ARS', true);
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Valeria Sánchez', 'v@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'activa');

-- Estructura y seguridad
select is((select relrowsecurity from pg_class where oid = 'dominio.opiniones_producto'::regclass), true, 'RLS activada');
select is((select count(*)::int from pg_policy where polrelid = 'dominio.opiniones_producto'::regclass and polname <> 'opiniones_producto_denegar_todo'), 0, 'sin políticas de acceso (solo la que deniega todo, MSF-918)');
select is(
  has_table_privilege('anon', 'dominio.opiniones_producto', 'select')
  or has_table_privilege('authenticated', 'dominio.opiniones_producto', 'select')
  or has_table_privilege('authenticated', 'dominio.opiniones_producto', 'insert')
  or has_table_privilege('authenticated', 'dominio.opiniones_producto', 'update')
  or has_table_privilege('authenticated', 'dominio.opiniones_producto', 'delete')
  or has_table_privilege('anon', 'dominio.opiniones_producto', 'insert'),
  false, 'anon y authenticated no tienen ningún privilegio directo');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'dominio' and table_name = 'opiniones_producto' and grantee in ('PUBLIC', 'anon', 'authenticated')),
  0, 'ningún grant a public, anon ni authenticated');
select is(
  has_table_privilege('service_role', 'dominio.opiniones_producto', 'select')
  and has_table_privilege('service_role', 'dominio.opiniones_producto', 'insert'),
  true, 'service_role opera la tabla (siembra y E2E)');
select is((select count(*)::int from pg_constraint where conrelid = 'dominio.opiniones_producto'::regclass and contype = 'f'), 3, 'tres FK compuestas');
select is(
  (select bool_and(array_length(conkey, 1) >= 2) from pg_constraint where conrelid = 'dominio.opiniones_producto'::regclass and contype = 'f'),
  true, 'todas las FK son compuestas con la organización');
select is((select activa from public.banderas_plataforma where clave = 'tienda_opiniones'), false, 'la bandera tienda_opiniones existe y está apagada');

-- Alta válida
select lives_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 4, 'Muy buen producto, lo recomiendo')$$,
  'alta válida');
select is((select estado from dominio.opiniones_producto limit 1), 'pendiente', 'nace pendiente');

-- Unicidad
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 5, 'Otra opinión del mismo producto')$$,
  '23505', null, 'una opinión por cuenta y producto');

delete from dominio.opiniones_producto;
-- Aislamiento: tienda distinta a la de su cuenta, organización ajena, producto de otra organización
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 5, 'Tienda distinta a la de la cuenta')$$,
  '23503', null, 'la tienda debe ser la de la cuenta');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 5, 'Cuenta de otra organización')$$,
  '23503', null, 'la cuenta debe ser de la organización');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 5, 'Producto de otra organización')$$,
  '23503', null, 'el producto debe ser de la organización');

-- Checks
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 6, 'Puntuación fuera de rango')$$,
  '23514', null, 'puntuación 6 rechazada');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 0, 'Puntuación fuera de rango')$$,
  '23514', null, 'puntuación 0 rechazada');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 3, 'corto')$$,
  '23514', null, 'comentario de menos de 10 caracteres rechazado');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 3, repeat('x', 1001))$$,
  '23514', null, 'comentario de más de 1000 caracteres rechazado');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 3, 'Estado desconocido en la fila', 'publicada')$$,
  '23514', null, 'estado desconocido rechazado');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 3, 'Aceptada sin moderador ni fecha', 'aceptada')$$,
  '23514', null, 'una opinión no pendiente exige quién y cuándo moderó');
select throws_ok($$insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, motivo_rechazo)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 3, 'Motivo en una opinión pendiente', 'no')$$,
  '23514', null, 'el motivo solo con estado rechazada');

select * from finish();
rollback;
