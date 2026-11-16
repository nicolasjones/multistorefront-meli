-- MSF-176 · menores de las revisiones retroactivas de B1/B2 y «Mi cuenta» (migración 20270430000000).
--   1. B1: el cupo de llamadas SOBREVIVE a un fallo posterior (lista de pedido y envío): se fuerza el fallo redefiniendo una función
--      interna que se llama DESPUÉS del cupo (todo dentro de la transacción, que se revierte).
--   2. `private.catalogo_tienda_efectivo_ids` = `private.catalogo_tienda_efectivo` filtrado por ids (paridad), sin acceso de API.
--      La lista, el envío, mis favoritos y el alta de favoritos siguen dando lo mismo con el catálogo acotado.
--   3. `private.estado_publico_comprobante`: mapeo cerrado (estado desconocido → pendiente; nota de crédito anulada → anulada).
--   4. Filtros `organizacion_id` redundantes del historial: siguen en el SQL (las FK compuestas impiden construir datos que los distingan).
--   5. Comentarios aclaratorios («tienda pausada → error» es un valor de la respuesta).
begin;

select plan(50);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'mayorista@example.com');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'menores-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'menores-b.ejemplo.com');

-- 1 Alfa y 2 Beta visibles en A · 3 oculto en A · 4 inactivo · 6 solo en B · 5 de otra organización.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'SKU-BETA', 2000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 'SKU-OCU', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'SKU-INA', 500, 'ARS', false),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Solo en B', 'SKU-SOB', 500, 'ARS', true),
  ('a2000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Otra organización', 'SKU-OTR', 500, 'ARS', true);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a2000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
-- Categorías: «Padre oculto» (oculta en A) con un hijo visible por sí mismo; «Visible». 7 está en el hijo (oculto por herencia), 8 en la visible.
insert into dominio.categorias (id, organizacion_id, nombre, padre_id, posicion) values
  ('ce000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Padre oculto', null, 1),
  ('ce000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Hijo del oculto', 'ce000000-0000-0000-0000-000000000001', 1),
  ('ce000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Categoría visible', null, 2);
insert into dominio.categorias_tienda (empresa_id, categoria_id, organizacion_id, visible) values
  ('e1000000-0000-0000-0000-000000000001', 'ce000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', false);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'En categoría oculta', 'SKU-CAT7', 500, 'ARS', true, 'ce000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'En categoría visible', 'SKU-CAT8', 500, 'ARS', true, 'ce000000-0000-0000-0000-000000000003');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000008', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false, false);
insert into dominio.existencias (producto_id, organizacion_id, cantidad)
select p.id, p.organizacion_id, 7 from dominio.productos p
on conflict (producto_id) do update set cantidad = excluded.cantidad;

insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Mayorista Cuenta', 'my@example.com', 'mayorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'activa');

update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';

create function pg_temp.ip(p_ip text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true),
         set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true)
$$;
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- ============================================================================
-- 2. private.catalogo_tienda_efectivo_ids: paridad con la completa
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'private.catalogo_tienda_efectivo_ids(uuid, uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'private.catalogo_tienda_efectivo_ids(uuid, uuid[])', 'execute')
  and not has_function_privilege('service_role', 'private.catalogo_tienda_efectivo_ids(uuid, uuid[])', 'execute'),
  'catalogo_tienda_efectivo_ids: sin execute para anon, authenticated ni service_role');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
     from pg_proc p where p.oid = 'private.catalogo_tienda_efectivo_ids(uuid, uuid[])'::regprocedure),
  'catalogo_tienda_efectivo_ids: security definer con search_path vacío (como la completa)');
select is(
  (select jsonb_agg(to_jsonb(x) order by x.producto_id)
     from private.catalogo_tienda_efectivo_ids('e1000000-0000-0000-0000-000000000001', array[
       'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003',
       'a1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000005',
       'a1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000008', '99999999-9999-9999-9999-999999999999']::uuid[]) x),
  (select jsonb_agg(to_jsonb(x) order by x.producto_id)
     from private.catalogo_tienda_efectivo('e1000000-0000-0000-0000-000000000001') x),
  'catalogo_tienda_efectivo_ids con todos los ids (visibles, oculto, inactivo, de B, de otra organización, inexistente) = la completa de A (incluye categoría oculta por herencia)');
select is(
  (select jsonb_agg(to_jsonb(x) order by x.producto_id)
     from private.catalogo_tienda_efectivo_ids('e1000000-0000-0000-0000-000000000001',
       array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000004']::uuid[]) x),
  (select jsonb_agg(to_jsonb(x) order by x.producto_id)
     from private.catalogo_tienda_efectivo('e1000000-0000-0000-0000-000000000001') x
    where x.producto_id in ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000004')),
  'con un subconjunto de ids, el resultado coincide fila por fila con la completa filtrada (efectivo y motivo incluidos)');
select is(
  (select x.efectivo::text || '|' || coalesce(x.motivo, '') from private.catalogo_tienda_efectivo_ids('e1000000-0000-0000-0000-000000000001', array['a1000000-0000-0000-0000-000000000007']::uuid[]) x),
  'false|No se muestra: categoría oculta', 'un producto en una categoría hija de una oculta NO es efectivo (la visibilidad hereda), también con el catálogo acotado');
select is(
  (select x.efectivo from private.catalogo_tienda_efectivo_ids('e1000000-0000-0000-0000-000000000001', array['a1000000-0000-0000-0000-000000000008']::uuid[]) x),
  true, 'un producto en una categoría visible es efectivo');
select is(
  (select count(*)::int from private.catalogo_tienda_efectivo_ids('e1000000-0000-0000-0000-000000000001', array['a1000000-0000-0000-0000-000000000006']::uuid[])),
  0, 'un producto de otra tienda no sale aunque se pida por id');
select is(
  (select count(*)::int from private.catalogo_tienda_efectivo_ids('e1000000-0000-0000-0000-000000000001', null)),
  0, 'ids nulos: ningún producto');
select is(
  (select count(*)::int from private.catalogo_tienda_efectivo_ids('e1000000-0000-0000-0000-000000000001', '{}')),
  0, 'ids vacíos: ningún producto');
select is(
  (select array_agg(x.producto_id order by x.producto_id) from private.catalogo_tienda_efectivo_ids('e1000000-0000-0000-0000-000000000001',
     array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[]) x where x.efectivo),
  array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[],
  'efectivos de A entre Alfa, Beta y el oculto: solo Alfa y Beta');

-- ============================================================================
-- Lista de pedido y envío siguen dando lo mismo con el catálogo acotado
-- ============================================================================
select pg_temp.ip('10.50.0.1');
insert into res values
  ('lista', publico.lista_pedido_por_dominio('menores-a.ejemplo.com',
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":2},{"producto_id":"a1000000-0000-0000-0000-000000000003","cantidad":1},
       {"producto_id":"a1000000-0000-0000-0000-000000000004","cantidad":1},{"producto_id":"a1000000-0000-0000-0000-000000000006","cantidad":1},
       {"producto_id":"a2000000-0000-0000-0000-000000000005","cantidad":1}]'));
select is((select jsonb_agg(l ->> 'producto_id') from res, jsonb_array_elements(v -> 'lineas') l where k = 'lista'),
  '["a1000000-0000-0000-0000-000000000001"]'::jsonb, 'lista: solo el producto visible sale en lineas');
select is((select v -> 'no_disponibles' from res where k = 'lista'),
  '["a1000000-0000-0000-0000-000000000003","a1000000-0000-0000-0000-000000000004","a1000000-0000-0000-0000-000000000006","a2000000-0000-0000-0000-000000000005"]'::jsonb,
  'lista: oculto, inactivo, de otra tienda y de otra organización, indistinguibles en no_disponibles');
select pg_temp.ip('10.50.0.2');
insert into res values
  ('envio_ok', publico.enviar_lista_pedido('menores-a.ejemplo.com', 'Ana', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', 'aaaaaaaa-0000-0000-0000-0000000000a1')),
  ('envio_oculto', publico.enviar_lista_pedido('menores-a.ejemplo.com', 'Ana', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1},{"producto_id":"a1000000-0000-0000-0000-000000000003","cantidad":1}]', 'aaaaaaaa-0000-0000-0000-0000000000a2'));
select is((select v from res where k = 'envio_ok'), '{"estado":"ok"}'::jsonb, 'envío con un producto visible: ok');
select is((select v from res where k = 'envio_oculto'),
  '{"estado":"invalido","campos":["items"],"no_disponibles":["a1000000-0000-0000-0000-000000000003"]}'::jsonb,
  'envío con un producto oculto: se rechaza la lista entera y se nombra el no disponible');

-- ============================================================================
-- Favoritos con el catálogo acotado
-- ============================================================================
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
insert into res values
  ('fav1', publico.cambiar_favorito_por_dominio('menores-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true)),
  ('fav2', publico.cambiar_favorito_por_dominio('menores-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', true)),
  ('fav_oculto', publico.cambiar_favorito_por_dominio('menores-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000003', true)),
  ('fav_inactivo', publico.cambiar_favorito_por_dominio('menores-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000004', true)),
  ('fav_otra_tienda', publico.cambiar_favorito_por_dominio('menores-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000006', true)),
  ('fav_otra_org', publico.cambiar_favorito_por_dominio('menores-a.ejemplo.com', 'a2000000-0000-0000-0000-000000000005', true)),
  ('fav_repetido', publico.cambiar_favorito_por_dominio('menores-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', true));
-- Otra sentencia: la función es stable y no ve lo insertado por la misma sentencia.
insert into res values ('mis_favoritos', publico.mis_favoritos_por_dominio('menores-a.ejemplo.com'));
reset role;
select is((select v from res where k = 'fav1'), '{"estado":"ok","favorito":true}'::jsonb, 'alta de un favorito visible: ok');
select is((select v from res where k = 'fav_repetido'), '{"estado":"ok","favorito":true}'::jsonb, 'alta repetida: ok sin duplicar');
select is((select jsonb_agg(v ->> 'estado' order by k) from res where k in ('fav_oculto', 'fav_inactivo', 'fav_otra_tienda', 'fav_otra_org')),
  '["no_encontrado","no_encontrado","no_encontrado","no_encontrado"]'::jsonb, 'oculto, inactivo, de otra tienda y de otra organización: no_encontrado');
select is((select v ->> 'estado' from res where k = 'mis_favoritos'), 'ok', 'mis favoritos: ok');
select is((select (v ->> 'total')::int from res where k = 'mis_favoritos'), 2, 'mis favoritos: total 2');
select is((select jsonb_agg(f ->> 'producto_id' order by f ->> 'nombre') from res, jsonb_array_elements(v -> 'filas') f where k = 'mis_favoritos'),
  '["a1000000-0000-0000-0000-000000000001","a1000000-0000-0000-0000-000000000002"]'::jsonb, 'mis favoritos: Alfa y Beta');
-- Un favorito cuyo producto se ocultó después no se lista ni se cuenta (sigue guardado).
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', false, false);
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select is((select (publico.mis_favoritos_por_dominio('menores-a.ejemplo.com') ->> 'total')::int), 1, 'tras ocultar Beta: mis favoritos cuenta 1');
reset role;
select is((select count(*)::int from dominio.favoritos_cliente), 2, 'el favorito del producto oculto sigue guardado');

-- ============================================================================
-- 1. B1: el cupo de llamadas sobrevive a un fallo posterior
-- ============================================================================
-- Fallo forzado DESPUÉS del cupo: `disponible_publico` se llama por cada línea de la lista (después del cupo de lecturas).
delete from public.limite_pedidos_publicos;
create or replace function private.disponible_publico(p_producto uuid) returns boolean language plpgsql stable as $$
begin raise exception 'fallo forzado por el pgTAP'; end $$;
select pg_temp.ip('10.50.0.3');
insert into res values
  ('lista_falla', publico.lista_pedido_por_dominio('menores-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]'));
select is((select v from res where k = 'lista_falla'), '{"estado":"error"}'::jsonb, 'lista con un fallo interno: {estado: error} sin texto de Postgres');
select is((select sum(pedidos)::int from public.limite_pedidos_publicos where visitante like 'lista|%'), 1,
  'lista: el cupo de lecturas SE GASTÓ aunque la llamada falló (sobrevive al fallo)');
-- Repetida más allá del cupo (30): el que provoca el fallo ya no es gratis.
do $$
begin
  for i in 1..30 loop
    perform publico.lista_pedido_por_dominio('menores-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]');
  end loop;
end $$;
select is((select publico.lista_pedido_por_dominio('menores-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]') ->> 'estado'),
  'limite', 'lista: tras 30 llamadas que fallan se llega a limite (el fallo no devuelve el cupo)');

-- Envío: `validar_items_pedido` se llama DESPUÉS del cupo de llamadas.
create or replace function private.validar_items_pedido(p_items jsonb) returns jsonb language plpgsql immutable as $$
begin raise exception 'fallo forzado por el pgTAP'; end $$;
select pg_temp.ip('10.50.0.4');
insert into res values
  ('envio_falla', publico.enviar_lista_pedido('menores-a.ejemplo.com', 'Ana', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', 'aaaaaaaa-0000-0000-0000-0000000000a3'));
select is((select v from res where k = 'envio_falla'), '{"estado":"error"}'::jsonb, 'envío con un fallo interno: {estado: error}');
select is((select sum(pedidos)::int from public.limite_pedidos_publicos where visitante like 'envio|%' and visitante = 'envio|' || private.visitante_publico('menores-a.ejemplo.com')), 1,
  'envío: el cupo de llamadas SE GASTÓ aunque la llamada falló (sobrevive al fallo)');
do $$
begin
  for i in 1..20 loop
    perform publico.enviar_lista_pedido('menores-a.ejemplo.com', 'Ana', 'ana@example.com', null,
      '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid());
  end loop;
end $$;
select is((select publico.enviar_lista_pedido('menores-a.ejemplo.com', 'Ana', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid()) ->> 'estado'),
  'limite', 'envío: tras 20 llamadas que fallan se llega a limite (el fallo no devuelve el cupo)');
select is((select count(*)::int from dominio.consultas where origen = 'pedido'), 1, 'las llamadas que fallaron no crearon consultas: solo la del envío ok');

-- Manejador EXTERIOR (lo que corre ANTES del sub-bloque). `validar_items_pedido` sigue lanzando: en la lista se llama antes del cupo.
delete from public.limite_pedidos_publicos;
select pg_temp.ip('10.50.0.5');
select is(publico.lista_pedido_por_dominio('menores-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]'),
  '{"estado":"error"}'::jsonb, 'lista: un fallo ANTES del cupo lo atrapa el manejador exterior y responde error');
select is((select count(*)::int from public.limite_pedidos_publicos), 0, 'lista: un fallo antes del cupo no consume cupo (no había cupo que conservar)');
-- Envío: `visitante_publico` se llama al consumir el cupo de llamadas (antes del sub-bloque).
create or replace function private.visitante_publico(p_host text) returns text language plpgsql stable as $$
begin raise exception 'fallo forzado por el pgTAP'; end $$;
select is(publico.enviar_lista_pedido('menores-a.ejemplo.com', 'Ana', 'ana@example.com', null,
  '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid()),
  '{"estado":"error"}'::jsonb, 'envío: un fallo ANTES del sub-bloque (al consumir el cupo) lo atrapa el manejador exterior y responde error');
select is((select count(*)::int from public.limite_pedidos_publicos), 0, 'envío: ese fallo no dejó filas de cupo');

-- Estructura: el cupo va ANTES del sub-bloque, y el sub-bloque tiene su propio manejador (3 manejadores en el envío, 2 en la lista).
select ok(
  (select regexp_count(p.prosrc, 'exception when others') = 2
      and p.prosrc ~ 'registrar_pedido_publico[\s\S]*?begin[\s\S]*?exception when others[\s\S]*?end;[\s\S]*?exception when others'
     from pg_proc p where p.oid = 'publico.lista_pedido_por_dominio(text, jsonb)'::regprocedure),
  'lista_pedido_por_dominio: cupo, luego un bloque propio con su manejador y el manejador exterior');
select ok(
  (select regexp_count(p.prosrc, 'exception when others') = 3
      and p.prosrc ~ 'registrar_pedido_publico[\s\S]*?begin[\s\S]*?exception when others'
     from pg_proc p where p.oid = 'publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid)'::regprocedure),
  'enviar_lista_pedido: cupo, luego un bloque propio, la sub-transacción de la entrega y el manejador exterior');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'))
     from pg_proc p where p.oid in ('publico.lista_pedido_por_dominio(text, jsonb)'::regprocedure,
                                    'publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid)'::regprocedure)),
  'lista y envío conservan security definer, search_path vacío y execute para anon y authenticated');

-- ============================================================================
-- 3. estado_publico_comprobante: mapeo cerrado
-- ============================================================================
select is(
  (select jsonb_agg(private.estado_publico_comprobante('presupuesto', e, null) order by e)
     from unnest(array['aceptado', 'anulada', 'armando', 'cobrado', 'confirmada', 'convertido', 'deuda', 'en_proceso', 'incompleto', 'pendiente']) e),
  '["aceptado","anulado","aceptado","aceptado","aceptado","aceptado","aceptado","aceptado","aceptado","pendiente"]'::jsonb,
  'presupuesto: aceptado y los estados posteriores → aceptado; anulada → anulado; pendiente → pendiente');
select is(
  (select jsonb_agg(private.estado_publico_comprobante('presupuesto', e, null) order by e) from unnest(array['estado_nuevo', '', 'borrador', 'ANULADA']) e),
  '["pendiente","pendiente","pendiente","pendiente"]'::jsonb,
  'presupuesto con estado desconocido (nuevo, vacío, borrador, otra capitalización): pendiente, NUNCA aceptado');
select is(private.estado_publico_comprobante('presupuesto', null, null), 'pendiente', 'presupuesto con estado nulo: pendiente');
select is(
  (select jsonb_agg(private.estado_publico_comprobante('presupuesto', x, null)) from unnest(array['cobrado', 'deuda']) x),
  '["aceptado","aceptado"]'::jsonb, 'presupuesto cobrado o con deuda se muestra «aceptado» (semántica existente: nunca se exponen cobro ni despacho)');
select is(
  (select jsonb_build_array(private.estado_publico_comprobante('nota_credito', 'confirmada', null), private.estado_publico_comprobante('nota_credito', 'anulada', null),
                            private.estado_publico_comprobante('factura', 'anulada', null), private.estado_publico_comprobante('factura', 'cobrado', null))),
  '["nota_credito","anulada","anulada","confirmada"]'::jsonb,
  'nota de crédito: nota_credito, y anulada si está anulada; factura: anulada o confirmada');
select is(private.estado_publico_comprobante('otro_tipo', 'pendiente', null), null, 'un tipo desconocido no tiene estado público (null)');
select ok(
  (select p.provolatile = 's' and array_to_string(p.proconfig, ',') = 'search_path=""' and not p.prosecdef
     and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
     from pg_proc p where p.oid = 'private.estado_publico_comprobante(text, text, date)'::regprocedure),
  'estado_publico_comprobante: stable, search_path vacío y sin execute para la API (sin cambios)');

-- ============================================================================
-- 4. Filtros organizacion_id del historial (defensa en profundidad): siguen en el SQL
-- ============================================================================
select is(
  (select count(*)::int from pg_constraint c
    where c.contype = 'f' and c.conrelid = 'dominio.comprobantes_venta'::regclass
      and c.conname in ('comprobantes_venta_cliente_id_organizacion_id_fkey', 'comprobantes_venta_empresa_fk')),
  2, 'FK compuestas (cliente, organizacion) y (empresa, organizacion) de comprobantes_venta: por eso el filtro organizacion_id es redundante');
select is(
  (select count(*)::int from pg_constraint c
    where c.contype = 'f' and c.conrelid = 'dominio.comprobantes_venta_lineas'::regclass
      and c.conname = 'comprobantes_venta_lineas_comprobante_id_organizacion_id_fkey'),
  1, 'FK compuesta (comprobante, organizacion) de las líneas');
select is(
  (select regexp_count(p.prosrc, 'c\.organizacion_id = v_cuenta\.organizacion_id') from pg_proc p
    where p.oid = 'publico.mis_compras_por_dominio(text, date, uuid, integer)'::regprocedure),
  1, 'mis_compras_por_dominio: el filtro del comprobante por la organización de la cuenta sigue en el SQL');
select is(
  (select regexp_count(p.prosrc, 'c\.organizacion_id = v_cuenta\.organizacion_id') from pg_proc p
    where p.oid = 'publico.mi_compra_por_dominio(text, uuid)'::regprocedure),
  1, 'mi_compra_por_dominio: el filtro del comprobante por la organización de la cuenta sigue en el SQL');
select is(
  (select regexp_count(p.prosrc, 'l\.organizacion_id = v_cuenta\.organizacion_id') from pg_proc p
    where p.oid = 'publico.mi_compra_por_dominio(text, uuid)'::regprocedure),
  1, 'mi_compra_por_dominio: el filtro de las líneas por la organización de la cuenta sigue en el SQL');

-- ============================================================================
-- 5. Comentarios aclaratorios
-- ============================================================================
select matches(obj_description('publico.capacidades_tienda_por_dominio(text)'::regprocedure, 'pg_proc'),
  'valor de la respuesta', 'capacidades_tienda_por_dominio: el comentario aclara que «error» es un valor de la respuesta y no una excepción');
select matches(obj_description('publico.mis_compras_por_dominio(text, date, uuid, integer)'::regprocedure, 'pg_proc'),
  'DEFENSA EN PROFUNDIDAD', 'mis_compras_por_dominio: el comentario documenta el filtro redundante como defensa en profundidad');

select * from finish();
rollback;
