-- MSF-932 (S1 de la épica MSF-816): `publico.precios_cliente_por_dominio` (tienda con sesión de cliente, escalas x1…x50)
-- aplica las promociones con la misma regla del local: GANA EL MÁS BAJO, SIN ACUMULAR.
-- Cubre: mayorista (cuatro escalas) y minorista (x1) con promoción menor / igual / mayor al precio de la escala, la
-- promoción que solo gana a algunas escalas, tienda con y sin IVA visible, paridad exacta con el neto del local
-- (`private.precio_linea_venta`, tienda sin IVA) y con la lista de pedido (`private.precio_referencia_pedido`), BANDERA
-- `promociones_precio` apagada = respuesta idéntica a la de antes (comparada jsonb contra jsonb), promoción de otra tienda,
-- vencida o anulada, aislamiento por organización, lista blanca y estados sin cuenta activa.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-s1@example.com'),
  ('f7000000-0000-0000-0000-000000000001', 'mayorista-s1@example.com'),
  ('f7000000-0000-0000-0000-000000000002', 'minorista-s1@example.com'),
  ('f7000000-0000-0000-0000-000000000003', 'suspendida-s1@example.com'),
  ('f7200000-0000-0000-0000-000000000001', 'mayorista-dos-s1@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

-- A: regla +10 % y precios con IVA. B: sin regla y sin IVA. E3: organización 2, sin IVA.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 's1-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 's1-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000003', 's1-dos.ejemplo.com');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10, true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);
update dominio.alicuotas_iva set id = 'a5000000-0000-0000-0000-000000000001'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '21 %';

-- Alfa lista 1000 con escalas x5 900 y x10 800 (x50 sin precio: usa x1) · Beta lista 3000 sin escalas (org 1) · Ajeno 1000 (org 2).
insert into dominio.productos (id, organizacion_id, nombre, precio_lista, moneda, activo, alicuota_iva_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 1000, 'ARS', true, 'a5000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 3000, 'ARS', true, 'a5000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 1000, 'ARS', true, null);
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'x10', 700);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222');

insert into clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c7000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 20, 'Mayorista', 'my@example.com', 'mayorista'),
  ('c7000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 21, 'Minorista', 'mn@example.com', 'minorista'),
  ('c7000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 22, 'Suspendida', 'su@example.com', 'mayorista'),
  ('c7200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 20, 'Mayorista dos', 'md@example.com', 'mayorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c7000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('c7200000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222');
insert into cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000002', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000002', 'activa'),
  ('11111111-1111-1111-1111-111111111111', 'c7000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000003', 'suspendida'),
  ('22222222-2222-2222-2222-222222222222', 'c7200000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', 'f7200000-0000-0000-0000-000000000001', 'activa');

create temp table res (k text primary key, v jsonb);
grant all on res to public;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Guarda la respuesta de una llamada (clave, usuario, host, productos).
create function pg_temp.llamar(p_k text, p_user uuid, p_host text, p_productos uuid[]) returns void language plpgsql as $$
begin
  perform pg_temp.como(p_user);
  insert into res values (p_k, publico.precios_cliente_por_dominio(p_host, p_productos));
  reset role;
end $$;
grant execute on function pg_temp.llamar(text, uuid, text, uuid[]) to public;

-- Atajo: [[escala, final, precio_anterior], …] del primer producto de la respuesta.
create function pg_temp.escalas(p_k text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_array(e ->> 'escala', e -> 'final', e -> 'precio_anterior') order by (e ->> 'desde')::int)
    from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where res.k = p_k $$;

create function pg_temp.alfa(p_k text, p_user uuid, p_host text) returns void language sql as $$
  select pg_temp.llamar(p_k, p_user, p_host, array['a1000000-0000-0000-0000-000000000001']::uuid[]) $$;

-- ============================================================================
-- BASE: sin promociones (con la bandera encendida y apagada) es la respuesta de siempre
-- ============================================================================
select pg_temp.alfa('base_b', 'f7000000-0000-0000-0000-000000000001', 's1-b.ejemplo.com');
select pg_temp.alfa('base_a', 'f7000000-0000-0000-0000-000000000001', 's1-a.ejemplo.com');
select pg_temp.alfa('base_min_b', 'f7000000-0000-0000-0000-000000000002', 's1-b.ejemplo.com');
select is(pg_temp.escalas('base_b'), '[["x1",1000,null],["x5",900,null],["x10",800,null],["x50",1000,null]]'::jsonb,
  'sin promoción, tienda B (sin IVA): las cuatro escalas de siempre y sin precio_anterior');
select is(pg_temp.escalas('base_a'), '[["x1",1331,null],["x5",1198,null],["x10",1065,null],["x50",1331,null]]'::jsonb,
  'sin promoción, tienda A (con IVA y +10 %): 1331 / 1198 / 1065 / 1331');

-- Promoción vigente de la tienda B para Alfa (neto 850), de la tienda A (neto 850), vencida y anulada de Beta,
-- y una de la organización 2.
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta, anulada_at) values
  ('c5000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 850, now() - interval '1 hour', now() + interval '1 day', null),
  ('c5000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 100, now() - interval '3 days', now() - interval '2 days', null),
  ('c5000000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 100, now() - interval '1 hour', now() + interval '1 day', now()),
  ('c5200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 500, now() - interval '1 hour', now() + interval '1 day', null);

-- Bandera APAGADA con promociones cargadas: respuesta idéntica a la base (comparada jsonb contra jsonb).
update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select pg_temp.alfa('off_b', 'f7000000-0000-0000-0000-000000000001', 's1-b.ejemplo.com');
select pg_temp.alfa('off_min_b', 'f7000000-0000-0000-0000-000000000002', 's1-b.ejemplo.com');
select is((select v from res where k = 'off_b'), (select v from res where k = 'base_b'),
  'bandera apagada con una promoción vigente cargada: mayorista, la respuesta es idéntica a la de antes');
select is((select v from res where k = 'off_min_b'), (select v from res where k = 'base_min_b'),
  'bandera apagada: minorista, la respuesta es idéntica a la de antes');

-- Bandera ENCENDIDA.
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
select pg_temp.alfa('may_b', 'f7000000-0000-0000-0000-000000000001', 's1-b.ejemplo.com');
select pg_temp.alfa('min_b', 'f7000000-0000-0000-0000-000000000002', 's1-b.ejemplo.com');
select pg_temp.alfa('may_a', 'f7000000-0000-0000-0000-000000000001', 's1-a.ejemplo.com');

-- Tienda B, promoción 850 contra x1 1000 / x5 900 / x10 800 / x50 (x1) 1000.
select is(pg_temp.escalas('may_b'), '[["x1",850,1000],["x5",850,900],["x10",800,null],["x50",850,1000]]'::jsonb,
  'mayorista, promoción 850: gana en x1, x5 y x50 (con el precio de la escala como anterior); x10 (800) es más baja: queda igual y sin anterior');
select is(pg_temp.escalas('min_b'), '[["x1",850,1000]]'::jsonb, 'minorista, promoción 850: x1 sale a 850 con anterior 1000');
-- Todavía no hay promoción en la tienda A: la de B no se le aplica.
select is(pg_temp.escalas('may_a'), '[["x1",1331,null],["x5",1198,null],["x10",1065,null],["x50",1331,null]]'::jsonb,
  'la promoción de la tienda B no se aplica en la tienda A (cada tienda tiene las suyas)');

-- Promoción en A (neto 850 → 1029 con IVA).
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('c5000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 850, now() - interval '1 hour', now() + interval '1 day');
select pg_temp.alfa('may_a2', 'f7000000-0000-0000-0000-000000000001', 's1-a.ejemplo.com');
select is(pg_temp.escalas('may_a2'), '[["x1",1029,1331],["x5",1029,1198],["x10",1029,1065],["x50",1029,1331]]'::jsonb,
  'tienda A con IVA: la promoción 850 neto (1029 con IVA) gana en las cuatro escalas, cada una con su precio como anterior');
-- Con IVA, una promoción cuyo precio con IVA no baja la escala x10 (1065): neto 930 = 1125 con IVA gana a x1/x5/x50 pero no a x10.
update dominio.promociones_precio set precio_promocional = 930 where id = 'c5000000-0000-0000-0000-00000000000a';
select pg_temp.alfa('may_a3', 'f7000000-0000-0000-0000-000000000001', 's1-a.ejemplo.com');
select is(pg_temp.escalas('may_a3'), '[["x1",1125,1331],["x5",1125,1198],["x10",1065,null],["x50",1125,1331]]'::jsonb,
  'tienda A con IVA: la promoción 930 neto (1125 con IVA) gana a x1, x5 y x50 pero no a x10 (1065)');

-- Igual y mayor al precio normal: la escala no cambia y no trae precio_anterior.
update dominio.promociones_precio set precio_promocional = 1000 where id = 'c5000000-0000-0000-0000-00000000000b';
select pg_temp.alfa('igual_b', 'f7000000-0000-0000-0000-000000000001', 's1-b.ejemplo.com');
select is((select v from res where k = 'igual_b'), (select v from res where k = 'base_b'),
  'promoción igual al precio x1 (1000): la respuesta es la de siempre (ninguna escala cambia)');
update dominio.promociones_precio set precio_promocional = 1200 where id = 'c5000000-0000-0000-0000-00000000000b';
select pg_temp.alfa('mayor_b', 'f7000000-0000-0000-0000-000000000001', 's1-b.ejemplo.com');
select is((select v from res where k = 'mayor_b'), (select v from res where k = 'base_b'),
  'promoción mayor al precio x1 (1200): la respuesta es la de siempre (no sube ningún precio)');
update dominio.promociones_precio set precio_promocional = 950 where id = 'c5000000-0000-0000-0000-00000000000b';
select pg_temp.alfa('medio_b', 'f7000000-0000-0000-0000-000000000001', 's1-b.ejemplo.com');
select is(pg_temp.escalas('medio_b'), '[["x1",950,1000],["x5",900,null],["x10",800,null],["x50",950,1000]]'::jsonb,
  'promoción 950: gana solo donde baja el precio (x1 y x50); x5 (900) y x10 (800) ya son más bajas');
update dominio.promociones_precio set precio_promocional = 850 where id = 'c5000000-0000-0000-0000-00000000000b';

-- ============================================================================
-- Paridad con el local (tienda B sin IVA: igualdad exacta del neto) y con la lista de pedido
-- ============================================================================
select set_config('request.jwt.claims', json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select is(
  (select count(*)::int
     from (values (1, 'x1'), (4, 'x1'), (5, 'x5'), (9, 'x5'), (10, 'x10'), (49, 'x10'), (50, 'x50'), (60, 'x50')) c (cantidad, escala)
     cross join lateral private.precio_linea_venta('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'mayorista', c.cantidad, 0, now(), true) l
    where l.neto_unitario is distinct from (
            select (e ->> 'final')::numeric from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e
             where res.k = 'may_b' and e ->> 'escala' = c.escala)),
  0, 'paridad con el local: para 8 cantidades, la tienda B muestra exactamente el neto que cobra private.precio_linea_venta (mayorista)');
select is(
  (select count(*)::int
     from (values (1, 'x1'), (5, 'x5'), (10, 'x10'), (50, 'x50')) c (cantidad, escala)
     cross join lateral private.precio_referencia_pedido('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'mayorista', c.cantidad) r
     cross join lateral (select e from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where res.k = 'may_b' and e ->> 'escala' = c.escala) s
    where r.precio is distinct from (s.e ->> 'final')::numeric
       or r.precio_anterior is distinct from (s.e ->> 'precio_anterior')::numeric),
  0, 'paridad con la lista de pedido: precio y precio_anterior de private.precio_referencia_pedido coinciden en las cuatro escalas');
select is(
  (select count(*)::int
     from private.precio_linea_venta('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'minorista', 1, 0, now(), true) l
    where l.neto_unitario is distinct from (select (e ->> 'final')::numeric from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where res.k = 'min_b')),
  0, 'paridad con el local: el minorista ve en x1 lo que cobra el mostrador');
-- Tienda A (con IVA): el precio de la tienda con IVA queda a menos de $1 por unidad del neto del local × 1,21.
select is(
  (select count(*)::int
     from (values (1, 'x1'), (5, 'x5'), (10, 'x10'), (50, 'x50')) c (cantidad, escala)
     cross join lateral private.precio_linea_venta('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'mayorista', c.cantidad, 0, now(), true) l
    where not (abs(l.neto_unitario * (1 + l.alicuota_porcentaje / 100)
                   - (select (e ->> 'final')::numeric from res, jsonb_array_elements(v -> 'precios' -> 0 -> 'escalas') e where res.k = 'may_a3' and e ->> 'escala' = c.escala)) < 1)),
  0, 'tienda A (con IVA): cada escala coincide con el neto del local × (1 + alícuota) a menos de $1 por unidad (promoción 930)');

-- ============================================================================
-- Promociones que no cuentan, aislamiento y estados sin cuenta activa
-- ============================================================================
select pg_temp.llamar('beta_a', 'f7000000-0000-0000-0000-000000000001', 's1-a.ejemplo.com', array['a1000000-0000-0000-0000-000000000002']::uuid[]);
select is(pg_temp.escalas('beta_a'), '[["x1",3993,null],["x5",3993,null],["x10",3993,null],["x50",3993,null]]'::jsonb,
  'Beta en A: la promoción vencida (100) no cuenta');
select pg_temp.llamar('beta_b', 'f7000000-0000-0000-0000-000000000001', 's1-b.ejemplo.com', array['a1000000-0000-0000-0000-000000000002']::uuid[]);
select is(pg_temp.escalas('beta_b'), '[["x1",3000,null],["x5",3000,null],["x10",3000,null],["x50",3000,null]]'::jsonb,
  'Beta en B: la promoción anulada (100) no cuenta');
select pg_temp.llamar('dos', 'f7200000-0000-0000-0000-000000000001', 's1-dos.ejemplo.com', array['b2000000-0000-0000-0000-000000000001']::uuid[]);
select is(pg_temp.escalas('dos'), '[["x1",500,1000],["x5",500,1000],["x10",500,700],["x50",500,1000]]'::jsonb,
  'organización 2: su mayorista ve la promoción 500 de su tienda en todas las escalas (anterior = cada escala)');
select pg_temp.alfa('uno_tras_dos', 'f7000000-0000-0000-0000-000000000001', 's1-b.ejemplo.com');
select is((select v from res where k = 'uno_tras_dos'), (select v from res where k = 'may_b'),
  'aislamiento: la promoción de la organización 2 no altera la respuesta de la organización 1');
select pg_temp.llamar('cruce', 'f7200000-0000-0000-0000-000000000001', 's1-b.ejemplo.com', array['a1000000-0000-0000-0000-000000000001']::uuid[]);
select is((select v from res where k = 'cruce'), null, 'el cliente de la org 2 no obtiene precios de la tienda de la org 1 (null)');
select pg_temp.alfa('suspendida', 'f7000000-0000-0000-0000-000000000003', 's1-b.ejemplo.com');
select is((select v from res where k = 'suspendida'), null, 'cuenta suspendida: null, sin promoción visible');
-- Sesión inexistente (anon) sigue sin ejecutar.
select is(has_function_privilege('anon', 'publico.precios_cliente_por_dominio(text, uuid[])', 'execute'), false, 'anon no ejecuta la función');
select is(has_function_privilege('authenticated', 'publico.precios_cliente_por_dominio(text, uuid[])', 'execute'), true, 'authenticated sigue ejecutándola');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'publico.precios_cliente_por_dominio(text, uuid[])'::regprocedure), true,
  'security definer con search_path vacío');

-- Lista blanca: solo suma precio_anterior, y solo en las escalas donde gana la promoción.
select is(
  (select array_agg(distinct clave order by clave) from res, jsonb_array_elements(v -> 'precios') p, jsonb_array_elements(p -> 'escalas') e, jsonb_object_keys(e) clave where res.k = 'may_b'),
  array['desde', 'escala', 'final', 'hasta', 'precio_anterior'], 'lista blanca con promoción: escala, desde, hasta, final y precio_anterior');
select is(
  (select array_agg(distinct clave order by clave) from res, jsonb_array_elements(v -> 'precios') p, jsonb_array_elements(p -> 'escalas') e, jsonb_object_keys(e) clave where res.k = 'base_b'),
  array['desde', 'escala', 'final', 'hasta'], 'lista blanca sin promoción: las cuatro claves de siempre');
select is(
  (select count(*)::int from res, jsonb_array_elements(v -> 'precios') p, jsonb_array_elements(p -> 'escalas') e where res.k = 'may_b' and e ? 'precio_anterior'),
  3, 'precio_anterior solo aparece en las 3 escalas donde gana la promoción (no en x10)');

select * from finish();
rollback;
