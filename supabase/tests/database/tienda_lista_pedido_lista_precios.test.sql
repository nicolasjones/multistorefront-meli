-- MSF-969 (seguimiento de la épica MSF-450, listas de precios por cliente): la lista de pedido de la tienda («Enviar consulta») usa el MISMO
-- precio que «Tu precio» cuando la persona tiene cuenta activa y una lista de precios. Cubre:
--   · PARIDAD lista de pedido ↔ «Tu precio» (`publico.precios_cliente_por_dominio`): el mayorista con lista, en las dos tiendas (con y sin IVA),
--     cuatro productos (escala cargada, sin escala, precio propio, decimales) y las cuatro escalas (32 casos): mismo precio;
--   · el minorista con lista ve la lista; el minorista sin lista, el visitante (anon), la cuenta suspendida, el cliente no habilitado en la tienda
--     y el usuario sin cuenta siguen viendo el precio público de siempre, aunque el JSON pida un `cliente_id` ajeno;
--   · bandera `listas_precios` apagada: la lista de pedido es exactamente la de antes, aun con lista asignada;
--   · promoción vigente: gana el más bajo contra la lista, sin acumular (la lista queda como `precio_anterior` solo si pierde);
--   · lo que guarda `enviar_lista_pedido` en `consulta_items.precio_referencia` es el precio de la lista (y el del visitante, el público);
--   · lista blanca de la respuesta (no revela la lista ni su porcentaje), firma única de `precio_referencia_pedido` y permisos.
-- Sin el arreglo, el mayorista con lista veía 1331 donde «Tu precio» da 968 (paridad, envío y minorista fallan).
begin;

select no_plan();




insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'mayorista@example.com'),
  ('f3000000-0000-0000-0000-000000000002', 'minorista-lista@example.com'),
  ('f3000000-0000-0000-0000-000000000003', 'minorista-sin@example.com'),
  ('f3000000-0000-0000-0000-000000000004', 'suspendida@example.com'),
  ('f3000000-0000-0000-0000-000000000005', 'nohabilitada@example.com'),
  ('f3000000-0000-0000-0000-000000000006', 'sin-cuenta@example.com'),
  ('f3000000-0000-0000-0000-000000000007', 'admin@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f3000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

-- A: +10 % con precios CON IVA; B: central sin ajuste y sin IVA.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'lp-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'lp-b.ejemplo.com');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10, true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d.id, e.id, e.organizacion_id
  from dominio.depositos d join dominio.empresas e on e.organizacion_id = d.organizacion_id
 where d.por_defecto and e.id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002')
on conflict do nothing;

update dominio.alicuotas_iva set id = 'a5000000-0000-0000-0000-000000000001'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '21 %';
-- P1: escalas x5 900 y x10 800 (x50 sin precio) · P2: 3000 · P3: precio propio en A (2500) · P4: 1234,56 (decimales)
insert into dominio.productos (id, organizacion_id, nombre, precio_lista, moneda, activo, alicuota_iva_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 1000, 'ARS', true, 'a5000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 3000, 'ARS', true, 'a5000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gama', 2000, 'ARS', true, 'a5000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Delta', 1234.56, 'ARS', true, 'a5000000-0000-0000-0000-000000000001');
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800);
insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 2500);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.existencias (producto_id, organizacion_id, cantidad)
select p.id, p.organizacion_id, 100 from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111'
on conflict (producto_id) do update set cantidad = excluded.cantidad;

insert into dominio.listas_precios (id, organizacion_id, nombre, ajuste_pct) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Revendedores', -20);

-- 1 mayorista con lista · 2 minorista con lista · 3 minorista sin lista · 4 suspendida con lista · 5 no habilitada en A con lista
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo, descuento) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Mayorista con lista', 'my@example.com', 'mayorista', 10),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 911, 'Minorista con lista', 'ml@example.com', 'minorista', 0),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 912, 'Minorista sin lista', 'ms@example.com', 'minorista', 0),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 913, 'Suspendida', 'su@example.com', 'mayorista', 0),
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 914, 'No habilitada', 'nh@example.com', 'mayorista', 0);
update dominio.clientes set lista_precio_id = 'd1000000-0000-0000-0000-000000000001'
 where id in ('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000005');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id)
select c, e, '11111111-1111-1111-1111-111111111111'
  from (values
    ('c1000000-0000-0000-0000-000000000001'::uuid, 'e1000000-0000-0000-0000-000000000001'::uuid),
    ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002'),
    ('c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001'),
    ('c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001'),
    ('c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001'),
    ('c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000002')) v(c, e);
insert into cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000001', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000003', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000004', 'suspendida'),
  ('11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000005', 'activa');

update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';

create function pg_temp.sesion(p_user uuid, p_ip text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  if p_user is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
end $$;
create function pg_temp.bandera(p_clave text, p_activa boolean) returns void language plpgsql as $$
begin
  reset role;
  update public.banderas_plataforma set activa = p_activa where clave = p_clave;
end $$;
create function pg_temp.items(variadic p text[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('producto_id', t[1], 'cantidad', t[2]::int))
    from (select array[p[i], p[i + 1]] as t from generate_series(1, array_length(p, 1), 2) i) x
$$;
grant execute on function pg_temp.items(text[]) to public;

-- «Tu precio» de un producto y una escala, para un host y la sesión vigente.
create function pg_temp.tu_precio(p_host text, p_producto text, p_escala text) returns numeric language sql as $$
  select (e ->> 'final')::numeric
    from jsonb_array_elements(publico.precios_cliente_por_dominio(p_host, array[p_producto]::uuid[]) -> 'precios' -> 0 -> 'escalas') e
   where e ->> 'escala' = p_escala
$$;
grant execute on function pg_temp.tu_precio(text, text, text) to public;

create temp table res (k text primary key, v jsonb);
grant all on res to public;
-- Una fila por producto de la lista de pedido: el precio de la lista y el «Tu precio» de la misma escala.
create temp table cmp (host text, cantidad int, producto uuid, pedido numeric, tu_precio numeric);
grant all on cmp to public;

-- Pide la lista de pedido con una sesión (null = visitante) y guarda la respuesta.
create function pg_temp.pedir(p_k text, p_user uuid, p_ip text, p_host text, p_items jsonb) returns void language plpgsql as $$
begin
  perform pg_temp.sesion(p_user, p_ip);
  insert into res values (p_k, publico.lista_pedido_por_dominio(p_host, p_items));
  reset role;
end $$;
-- Pide los cuatro productos con la misma cantidad y los compara con «Tu precio» de la escala que corresponde a esa cantidad.
create function pg_temp.comparar(p_user uuid, p_ip text, p_host text, p_cantidad int) returns void language plpgsql as $$
declare
  v_resp jsonb;
  v_escala text := case p_cantidad when 1 then 'x1' when 5 then 'x5' when 10 then 'x10' else 'x50' end;
begin
  perform pg_temp.sesion(p_user, p_ip);
  v_resp := publico.lista_pedido_por_dominio(p_host, pg_temp.items(
    'a1000000-0000-0000-0000-000000000001', p_cantidad::text, 'a1000000-0000-0000-0000-000000000002', p_cantidad::text,
    'a1000000-0000-0000-0000-000000000003', p_cantidad::text, 'a1000000-0000-0000-0000-000000000004', p_cantidad::text));
  insert into cmp
  select p_host, p_cantidad, (l ->> 'producto_id')::uuid, (l ->> 'precio_unitario')::numeric, pg_temp.tu_precio(p_host, l ->> 'producto_id', v_escala)
    from jsonb_array_elements(v_resp -> 'lineas') l;
  reset role;
end $$;
-- Precio unitario y precio anterior de un producto de una respuesta guardada.
create function pg_temp.precio(p_k text, p_producto text) returns numeric language sql as $$
  select (l ->> 'precio_unitario')::numeric from res, jsonb_array_elements(v -> 'lineas') l where k = p_k and l ->> 'producto_id' = p_producto
$$;
create function pg_temp.anterior(p_k text, p_producto text) returns numeric language sql as $$
  select (l ->> 'precio_anterior')::numeric from res, jsonb_array_elements(v -> 'lineas') l where k = p_k and l ->> 'producto_id' = p_producto
$$;

-- ============================================================================
-- Bandera ENCENDIDA: paridad con «Tu precio»
-- ============================================================================
select pg_temp.bandera('listas_precios', true);

select pg_temp.comparar('f3000000-0000-0000-0000-000000000001', '10.20.0.1', 'lp-a.ejemplo.com', 1);
select pg_temp.comparar('f3000000-0000-0000-0000-000000000001', '10.20.0.2', 'lp-a.ejemplo.com', 5);
select pg_temp.comparar('f3000000-0000-0000-0000-000000000001', '10.20.0.3', 'lp-a.ejemplo.com', 10);
select pg_temp.comparar('f3000000-0000-0000-0000-000000000001', '10.20.0.4', 'lp-a.ejemplo.com', 50);
select pg_temp.comparar('f3000000-0000-0000-0000-000000000001', '10.20.0.5', 'lp-b.ejemplo.com', 1);
select pg_temp.comparar('f3000000-0000-0000-0000-000000000001', '10.20.0.6', 'lp-b.ejemplo.com', 5);
select pg_temp.comparar('f3000000-0000-0000-0000-000000000001', '10.20.0.7', 'lp-b.ejemplo.com', 10);
select pg_temp.comparar('f3000000-0000-0000-0000-000000000001', '10.20.0.8', 'lp-b.ejemplo.com', 50);
select is((select count(*)::int from cmp), 32, 'la matriz de paridad tiene 2 tiendas x 4 productos x 4 cantidades');
select is((select count(*)::int from cmp where pedido is null or tu_precio is null), 0, 'todos los casos tienen precio en la lista de pedido y en «Tu precio»');
select is((select count(*)::int from cmp where pedido is distinct from tu_precio), 0,
  'PARIDAD: la lista de pedido del mayorista con lista muestra el mismo precio que «Tu precio» en los 32 casos');
select is((select pedido from cmp where host = 'lp-a.ejemplo.com' and cantidad = 1 and producto = 'a1000000-0000-0000-0000-000000000001'), 968::numeric,
  'mayorista con lista, tienda A: Alfa x1 = 1000 × 0,80 = 800 + IVA 21 % = 968 (y no el 1331 público)');
select is((select pedido from cmp where host = 'lp-a.ejemplo.com' and cantidad = 5 and producto = 'a1000000-0000-0000-0000-000000000001'), 1197.90::numeric,
  'la escala cargada (x5 = 900) no la pisa la lista: 990 + IVA = 1197,90');
select is((select pedido from cmp where host = 'lp-a.ejemplo.com' and cantidad = 5 and producto = 'a1000000-0000-0000-0000-000000000002'), 2904::numeric,
  'sin escala cargada rige la lista aun con cantidad de x5: Beta 3000 × 0,80 = 2400 + IVA = 2904');
select is((select pedido from cmp where host = 'lp-a.ejemplo.com' and cantidad = 1 and producto = 'a1000000-0000-0000-0000-000000000003'), 3025::numeric,
  'el precio propio de la tienda (2500 + IVA) no lo pisa la lista');
select is((select pedido from cmp where host = 'lp-b.ejemplo.com' and cantidad = 1 and producto = 'a1000000-0000-0000-0000-000000000001'), 800::numeric,
  'tienda B (sin IVA, sin ajuste): 800');

-- Respuesta completa del mayorista: mismas claves que siempre (no revela la lista ni su porcentaje).
select pg_temp.pedir('may', 'f3000000-0000-0000-0000-000000000001', '10.20.1.1', 'lp-a.ejemplo.com',
  pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000002', '2'));
select is((select v ->> 'estado' from res where k = 'may'), 'ok', 'el mayorista con lista recibe la lista revalidada');
select is((select v ->> 'con_cuenta' from res where k = 'may'), 'true', 'con_cuenta = true');
select is((select array_agg(kk order by kk) from res, jsonb_object_keys(v) kk where k = 'may'),
  array['con_cuenta', 'estado', 'lineas', 'no_disponibles', 'tipo', 'total_referencia'], 'lista blanca: el nivel superior no suma claves');
select is((select array_agg(kk order by kk) from res, jsonb_object_keys(v -> 'lineas' -> 0) kk where k = 'may'),
  array['cantidad', 'disponible', 'escala', 'imagen', 'nombre', 'precio_anterior', 'precio_unitario', 'producto_id', 'sku', 'subtotal'],
  'lista blanca: cada línea conserva exactamente sus claves');
select is((select position('lista_precio' in v::text) + position('ajuste' in v::text) from res where k = 'may'), 0, 'la respuesta no menciona la lista ni su porcentaje');
select is((select (v ->> 'total_referencia')::numeric from res where k = 'may'), 968::numeric + 2 * 2904, 'el total de referencia es la suma de los subtotales con la lista (968 + 2 × 2904)');

-- ============================================================================
-- Quién NO ve la lista: precio público de siempre
-- ============================================================================
-- Minorista con lista: la ve (x1, aunque pida 5 unidades).
select pg_temp.pedir('min_lista', 'f3000000-0000-0000-0000-000000000002', '10.20.2.1', 'lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '5'));
select is(pg_temp.precio('min_lista', 'a1000000-0000-0000-0000-000000000001'), 968::numeric, 'minorista con lista: ve la lista (968)');
select is((select v -> 'lineas' -> 0 ->> 'escala' from res where k = 'min_lista'), 'x1', 'el minorista sigue en la escala x1');
-- Minorista sin lista: 1000 + 10 % = 1100 + IVA = 1331.
select pg_temp.pedir('min_sin', 'f3000000-0000-0000-0000-000000000003', '10.20.2.2', 'lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '5'));
select is(pg_temp.precio('min_sin', 'a1000000-0000-0000-0000-000000000001'), 1331::numeric, 'minorista sin lista: el precio de siempre (1331)');
-- Visitante (anon): nunca ve la lista, ni pidiendo un cliente_id ajeno dentro de los ítems.
select pg_temp.pedir('anon', null, '10.20.2.3', 'lp-a.ejemplo.com',
  '[{"producto_id":"a1000000-0000-0000-0000-000000000001","cantidad":1,"cliente_id":"c1000000-0000-0000-0000-000000000001","lista_precio_id":"d1000000-0000-0000-0000-000000000001"}]'::jsonb);
select is((select v ->> 'estado' from res where k = 'anon'), 'ok', 'el visitante recibe la lista revalidada');
select is((select v ->> 'con_cuenta' from res where k = 'anon'), 'false', 'visitante: con_cuenta = false');
select is(pg_temp.precio('anon', 'a1000000-0000-0000-0000-000000000001'), 1331::numeric, 'visitante: precio público (1331), aunque el JSON nombre a un cliente con lista');
-- Cuenta suspendida, cliente no habilitado en la tienda y usuario sin cuenta: son un visitante.
select pg_temp.pedir('suspendida', 'f3000000-0000-0000-0000-000000000004', '10.20.2.4', 'lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'));
select pg_temp.pedir('nohabilitada', 'f3000000-0000-0000-0000-000000000005', '10.20.2.5', 'lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'));
select pg_temp.pedir('sin_cuenta', 'f3000000-0000-0000-0000-000000000006', '10.20.2.6', 'lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'));
select is(pg_temp.precio('suspendida', 'a1000000-0000-0000-0000-000000000001'), 1331::numeric, 'cuenta suspendida con lista: precio público');
select is(pg_temp.precio('nohabilitada', 'a1000000-0000-0000-0000-000000000001'), 1331::numeric, 'cliente con lista no habilitado en la tienda: precio público');
select is(pg_temp.precio('sin_cuenta', 'a1000000-0000-0000-0000-000000000001'), 1331::numeric, 'usuario sin cuenta: precio público');
select is((select count(*)::int from res where k in ('suspendida', 'nohabilitada', 'sin_cuenta') and v ->> 'con_cuenta' = 'false'), 3, 'los tres se tratan como visitante (con_cuenta = false)');

-- ============================================================================
-- Lo que se envía: precio_referencia de la consulta
-- ============================================================================
select pg_temp.sesion('f3000000-0000-0000-0000-000000000001', '10.20.3.1');
insert into res values ('envio_may', publico.enviar_lista_pedido('lp-a.ejemplo.com', 'ignorado', 'ignorado', null,
  pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000002', '5'), 'aaaaaaaa-0000-0000-0000-000000000101'));
reset role;
select pg_temp.sesion(null, '10.20.3.2');
insert into res values ('envio_vis', publico.enviar_lista_pedido('lp-a.ejemplo.com', 'Ana Pérez', 'ana@example.com', null,
  pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000002', '5'), 'aaaaaaaa-0000-0000-0000-000000000102'));
reset role;
select is((select v from res where k = 'envio_may'), '{"estado":"ok"}'::jsonb, 'el mayorista con lista envía su lista: ok');
select is((select v from res where k = 'envio_vis'), '{"estado":"ok"}'::jsonb, 'el visitante envía su lista: ok');
select is(
  (select jsonb_agg(i.precio_referencia order by i.orden) from dominio.consulta_items i join dominio.consultas c on c.id = i.consulta_id
    where c.cliente_id = 'c1000000-0000-0000-0000-000000000001'),
  '[968, 2904]'::jsonb, 'la consulta del cliente con lista guarda el precio de la lista (968 y 2904: lo mismo que «Tu precio»)');
select is(
  (select jsonb_agg(i.precio_referencia order by i.orden) from dominio.consulta_items i join dominio.consultas c on c.id = i.consulta_id
    where c.cliente_id is null and c.origen = 'pedido'),
  '[1331, 3993]'::jsonb, 'la consulta del visitante guarda el precio público (1331 y 3993)');

-- ============================================================================
-- Promoción vigente: gana el más bajo contra la lista, sin acumular
-- ============================================================================
select pg_temp.bandera('promociones_precio', true);
-- Beta: promoción 2000 (2420 con IVA) menor que la lista (2904). Delta: promoción 1100 (1331 con IVA) mayor que la lista (1198) y menor que el público.
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 2000, now() - interval '1 hour', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 1100, now() - interval '1 hour', now() + interval '1 day');
select pg_temp.pedir('promo', 'f3000000-0000-0000-0000-000000000001', '10.20.4.1', 'lp-a.ejemplo.com',
  pg_temp.items('a1000000-0000-0000-0000-000000000002', '1', 'a1000000-0000-0000-0000-000000000004', '1'));
reset role;
select pg_temp.sesion('f3000000-0000-0000-0000-000000000001', '10.20.4.2');
insert into res values ('tu_promo', jsonb_build_object(
  'beta', pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 'x1'),
  'delta', pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000004', 'x1')));
reset role;
select is(pg_temp.precio('promo', 'a1000000-0000-0000-0000-000000000002'), 2420::numeric, 'promoción menor que la lista: gana la promoción (2420)');
select is(pg_temp.anterior('promo', 'a1000000-0000-0000-0000-000000000002'), 2904::numeric, 'la lista queda como precio anterior (2904)');
select is(pg_temp.precio('promo', 'a1000000-0000-0000-0000-000000000002'), (select (v ->> 'beta')::numeric from res where k = 'tu_promo'), 'y es el mismo precio que «Tu precio»');
select is(pg_temp.precio('promo', 'a1000000-0000-0000-0000-000000000004'), 1197.90::numeric, 'promoción mayor que la lista: gana la lista (1197,90), sin acumular');
select is(pg_temp.anterior('promo', 'a1000000-0000-0000-0000-000000000004'), null, 'y no hay precio anterior');
select is(pg_temp.precio('promo', 'a1000000-0000-0000-0000-000000000004'), (select (v ->> 'delta')::numeric from res where k = 'tu_promo'), 'también igual a «Tu precio»');

-- ============================================================================
-- Bandera APAGADA: exactamente la de antes, aun con lista asignada
-- ============================================================================
select pg_temp.bandera('promociones_precio', false);
select pg_temp.bandera('listas_precios', false);
select pg_temp.pedir('off', 'f3000000-0000-0000-0000-000000000001', '10.20.5.1', 'lp-a.ejemplo.com',
  pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000002', '5'));
select pg_temp.pedir('off_x5', 'f3000000-0000-0000-0000-000000000001', '10.20.5.2', 'lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '5'));
select is(pg_temp.precio('off', 'a1000000-0000-0000-0000-000000000001'), 1331::numeric, 'bandera apagada: x1 del mayorista con lista = precio público de siempre (1331)');
select is(pg_temp.precio('off', 'a1000000-0000-0000-0000-000000000002'), 3993::numeric, 'bandera apagada: sin escala cargada, el público (3993)');
select is(pg_temp.precio('off_x5', 'a1000000-0000-0000-0000-000000000001'), 1197.90::numeric, 'bandera apagada: la escala cargada x5 sigue rigiendo (1197,90)');
select pg_temp.sesion('f3000000-0000-0000-0000-000000000001', '10.20.5.3');
insert into res values ('envio_off', publico.enviar_lista_pedido('lp-a.ejemplo.com', 'x', 'x', 'bandera apagada',
  pg_temp.items('a1000000-0000-0000-0000-000000000001', '1'), 'aaaaaaaa-0000-0000-0000-000000000103'));
reset role;
select is((select v from res where k = 'envio_off'), '{"estado":"ok"}'::jsonb, 'bandera apagada: el envío funciona');
select is(
  (select i.precio_referencia from dominio.consulta_items i join dominio.consultas c on c.id = i.consulta_id
    where c.mensaje = 'bandera apagada'),
  1331::numeric, 'bandera apagada: la consulta guarda el precio público (1331)');

-- ============================================================================
-- Firma y permisos
-- ============================================================================
select is((select count(*)::int from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'precio_referencia_pedido'), 1,
  'precio_referencia_pedido tiene una sola firma (sin sobrecarga ambigua)');
select ok(to_regprocedure('private.precio_referencia_pedido(uuid, uuid, text, integer)') is null, 'la firma de 4 argumentos ya no existe');
select ok(
  not has_function_privilege('anon', 'private.precio_referencia_pedido(uuid, uuid, text, integer, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.precio_referencia_pedido(uuid, uuid, text, integer, uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.precio_referencia_pedido(uuid, uuid, text, integer, uuid)', 'execute')
  and not has_function_privilege('public', 'private.precio_referencia_pedido(uuid, uuid, text, integer, uuid)', 'execute'),
  'precio_referencia_pedido no es ejecutable por anon, authenticated, service_role ni public');
select ok(
  not has_function_privilege('anon', 'private.crear_consulta_pedido(uuid, text, text, text, uuid, jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.crear_consulta_pedido(uuid, text, text, text, uuid, jsonb, text)', 'execute'),
  'crear_consulta_pedido sigue sin execute para la API');
select ok(
  has_function_privilege('anon', 'publico.lista_pedido_por_dominio(text, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'publico.lista_pedido_por_dominio(text, jsonb)', 'execute')
  and not has_function_privilege('public', 'publico.lista_pedido_por_dominio(text, jsonb)', 'execute'),
  'lista_pedido_por_dominio sigue siendo superficie pública deliberada (anon y authenticated) y no de public');
select is((select p.proargnames from pg_proc p where p.pronamespace = 'publico'::regnamespace and p.proname = 'lista_pedido_por_dominio'),
  array['host', 'items'], 'lista_pedido_por_dominio sigue sin argumentos de cliente, cuenta ni precio: el cliente sale de la sesión');

select * from finish();
rollback;
