-- F-CLI-07 (MSF-432, épica MSF-237): publico.precios_cliente_por_dominio. Cubre FR-033, FR-034, SC-007 y SC-008:
-- paridad con private.precio_para(...).final por escala (con y sin IVA, escala sin precio => x1), minorista solo
-- x1 / mayorista cuatro escalas con rango, lista blanca de claves, null idéntico para visitante / suspendida /
-- no habilitada / host desconocido, solo productos visibles, tope de productos y que anon no ejecute la función.
begin;

select plan(18);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('f7000000-0000-0000-0000-000000000001', 'mayorista@example.com'),
  ('f7000000-0000-0000-0000-000000000002', 'minorista@example.com'),
  ('f7000000-0000-0000-0000-000000000003', 'suspendida@example.com'),
  ('f7000000-0000-0000-0000-000000000004', 'nohabilitada@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

-- A: regla +10 % y precios con IVA. B: sin regla y sin IVA.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'pc-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'pc-b.ejemplo.com');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10, true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);

-- La organización ya trae sembrada la alícuota «21 %» (trigger de alta): se reutiliza, no se inserta otra.
update dominio.alicuotas_iva set id = 'a5000000-0000-0000-0000-000000000001'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '21 %';

-- P1: escalas x5 y x10 con precio, x50 sin precio (usa x1). P2: sin escalas. P3: oculto en A.
insert into dominio.productos (id, organizacion_id, nombre, precio_lista, moneda, activo, alicuota_iva_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 1000, 'ARS', true, 'a5000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 3000, 'ARS', true, 'a5000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 500, 'ARS', true, 'a5000000-0000-0000-0000-000000000001');
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800);
-- Solo los productos de ESTA organización: la FK compuesta (producto_id, organizacion_id) rechaza
-- los productos de otra organización que el seed de desarrollo deja en la base (p. ej. el de
-- MSF-195). Antes se tomaba `dominio.productos` entero y el alta fallaba con el seed puesto.
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false, false);

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c7000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20, 'Mayorista', 'my@example.com', 'mayorista'),
  ('c7000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 21, 'Minorista', 'mn@example.com', 'minorista'),
  ('c7000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 22, 'Suspendida', 'su@example.com', 'mayorista'),
  ('c7000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 23, 'No habilitada', 'nh@example.com', 'mayorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000002', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000003', 'suspendida'),
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000004', 'activa');

create temp table res (k text primary key, v jsonb);
grant all on res to public;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Llamadas (se guardan; las verificaciones corren después).
select pg_temp.como('f7000000-0000-0000-0000-000000000001');
insert into res values
  ('may_a', publico.precios_cliente_por_dominio('pc-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[])),
  ('may_b', publico.precios_cliente_por_dominio('pc-b.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[])),
  ('may_oculto', publico.precios_cliente_por_dominio('pc-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000003']::uuid[])),
  ('may_host', publico.precios_cliente_por_dominio('desconocido.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));
select pg_temp.como('f7000000-0000-0000-0000-000000000002');
insert into res values
  ('min_a', publico.precios_cliente_por_dominio('pc-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));
select pg_temp.como('f7000000-0000-0000-0000-000000000003');
insert into res values
  ('suspendida', publico.precios_cliente_por_dominio('pc-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));
select pg_temp.como('f7000000-0000-0000-0000-000000000004');
insert into res values
  ('no_habilitada', publico.precios_cliente_por_dominio('pc-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
insert into res values
  ('sin_cuenta', publico.precios_cliente_por_dominio('pc-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]));

-- ============================================================================
-- Estados: solo la cuenta activa y habilitada recibe precios (FR-033)
-- ============================================================================
reset role;
select is((select v from res where k = 'suspendida'), null, 'cuenta suspendida: null');
select is((select v from res where k = 'no_habilitada'), null, 'cliente no habilitado en la tienda: null');
select is((select v from res where k = 'sin_cuenta'), null, 'usuario sin cuenta web: null');
select is((select v from res where k = 'may_host'), null, 'host desconocido: null');
select is((select v from res where k = 'may_oculto'), jsonb_build_object('tipo', 'mayorista', 'precios', '[]'::jsonb), 'producto oculto en la tienda: se omite');

-- ============================================================================
-- Forma: minorista solo x1; mayorista x1/x5/x10/x50 con rango (FR-031, FR-032)
-- ============================================================================
select is((select v ->> 'tipo' from res where k = 'min_a'), 'minorista', 'minorista: tipo minorista');
select is(
  (select jsonb_agg(e ->> 'escala') from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where k = 'min_a'),
  '["x1"]'::jsonb, 'minorista recibe solo la escala x1');
select is(
  (select jsonb_agg(jsonb_build_array(e ->> 'escala', e -> 'desde', e -> 'hasta'))
     from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where k = 'may_a' and v -> 'precios' -> 0 ->> 'producto_id' = 'a1000000-0000-0000-0000-000000000001'),
  '[["x1",1,4],["x5",5,9],["x10",10,49],["x50",50,null]]'::jsonb, 'mayorista: cuatro escalas con su rango');
select is((select jsonb_array_length(v -> 'precios') from res where k = 'may_a'), 2, 'devuelve un registro por producto pedido');

-- ============================================================================
-- Paridad con private.precio_para(...).final (SC-007), con IVA (A) y sin IVA (B)
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(
  (select jsonb_agg(e -> 'final' order by (e ->> 'desde')::int)
     from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where k = 'may_a' and v -> 'precios' -> 0 ->> 'producto_id' = 'a1000000-0000-0000-0000-000000000001'),
  (select jsonb_agg(f.final order by t.n)
     from (values ('x1', 1), ('x5', 5), ('x10', 10), ('x50', 50)) t (escala, n),
          lateral private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', t.escala) f(escala_usada, neto, alicuota_id, alicuota_nombre, alicuota_porcentaje, alicuota_exenta, final)),
  'tienda con IVA: cada escala coincide con precio_para(...).final');
select is(
  (select (v -> 'precios' -> 0 -> 'escalas' -> 3 ->> 'final')::numeric from res where k = 'may_a'),
  (select (v -> 'precios' -> 0 -> 'escalas' -> 0 ->> 'final')::numeric from res where k = 'may_a'),
  'escala sin precio (x50) usa el precio x1');
select is(
  (select jsonb_agg(e -> 'final' order by (e ->> 'desde')::int)
     from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where k = 'may_b'),
  (select jsonb_agg(f.neto order by t.n)
     from (values ('x1', 1), ('x5', 5), ('x10', 10), ('x50', 50)) t (escala, n),
          lateral private.precio_para('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', t.escala) f(escala_usada, neto, alicuota_id, alicuota_nombre, alicuota_porcentaje, alicuota_exenta, final)),
  'tienda sin IVA: cada escala coincide con el neto de precio_para');

-- ============================================================================
-- Lista blanca (FR-034, SC-008)
-- ============================================================================
reset role;
select is(
  (select array_agg(distinct clave order by clave) from res, jsonb_object_keys(v) clave where res.k = 'may_a'),
  array['precios', 'tipo'], 'respuesta: solo tipo y precios');
select is(
  (select array_agg(distinct clave order by clave) from res, jsonb_array_elements(v -> 'precios') p, jsonb_object_keys(p) clave where res.k = 'may_a'),
  array['escalas', 'producto_id'], 'por producto: solo producto_id y escalas');
select is(
  (select array_agg(distinct clave order by clave) from res, jsonb_array_elements(v -> 'precios') p, jsonb_array_elements(p -> 'escalas') e, jsonb_object_keys(e) clave where res.k = 'may_a'),
  array['desde', 'escala', 'final', 'hasta'], 'por escala: solo escala, desde, hasta y final (sin costos, existencias ni organizacion_id)');

-- El tipo sale de la base: no hay parámetro para pedir la escala de otro tipo.
select is(
  (select count(*)::int from pg_proc where oid = 'publico.precios_cliente_por_dominio(text, uuid[])'::regprocedure and pronargs = 2),
  1, 'la función solo recibe host y productos (no se puede pedir otra escala)');

-- Tope de productos por llamada y anon sin acceso.
select pg_temp.como('f7000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select publico.precios_cliente_por_dominio('pc-a.ejemplo.com', array(select gen_random_uuid() from generate_series(1, 51)))$$,
  '22023', null, 'más de 50 productos por llamada: error controlado');
reset role;
select ok(not has_function_privilege('anon', 'publico.precios_cliente_por_dominio(text, uuid[])', 'execute'), 'anon no ejecuta la función');

select * from finish();
rollback;
