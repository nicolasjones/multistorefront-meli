-- MSF-936 (S5 de la épica MSF-816): una promoción cuyo precio NO es menor al precio normal de la tienda se ignora en la
-- tienda (igual que en el local) y `guardar_promocion_precio` avisa al cargarla.
-- Cubre: la regla en `private.precio_vigente_empresa` (menor / igual / mayor, tienda sin IVA y con IVA visible, empate
-- por redondeo al peso), el camino directo del catálogo (`publico.catalogo_pagina_por_dominio` con tope de precio) y
-- la ficha, la paridad con `private.precio_linea_venta` del local, la bandera `promociones_precio` apagada (sin cambios),
-- el aislamiento entre organizaciones, el aviso de la RPC (guarda igual, sin aviso con una promoción válida, aviso al
-- editar y al repetir), los permisos y que la función auxiliar no se pueda ejecutar desde la API.
-- Las fechas son relativas a now().
begin;

select no_plan();

-- ============================================================================
-- Fixture (como postgres)
-- ============================================================================
insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'admin-s5@example.com'),
  ('f5000000-0000-0000-0000-000000000002', 'consulta-s5@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo');

-- E1 «Tienda A» (sin IVA) · E2 «Tienda B» (precios con IVA 21 %) · E3 (organización 2, sin IVA).
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e5000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e5000000-0000-0000-0000-000000000001', 's5-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e5000000-0000-0000-0000-000000000002', 's5-b.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e5000000-0000-0000-0000-000000000003', 's5-dos.ejemplo.com');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central', 0, false),
  ('e5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, true);

-- Alfa ARS 1000 · Gamma ARS 2000 (org 1, en A y B) · Ajeno ARS 1000 (org 2, en E3). IVA 21 % en la org 1.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'S5-1', 1000, 'ARS', true),
  ('a5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gamma', 'S5-2', 2000, 'ARS', true),
  ('b5000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 'S5-9', 1000, 'ARS', true);
update dominio.productos set alicuota_iva_id = (select id from dominio.alicuotas_iva
  where organizacion_id = '11111111-1111-1111-1111-111111111111' and nombre = '21 %')
 where organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e5000000-0000-0000-0000-000000000001'::uuid), ('e5000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222');

-- Promociones vigentes sembradas (el precio se cambia por UPDATE, como postgres, para recorrer los casos):
--   pA E1/Alfa · pB E2/Alfa · pO E3/Ajeno (otra organización).
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('c5000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'e5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 800, now() - interval '1 hour', now() + interval '1 day'),
  ('c5000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'e5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000001', 800, now() - interval '1 hour', now() + interval '1 day'),
  ('c5000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'e5000000-0000-0000-0000-000000000003', 'b5000000-0000-0000-0000-000000000001', 1500, now() - interval '1 hour', now() + interval '1 day');

update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Atajo: [precio, precio_anterior] de la tienda para Alfa.
create function pg_temp.tienda(p_empresa uuid) returns jsonb language sql as $$
  select jsonb_build_array(v.precio, v.precio_anterior)
    from private.precio_vigente_empresa('a5000000-0000-0000-0000-000000000001', p_empresa, now()) v;
$$;

-- ============================================================================
-- La regla en la tienda sin IVA (E1): normal 1000
-- ============================================================================
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000001'), '[800, 1000]'::jsonb,
  'E1: una promoción menor (800) se aplica con precio anterior 1000');
update dominio.promociones_precio set precio_promocional = 999.99 where id = 'c5000000-0000-0000-0000-00000000000a';
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000001'), '[999.99, 1000]'::jsonb,
  'E1: una promoción apenas menor (999,99) se aplica');
update dominio.promociones_precio set precio_promocional = 1000 where id = 'c5000000-0000-0000-0000-00000000000a';
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000001'), '[1000, null]'::jsonb,
  'E1: una promoción igual al precio normal (1000) se ignora: precio normal y sin precio anterior');
update dominio.promociones_precio set precio_promocional = 1200 where id = 'c5000000-0000-0000-0000-00000000000a';
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000001'), '[1000, null]'::jsonb,
  'E1: una promoción mayor (1200) se ignora: no muestra un precio MÁS ALTO que el normal');

-- ============================================================================
-- La regla con «Precios con IVA» (E2): normal 1000 + 21 % = 1210
-- ============================================================================
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000002'), '[968, 1210]'::jsonb,
  'E2 (con IVA): la promoción 800 sin IVA se aplica (968 con IVA) con anterior 1210');
update dominio.promociones_precio set precio_promocional = 990 where id = 'c5000000-0000-0000-0000-00000000000b';
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000002'), '[1198, 1210]'::jsonb,
  'E2: 990 sin IVA (1198 con IVA) es menor y se aplica');
update dominio.promociones_precio set precio_promocional = 1000 where id = 'c5000000-0000-0000-0000-00000000000b';
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000002'), '[1210, null]'::jsonb,
  'E2: promoción igual al neto normal: se ignora');
update dominio.promociones_precio set precio_promocional = 1200 where id = 'c5000000-0000-0000-0000-00000000000b';
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000002'), '[1210, null]'::jsonb,
  'E2: promoción mayor al neto normal: se ignora (antes mostraba 1452 con IVA, más que el normal 1210)');
update dominio.promociones_precio set precio_promocional = 999.9 where id = 'c5000000-0000-0000-0000-00000000000b';
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000002'), '[1210, null]'::jsonb,
  'E2: 999,90 sin IVA da 1210 al redondear al peso, igual al normal: no hay descuento que mostrar y se ignora (empate por redondeo)');
update dominio.promociones_precio set precio_promocional = 800 where id = 'c5000000-0000-0000-0000-00000000000b';

-- ============================================================================
-- Aislamiento por organización: la promoción de E3 no toca a E1/E2 y viceversa
-- ============================================================================
select is(
  (select jsonb_build_array(v.precio, v.precio_anterior)
     from private.precio_vigente_empresa('b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000003', now()) v),
  '[1000, null]'::jsonb, 'E3 (org 2): su promoción 1500 mayor al normal 1000 se ignora');
update dominio.promociones_precio set precio_promocional = 500 where id = 'c5000000-0000-0000-0000-00000000000c';
select is(
  (select jsonb_build_array(v.precio, v.precio_anterior)
     from private.precio_vigente_empresa('b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000003', now()) v),
  '[500, 1000]'::jsonb, 'E3: con 500 sí se aplica');
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000001'), '[1000, null]'::jsonb,
  'E1 sigue ignorando su promoción 1200: no la afecta lo de la organización 2');
select is(
  (select jsonb_build_array(v.precio, v.precio_anterior)
     from private.precio_vigente_empresa('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000003', now()) v),
  '[null, null]'::jsonb, 'un producto de la org 1 no tiene precio en la tienda de la org 2 (ni promoción cruzada)');
update dominio.promociones_precio set precio_promocional = 1500 where id = 'c5000000-0000-0000-0000-00000000000c';

-- ============================================================================
-- Paridad con el local (`private.precio_linea_venta`: minorista, cantidad 1, sin descuento)
-- ============================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', 'f5000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

select is(
  (select jsonb_build_array(l.neto_unitario, l.promocion_id is not null)
     from private.precio_linea_venta('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'minorista', 1, 0, now(), true) l),
  '[1000, false]'::jsonb, 'local E1 con la promoción 1200: cobra el normal 1000 sin promoción');
select is((select (pg_temp.tienda('e5000000-0000-0000-0000-000000000001') -> 0)::numeric),
  (select l.neto_unitario from private.precio_linea_venta('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'minorista', 1, 0, now(), true) l),
  'paridad: con la promoción 1200 la tienda y el local muestran y cobran lo mismo (1000)');
update dominio.promociones_precio set precio_promocional = 1000 where id = 'c5000000-0000-0000-0000-00000000000a';
select is((select (pg_temp.tienda('e5000000-0000-0000-0000-000000000001') -> 0)::numeric),
  (select l.neto_unitario from private.precio_linea_venta('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'minorista', 1, 0, now(), true) l),
  'paridad: con la promoción igual al normal (1000) tienda y local coinciden');
update dominio.promociones_precio set precio_promocional = 800 where id = 'c5000000-0000-0000-0000-00000000000a';
select is((select (pg_temp.tienda('e5000000-0000-0000-0000-000000000001') -> 0)::numeric),
  (select l.neto_unitario from private.precio_linea_venta('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'minorista', 1, 0, now(), true) l),
  'paridad: con la promoción menor (800) tienda y local coinciden');

-- ============================================================================
-- Camino directo del catálogo y ficha (como anon)
-- ============================================================================
create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

update dominio.promociones_precio set precio_promocional = 1200 where id = 'c5000000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
insert into res values
  ('cat_mayor', publico.catalogo_pagina_por_dominio('s5-a.ejemplo.com')),
  ('cat_mayor_max', publico.catalogo_pagina_por_dominio('s5-a.ejemplo.com', null, false, 1100, 'relevancia', 1)),
  ('cat_mayor_asc', publico.catalogo_pagina_por_dominio('s5-a.ejemplo.com', null, false, null, 'precio_asc', 1)),
  ('ficha_mayor', publico.producto_por_dominio('s5-a.ejemplo.com', 'a5000000-0000-0000-0000-000000000001')),
  ('cat_b_mayor', publico.catalogo_pagina_por_dominio('s5-b.ejemplo.com'));
reset role;

select is(
  (select jsonb_build_array((p ->> 'precio')::numeric, p -> 'precio_anterior') from res, jsonb_array_elements(j -> 'productos') p
    where clave = 'cat_mayor' and p ->> 'nombre' = 'Alfa'),
  '[1000, null]'::jsonb, 'catálogo de A: promoción 1200 ignorada (precio normal 1000, sin anterior)');
select is(
  (select jsonb_agg(p ->> 'nombre') from res, jsonb_array_elements(j -> 'productos') p where clave = 'cat_mayor_max'),
  '["Alfa"]'::jsonb, 'catálogo de A con tope de precio 1100: Alfa entra (su precio es 1000, no 1200)');
select is(
  (select jsonb_agg(p ->> 'nombre' order by ord) from res, jsonb_array_elements(j -> 'productos') with ordinality t(p, ord) where clave = 'cat_mayor_asc'),
  '["Alfa", "Gamma"]'::jsonb, 'orden por precio de A: Alfa (1000) antes que Gamma (2000)');
select is(
  (select jsonb_build_array((j ->> 'precio')::numeric, j -> 'precio_anterior') from res where clave = 'ficha_mayor'),
  '[1000, null]'::jsonb, 'ficha de Alfa en A: promoción 1200 ignorada');
select is(
  (select jsonb_build_array((p ->> 'precio')::numeric, p -> 'precio_anterior') from res, jsonb_array_elements(j -> 'productos') p
    where clave = 'cat_b_mayor' and p ->> 'nombre' = 'Alfa'),
  '[968, 1210]'::jsonb, 'catálogo de B (con IVA): la promoción 800 sin IVA (menor) sigue aplicando en B, con anterior 1210');

-- Con una promoción menor el catálogo sigue mostrando el tachado.
update dominio.promociones_precio set precio_promocional = 800 where id = 'c5000000-0000-0000-0000-00000000000a';
set local role anon;
insert into res values ('cat_menor', publico.catalogo_pagina_por_dominio('s5-a.ejemplo.com', null, false, 900, 'precio_asc', 1));
reset role;
select is(
  (select jsonb_agg(jsonb_build_array(p ->> 'nombre', (p ->> 'precio')::numeric, (p ->> 'precio_anterior')::numeric))
     from res, jsonb_array_elements(j -> 'productos') p where clave = 'cat_menor'),
  '[["Alfa", 800, 1000]]'::jsonb, 'catálogo de A con una promoción menor (800): se aplica con anterior 1000 y entra en el tope 900');

-- ============================================================================
-- Bandera apagada: sin cambios (la tienda muestra el normal y la RPC rechaza con 55000)
-- ============================================================================
update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000001'), '[1000, null]'::jsonb,
  'bandera apagada: la tienda muestra el precio normal sin anterior (con la promoción 800 cargada)');
select is(pg_temp.tienda('e5000000-0000-0000-0000-000000000002'), '[1210, null]'::jsonb,
  'bandera apagada: E2 también');
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000002', 2500, now(), now() + interval '2 days')$$,
  '55000', null, 'bandera apagada: guardar sigue rechazando con 55000 (también una promoción mayor al normal)');
reset role;
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

-- ============================================================================
-- guardar_promocion_precio avisa (y guarda igual)
-- ============================================================================
create temp table r (clave text primary key, j jsonb);
grant all on r to authenticated;

select pg_temp.como('f5000000-0000-0000-0000-000000000001');
insert into r values
  ('menor_a', public.guardar_promocion_precio(null, 'e5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000002', 1500, now(), now() + interval '2 days')),
  ('igual_a', public.guardar_promocion_precio(null, 'e5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000002', 2000, now(), now() + interval '2 days'));
reset role;
-- E1/Gamma: 1500 < 2000: sin aviso. E2/Gamma (con IVA): 2000 sin IVA = normal (2420 con IVA): aviso.
select is((select j ? 'aviso' or j ? 'aviso_codigo' from r where clave = 'menor_a'), false,
  'una promoción menor al normal (1500 < 2000) se guarda sin aviso');
select is((select (j ->> 'precio_promocional')::numeric from r where clave = 'menor_a'), 1500::numeric, '... y devuelve la fila guardada');
select is((select j ->> 'aviso_codigo' from r where clave = 'igual_a'), 'promocion_no_menor_al_normal',
  'una promoción igual al neto normal (E2 con IVA, 2000) devuelve aviso_codigo');
select ok((select length(j ->> 'aviso') > 20 from r where clave = 'igual_a'), '... y el texto del aviso');
select is((select count(*)::int from dominio.promociones_precio where id = (select (j ->> 'id')::uuid from r where clave = 'igual_a') and precio_promocional = 2000 and anulada_at is null), 1,
  'el aviso no rechaza: la promoción quedó guardada');
select is((select count(*)::int from jsonb_object_keys((select j from r where clave = 'menor_a'))),
  (select count(*)::int from information_schema.columns where table_schema = 'dominio' and table_name = 'promociones_precio'),
  'sin aviso el resultado es exactamente la fila (mismas claves que la tabla: contrato anterior intacto)');

-- Edición: de menor a mayor avisa; de mayor a menor deja de avisar; repetir lo ya guardado conserva el aviso.
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
insert into r values
  ('editada_mayor', public.guardar_promocion_precio((select (j ->> 'id')::uuid from r where clave = 'menor_a'),
     'e5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000002', 2500, now(), now() + interval '2 days',
     (select (j ->> 'updated_at')::timestamptz from r where clave = 'menor_a'))),
  ('repetida_igual', public.guardar_promocion_precio(null, 'e5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000002', 2000,
     (select (j ->> 'desde')::timestamptz from r where clave = 'igual_a'), (select (j ->> 'hasta')::timestamptz from r where clave = 'igual_a')));
insert into r values
  ('repetida_edicion', public.guardar_promocion_precio((select (j ->> 'id')::uuid from r where clave = 'editada_mayor'),
     'e5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000002', 2500,
     (select (j ->> 'desde')::timestamptz from r where clave = 'editada_mayor'), (select (j ->> 'hasta')::timestamptz from r where clave = 'editada_mayor'),
     (select (j ->> 'updated_at')::timestamptz from r where clave = 'editada_mayor')));
insert into r values
  ('editada_menor', public.guardar_promocion_precio((select (j ->> 'id')::uuid from r where clave = 'igual_a'),
     'e5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000002', 1990,
     (select (j ->> 'desde')::timestamptz from r where clave = 'igual_a'), (select (j ->> 'hasta')::timestamptz from r where clave = 'igual_a'),
     (select (j ->> 'updated_at')::timestamptz from r where clave = 'igual_a')));
reset role;
select is((select j ->> 'aviso_codigo' from r where clave = 'editada_mayor'), 'promocion_no_menor_al_normal',
  'editar una promoción a un precio mayor al normal (2500 > 2000) avisa');
select is((select (j ->> 'precio_promocional')::numeric from r where clave = 'editada_mayor'), 2500::numeric, '... y guarda la edición');
select is((select j ->> 'aviso_codigo' from r where clave = 'repetida_igual'), 'promocion_no_menor_al_normal',
  'repetir la alta idempotente de una promoción no menor conserva el aviso');
select is((select j ->> 'aviso_codigo' from r where clave = 'repetida_edicion'), 'promocion_no_menor_al_normal',
  'repetir la edición ya guardada (idempotente) de una promoción no menor conserva el aviso');
select is((select j ? 'aviso' from r where clave = 'editada_menor'), false,
  'editar a un precio menor al normal con IVA (1990 sin IVA < 2000) deja de avisar');

-- Permisos y aislamiento.
select pg_temp.como('f5000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 5000, now(), now() + interval '2 days')$$,
  '42501', null, 'un rol de consulta no carga promociones (42501), tampoco una mayor al normal');
reset role;
select pg_temp.como('f5000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.guardar_promocion_precio(null, 'e5000000-0000-0000-0000-000000000003', 'b5000000-0000-0000-0000-000000000001', 5000, now(), now() + interval '2 days')$$,
  'P0002', null, 'una tienda de otra organización no existe para el administrador (P0002): el aviso no filtra precios ajenos');
select throws_ok(
  $$select private.promocion_con_aviso('{}'::jsonb, 'e5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 1)$$,
  '42501', null, 'authenticated no ejecuta private.promocion_con_aviso');
reset role;
select is(has_function_privilege('anon', 'private.promocion_con_aviso(jsonb, uuid, uuid, numeric)', 'execute'), false, 'anon no ejecuta promocion_con_aviso');
select is(has_function_privilege('authenticated', 'private.promocion_con_aviso(jsonb, uuid, uuid, numeric)', 'execute'), false, 'authenticated no ejecuta promocion_con_aviso');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'private.promocion_con_aviso(jsonb, uuid, uuid, numeric)'::regprocedure), true,
  'promocion_con_aviso: security definer con search_path vacío');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'private.promocion_vigente(uuid, uuid, timestamptz)'::regprocedure), true,
  'promocion_vigente sigue security definer con search_path vacío');
select is(has_function_privilege('authenticated', 'public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz)', 'execute'), true,
  'guardar_promocion_precio sigue ejecutable por authenticated');
select is(has_function_privilege('anon', 'public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz)', 'execute'), false,
  'guardar_promocion_precio sigue sin ejecución para anon');

select * from finish();
rollback;
