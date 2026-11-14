-- MSF-176 · Tienda compra y cuentas, historia B1 «Lista de pedido sin cobro», T032 + T033 + T035 + T036 + T042. FR-020 a FR-033, FR-014;
-- D-8, D-9, D-20, D-28; amenazas 1.1 a 1.10; escenarios B1-1 a B1-10.
--   * `private.validar_items_pedido`: batería de entradas hostiles (no-array, 10.000 elementos, anidados, tipos raros, cantidad negativa/
--     decimal/texto/`1e9`, uuid mal formado, claves ajenas): todas dan NULL y NINGUNA lanza un error de Postgres.
--   * `publico.lista_pedido_por_dominio`: precio del servidor y paridad contra `producto_por_dominio` y `precios_cliente_por_dominio`
--     (mismo precio y mismo `precio_anterior`), escala por cantidad con cuenta activa, no disponibles indistinguibles, claves exactas,
--     host desconocido = empresa desactivada = bandera apagada, cupo de lecturas, 50 líneas.
--   * `publico.enviar_lista_pedido`: consulta + ítems en una transacción, `precio_referencia` del servidor, idempotencia por clave,
--     sexto envío = `limite`, validación de campos y caracteres de control, `<script>` y fórmulas guardados literales, cuenta activa sin
--     pedir datos y con `cliente_id`, rechazo total ante productos no visibles, falla de entrega sin gastar cupo, nada de texto de
--     Postgres, aislamiento entre dos organizaciones, bandera apagada sin efecto.
--   * Privilegios: `anon` sin execute sobre `crear_consulta_publica`, `crear_consulta_pedido` ni las tablas; RLS de `consulta_items`.
--   * Aviso por correo del pedido (resumen de ítems) y vistas del panel.
begin;

select plan(210);

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

-- A y B: dos tiendas de la misma organización; P: tienda pausada; X: de otra organización.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda pausada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda X', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'lista-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'lista-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'lista-pausada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'lista-x.ejemplo.com');

-- 1 Alfa (lista 1000; escalas x5 900, x10 800, x50 700) · 2 Beta · 3 oculto en A · 4 inactivo · 6 solo en B · 7 sin stock ·
-- 8 con promoción vigente (3000 → 2400; x10 = 2000, gana la escala) · 9 con promoción vigente (5000 → 3000; x10 = 4500, gana la promoción) ·
-- 5 de otra organización.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'SKU-BETA', 2000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 'SKU-OCU', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'SKU-INA', 500, 'ARS', false),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Solo en B', 'SKU-SOB', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Sin stock', 'SKU-SST', 500, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Con promo menor que la escala', 'SKU-PRO8', 3000, 'ARS', true),
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Con promo mayor descuento', 'SKU-PRO9', 5000, 'ARS', true),
  ('a2000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Otra organización', 'SKU-OTR', 500, 'ARS', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 'Masivo ' || n, 'MAS-' || n, 100 + n, 'ARS', true
  from generate_series(1, 60) n;
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id
  from dominio.productos p
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.id <> 'a1000000-0000-0000-0000-000000000006';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
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
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x50', 700),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'x10', 2000),
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'x10', 4500);
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000008', 2400, now() - interval '1 day', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000009', 3000, now() - interval '1 day', now() + interval '1 day');

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Mayorista Cuenta', 'my@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Minorista Cuenta', 'mn@example.com', 'minorista'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 912, 'Suspendida', 'su@example.com', 'mayorista'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 913, 'No habilitada', 'nh@example.com', 'mayorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'activa'),
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
-- Cada caso usa «su» visitante (IP distinta): el cupo es por hash de IP y empresa.
-- También deja la sesión como la de un visitante (claims sin `sub`): un `como` anterior no se arrastra a las pruebas de `anon`.
create function pg_temp.ip(p_ip text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true),
         set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true)
$$;

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- ============================================================================
-- Privilegios y estructura (amenazas 1.2, 1.4; matriz de permisos)
-- ============================================================================
select ok(
  has_function_privilege('anon', 'publico.lista_pedido_por_dominio(text, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'publico.lista_pedido_por_dominio(text, jsonb)', 'execute'),
  'anon y authenticated ejecutan lista_pedido_por_dominio (superficie pública deliberada)');
select ok(
  has_function_privilege('anon', 'publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid)', 'execute')
  and has_function_privilege('authenticated', 'publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid)', 'execute'),
  'anon y authenticated ejecutan enviar_lista_pedido (superficie pública deliberada)');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'publico'::regnamespace and p.proname in ('lista_pedido_por_dominio', 'enviar_lista_pedido')
      and p.prosecdef and p.proconfig = array['search_path=""']),
  2, 'las dos son security definer con search_path vacío');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'publico'::regnamespace and p.proname in ('lista_pedido_por_dominio', 'enviar_lista_pedido')
      and (p.proargnames && array['cliente_id', 'cuenta_id', 'cuenta_cliente_id', 'empresa_id', 'organizacion_id', 'precio', 'precio_referencia'])),
  0, 'ninguna recibe cliente, cuenta, empresa, organización ni precios: todo sale del host y de la sesión');
select ok(
  not has_function_privilege('anon', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'execute'),
  'crear_consulta_publica sigue sin execute para anon y authenticated (no se puede evadir el límite)');
select is(
  (select jsonb_build_array(count(*), count(*) filter (where has_function_privilege('anon', p.oid, 'execute')
                                                          or has_function_privilege('authenticated', p.oid, 'execute')
                                                          or has_function_privilege('public', p.oid, 'execute')))
     from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('validar_items_pedido', 'precio_referencia_pedido', 'crear_consulta_pedido', 'emitir_aviso_consulta',
                        'encolar_aviso_consulta', 'limite_listas_por_minuto')),
  '[6, 0]'::jsonb, 'existen los 6 helpers private de B1 y ninguno es ejecutable por la API');
select ok(
  not has_table_privilege('anon', 'dominio.consulta_items', 'select')
  and not has_table_privilege('anon', 'dominio.consultas', 'select')
  and not has_table_privilege('anon', 'dominio.tienda_envios', 'select')
  and not has_table_privilege('anon', 'dominio.consultas', 'insert')
  and not has_table_privilege('anon', 'dominio.consulta_items', 'insert'),
  'anon no lee ni escribe consultas, consulta_items ni tienda_envios');
select ok(
  has_table_privilege('authenticated', 'dominio.consulta_items', 'select')
  and not has_table_privilege('authenticated', 'dominio.consulta_items', 'insert')
  and not has_table_privilege('authenticated', 'dominio.consulta_items', 'update')
  and not has_table_privilege('authenticated', 'dominio.consulta_items', 'delete')
  and not has_table_privilege('authenticated', 'dominio.consultas', 'insert'),
  'authenticated solo lee consulta_items (sin escritura); tampoco inserta en consultas');
select ok(
  not has_table_privilege('anon', 'public.consulta_items_bandeja', 'select')
  and has_table_privilege('authenticated', 'public.consulta_items_bandeja', 'select')
  and not has_table_privilege('anon', 'public.consultas_bandeja', 'select'),
  'las vistas del panel no son legibles por anon; authenticated sí');
select is(
  (select c.relrowsecurity from pg_class c where c.oid = 'dominio.consulta_items'::regclass),
  true, 'dominio.consulta_items tiene RLS activada');
select is(
  (select count(*)::int from pg_policy where polrelid = 'dominio.consulta_items'::regclass and polcmd = 'r'),
  1, 'una única política (select); ninguna de escritura');
select is(
  (select count(*)::int from pg_policy where polrelid = 'dominio.consulta_items'::regclass and polcmd <> 'r'),
  0, 'sin políticas de escritura');
select is(
  (select array_agg(c.reloptions::text) from pg_class c where c.oid in ('public.consulta_items_bandeja'::regclass, 'public.consultas_bandeja'::regclass)),
  array['{security_invoker=true}', '{security_invoker=true}'], 'las dos vistas son security_invoker (heredan la RLS)');

-- FK compuestas: una línea no puede mezclar organización ni empresa de su consulta ni apuntar a un producto de otra organización.
insert into dominio.consultas (id, organizacion_id, empresa_id, origen, nombre, contacto, mensaje) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'formulario', 'Base', 'base@example.com', 'Hola');
select throws_ok(
  $$insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, descripcion, cantidad)
    values ('22222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, 'X', 1)$$,
  '23503', null, 'una línea no puede mezclar su organización con la de la consulta');
select throws_ok(
  $$insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, descripcion, cantidad)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 1, 'X', 1)$$,
  '23503', null, 'una línea no puede apuntar a otra empresa que la de su consulta');
select throws_ok(
  $$insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, producto_id, descripcion, cantidad)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, 'a2000000-0000-0000-0000-000000000005', 'X', 1)$$,
  '23503', null, 'una línea no puede apuntar a un producto de otra organización');
select throws_ok(
  $$insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, descripcion, cantidad)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, 'X', 0)$$,
  '23514', null, 'cantidad 0 rechazada por la tabla');
select throws_ok(
  $$insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, descripcion, cantidad)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, 'X', 10000)$$,
  '23514', null, 'cantidad 10.000 rechazada por la tabla');
select throws_ok(
  $$insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, descripcion, cantidad)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 51, 'X', 1)$$,
  '23514', null, 'orden 51 rechazado por la tabla (tope de 50 líneas)');

-- `consultas`: el origen pedido es válido y no exige mensaje; formulario sigue exigiéndolo; un origen cualquiera se rechaza.
select lives_ok(
  $$insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'pedido', 'Sin nota', 'sn@example.com')$$,
  'un pedido sin nota (mensaje nulo) es válido');
select throws_ok(
  $$insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'formulario', 'Sin mensaje', 'sm@example.com')$$,
  '23514', null, 'un formulario sin mensaje sigue siendo inválido');
select throws_ok(
  $$insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto, mensaje)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'cualquiera', 'Otro', 'o@example.com', 'x')$$,
  '23514', null, 'un origen desconocido se rechaza');
select throws_ok(
  $$insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto, cliente_id)
    values ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'pedido', 'Cruce', 'c@example.com', 'c1000000-0000-0000-0000-000000000001')$$,
  '23503', null, 'cliente_id es una FK compuesta: no puede ser de otra organización');
select lives_ok(
  $$insert into dominio.tienda_envios (organizacion_id, empresa_id, visitante, clave_envio, origen)
    values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'x', gen_random_uuid(), 'pedido'),
           ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'x', gen_random_uuid(), 'presupuesto')$$,
  'tienda_envios acepta los orígenes pedido y presupuesto');
delete from dominio.consultas where origen = 'pedido' and nombre = 'Sin nota';
delete from dominio.tienda_envios where visitante = 'x';

-- ============================================================================
-- T032 · batería de entradas hostiles de private.validar_items_pedido (amenaza 1.3): todas NULL, ninguna con error de Postgres
-- ============================================================================
select is(private.validar_items_pedido(null), null, 'null: inválido');
select is(private.validar_items_pedido('{}'::jsonb), null, 'un objeto en vez de un arreglo: inválido');
select is(private.validar_items_pedido('"texto"'::jsonb), null, 'un texto en vez de un arreglo: inválido');
select is(private.validar_items_pedido('5'::jsonb), null, 'un número en vez de un arreglo: inválido');
select is(private.validar_items_pedido('[]'::jsonb), null, 'un arreglo vacío: inválido');
select is(
  private.validar_items_pedido((select jsonb_agg(jsonb_build_object('producto_id', gen_random_uuid(), 'cantidad', 1)) from generate_series(1, 51))),
  null, '51 líneas: inválido');
select lives_ok(
  $$select private.validar_items_pedido((select jsonb_agg(jsonb_build_object('producto_id', gen_random_uuid(), 'cantidad', 1)) from generate_series(1, 10000)))$$,
  '10.000 elementos no lanzan error');
select is(
  private.validar_items_pedido((select jsonb_agg(jsonb_build_object('producto_id', gen_random_uuid(), 'cantidad', 1)) from generate_series(1, 10000))),
  null, '10.000 elementos: inválido');
select is(
  private.validar_items_pedido((select jsonb_agg(jsonb_build_object('producto_id', gen_random_uuid(), 'cantidad', 1, 'relleno', repeat('x', 200))) from generate_series(1, 50))),
  null, '50 líneas pero más de 8.000 caracteres de texto: inválido');
select is(private.validar_items_pedido('[[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]]'::jsonb), null, 'un arreglo anidado: inválido');
select is(private.validar_items_pedido('[5]'::jsonb), null, 'un elemento número: inválido');
select is(private.validar_items_pedido('["a1000000-0000-0000-0000-000000000001"]'::jsonb), null, 'un elemento texto: inválido');
select is(private.validar_items_pedido('[null]'::jsonb), null, 'un elemento null: inválido');
select is(private.validar_items_pedido('[{}]'::jsonb), null, 'un elemento sin claves: inválido');
select is(private.validar_items_pedido('[{"cantidad":1}]'::jsonb), null, 'sin producto_id: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001"}]'::jsonb), null, 'sin cantidad: inválido');
select is(private.validar_items_pedido('[{"producto_id":5,"cantidad":1}]'::jsonb), null, 'producto_id número: inválido');
select is(private.validar_items_pedido('[{"producto_id":"no-es-un-uuid","cantidad":1}]'::jsonb), null, 'producto_id mal formado: inválido');
select is(private.validar_items_pedido('[{"producto_id":"{a1000000-0000-0000-0000-000000000001}","cantidad":1}]'::jsonb), null, 'uuid entre llaves: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-00000000000g","cantidad":1}]'::jsonb), null, 'uuid con un carácter no hexadecimal: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":-1}]'::jsonb), null, 'cantidad negativa: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":0}]'::jsonb), null, 'cantidad 0: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1.5}]'::jsonb), null, 'cantidad decimal: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":"1.0"}]'::jsonb), null, 'cantidad texto decimal: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":"abc"}]'::jsonb), null, 'cantidad texto: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":"1e9"}]'::jsonb), null, 'cantidad «1e9» texto: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1e9}]'::jsonb), null, 'cantidad 1e9 número: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":10000}]'::jsonb), null, 'cantidad 10.000: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":99999999999999999999}]'::jsonb), null, 'cantidad enorme: inválido sin desbordar');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":true}]'::jsonb), null, 'cantidad booleana: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":null}]'::jsonb), null, 'cantidad null: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":{"a":1}}]'::jsonb), null, 'cantidad objeto: inválido');
select is(private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":" 5"}]'::jsonb), null, 'cantidad con espacios: inválido');
select is(
  private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1},{"cantidad":-5}]'::jsonb),
  null, 'una sola línea mala invalida la lista entera');
select is(
  private.validar_items_pedido('[{"producto_id":"A1000000-0000-0000-0000-000000000001","cantidad":"3","precio":1,"precio_referencia":1,"cliente_id":"c1000000-0000-0000-0000-000000000001","descuento":99}]'::jsonb),
  '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":3}]'::jsonb,
  'válida: uuid en minúsculas, cantidad texto o número, y las claves ajenas (precio, cliente_id, descuento…) se ignoran');
select is(
  private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":2},{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1},{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":3}]'::jsonb),
  '[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":5},{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]'::jsonb,
  'los repetidos se suman y conservan el orden de la primera aparición');
select is(
  private.validar_items_pedido('[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":9000},{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":9000}]'::jsonb),
  '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":9999}]'::jsonb,
  'la suma de repetidos tiene tope 9.999');
select is(
  private.validar_items_pedido((select jsonb_agg(jsonb_build_object('producto_id', gen_random_uuid(), 'cantidad', 9999)) from generate_series(1, 50))) is not null,
  true, '50 líneas válidas con el máximo de unidades: válido');

-- ============================================================================
-- Bandera apagada y host desconocido: el mismo error (FR-014; amenaza 1.4) y nada se toca
-- ============================================================================
update public.banderas_plataforma set activa = false where clave = 'tienda_pedidos';
select pg_temp.ip('10.9.0.1');
set local role anon;
insert into res values
  ('lista_apagada', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]')),
  ('envio_apagada', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid()));
reset role;
update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';
select is((select v from res where k = 'lista_apagada'), '{"estado":"error"}'::jsonb, 'bandera apagada: lista_pedido_por_dominio responde error genérico');
select is((select v from res where k = 'envio_apagada'), '{"estado":"error"}'::jsonb, 'bandera apagada: enviar_lista_pedido responde error genérico');
select is((select count(*)::int from dominio.consultas where origen = 'pedido'), 0, 'bandera apagada: no se creó ninguna consulta');
select is((select count(*)::int from dominio.tienda_envios), 0, 'bandera apagada: no se gastó cupo');

select pg_temp.ip('10.9.0.2');
set local role anon;
insert into res values
  ('lista_host_desconocido', publico.lista_pedido_por_dominio('desconocido.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]')),
  ('lista_pausada', publico.lista_pedido_por_dominio('lista-pausada.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]')),
  ('lista_host_nulo', publico.lista_pedido_por_dominio(null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]')),
  ('lista_host_invalido_items', publico.lista_pedido_por_dominio('desconocido.ejemplo.com', '[]')),
  ('envio_host_desconocido', publico.enviar_lista_pedido('desconocido.ejemplo.com', 'Ana', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('envio_pausada', publico.enviar_lista_pedido('lista-pausada.ejemplo.com', 'Ana', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('envio_host_invalido_items', publico.enviar_lista_pedido('desconocido.ejemplo.com', '', 'no', null, '[]', gen_random_uuid())),
  ('envio_sin_clave', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', null));
reset role;
select is(
  (select count(distinct v)::int from res where k in ('lista_host_desconocido', 'lista_pausada', 'lista_host_nulo', 'lista_host_invalido_items', 'lista_apagada')),
  1, 'lista: host desconocido, empresa desactivada, host nulo y bandera apagada responden lo mismo (también antes de validar los ítems)');
select is(
  (select count(distinct v)::int from res where k in ('envio_host_desconocido', 'envio_pausada', 'envio_host_invalido_items', 'envio_sin_clave', 'envio_apagada')),
  1, 'envío: host desconocido, empresa desactivada, sin clave y bandera apagada responden lo mismo (antes de validar los campos)');
select is((select v from res where k = 'envio_pausada'), '{"estado":"error"}'::jsonb, 'el error es {estado: error} y nada más');

-- ============================================================================
-- lista_pedido_por_dominio: visitante (precio de la ficha), claves exactas, paridad (T033; D-28)
-- ============================================================================
select pg_temp.ip('10.1.0.1');
set local role anon;
insert into res values
  ('lista_vis', publico.lista_pedido_por_dominio('lista-a.ejemplo.com',
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":12,"precio":1,"descuento":50,"cliente_id":"c1000000-0000-0000-0000-000000000001"},
       {"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":3},
       {"producto_id":"a1000000-0000-0000-0000-000000000007","cantidad":1},
       {"producto_id":"a1000000-0000-0000-0000-000000000008","cantidad":2},
       {"producto_id":"a1000000-0000-0000-0000-000000000009","cantidad":1}]')),
  ('ficha_alfa', publico.producto_por_dominio('lista-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')),
  ('ficha_beta', publico.producto_por_dominio('lista-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002')),
  ('ficha_sin_stock', publico.producto_por_dominio('lista-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000007')),
  ('ficha_p8', publico.producto_por_dominio('lista-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000008')),
  ('ficha_p9', publico.producto_por_dominio('lista-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000009'));
reset role;
select is((select v ->> 'estado' from res where k = 'lista_vis'), 'ok', 'el visitante recibe la lista revalidada');
select is((select v ->> 'con_cuenta' from res where k = 'lista_vis'), 'false', 'visitante: con_cuenta = false');
select is((select v -> 'tipo' from res where k = 'lista_vis'), 'null'::jsonb, 'visitante: tipo = null');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select v from res where k = 'lista_vis')) k),
  array['con_cuenta', 'estado', 'lineas', 'no_disponibles', 'tipo', 'total_referencia'], 'la respuesta tiene exactamente las claves del contrato');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select v -> 'lineas' -> 0 from res where k = 'lista_vis')) k),
  array['cantidad', 'disponible', 'escala', 'imagen', 'nombre', 'precio_anterior', 'precio_unitario', 'producto_id', 'sku', 'subtotal'],
  'cada línea tiene exactamente la lista blanca: sin costos, márgenes, existencias ni organización');
select is(
  (select jsonb_agg(l ->> 'producto_id') from jsonb_array_elements((select v -> 'lineas' from res where k = 'lista_vis')) l),
  '["a1000000-0000-0000-0000-000000000001","a1000000-0000-0000-0000-000000000002","a1000000-0000-0000-0000-000000000007","a1000000-0000-0000-0000-000000000008","a1000000-0000-0000-0000-000000000009"]'::jsonb,
  'las líneas conservan el orden de la lista');
select is((select (v -> 'lineas' -> 0 ->> 'cantidad')::int from res where k = 'lista_vis'), 12, 'la cantidad es la pedida');
select is((select v -> 'lineas' -> 0 ->> 'imagen' from res where k = 'lista_vis'), '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/alfa-1.jpg', 'la imagen es la primera del producto');
-- Paridad con la ficha: mismo precio y mismo precio_anterior (D-28).
select is(
  (select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'lista_vis'),
  (select (v ->> 'precio')::numeric from res where k = 'ficha_alfa'), 'paridad: Alfa tiene el mismo precio que la ficha (el visitante no tiene escala)');
select is(
  (select (v -> 'lineas' -> 1 ->> 'precio_unitario')::numeric from res where k = 'lista_vis'),
  (select (v ->> 'precio')::numeric from res where k = 'ficha_beta'), 'paridad: Beta tiene el mismo precio que la ficha');
select is(
  (select (v -> 'lineas' -> 3 ->> 'precio_unitario')::numeric from res where k = 'lista_vis'),
  (select (v ->> 'precio')::numeric from res where k = 'ficha_p8'), 'paridad: el producto en promoción tiene el precio promocional de la ficha');
select is(
  (select (v -> 'lineas' -> 3 ->> 'precio_anterior')::numeric from res where k = 'lista_vis'),
  (select (v ->> 'precio_anterior')::numeric from res where k = 'ficha_p8'), 'paridad: el precio_anterior es el tachado de la ficha');
select isnt((select v -> 'lineas' -> 3 ->> 'precio_anterior' from res where k = 'lista_vis'), null, 'con promoción vigente hay precio_anterior');
select is((select v -> 'lineas' -> 0 -> 'precio_anterior' from res where k = 'lista_vis'), 'null'::jsonb, 'sin promoción el precio_anterior es null');
select is(
  (select (v -> 'lineas' -> 4 ->> 'precio_unitario')::numeric from res where k = 'lista_vis'),
  (select (v ->> 'precio')::numeric from res where k = 'ficha_p9'), 'paridad: segundo producto en promoción');
select is((select (v -> 'lineas' -> 0 ->> 'subtotal')::numeric from res where k = 'lista_vis'),
  (select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric * 12 from res where k = 'lista_vis'), 'subtotal = precio × cantidad (visitante: sin escala)');
select is((select v -> 'lineas' -> 0 ->> 'escala' from res where k = 'lista_vis'), 'x1', 'el visitante siempre ve la escala x1');
-- Sin stock: se puede agregar, marcada (FR-024).
select is((select (v -> 'lineas' -> 2 ->> 'disponible')::boolean from res where k = 'lista_vis'), false, 'sin stock: la línea está y figura no disponible');
select is((select (v ->> 'disponible')::boolean from res where k = 'ficha_sin_stock'), false, 'coincide con la ficha');
select is(
  (select (v ->> 'total_referencia')::numeric from res where k = 'lista_vis'),
  (select sum((l ->> 'subtotal')::numeric) from jsonb_array_elements((select v -> 'lineas' from res where k = 'lista_vis')) l),
  'el total de referencia es la suma de los subtotales');

-- ============================================================================
-- lista_pedido_por_dominio: no disponibles indistinguibles (amenazas 1.4 y 1.10; escenario B1-5)
-- ============================================================================
select pg_temp.ip('10.1.0.2');
set local role anon;
insert into res values
  ('nd_oculto', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000003","cantidad":1}]')),
  ('nd_inactivo', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000004","cantidad":1}]')),
  ('nd_otra_tienda', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000006","cantidad":1}]')),
  ('nd_otra_org', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a2000000-0000-0000-0000-000000000005","cantidad":1}]')),
  ('nd_inexistente', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"99999999-9999-9999-9999-999999999999","cantidad":1}]')),
  ('nd_mezcla', publico.lista_pedido_por_dominio('lista-a.ejemplo.com',
     '[{"producto_id":"a1000000-0000-0000-0000-000000000003","cantidad":1},{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1},{"producto_id":"99999999-9999-9999-9999-999999999999","cantidad":1}]'));
reset role;
select is((select v -> 'lineas' from res where k = 'nd_oculto'), '[]'::jsonb, 'oculto: ninguna línea');
select is((select v -> 'lineas' from res where k = 'nd_inactivo'), '[]'::jsonb, 'inactivo: ninguna línea');
select is(
  (select count(distinct v - 'no_disponibles')::int from res where k in ('nd_oculto', 'nd_inactivo', 'nd_otra_tienda', 'nd_otra_org', 'nd_inexistente')),
  1, 'oculto, inactivo, de otra tienda, de otra organización e inexistente: respuestas indistinguibles');
select is((select v -> 'no_disponibles' from res where k = 'nd_otra_org'), '["a2000000-0000-0000-0000-000000000005"]'::jsonb, 'figuran en no_disponibles con el id pedido');
select is((select v -> 'total_referencia' from res where k = 'nd_oculto'), 'null'::jsonb, 'sin líneas el total de referencia es null');
select is((select v -> 'no_disponibles' from res where k = 'nd_mezcla'), '["a1000000-0000-0000-0000-000000000003","99999999-9999-9999-9999-999999999999"]'::jsonb,
  'en una lista mezclada solo los no visibles van a no_disponibles, en orden');
select is((select jsonb_array_length(v -> 'lineas') from res where k = 'nd_mezcla'), 1, 'y el visible queda en las líneas');

-- ============================================================================
-- lista_pedido_por_dominio: cuenta activa, escala por cantidad (paridad con precios_cliente_por_dominio)
-- ============================================================================
select pg_temp.ip('10.1.0.3');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values
  ('lista_may', publico.lista_pedido_por_dominio('lista-a.ejemplo.com',
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":12},{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":3},
       {"producto_id":"a1000000-0000-0000-0000-000000000008","cantidad":12},{"producto_id":"a1000000-0000-0000-0000-000000000009","cantidad":12},
       {"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":60}]')),
  ('lista_may_x5', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":6}]')),
  ('lista_may_x50', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":50}]')),
  ('precios_may', publico.precios_cliente_por_dominio('lista-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
insert into res values
  ('lista_min', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":12}]'));
select pg_temp.como('f2000000-0000-0000-0000-000000000003');
insert into res values
  ('lista_susp', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":12}]'));
select pg_temp.como('f2000000-0000-0000-0000-000000000004');
insert into res values
  ('lista_nohab', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":12}]'));
select pg_temp.como('f2000000-0000-0000-0000-000000000007');
insert into res values
  ('lista_panel', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":12}]'));
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values
  ('lista_may_otra_tienda', publico.lista_pedido_por_dominio('lista-b.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":12}]'));
reset role;
select is((select v ->> 'con_cuenta' from res where k = 'lista_may'), 'true', 'cuenta activa: con_cuenta = true');
select is((select v ->> 'tipo' from res where k = 'lista_may'), 'mayorista', 'cuenta activa: el tipo sale de la base');
select is((select v -> 'lineas' -> 0 ->> 'escala' from res where k = 'lista_may'), 'x10', 'mayorista con 12 unidades: escala x10');
select is((select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'lista_may'), 800::numeric, 'mayorista x10: precio de la escala');
select is(
  (select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'lista_may'),
  (select (e ->> 'final')::numeric from jsonb_array_elements((select v -> 'precios' -> 0 -> 'escalas' from res where k = 'precios_may')) e where e ->> 'escala' = 'x10'),
  'paridad: el precio de la línea es el final x10 de precios_cliente_por_dominio');
select is(
  (select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'lista_may_x5'),
  (select (e ->> 'final')::numeric from jsonb_array_elements((select v -> 'precios' -> 0 -> 'escalas' from res where k = 'precios_may')) e where e ->> 'escala' = 'x5'),
  'paridad: 6 unidades = escala x5 de precios_cliente_por_dominio');
select is(
  (select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'lista_may_x50'),
  (select (e ->> 'final')::numeric from jsonb_array_elements((select v -> 'precios' -> 0 -> 'escalas' from res where k = 'precios_may')) e where e ->> 'escala' = 'x50'),
  'paridad: 50 unidades = escala x50 de precios_cliente_por_dominio');
select is((select (v -> 'lineas' -> 0 ->> 'subtotal')::numeric from res where k = 'lista_may'), 12000::numeric, 'subtotal = escala × cantidad (15 × 800)');
select is((select jsonb_array_length(v -> 'lineas') from res where k = 'lista_may'), 4, 'el repetido se sumó (12 + 3 = 15): cuatro líneas en total');
select is((select (v -> 'lineas' -> 0 ->> 'cantidad')::int from res where k = 'lista_may'), 15, 'la cantidad sumada del repetido es 15 y la escala sale de la suma');
select is((select (v -> 'lineas' -> 1 ->> 'precio_unitario')::numeric from res where k = 'lista_may'), 2000::numeric, 'la escala x10 menor que la promoción gana: precio de la escala');
select is((select v -> 'lineas' -> 1 -> 'precio_anterior' from res where k = 'lista_may'), 'null'::jsonb, 'si gana la escala no hay precio anterior');
select is((select (v -> 'lineas' -> 2 ->> 'precio_unitario')::numeric from res where k = 'lista_may'), 3000::numeric, 'la promoción menor que la escala gana: precio promocional');
select is((select (v -> 'lineas' -> 2 ->> 'precio_anterior')::numeric from res where k = 'lista_may'), 4500::numeric, 'y la escala queda como precio anterior (gana el más bajo, sin acumular)');
select is((select v -> 'lineas' -> 3 ->> 'escala' from res where k = 'lista_may'), 'x50', '60 unidades: escala x50');
select is((select v ->> 'con_cuenta' from res where k = 'lista_min'), 'true', 'minorista activo: con_cuenta');
select is((select v -> 'lineas' -> 0 ->> 'escala' from res where k = 'lista_min'), 'x1', 'minorista: siempre x1');
select is((select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'lista_min'), 1000::numeric, 'minorista: precio normal');
select is(
  (select count(*)::int from res where k in ('lista_susp', 'lista_nohab', 'lista_panel', 'lista_may_otra_tienda') and v ->> 'con_cuenta' = 'false' and v -> 'tipo' = 'null'::jsonb),
  4, 'cuenta suspendida, no habilitada, usuario del panel y cuenta de otra tienda: se tratan como visitantes (sin escala)');
select is(
  (select count(distinct v)::int from res where k in ('lista_susp', 'lista_nohab', 'lista_panel', 'lista_may_otra_tienda')),
  1, 'y las cuatro respuestas son idénticas: no se distingue por qué no hay cuenta');
select is((select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'lista_susp'), 1000::numeric, 'suspendida: precio de visitante');

-- ============================================================================
-- lista_pedido_por_dominio: entradas inválidas, cupo de lecturas y 50 líneas (amenaza 1.9)
-- ============================================================================
select pg_temp.ip('10.1.0.4');
set local role anon;
insert into res values
  ('lista_invalida', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":10000}]')),
  ('lista_51', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', (select jsonb_agg(jsonb_build_object('producto_id', gen_random_uuid(), 'cantidad', 1)) from generate_series(1, 51)))),
  ('lista_vacia', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[]')),
  ('lista_no_arreglo', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '{"a":1}'));
reset role;
select is((select v from res where k = 'lista_invalida'), '{"estado":"invalido","campos":["items"]}'::jsonb, 'cantidad 10.000: invalido con campos [items]');
select is((select v from res where k = 'lista_51'), '{"estado":"invalido","campos":["items"]}'::jsonb, '51 líneas: invalido');
select is((select v from res where k = 'lista_vacia'), '{"estado":"invalido","campos":["items"]}'::jsonb, 'lista vacía: invalido');
select is((select v from res where k = 'lista_no_arreglo'), '{"estado":"invalido","campos":["items"]}'::jsonb, 'un objeto en vez de un arreglo: invalido, sin error de Postgres');

-- 50 líneas: mide el tiempo (informativo, queda en el log de la CI) y exige un tope generoso.
select pg_temp.ip('10.1.0.5');
set local role anon;
insert into res values ('t0', to_jsonb(clock_timestamp()::text));
insert into res values
  ('lista_50', publico.lista_pedido_por_dominio('lista-a.ejemplo.com',
     (select jsonb_agg(jsonb_build_object('producto_id', ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0')), 'cantidad', n)) from generate_series(1, 50) n)));
insert into res values ('t1', to_jsonb(clock_timestamp()::text));
reset role;
select is((select jsonb_array_length(v -> 'lineas') from res where k = 'lista_50'), 50, '50 líneas: las 50 vuelven revalidadas');
select diag('MSF-176 T033 · rendimiento: lista_pedido_por_dominio con 50 líneas tardó '
  || round(extract(epoch from ((select v #>> '{}' from res where k = 't1')::timestamptz - (select v #>> '{}' from res where k = 't0')::timestamptz)) * 1000)::text || ' ms');
select cmp_ok(
  extract(epoch from ((select v #>> '{}' from res where k = 't1')::timestamptz - (select v #>> '{}' from res where k = 't0')::timestamptz)),
  '<', 2::numeric, '50 líneas se resuelven en menos de 2 s (el statement_timeout de anon es 3 s)');

-- Cupo de lecturas: 30 por minuto y visitante; la 31 da `limite` y otro visitante no se ve afectado.
select pg_temp.ip('10.1.0.6');
set local role anon;
insert into res values
  ('lecturas_ok', to_jsonb((select count(*)::int from generate_series(1, 30) g
     where publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]') ->> 'estado' = 'ok'))),
  ('lecturas_31', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]'));
select pg_temp.ip('10.1.0.7');
insert into res values
  ('lecturas_otro', publico.lista_pedido_por_dominio('lista-a.ejemplo.com', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]'));
reset role;
select is((select v from res where k = 'lecturas_ok'), '30'::jsonb, 'las primeras 30 lecturas del minuto salen bien');
select is((select v ->> 'estado' from res where k = 'lecturas_31'), 'limite', 'la lectura 31 del minuto: limite');
select ok((select (v ->> 'espera_segundos')::int between 1 and 60 from res where k = 'lecturas_31'), 'limite trae espera_segundos (1 a 60)');
select is((select v ->> 'estado' from res where k = 'lecturas_otro'), 'ok', 'otro visitante no se ve afectado por el cupo');
select is(
  (select count(*)::int from public.limite_pedidos_publicos where visitante not like 'lista|%'),
  0, 'el cupo de la lista usa su propia clave (lista|…) y no se come el de la búsqueda');

-- ============================================================================
-- enviar_lista_pedido: visitante, consulta + ítems en una transacción (B1-1, B1-4; FR-030)
-- ============================================================================
select pg_temp.ip('10.2.0.1');
set local role anon;
insert into res values
  ('envio_ok', publico.enviar_lista_pedido('lista-a.ejemplo.com', '  Ana Pérez ', ' ana@example.com ', E'  Necesito factura A\nGracias  ',
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":2,"precio":1,"precio_referencia":1,"total":5,"cliente_id":"c1000000-0000-0000-0000-000000000001","descuento":99},
       {"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":3},
       {"producto_id":"a1000000-0000-0000-0000-000000000007","cantidad":1}]',
     'aaaaaaaa-0000-0000-0000-000000000001'));
reset role;
select is((select v from res where k = 'envio_ok'), '{"estado":"ok"}'::jsonb, 'el visitante envía su lista: ok');
select is((select count(*)::int from dominio.consultas where origen = 'pedido'), 1, 'se creó UNA consulta de origen pedido');
select is((select nombre from dominio.consultas where origen = 'pedido'), 'Ana Pérez', 'el nombre se guarda recortado');
select is((select contacto from dominio.consultas where origen = 'pedido'), 'ana@example.com', 'el contacto se guarda recortado');
select is((select mensaje from dominio.consultas where origen = 'pedido'), E'Necesito factura A\nGracias', 'la nota se guarda recortada y conserva el salto de línea');
select is((select cliente_id from dominio.consultas where origen = 'pedido'), null, 'un visitante: cliente_id nulo (nunca viene del llamador)');
select is((select empresa_id from dominio.consultas where origen = 'pedido'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'la empresa sale del host');
select is((select count(*)::int from dominio.consulta_items), 3, 'tres ítems en la misma transacción');
select is(
  (select jsonb_agg(jsonb_build_object('o', orden, 'd', descripcion, 's', sku, 'c', cantidad) order by orden) from dominio.consulta_items),
  '[{"o":1,"d":"Alfa","s":"SKU-ALFA","c":2},{"o":2,"d":"Beta","s":"SKU-BETA","c":3},{"o":3,"d":"Sin stock","s":"SKU-SST","c":1}]'::jsonb,
  'descripción y SKU copiados del producto, cantidad y orden de la lista (el sin stock también entra)');
select is(
  (select jsonb_agg(precio_referencia order by orden) from dominio.consulta_items),
  '[1000, 2000, 500]'::jsonb, 'el precio_referencia es el del servidor: las claves precio/precio_referencia/total/descuento enviadas no cambian nada');
select is((select count(*)::int from dominio.tienda_envios where origen = 'pedido'), 1, 'se registró el envío (cupo)');
-- Aviso por correo (T036): resumen de ítems, origen legible, sin datos del visitante en el asunto.
select is((select count(*)::int from public.avisos_pendientes where tipo_aviso = 'consulta_nueva' and datos ->> 'Contacto' = 'ana@example.com'), 1, 'el pedido encola UN aviso de consulta nueva para quien lo tiene encendido');
select is((select datos ->> 'Origen' from public.avisos_pendientes where datos ->> 'Contacto' = 'ana@example.com'), 'Pedido de la tienda', 'el aviso dice «Pedido de la tienda»');
select is((select datos ->> 'Pedido' from public.avisos_pendientes where datos ->> 'Contacto' = 'ana@example.com'), '2 × Alfa (SKU-ALFA) · 3 × Beta (SKU-BETA) · 1 × Sin stock (SKU-SST)', 'el aviso lleva el resumen de los ítems');
select is((select datos ->> 'Nombre' from public.avisos_pendientes where datos ->> 'Contacto' = 'ana@example.com'), 'Ana Pérez', 'el aviso lleva el nombre');
select is((select datos ->> 'Mensaje' from public.avisos_pendientes where datos ->> 'Contacto' = 'ana@example.com'), E'Necesito factura A\nGracias', 'el aviso lleva la nota');
select ok((select datos -> 'Cliente' is null from public.avisos_pendientes where datos ->> 'Contacto' = 'ana@example.com'), 'sin cuenta no hay clave Cliente en el aviso');
select is((select count(*)::int from public.avisos_pendientes where datos ->> 'Nombre' = 'Sin nota'), 0,
  'un pedido insertado directo (sin ítems) no emite aviso: lo emite crear_consulta_pedido con sus ítems');
select is((select nombre from public.tipos_aviso where clave = 'consulta_nueva'), 'Consulta nueva',
  'el asunto del correo sale del nombre del tipo de aviso: no lleva datos del visitante');

-- Reintento con la misma clave: una sola consulta (B1-2), también si el producto ya no está visible.
select pg_temp.ip('10.2.0.1');
set local role anon;
insert into res values
  ('envio_repetido', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana Pérez', 'ana@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":2}]', 'aaaaaaaa-0000-0000-0000-000000000001'));
reset role;
select is((select v from res where k = 'envio_repetido'), '{"estado":"ok"}'::jsonb, 'reintento con la misma clave: ok');
select is((select count(*)::int from dominio.consultas where origen = 'pedido'), 1, 'reintento con la misma clave: sigue habiendo UNA consulta');
select is((select count(*)::int from dominio.tienda_envios where origen = 'pedido'), 1, 'y no se gasta más cupo');

-- ============================================================================
-- enviar_lista_pedido: límite por visitante (B1-3; amenaza 1.1): 5 por hora, el sexto = limite
-- ============================================================================
select pg_temp.ip('10.3.0.1');
set local role anon;
insert into res values
  ('cinco_ok', to_jsonb((select count(*)::int from generate_series(1, 5) g
     where publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Bruno', 'bruno@example.com', null,
       '[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":1}]', gen_random_uuid()) ->> 'estado' = 'ok'))),
  ('sexto', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Bruno', 'bruno@example.com', null,
       '[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":1}]', gen_random_uuid()));
select pg_temp.ip('10.3.0.2');
insert into res values
  ('otro_visitante', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Carla', 'carla@example.com', null,
       '[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":1}]', gen_random_uuid()));
reset role;
select is((select v from res where k = 'cinco_ok'), '5'::jsonb, 'los primeros cinco envíos de la hora salen bien');
select is((select v ->> 'estado' from res where k = 'sexto'), 'limite', 'el sexto envío de la hora: limite');
select ok((select (v ->> 'espera_segundos')::int between 1 and 3600 from res where k = 'sexto'), 'limite trae espera_segundos');
select is((select count(*)::int from dominio.consultas where origen = 'pedido' and nombre = 'Bruno'), 5, 'el sexto no creó nada');
select is((select v ->> 'estado' from res where k = 'otro_visitante'), 'ok', 'otro visitante (otra IP) no se ve afectado');

-- ============================================================================
-- enviar_lista_pedido: validación de campos (B1-6, B1-7; amenaza 1.5)
-- ============================================================================
select pg_temp.ip('10.4.0.1');
set local role anon;
insert into res values
  ('v_nombre_vacio', publico.enviar_lista_pedido('lista-a.ejemplo.com', '   ', 'ana@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_nombre_largo', publico.enviar_lista_pedido('lista-a.ejemplo.com', repeat('n', 101), 'ana@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_contacto_malo', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'no es un contacto', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_telefono_corto', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', '1234567', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_nota_larga', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com', repeat('x', 501), '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_nombre_control', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana' || chr(1) || 'Pérez', 'ana@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_nombre_salto', publico.enviar_lista_pedido('lista-a.ejemplo.com', E'Ana\nBcc: x@example.com', 'ana@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_nombre_bidi', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana' || chr(8238) || 'cod', 'ana@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_contacto_control', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com' || chr(7), null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_nota_control', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com', 'hola' || chr(7), '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_nota_separador', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com', 'hola' || chr(8232) || 'chau', '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid())),
  ('v_items_51', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com', null, (select jsonb_agg(jsonb_build_object('producto_id', gen_random_uuid(), 'cantidad', 1)) from generate_series(1, 51)), gen_random_uuid())),
  ('v_items_10000', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":10000}]', gen_random_uuid())),
  ('v_items_vacios', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Ana', 'ana@example.com', null, '[]', gen_random_uuid())),
  ('v_todo_mal', publico.enviar_lista_pedido('lista-a.ejemplo.com', '', '', repeat('x', 501), 'null', gen_random_uuid()));
reset role;
select is((select v from res where k = 'v_nombre_vacio'), '{"estado":"invalido","campos":["nombre"]}'::jsonb, 'nombre vacío: invalido [nombre]');
select is((select v from res where k = 'v_nombre_largo'), '{"estado":"invalido","campos":["nombre"]}'::jsonb, 'nombre de 101 caracteres: invalido [nombre]');
select is((select v from res where k = 'v_contacto_malo'), '{"estado":"invalido","campos":["contacto"]}'::jsonb, 'contacto que no es correo ni teléfono: invalido [contacto]');
select is((select v from res where k = 'v_telefono_corto'), '{"estado":"invalido","campos":["contacto"]}'::jsonb, 'teléfono de 7 dígitos: invalido [contacto]');
select is((select v from res where k = 'v_nota_larga'), '{"estado":"invalido","campos":["nota"]}'::jsonb, 'nota de 501 caracteres: invalido [nota]');
select is((select v from res where k = 'v_nombre_control'), '{"estado":"invalido","campos":["nombre"]}'::jsonb, 'carácter de control en el nombre: rechazado');
select is((select v from res where k = 'v_nombre_salto'), '{"estado":"invalido","campos":["nombre"]}'::jsonb, 'salto de línea en el nombre (forjar encabezados): rechazado');
select is((select v from res where k = 'v_nombre_bidi'), '{"estado":"invalido","campos":["nombre"]}'::jsonb, 'marca de dirección del texto en el nombre: rechazada');
select is((select v from res where k = 'v_contacto_control'), '{"estado":"invalido","campos":["contacto"]}'::jsonb, 'carácter de control en el contacto: rechazado');
select is((select v from res where k = 'v_nota_control'), '{"estado":"invalido","campos":["nota"]}'::jsonb, 'carácter de control en la nota: rechazado');
select is((select v from res where k = 'v_nota_separador'), '{"estado":"invalido","campos":["nota"]}'::jsonb, 'separador de línea Unicode en la nota: rechazado');
select is((select v from res where k = 'v_items_51'), '{"estado":"invalido","campos":["items"]}'::jsonb, '51 líneas: invalido [items] (escenario B1-6)');
select is((select v from res where k = 'v_items_10000'), '{"estado":"invalido","campos":["items"]}'::jsonb, 'cantidad 10.000: invalido [items] (escenario B1-6)');
select is((select v from res where k = 'v_items_vacios'), '{"estado":"invalido","campos":["items"]}'::jsonb, 'lista vacía: invalido [items]');
select is((select v from res where k = 'v_todo_mal'), '{"estado":"invalido","campos":["nombre","contacto","nota","items"]}'::jsonb, 'todo mal: invalido con todos los campos, nunca el valor');
select is(
  (select count(*)::int from dominio.consultas where origen = 'pedido' and nombre not in ('Ana Pérez', 'Bruno', 'Carla')),
  0, 'ninguna entrada inválida creó una consulta');
select is(
  (select count(*)::int from dominio.tienda_envios where origen = 'pedido'),
  7, 'ninguna entrada inválida gastó cupo: solo el primer pedido, los cinco de Bruno y el de Carla');

-- ============================================================================
-- XSS e inyección de extremo a extremo (T042; amenaza 1.5): se guarda TAL CUAL, como texto
-- ============================================================================
select pg_temp.ip('10.4.0.2');
set local role anon;
insert into res values
  ('xss', publico.enviar_lista_pedido('lista-a.ejemplo.com', '<script>alert(1)</script>', 'xss@example.com',
     E'<img src=x onerror=alert(1)>\n=HYPERLINK("http://malo.example","clic")\n+cmd|''/c calc''!A0\njavascript:alert(1)',
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid()));
reset role;
select is((select v ->> 'estado' from res where k = 'xss'), 'ok', 'HTML, fórmulas y javascript: en nombre y nota se aceptan como texto');
select is((select nombre from dominio.consultas where contacto = 'xss@example.com'), '<script>alert(1)</script>', 'el nombre con <script> se guarda literal (no se escapa ni se altera)');
select is(
  (select mensaje from dominio.consultas where contacto = 'xss@example.com'),
  E'<img src=x onerror=alert(1)>\n=HYPERLINK("http://malo.example","clic")\n+cmd|\'/c calc\'!A0\njavascript:alert(1)',
  'la nota con HTML, fórmula de CSV y saltos se guarda literal');
select is(
  (select datos ->> 'Nombre' from public.avisos_pendientes where datos ->> 'Contacto' = 'xss@example.com'),
  '<script>alert(1)</script>', 'el aviso lleva el texto crudo: el correo lo escapa al armar el HTML (flow enviar-avisos, filtro escape)');

-- ============================================================================
-- Productos no visibles: rechazo total, sin crear nada ni gastar cupo (amenazas 1.4 y 1.10; B1-5)
-- ============================================================================
select pg_temp.ip('10.5.0.1');
insert into res values ('cupo_antes', to_jsonb((select count(*)::int from dominio.tienda_envios)));
insert into res values ('consultas_antes', to_jsonb((select count(*)::int from dominio.consultas)));
set local role anon;
insert into res values
  ('nv_oculto', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Diego', 'diego@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1},{"producto_id":"a1000000-0000-0000-0000-000000000003","cantidad":1}]', gen_random_uuid())),
  ('nv_inactivo', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Diego', 'diego@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000004","cantidad":1}]', gen_random_uuid())),
  ('nv_otra_tienda', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Diego', 'diego@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000006","cantidad":1}]', gen_random_uuid())),
  ('nv_otra_org', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Diego', 'diego@example.com', null,
     '[{"producto_id":"a2000000-0000-0000-0000-000000000005","cantidad":1}]', gen_random_uuid())),
  ('nv_inexistente', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Diego', 'diego@example.com', null,
     '[{"producto_id":"99999999-9999-9999-9999-999999999999","cantidad":1}]', gen_random_uuid()));
reset role;
select is(
  (select count(distinct v - 'no_disponibles')::int from res where k in ('nv_oculto', 'nv_inactivo', 'nv_otra_tienda', 'nv_otra_org', 'nv_inexistente')),
  1, 'oculto, inactivo, de otra tienda, de otra organización e inexistente: rechazos indistinguibles');
select is((select v from res where k = 'nv_oculto'),
  '{"estado":"invalido","campos":["items"],"no_disponibles":["a1000000-0000-0000-0000-000000000003"]}'::jsonb,
  'una lista con un producto oculto se rechaza ENTERA y avisa cuál');
select is((select count(*)::int from dominio.consultas), (select v::int from res where k = 'consultas_antes'), 'no se creó ninguna consulta');
select is((select count(*)::int from dominio.tienda_envios), (select v::int from res where k = 'cupo_antes'), 'no se gastó cupo');

-- ============================================================================
-- Falla de entrega: se revierte todo y no se gasta cupo (FR-029); ningún texto de Postgres (amenaza 1.7)
-- ============================================================================
create function public.test_pedido_fallar() returns trigger language plpgsql as $$
begin
  raise exception 'detalle interno que nunca debe llegar al visitante: %', new.descripcion;
end $$;
create trigger test_pedido_fallar before insert on dominio.consulta_items for each row execute function public.test_pedido_fallar();
select pg_temp.ip('10.6.0.1');
insert into res values ('cupo_antes2', to_jsonb((select count(*)::int from dominio.tienda_envios)));
insert into res values ('consultas_antes2', to_jsonb((select count(*)::int from dominio.consultas)));
set local role anon;
insert into res values
  ('falla', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Elena', 'elena@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', 'eeeeeeee-0000-0000-0000-000000000001'));
reset role;
drop trigger test_pedido_fallar on dominio.consulta_items;
drop function public.test_pedido_fallar();
select is((select v from res where k = 'falla'), '{"estado":"error"}'::jsonb, 'una falla de entrega responde {estado: error}, sin texto de Postgres');
select is((select count(*)::int from dominio.consultas), (select v::int from res where k = 'consultas_antes2'), 'la falla no deja una consulta a medias');
select is((select count(*)::int from dominio.tienda_envios), (select v::int from res where k = 'cupo_antes2'), 'la falla de entrega no gasta cupo');
select pg_temp.ip('10.6.0.1');
set local role anon;
insert into res values
  ('falla_reintento', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Elena', 'elena@example.com', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', 'eeeeeeee-0000-0000-0000-000000000001'));
reset role;
select is((select v from res where k = 'falla_reintento'), '{"estado":"ok"}'::jsonb, 'reintentar con la misma clave tras la falla funciona');

-- ============================================================================
-- Cuenta activa: no se piden datos, se usan los de la ficha y se guarda cliente_id (B1-8; D-8, D-25)
-- ============================================================================
select pg_temp.ip('10.7.0.1');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
insert into res values
  ('cuenta_ok', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Nombre inventado', 'inventado@example.com', 'Quiero 12 de Alfa',
     '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":12},{"producto_id":"a1000000-0000-0000-0000-000000000009","cantidad":12}]', gen_random_uuid())),
  ('cuenta_sin_datos', publico.enviar_lista_pedido('lista-a.ejemplo.com', '', '', null,
     '[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":1}]', gen_random_uuid()));
reset role;
select is((select v from res where k = 'cuenta_ok'), '{"estado":"ok"}'::jsonb, 'cuenta activa: ok');
select is((select v from res where k = 'cuenta_sin_datos'), '{"estado":"ok"}'::jsonb, 'cuenta activa: no se piden nombre ni contacto (vacíos no importan)');
select is((select nombre from dominio.consultas where mensaje = 'Quiero 12 de Alfa'), 'Mayorista Cuenta', 'el nombre sale de la ficha del cliente, no de lo recibido');
select is((select contacto from dominio.consultas where mensaje = 'Quiero 12 de Alfa'), 'my@example.com', 'el contacto es el correo de la ficha');
select is((select cliente_id from dominio.consultas where mensaje = 'Quiero 12 de Alfa'), 'c1000000-0000-0000-0000-000000000001'::uuid, 'la consulta lleva el cliente_id de la cuenta');
select is(
  (select jsonb_agg(precio_referencia order by orden) from dominio.consulta_items i join dominio.consultas c on c.id = i.consulta_id where c.mensaje = 'Quiero 12 de Alfa'),
  '[800, 3000]'::jsonb, 'con cuenta mayorista el precio de referencia es el de la escala (y la promoción más baja gana)');
select is((select datos ->> 'Cliente' from public.avisos_pendientes where tipo_aviso = 'consulta_nueva' and datos ->> 'Mensaje' = 'Quiero 12 de Alfa'), 'Nº 910 · Mayorista Cuenta', 'el aviso nombra al cliente (Nº y nombre)');
-- Suspendida, no habilitada, usuario del panel: se tratan como visitantes (piden datos, sin cliente_id).
select pg_temp.ip('10.7.0.2');
select pg_temp.como('f2000000-0000-0000-0000-000000000003');
insert into res values
  ('susp_envio', publico.enviar_lista_pedido('lista-a.ejemplo.com', '', '', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":1}]', gen_random_uuid()));
select pg_temp.como('f2000000-0000-0000-0000-000000000007');
insert into res values
  ('panel_envio', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'Operador de prueba', 'op@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":1}]', gen_random_uuid()));
reset role;
select is((select v from res where k = 'susp_envio'), '{"estado":"invalido","campos":["nombre","contacto"]}'::jsonb, 'cuenta suspendida: es un visitante, se le piden nombre y contacto');
select is((select v from res where k = 'panel_envio'), '{"estado":"ok"}'::jsonb, 'usuario del panel: envía como visitante');
select is((select cliente_id from dominio.consultas where nombre = 'Operador de prueba'), null, 'y su consulta no lleva cliente_id');
-- Una ficha sin ningún contacto no se puede responder: error genérico sin crear nada.
update clientes set correo = null, telefono = null, celular = null where id = 'c1000000-0000-0000-0000-000000000002';
select pg_temp.ip('10.7.0.3');
select pg_temp.como('f2000000-0000-0000-0000-000000000002');
insert into res values
  ('cuenta_sin_contacto', publico.enviar_lista_pedido('lista-a.ejemplo.com', 'X', 'x@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000002","cantidad":1}]', gen_random_uuid()));
reset role;
select is((select v from res where k = 'cuenta_sin_contacto'), '{"estado":"error"}'::jsonb, 'ficha sin correo ni teléfono: error genérico, no se inventa un contacto');

-- ============================================================================
-- Panel: RLS de las líneas y vistas (amenaza 1.6; aislamiento entre dos organizaciones)
-- ============================================================================
select pg_temp.como('f2000000-0000-0000-0000-000000000007');
insert into res values
  ('panel1_items', to_jsonb((select count(*)::int from dominio.consulta_items))),
  ('panel1_vista_items', to_jsonb((select count(*)::int from public.consulta_items_bandeja))),
  ('panel1_bandeja', (select to_jsonb(b) from public.consultas_bandeja b where b.mensaje = 'Quiero 12 de Alfa'));
select pg_temp.como('f2000000-0000-0000-0000-000000000008');
insert into res values
  ('panel2_items', to_jsonb((select count(*)::int from dominio.consulta_items))),
  ('panel2_vista_items', to_jsonb((select count(*)::int from public.consulta_items_bandeja))),
  ('panel2_consultas', to_jsonb((select count(*)::int from public.consultas_bandeja where origen = 'pedido')));
reset role;
select ok((select (v::int) > 0 from res where k = 'panel1_items'), 'el panel de la organización ve las líneas de sus pedidos');
select is((select v from res where k = 'panel1_items'), (select v from res where k = 'panel1_vista_items'), 'la vista de ítems muestra lo mismo que la RLS deja ver');
select is((select v from res where k = 'panel2_items'), '0'::jsonb, 'el panel de OTRA organización no ve ninguna línea');
select is((select v from res where k = 'panel2_vista_items'), '0'::jsonb, 'ni por la vista de ítems');
select is((select v from res where k = 'panel2_consultas'), '0'::jsonb, 'ni los pedidos en la bandeja');
select is((select v ->> 'items_cantidad' from res where k = 'panel1_bandeja'), '2', 'la bandeja cuenta los ítems del pedido');
select is((select v ->> 'cliente_numero' from res where k = 'panel1_bandeja'), '910', 'la bandeja trae el número del cliente de la cuenta');
select is((select v ->> 'cliente_nombre' from res where k = 'panel1_bandeja'), 'Mayorista Cuenta', 'la bandeja trae el nombre del cliente de la cuenta');
select is((select v ->> 'origen' from res where k = 'panel1_bandeja'), 'pedido', 'el origen viaja como pedido');
select is(
  (select (to_jsonb(b) ->> 'items_cantidad')::int from public.consultas_bandeja b where b.id = 'c0000000-0000-0000-0000-000000000001'), 0,
  'una consulta que no es pedido tiene items_cantidad = 0');
select is(
  (select to_jsonb(b) -> 'cliente_numero' from public.consultas_bandeja b where b.id = 'c0000000-0000-0000-0000-000000000001'), 'null'::jsonb,
  'y no tiene cliente');

-- ============================================================================
-- Aislamiento entre dos organizaciones y conservación de la copia (amenaza 1.10)
-- ============================================================================
select pg_temp.ip('10.8.0.1');
set local role anon;
insert into res values
  ('x_a_x', publico.enviar_lista_pedido('lista-x.ejemplo.com', 'Xavi', 'xavi@example.com', null, '[{"producto_id":"a2000000-0000-0000-0000-000000000005","cantidad":1}]', gen_random_uuid())),
  ('x_con_producto_de_a', publico.enviar_lista_pedido('lista-x.ejemplo.com', 'Xavi', 'xavi@example.com', null, '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1}]', gen_random_uuid()));
reset role;
select is((select v from res where k = 'x_a_x'), '{"estado":"ok"}'::jsonb, 'la tienda de la otra organización recibe su pedido');
select is((select v ->> 'estado' from res where k = 'x_con_producto_de_a'), 'invalido', 'con un producto de la organización de la tienda A, la tienda X lo rechaza');
select is((select organizacion_id from dominio.consultas where nombre = 'Xavi'), '22222222-2222-2222-2222-222222222222'::uuid, 'la consulta es de la organización de la tienda');
-- Borrar un producto no rompe el pedido ya enviado: la línea conserva descripción y SKU (copia).
delete from dominio.producto_imagenes where producto_id = 'a1000000-0000-0000-0000-000000000007';
delete from dominio.existencias where producto_id = 'a1000000-0000-0000-0000-000000000007';
delete from dominio.producto_empresa where producto_id = 'a1000000-0000-0000-0000-000000000007';
delete from dominio.productos where id = 'a1000000-0000-0000-0000-000000000007';
select is(
  (select jsonb_build_array(producto_id, descripcion, sku) from dominio.consulta_items where sku = 'SKU-SST' limit 1),
  jsonb_build_array(null, 'Sin stock', 'SKU-SST'), 'si el producto se borra, la línea conserva su descripción y SKU y su producto_id queda en null');

select * from finish();
rollback;
