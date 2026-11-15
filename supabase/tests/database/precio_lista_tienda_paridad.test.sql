-- F-CLI-21 (MSF-453, spec 20270327-100000-listas-de-precios-por-cliente, Fase 4, T020 y T021): la tienda con cuenta web usa la lista del
-- cliente. Dueño de RF-CLI-21-7, CA-CLI-21-10 y SC-002:
--   · PARIDAD mostrador ↔ tienda: para el mismo cliente, producto y tienda, el «Tu precio» de `publico.precios_cliente_por_dominio`, el
--     `precio_final` de los favoritos, la línea del presupuesto de la tienda y la línea del panel (`guardar_lineas_comprobante`) dan el
--     mismo precio (la tienda con «Con IVA incluido» suma el IVA al mismo neto);
--   · estados de la cuenta: visitante, usuario sin cuenta, cuenta suspendida y cliente no habilitado NO ven listas (null idéntico);
--   · con la bandera `listas_precios` apagada, la tienda devuelve exactamente lo de antes, aun con lista asignada;
--   · lista blanca: la respuesta pública no agrega ninguna clave (no revela la lista ni el porcentaje);
--   · el presupuesto creado desde la tienda guarda el snapshot de la lista y es idéntico al del panel.
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

create function pg_temp.como(p_user uuid, p_ip text default '10.9.0.1') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  set local role authenticated;
end $$;
create function pg_temp.anonimo() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;
create function pg_temp.bandera(p_activa boolean) returns void language plpgsql as $$
begin
  reset role;
  update public.banderas_plataforma set activa = p_activa where clave = 'listas_precios';
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
-- Neto del mostrador (motor del panel) para el cliente, y el mismo precio como lo muestra la tienda (con IVA si la tienda lo pide).
create function pg_temp.mostrador(p_tienda integer, p_producto text, p_cliente text, p_cantidad integer) returns numeric language sql security definer as $$
  select case when r.mostrar_con_iva then private.aplicar_iva(n.neto_unitario, n.alicuota_porcentaje, coalesce(n.alicuota_exenta, false)) else n.neto_unitario end
    from dominio.empresas e
    join dominio.precios_empresa r on r.empresa_id = e.id
    join dominio.clientes c on c.id = p_cliente::uuid
   cross join lateral private.precio_linea_venta_calculo(p_producto::uuid, e.id, c.tipo, p_cantidad, 0, now(), false, c.id) n
   where e.id = case p_tienda when 1 then 'e1000000-0000-0000-0000-000000000001'::uuid else 'e1000000-0000-0000-0000-000000000002'::uuid end
$$;
grant execute on function pg_temp.mostrador(integer, text, text, integer) to public;

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- ============================================================================
-- Bandera ENCENDIDA
-- ============================================================================
update public.banderas_plataforma set activa = true where clave = 'listas_precios';

-- Mayorista con lista en la tienda A (con IVA): x1 con lista; x5 y x10 con su escala cargada (la lista no la pisa); x50 sin escala: lista.
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 'x1'), 968::numeric,
  'Tu precio · mayorista con lista, tienda A: x1 = 1000 × 0,80 = 800 + IVA 21 % = 968');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 'x5'), 1198::numeric,
  'Tu precio · x5 cargada (900) rige con el +10 % de la tienda: 990 + IVA, redondeado = 1198');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 'x10'), 1065::numeric,
  'Tu precio · x10 cargada (800): 880 + IVA = 1065 (redondeado al peso entero)');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 'x50'), 968::numeric,
  'Tu precio · x50 sin precio cargado: cae a x1 y rige la lista (968)');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000002', 'x1'), 2904::numeric,
  'Tu precio · otro producto: 3000 × 0,80 = 2400 + IVA = 2904');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000003', 'x1'), 3025::numeric,
  'Tu precio · producto con precio propio (2500) en la tienda: la lista no rige (2500 + IVA = 3025)');
insert into res values ('may_a', publico.precios_cliente_por_dominio('lp-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004']::uuid[]));
insert into res values ('may_b', publico.precios_cliente_por_dominio('lp-b.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));
select is((select (e ->> 'final')::numeric from res, jsonb_array_elements(v -> 'precios' -> 1 -> 'escalas') e where k = 'may_a' and e ->> 'escala' = 'x1'), 1198::numeric,
  'Tu precio · redondeo de la tienda: 1234,56 × 0,80 = 987,648 se redondea a 990 y con IVA 1198');
select is((select (e ->> 'final')::numeric from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where k = 'may_b' and e ->> 'escala' = 'x1'), 800::numeric,
  'Tu precio · tienda B (sin IVA, sin ajuste): 800');
select is((select (e ->> 'final')::numeric from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where k = 'may_b' and e ->> 'escala' = 'x5'), 900::numeric,
  'Tu precio · tienda B: la escala x5 cargada rige (900)');

-- Lista blanca: ninguna clave nueva (ni la lista ni su porcentaje).
select is((select array_agg(kk order by kk) from res, jsonb_object_keys(v) kk where res.k = 'may_a'), array['precios', 'tipo'], 'lista blanca: el nivel superior sigue siendo {tipo, precios}');
select is((select array_agg(kk order by kk) from res, jsonb_object_keys(v -> 'precios' -> 0) kk where res.k = 'may_a'), array['escalas', 'producto_id'], 'lista blanca: cada producto sigue siendo {producto_id, escalas}');
select is((select array_agg(kk order by kk) from res, jsonb_object_keys(v -> 'precios' -> 0 -> 'escalas' -> 0) kk where res.k = 'may_a'), array['desde', 'escala', 'final', 'hasta'], 'lista blanca: cada escala sigue siendo {escala, desde, hasta, final}');
select is((select position('lista' in v::text) from res where k = 'may_a'), 0, 'la respuesta no menciona la lista ni su porcentaje');

-- Minorista con lista: solo x1 y con la lista. Minorista sin lista: sin cambios.
select pg_temp.como('f3000000-0000-0000-0000-000000000002');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 'x1'), 968::numeric, 'Tu precio · minorista con lista: 968');
select is(publico.precios_cliente_por_dominio('lp-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]) -> 'precios' -> 0 -> 'escalas' -> 1, null, 'el minorista sigue recibiendo solo x1');
select pg_temp.como('f3000000-0000-0000-0000-000000000003');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 'x1'), 1331::numeric, 'Tu precio · minorista SIN lista: 1000 + 10 % = 1100 + IVA = 1331 (como siempre)');
reset role;
select is(private.precio_final_publico_escala('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'x1'), 1331::numeric,
  'private.precio_final_publico_escala con 3 argumentos (sin cliente) no cambia: 1331') ;

-- Estados de la cuenta: nadie más ve la lista.
select pg_temp.como('f3000000-0000-0000-0000-000000000004');
select is(publico.precios_cliente_por_dominio('lp-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]), null, 'cuenta suspendida con lista: null');
select pg_temp.como('f3000000-0000-0000-0000-000000000005');
select is(publico.precios_cliente_por_dominio('lp-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]), null, 'cliente con lista no habilitado en la tienda: null');
select pg_temp.como('f3000000-0000-0000-0000-000000000006');
select is(publico.precios_cliente_por_dominio('lp-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]), null, 'usuario sin cuenta: null');
select pg_temp.anonimo();
select throws_ok($$select publico.precios_cliente_por_dominio('lp-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[])$$, '42501', null, 'el visitante (anon) no ejecuta la función');

-- ============================================================================
-- PARIDAD mostrador ↔ tienda (SC-002, CA-CLI-21-10)
-- ============================================================================
reset role;
create temp table paridad as
select h.tienda, h.host, p.n, e.escala, e.cantidad, c.cliente, c.k
  from (values (1, 'lp-a.ejemplo.com'), (2, 'lp-b.ejemplo.com')) h(tienda, host)
 cross join (values (1), (2), (3), (4)) p(n)
 cross join (values ('x1', 1), ('x5', 5), ('x10', 10), ('x50', 50)) e(escala, cantidad)
 cross join (values ('c1000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001')) c(cliente, k);
grant all on paridad to public;
create temp table paridad_res (tienda int, n int, escala text, tienda_precio numeric, mostrador numeric);
grant all on paridad_res to public;
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
insert into paridad_res
select p.tienda, p.n, p.escala,
       pg_temp.tu_precio(p.host, 'a1000000-0000-0000-0000-' || lpad(p.n::text, 12, '0'), p.escala),
       pg_temp.mostrador(p.tienda, 'a1000000-0000-0000-0000-' || lpad(p.n::text, 12, '0'), p.cliente, p.cantidad)
  from paridad p;
reset role;
select is((select count(*)::int from paridad_res), 32, 'la matriz de paridad tiene 2 tiendas x 4 productos x 4 escalas');
select is((select count(*)::int from paridad_res where tienda_precio is distinct from mostrador), 0,
  'PARIDAD: «Tu precio» de la tienda y el precio del mostrador coinciden en los 32 casos (mayorista con lista, con y sin IVA)');
select cmp_ok((select count(*) from paridad_res where tienda_precio is not null)::int, '=', 32, 'y todos tienen precio');

-- Favoritos: el precio_final usa la lista de la cuenta (producto 1, escala x1).
insert into dominio.favoritos_cliente (organizacion_id, empresa_id, cuenta_cliente_id, producto_id)
select cc.organizacion_id, cc.empresa_id, cc.id, 'a1000000-0000-0000-0000-000000000001'
  from cuentas_cliente cc where cc.auth_user_id = 'f3000000-0000-0000-0000-000000000001' and cc.empresa_id = 'e1000000-0000-0000-0000-000000000001';
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
select is((publico.mis_favoritos_por_dominio('lp-a.ejemplo.com') -> 'filas' -> 0 ->> 'precio_final')::numeric, 968::numeric, 'favoritos: el precio_final usa la lista de la cuenta (968)');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 'x1'), (publico.mis_favoritos_por_dominio('lp-a.ejemplo.com') -> 'filas' -> 0 ->> 'precio_final')::numeric,
  'favoritos y «Tu precio» muestran el mismo precio');

-- ============================================================================
-- Presupuesto de la tienda: mismo motor, snapshot de la lista y paridad con el panel
-- ============================================================================
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.7.0.1');
insert into res values ('cot', publico.cotizar_presupuesto_tienda('lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000003', '1', 'a1000000-0000-0000-0000-000000000002', '1')));
insert into res values ('crear', publico.crear_presupuesto_tienda('lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1', 'a1000000-0000-0000-0000-000000000003', '1', 'a1000000-0000-0000-0000-000000000002', '1'), null, 'c0000000-0000-0000-0000-000000000001'));
reset role;
select is((select v ->> 'estado' from res where k = 'cot'), 'ok', 'cotizar presupuesto de la tienda: estado ok');
select is((select v ->> 'estado' from res where k = 'crear'), 'ok', 'crear presupuesto de la tienda: estado ok');
select is((select string_agg(l.precio_unitario::text || ':' || coalesce(l.lista_ajuste_pct::text, '-'), ' ' order by l.orden)
             from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta c on c.id = l.comprobante_id
            where c.canal = 'tienda_online' and c.cliente_id = 'c1000000-0000-0000-0000-000000000001'),
  '800.00:-20.00 2250.00:- 2400.00:-20.00', 'el presupuesto guarda lista y porcentaje solo en las líneas fijadas por la lista (800 y 2400); el precio propio (2500) lleva el descuento personal (2250) y no guarda lista');
-- Mismas líneas armadas por el panel (crear_comprobante + guardar_lineas_comprobante) dan el mismo precio y el mismo snapshot.
select pg_temp.como('f3000000-0000-0000-0000-000000000007');
create temp table panel (id uuid);
grant all on panel to public;
insert into panel select (public.crear_comprobante('presupuesto', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'mostrador', '2027-03-01')).id;
select lives_ok(format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, (select updated_at from dominio.comprobantes_venta where id = %L))$$,
    (select id from panel), jsonb_build_array(
      jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1),
      jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000003', 'cantidad', 1),
      jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000002', 'cantidad', 1))::text, (select id from panel)),
  'el panel guarda las mismas líneas');
reset role;
select is((select string_agg(l.precio_unitario::text || ':' || coalesce(l.lista_ajuste_pct::text, '-') || ':' || l.descuento_pct::text, ' ' order by l.orden)
             from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from panel)),
  (select string_agg(l.precio_unitario::text || ':' || coalesce(l.lista_ajuste_pct::text, '-') || ':' || l.descuento_pct::text, ' ' order by l.orden)
             from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta c on c.id = l.comprobante_id
            where c.canal = 'tienda_online' and c.cliente_id = 'c1000000-0000-0000-0000-000000000001'),
  'PARIDAD: el presupuesto de la tienda y el del panel tienen precio, lista y descuento idénticos línea por línea');

-- ============================================================================
-- Bandera APAGADA: la tienda es exactamente la de antes, aun con lista asignada
-- ============================================================================
select pg_temp.bandera(false);
select pg_temp.como('f3000000-0000-0000-0000-000000000001');
select is(pg_temp.tu_precio('lp-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001', 'x1'), 1331::numeric, 'bandera apagada: Tu precio del cliente con lista = 1331, el de siempre');
select is((publico.mis_favoritos_por_dominio('lp-a.ejemplo.com') -> 'filas' -> 0 ->> 'precio_final')::numeric, 1331::numeric, 'bandera apagada: favoritos con el precio de siempre');
select pg_temp.como('f3000000-0000-0000-0000-000000000001', '10.7.0.2');
insert into res values ('cot_apagada', publico.cotizar_presupuesto_tienda('lp-a.ejemplo.com', pg_temp.items('a1000000-0000-0000-0000-000000000001', '1')));
reset role;

select is((select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'cot_apagada'), 990::numeric,
  'bandera apagada: la cotización de la tienda vuelve al precio de siempre (1000 + 10 % de la tienda = 1100, menos el descuento personal del 10 % = 990)');
select is((select (v -> 'lineas' -> 0 ->> 'precio_unitario')::numeric from res where k = 'cot'), 800::numeric,
  'y con la bandera encendida la misma cotización es la de la lista (800, sin descuento personal)');

select * from finish();
rollback;
