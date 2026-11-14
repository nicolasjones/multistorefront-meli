-- MSF-176 · Tienda compra y cuentas, historia A «Mi cuenta» (F-CLI-20 · MSF-452), T013. FR-007 a FR-010, FR-014, D-2, D-11;
-- amenazas 3.1, 3.3, 3.4, 3.5; escenarios A-8, A-9, A-10, A-11.
--   * `dominio.favoritos_cliente`: RLS activada, sin privilegios de API (anon ni authenticated), FK compuestas.
--   * `publico.cambiar_favorito_por_dominio`: alternar idempotente, tope 200 (el 201 se rechaza), producto oculto, inactivo,
--     ajeno o inexistente = `no_encontrado` idéntico, sin acceso (suspendida, no habilitada, otra tienda, panel de otra
--     organización, host desconocido), bandera apagada = `sin_acceso` sin tocar datos.
--   * `publico.mis_favoritos_por_dominio`: solo lo visible hoy (un producto oculto no se lista y vuelve al publicarse),
--     aislamiento entre cuentas y entre tiendas del mismo cliente, cursor y límite acotado, lista blanca por claves, sin stock.
--   * `publico.favoritos_entre_por_dominio`: intersección con los favoritos de la cuenta, máximo 50 ids.
--   * Grants: `anon` sin execute; `authenticated` con execute; `security definer` con `search_path = ''`.
begin;

select plan(83);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f2000000-0000-0000-0000-000000000001', 'mayorista@example.com'),
  ('f2000000-0000-0000-0000-000000000002', 'minorista@example.com'),
  ('f2000000-0000-0000-0000-000000000003', 'suspendida@example.com'),
  ('f2000000-0000-0000-0000-000000000004', 'nohabilitada@example.com'),
  ('f2000000-0000-0000-0000-000000000007', 'panel-uno@example.com'),
  ('f2000000-0000-0000-0000-000000000008', 'panel-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f2000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f2000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- San Javucho (A) y Mundo JC (B): dos tiendas de la misma organización; X, de otra organización.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'fav-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'fav-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'fav-x.ejemplo.com');

-- P1 y P2: visibles en A y en B. P3: oculto en A. P4: inactivo. P6: solo en B. P7: sin stock. P5: de otra organización.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'SKU-BETA', 2000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 'SKU-OCU', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'SKU-INA', 500, 'ARS', false),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Solo en B', 'SKU-SOB', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Sin stock', 'SKU-SST', 500, 'ARS', true),
  ('a2000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Otra organización', 'SKU-OTR', 500, 'ARS', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'Masivo ' || n, 'MAS-' || n, 100, 'ARS', true
  from generate_series(1, 201) n;
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id
  from dominio.productos p
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.id <> 'a1000000-0000-0000-0000-000000000006';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a2000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false, false);
insert into dominio.existencias (producto_id, organizacion_id, cantidad)
select p.id, p.organizacion_id, 7 from dominio.productos p
 where p.id <> 'a1000000-0000-0000-0000-000000000007'
on conflict (producto_id) do update set cantidad = excluded.cantidad;
update dominio.existencias set cantidad = 0 where producto_id = 'a1000000-0000-0000-0000-000000000007';
insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/alfa-1.jpg'),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/alfa-2.jpg');

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Mayorista', 'my@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Minorista', 'mn@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 912, 'Suspendida', 'su@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 913, 'No habilitada', 'nh@example.com', 'mayorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'activa'),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002', 'activa'),
  ('ca000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000003', 'suspendida'),
  ('ca000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000004', 'activa');

-- La función de la épica se prueba encendida; apagada se prueba más abajo.
update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- ============================================================================
-- Privilegios y estructura (amenazas 3.1; RLS sin acceso de API)
-- ============================================================================
select is(
  (select c.relrowsecurity from pg_class c where c.oid = 'dominio.favoritos_cliente'::regclass),
  true, 'dominio.favoritos_cliente tiene RLS activada');
select is(
  (select count(*)::int from pg_policy where polrelid = 'dominio.favoritos_cliente'::regclass),
  0, 'sin políticas: solo se accede por RPC security definer');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'dominio' and table_name = 'favoritos_cliente' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0, 'anon, authenticated y PUBLIC no tienen ningún privilegio sobre la tabla');
select ok(
  not has_table_privilege('anon', 'dominio.favoritos_cliente', 'select')
  and not has_table_privilege('authenticated', 'dominio.favoritos_cliente', 'select')
  and not has_table_privilege('authenticated', 'dominio.favoritos_cliente', 'insert')
  and not has_table_privilege('authenticated', 'dominio.favoritos_cliente', 'update')
  and not has_table_privilege('authenticated', 'dominio.favoritos_cliente', 'delete'),
  'ni select, insert, update ni delete para anon o authenticated');
select ok(
  not has_function_privilege('anon', 'publico.cambiar_favorito_por_dominio(text, uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'publico.favoritos_entre_por_dominio(text, uuid[])', 'execute'),
  'anon no ejecuta ninguna de las tres RPC de favoritos');
select ok(
  has_function_privilege('authenticated', 'publico.cambiar_favorito_por_dominio(text, uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'publico.favoritos_entre_por_dominio(text, uuid[])', 'execute'),
  'authenticated ejecuta las tres RPC de favoritos (grant explícito)');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'publico'::regnamespace
      and p.proname in ('cambiar_favorito_por_dominio', 'mis_favoritos_por_dominio', 'favoritos_entre_por_dominio')
      and p.prosecdef and p.proconfig = array['search_path=""']),
  3, 'las tres son security definer con search_path vacío');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'publico'::regnamespace
      and p.proname in ('cambiar_favorito_por_dominio', 'mis_favoritos_por_dominio', 'favoritos_entre_por_dominio')
      and (p.proargnames && array['cliente_id', 'cuenta_id', 'cuenta_cliente_id', 'empresa_id', 'organizacion_id'])),
  0, 'ninguna recibe cliente, cuenta, empresa ni organización: todo sale de la sesión');
select ok(
  (select p.prosrc ~ 'pg_advisory_xact_lock' from pg_proc p where p.oid = 'publico.cambiar_favorito_por_dominio(text, uuid, boolean)'::regprocedure),
  'el alta toma un lock por cuenta (el tope no se supera en paralelo)');

-- FK compuestas: una fila no puede apuntar a otra organización ni a otra tienda que la de su cuenta.
select throws_ok(
  $$insert into dominio.favoritos_cliente (organizacion_id, empresa_id, cuenta_cliente_id, producto_id)
    values ('22222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '23503', null, 'una fila no puede mezclar la organización de la cuenta con otra');
select throws_ok(
  $$insert into dominio.favoritos_cliente (organizacion_id, empresa_id, cuenta_cliente_id, producto_id)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '23503', null, 'una fila no puede apuntar a una tienda distinta de la de su cuenta');
select throws_ok(
  $$insert into dominio.favoritos_cliente (organizacion_id, empresa_id, cuenta_cliente_id, producto_id)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000005')$$,
  '23503', null, 'una fila no puede apuntar a un producto de otra organización');

-- ============================================================================
-- Sin acceso: idéntico para todos los casos (FR-002, FR-011; escenario A-10)
-- ============================================================================
select pg_temp.como('f2000000-0000-0000-0000-000000000007');
insert into res values
  ('panel1_cambiar', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true)),
  ('panel1_lista', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com')),
  ('panel1_entre', publico.favoritos_entre_por_dominio('fav-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));
select pg_temp.como('f2000000-0000-0000-0000-000000000008');
insert into res values
  ('panel2_cambiar', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true));
select pg_temp.como('f2000000-0000-0000-0000-000000000003');
insert into res values
  ('susp_cambiar', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true)),
  ('susp_lista', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com'));
select pg_temp.como('f2000000-0000-0000-0000-000000000004');
insert into res values
  ('nohab_cambiar', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true));
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
insert into res values
  ('otra_tienda', publico.cambiar_favorito_por_dominio('fav-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true)),
  ('host_desconocido', publico.cambiar_favorito_por_dominio('desconocido.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true)),
  ('otra_organizacion', publico.mis_favoritos_por_dominio('fav-x.ejemplo.com'));
reset role;
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
insert into res values ('sin_sesion', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true));
reset role;

select is((select v from res where k = 'panel1_cambiar'), '{"estado":"sin_acceso"}'::jsonb, 'usuario de panel sin cuenta web: sin_acceso al guardar');
select is((select v from res where k = 'panel1_lista'), '{"estado":"sin_acceso"}'::jsonb, 'usuario de panel sin cuenta web: sin_acceso al listar');
select is((select v from res where k = 'panel1_entre'), '{"estado":"sin_acceso"}'::jsonb, 'usuario de panel sin cuenta web: sin_acceso en favoritos_entre');
select is((select v from res where k = 'panel2_cambiar'), '{"estado":"sin_acceso"}'::jsonb, 'panel de otra organización: sin_acceso');
select is((select v from res where k = 'susp_cambiar'), '{"estado":"sin_acceso"}'::jsonb, 'cuenta suspendida: sin_acceso al guardar');
select is((select v from res where k = 'susp_lista'), '{"estado":"sin_acceso"}'::jsonb, 'cuenta suspendida: sin_acceso al listar');
select is((select v from res where k = 'nohab_cambiar'), '{"estado":"sin_acceso"}'::jsonb, 'cliente no habilitado en la tienda: sin_acceso');
select is((select v from res where k = 'otra_tienda'), '{"estado":"sin_acceso"}'::jsonb, 'cuenta de otra tienda de la organización: sin_acceso');
select is((select v from res where k = 'host_desconocido'), '{"estado":"sin_acceso"}'::jsonb, 'host desconocido: sin_acceso');
select is((select v from res where k = 'otra_organizacion'), '{"estado":"sin_acceso"}'::jsonb, 'tienda de otra organización: sin_acceso');
select is((select v from res where k = 'sin_sesion'), '{"estado":"sin_acceso"}'::jsonb, 'sin sesión: sin_acceso');
select is((select count(*)::int from dominio.favoritos_cliente), 0, 'ninguna llamada sin acceso escribió nada');

-- ============================================================================
-- Alternar: idempotente; quitar sin error; producto oculto, inactivo, ajeno o inexistente = no_encontrado (A-8)
-- ============================================================================
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values
  ('guardar1', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true)),
  ('guardar2', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true)),
  ('oculto', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000003', true)),
  ('inactivo', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000004', true)),
  ('otra_org_prod', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a2000000-0000-0000-0000-000000000005', true)),
  ('solo_en_b', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000006', true)),
  ('inexistente', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a9999999-9999-9999-9999-999999999999', true)),
  ('nulo', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', null, true)),
  ('fav_nulo', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', null));
reset role;

select is((select v from res where k = 'guardar1'), '{"estado":"ok","favorito":true}'::jsonb, 'guardar un producto visible: ok');
select is((select v from res where k = 'guardar2'), '{"estado":"ok","favorito":true}'::jsonb, 'guardarlo otra vez: ok idempotente');
select is(
  (select count(*)::int from dominio.favoritos_cliente where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000001'),
  1, 'guardar dos veces deja un solo favorito');
select is((select v from res where k = 'oculto'), '{"estado":"no_encontrado"}'::jsonb, 'producto oculto en la tienda: no_encontrado');
select is((select v from res where k = 'inactivo'), (select v from res where k = 'oculto'), 'producto inactivo: la misma respuesta que oculto');
select is((select v from res where k = 'otra_org_prod'), (select v from res where k = 'oculto'), 'producto de otra organización: la misma respuesta');
select is((select v from res where k = 'solo_en_b'), (select v from res where k = 'oculto'), 'producto que no vende esta tienda: la misma respuesta');
select is((select v from res where k = 'inexistente'), (select v from res where k = 'oculto'), 'producto inexistente: la misma respuesta');
select is((select v from res where k = 'nulo'), (select v from res where k = 'oculto'), 'producto nulo: la misma respuesta');
select is((select v from res where k = 'fav_nulo'), '{"estado":"error"}'::jsonb, 'favorito nulo: error genérico');
select is(
  (select count(*)::int from dominio.favoritos_cliente where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000001'),
  1, 'los rechazados no escribieron nada');

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values
  ('quitar1', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', false)),
  ('quitar2', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', false)),
  ('quitar_inexistente', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a9999999-9999-9999-9999-999999999999', false));
reset role;
select is((select v from res where k = 'quitar1'), '{"estado":"ok","favorito":false}'::jsonb, 'quitar un favorito: ok');
select is((select v from res where k = 'quitar2'), '{"estado":"ok","favorito":false}'::jsonb, 'quitar uno que ya no existe: ok, sin error');
select is((select v from res where k = 'quitar_inexistente'), '{"estado":"ok","favorito":false}'::jsonb, 'quitar un producto inexistente: ok, sin error');
select is((select count(*)::int from dominio.favoritos_cliente), 0, 'quitar dejó la tabla vacía');

-- ============================================================================
-- Aislamiento entre clientes y entre tiendas del mismo cliente (FR-010, amenaza 3.3)
-- ============================================================================
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true);
select publico.cambiar_favorito_por_dominio('fav-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', true);
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
select publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', true);
insert into res values ('min_a', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com'));
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values
  ('may_a', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com')),
  ('may_b', publico.mis_favoritos_por_dominio('fav-b.ejemplo.com')),
  ('may_entre_a', publico.favoritos_entre_por_dominio('fav-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[])),
  ('may_entre_b', publico.favoritos_entre_por_dominio('fav-b.ejemplo.com', array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[]));
reset role;

select is(
  (select jsonb_agg(f ->> 'producto_id') from res, jsonb_array_elements(v -> 'filas') f where k = 'may_a'),
  '["a1000000-0000-0000-0000-000000000001"]'::jsonb, 'el mayorista ve en A solo su favorito de A');
select is(
  (select jsonb_agg(f ->> 'producto_id') from res, jsonb_array_elements(v -> 'filas') f where k = 'may_b'),
  '["a1000000-0000-0000-0000-000000000002"]'::jsonb, 'el mismo cliente ve en B solo lo suyo de B (por tienda)');
select is(
  (select jsonb_agg(f ->> 'producto_id') from res, jsonb_array_elements(v -> 'filas') f where k = 'min_a'),
  '["a1000000-0000-0000-0000-000000000002"]'::jsonb, 'otro cliente de la misma tienda ve solo lo suyo, no el de los demás');
select is((select v -> 'favoritos' from res where k = 'may_entre_a'), '["a1000000-0000-0000-0000-000000000001"]'::jsonb, 'favoritos_entre en A: la intersección con los favoritos de A');
select is((select v -> 'favoritos' from res where k = 'may_entre_b'), '["a1000000-0000-0000-0000-000000000002"]'::jsonb, 'favoritos_entre en B: la intersección con los favoritos de B');

-- ============================================================================
-- Lista blanca por claves y disponibilidad sin cantidades (FR-008)
-- ============================================================================
select is(
  (select array_agg(distinct c order by c) from res r, jsonb_object_keys(r.v) c where r.k = 'may_a'),
  array['estado', 'filas', 'siguiente', 'total'], 'la respuesta tiene exactamente estado, total, filas y siguiente');
select is(
  (select array_agg(distinct c order by c) from res r, jsonb_array_elements(r.v -> 'filas') f, jsonb_object_keys(f) c where r.k = 'may_a'),
  array['disponible', 'escala', 'imagen', 'nombre', 'precio_final', 'producto_id', 'sku'],
  'cada fila: solo producto_id, nombre, sku, imagen, disponible, precio_final y escala (sin stock ni costos)');
select is((select v -> 'filas' -> 0 ->> 'imagen' from res where k = 'may_a'), '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/alfa-1.jpg', 'la imagen es la primera por posición');
select is((select v -> 'filas' -> 0 ->> 'sku' from res where k = 'may_a'), 'SKU-ALFA', 'trae el SKU');
select is((select (v -> 'filas' -> 0 -> 'disponible')::boolean from res where k = 'may_a'), true, 'con stock: disponible');
select is((select v -> 'filas' -> 0 ->> 'escala' from res where k = 'may_a'), 'x1', 'la escala de la ficha a cantidad 1 es x1 (mayorista)');
select is(
  (select (v -> 'filas' -> 0 ->> 'precio_final')::numeric from res where k = 'may_a'),
  private.precio_final_publico_escala('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'x1'),
  'precio_final es el de la ficha (private.precio_final_publico_escala, escala x1)');
select is((select v ->> 'total' from res where k = 'may_a'), '1', 'total cuenta sus favoritos visibles');
select is((select v -> 'siguiente' from res where k = 'may_a'), 'null'::jsonb, 'sin más filas: siguiente nulo');

-- ============================================================================
-- Un favorito cuyo producto deja de ser visible no se lista ni se cuenta; vuelve al publicarse (A-9)
-- ============================================================================
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
select publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000007', true);
reset role;
update dominio.productos_tienda set visible = false where empresa_id = 'e1000000-0000-0000-0000-000000000001' and producto_id = 'a1000000-0000-0000-0000-000000000002';
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible)
select 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', false
 where not exists (select 1 from dominio.productos_tienda where empresa_id = 'e1000000-0000-0000-0000-000000000001' and producto_id = 'a1000000-0000-0000-0000-000000000002');
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
delete from res where k = 'min_a';
insert into res values ('min_a', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com'));
reset role;
select is(
  (select jsonb_agg(f ->> 'producto_id') from res, jsonb_array_elements(v -> 'filas') f where k = 'min_a'),
  '["a1000000-0000-0000-0000-000000000007"]'::jsonb, 'el favorito de un producto que se ocultó no se lista');
select is((select v ->> 'total' from res where k = 'min_a'), '1', 'ni se cuenta en el total');
select is(
  (select count(*)::int from dominio.favoritos_cliente where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000003'),
  2, 'pero la fila no se borra');
select is((select (v -> 'filas' -> 0 -> 'disponible')::boolean from res where k = 'min_a'), false, 'sin stock: disponible = false (solo el booleano)');
update dominio.productos_tienda set visible = true where empresa_id = 'e1000000-0000-0000-0000-000000000001' and producto_id = 'a1000000-0000-0000-0000-000000000002';
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
delete from res where k = 'min_a';
insert into res values ('min_a', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com'));
reset role;
select is((select v ->> 'total' from res where k = 'min_a'), '2', 'al volver a publicarse, el favorito reaparece');

-- ============================================================================
-- Tope de 200 favoritos por cuenta (FR-009, amenaza 3.4) y cursor / límite (amenaza 3.5)
-- ============================================================================
delete from dominio.favoritos_cliente where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000003';
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
insert into res values
  ('doscientos', (select jsonb_build_object('oks', count(*) filter (where r ->> 'estado' = 'ok'), 'total', count(*))
                    from generate_series(1, 200) n,
                         lateral publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, true) r)),
  ('el_201', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000201', true)),
  ('repetir_a_tope', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000001', true)),
  ('quitar_a_tope', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000001', false)),
  ('el_201_tras_quitar', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'b1000000-0000-0000-0000-000000000201', true));
reset role;
select is((select v from res where k = 'doscientos'), '{"oks":200,"total":200}'::jsonb, 'se pueden guardar 200 favoritos');
select is((select v from res where k = 'el_201'), '{"estado":"limite_favoritos"}'::jsonb, 'el 201 se rechaza con limite_favoritos');
select is((select v from res where k = 'repetir_a_tope'), '{"estado":"ok","favorito":true}'::jsonb, 'en el tope, guardar uno que ya existe sigue siendo ok (idempotente)');
select is((select v from res where k = 'quitar_a_tope'), '{"estado":"ok","favorito":false}'::jsonb, 'en el tope se puede quitar uno');
select is((select v from res where k = 'el_201_tras_quitar'), '{"estado":"ok","favorito":true}'::jsonb, 'al liberar un lugar se puede guardar otro');
select is(
  (select count(*)::int from dominio.favoritos_cliente where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000003'),
  200, 'la cuenta nunca supera 200 favoritos');

select pg_temp.como('f2000000-0000-0000-0000-000000000002');
insert into res values
  ('pag1', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com', null, null, 50)),
  ('pag_enorme', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com', null, null, 100000)),
  ('pag_cero', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com', null, null, 0)),
  ('pag_nula', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com', null, null, null));
insert into res
select 'pag2', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com', (v -> 'siguiente' ->> 'creado')::timestamptz, (v -> 'siguiente' ->> 'id')::uuid, 50)
  from res where k = 'pag1';
-- Cursor forjado con la fila de OTRA cuenta: solo ordena, nunca deja ver lo ajeno.
reset role;
create temp table cursor_ajeno as
  select f.creado_en + interval '1 day' as creado, f.id
    from dominio.favoritos_cliente f where f.cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000003' limit 1;
grant select on cursor_ajeno to public;
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res
select 'pag_forjada', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com', creado, id, 50) from cursor_ajeno;
reset role;
select is((select v ->> 'total' from res where k = 'pag1'), '200', 'el total cuenta los 200 favoritos visibles');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'pag1'), 50, 'una tanda de 50');
select isnt((select v -> 'siguiente' from res where k = 'pag1'), 'null'::jsonb, 'hay siguiente cuando quedan filas');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'pag_enorme'), 50, 'el límite se acota a 50');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'pag_cero'), 1, 'el límite mínimo es 1');
select is((select jsonb_array_length(v -> 'filas') from res where k = 'pag_nula'), 20, 'sin límite: 20');
select is(
  (select count(distinct f ->> 'producto_id')::int
     from res r, jsonb_array_elements(r.v -> 'filas') f where r.k in ('pag1', 'pag2')),
  100, 'la segunda tanda no repite filas de la primera');
select is(
  (select jsonb_agg(f ->> 'producto_id') from res r, jsonb_array_elements(r.v -> 'filas') f where r.k = 'pag_forjada'),
  '["a1000000-0000-0000-0000-000000000001"]'::jsonb, 'un cursor forjado con filas de otra cuenta solo ordena: el mayorista ve únicamente lo suyo');

-- ============================================================================
-- favoritos_entre: máximo 50 ids
-- ============================================================================
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values
  ('entre_50', publico.favoritos_entre_por_dominio('fav-a.ejemplo.com', array(select gen_random_uuid() from generate_series(1, 50)))),
  ('entre_51', publico.favoritos_entre_por_dominio('fav-a.ejemplo.com', array(select gen_random_uuid() from generate_series(1, 51)))),
  ('entre_nulo', publico.favoritos_entre_por_dominio('fav-a.ejemplo.com', null));
reset role;
select is((select v from res where k = 'entre_50'), '{"estado":"ok","favoritos":[]}'::jsonb, '50 ids: ok');
select is((select v from res where k = 'entre_51'), '{"estado":"invalido","campos":["productos"]}'::jsonb, 'más de 50 ids: invalido (productos)');
select is((select v from res where k = 'entre_nulo'), '{"estado":"ok","favoritos":[]}'::jsonb, 'sin ids: lista vacía');

-- ============================================================================
-- Suspensión inmediata y baja de «Habilitado en»
-- ============================================================================
update cuentas_cliente set estado = 'suspendida' where id = 'ca000000-0000-0000-0000-000000000001';
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values ('tras_suspender', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com'));
reset role;
select is((select v from res where k = 'tras_suspender'), '{"estado":"sin_acceso"}'::jsonb, 'al suspender la cuenta, la próxima llamada ya no devuelve nada');
update cuentas_cliente set estado = 'activa' where id = 'ca000000-0000-0000-0000-000000000001';

-- ============================================================================
-- Bandera apagada: sin_acceso genérico sin tocar datos (FR-014; escenario A-11)
-- ============================================================================
update public.banderas_plataforma set activa = false where clave = 'tienda_pedidos';
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values
  ('apagada_cambiar', publico.cambiar_favorito_por_dominio('fav-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', true)),
  ('apagada_lista', publico.mis_favoritos_por_dominio('fav-a.ejemplo.com')),
  ('apagada_entre', publico.favoritos_entre_por_dominio('fav-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));
reset role;
select is((select v from res where k = 'apagada_cambiar'), '{"estado":"sin_acceso"}'::jsonb, 'bandera apagada: guardar responde sin_acceso');
select is((select v from res where k = 'apagada_lista'), '{"estado":"sin_acceso"}'::jsonb, 'bandera apagada: listar responde sin_acceso');
select is((select v from res where k = 'apagada_entre'), '{"estado":"sin_acceso"}'::jsonb, 'bandera apagada: favoritos_entre responde sin_acceso');
select is(
  (select count(*)::int from dominio.favoritos_cliente where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000001'),
  1, 'con la bandera apagada no se escribió nada (el favorito previo sigue y no se agregó el nuevo)');
update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';

-- ============================================================================
-- La tabla no se alcanza por la API aunque se sepa su nombre
-- ============================================================================
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok($$select * from dominio.favoritos_cliente$$, '42501', null, 'authenticated no puede leer la tabla directamente');
select throws_ok(
  $$insert into dominio.favoritos_cliente (organizacion_id, empresa_id, cuenta_cliente_id, producto_id)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'authenticated no puede escribir la tabla directamente');
reset role;

-- La baja de la cuenta borra sus favoritos (on delete cascade).
delete from cuentas_cliente where id = 'ca000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from dominio.favoritos_cliente where cuenta_cliente_id = 'ca000000-0000-0000-0000-000000000003'),
  0, 'al borrar la cuenta se borran sus favoritos');

select * from finish();
rollback;
