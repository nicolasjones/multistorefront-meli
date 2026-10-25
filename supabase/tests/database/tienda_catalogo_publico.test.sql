-- F-TDA-12 (MSF-355, épica MSF-167): catálogo público con filtros, orden y paginación.
-- Cubre SC-004 y verifica FR-030…FR-034: filtros (categoría, solo con stock, precio máximo), los tres
-- órdenes con los sin precio al final, paginación de 24, normalización de parámetros, paridad de
-- private.precio_final_publico con private.precio_para (neto o final según el interruptor de IVA),
-- aislamiento entre tiendas, lista blanca de campos, la política de imágenes de `anon` y que `anon`
-- no ejecute las funciones `private` (salvo imagen_publica, que respalda esa política).
-- Las llamadas públicas se hacen como `anon` y se guardan en una tabla temporal; las verificaciones
-- corren como postgres. La paridad de precio se calcula como administrador de la organización.
begin;

select plan(73);

-- ============================================================================
-- Fixture (como postgres: RLS no aplica)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

-- Org 1: tienda A (E1, regla +10 % y precios con IVA), tienda B (E2, sin regla, sin IVA) y una apagada (E3).
-- Org 2: una tienda sin cotización del dólar. Org 3: 30 productos para paginar.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true),
  ('e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tienda Masiva', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'pc-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'pc-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'pc-apagada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'pc-dos.ejemplo.com'),
  ('33333333-3333-3333-3333-333333333333', 'e3000000-0000-0000-0000-000000000001', 'pc-masiva.ejemplo.com');

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10, true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);

insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1500);

-- Las categorías nacen en 21 % de IVA y los productos heredan esa alícuota.
insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks', 1),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cargadores', 2),
  ('ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Oculta en A', 3),
  ('ca000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'Ajena', 1);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'PC-1', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'PC-2', 3000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gama', 'PC-3', 10, 'USD', true, 'ca000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Delta', 'PC-4', 500, 'ARS', true, 'ca000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Oculto en A', 'PC-6', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'PC-7', 100, 'ARS', false, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'En categoría oculta', 'PC-8', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000003'),
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Solo en apagada', 'PC-9', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Dos ARS', 'PD-1', 700, 'ARS', true, 'ca000000-0000-0000-0000-0000000000f1'),
  ('b2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Sin cotiz', 'PD-2', 10, 'USD', true, 'ca000000-0000-0000-0000-0000000000f1');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
select ('c3000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '33333333-3333-3333-3333-333333333333', 'P ' || lpad(n::text, 2, '0'), 'PM-' || n, 100 + n, 'ARS', true
  from generate_series(1, 30) n;

-- Alfa..Delta, Oculto, Inactivo y En categoría oculta: en A y B. «Solo en apagada»: solo en la tienda apagada.
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111'
   and p.id <> 'a1000000-0000-0000-0000-000000000009';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
  ('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333'
  from dominio.productos p where p.organizacion_id = '33333333-3333-3333-3333-333333333333';

-- Visibilidad: A oculta «Oculto en A» y la categoría «Oculta en A»; B oculta «Beta». «Delta» es destacado en A.
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', false, false),
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', true, true),
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', false, false);
insert into dominio.categorias_tienda (empresa_id, categoria_id, organizacion_id, visible) values
  ('e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', false);

-- Stock: Alfa 5, Beta 0, Gama 3, Delta 2.
update dominio.existencias set cantidad = 5 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 0 where producto_id = 'a1000000-0000-0000-0000-000000000002';
update dominio.existencias set cantidad = 3 where producto_id = 'a1000000-0000-0000-0000-000000000003';
update dominio.existencias set cantidad = 2 where producto_id = 'a1000000-0000-0000-0000-000000000004';

-- Imágenes: Alfa (2), Beta (1), Oculto en A, Inactivo, En categoría oculta y Solo en apagada (1 cada una).
insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/segunda.png'),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/beta.png'),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000006/oculto.png'),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000007/inactivo.png'),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000008/categoria-oculta.png'),
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000009/apagada.png');

insert into storage.objects (bucket_id, name)
select 'productos-imagenes', i.ruta from dominio.producto_imagenes i;

-- Ayudante: nombres de los productos de una respuesta, en el orden recibido.
create function pg_temp.nombres(j jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(p ->> 'nombre' order by o), '[]'::jsonb)
    from jsonb_array_elements(j -> 'productos') with ordinality t(p, o);
$$;

-- ============================================================================
-- Privilegios y estructura
-- ============================================================================

select is(has_function_privilege('anon', 'publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer)', 'execute'), true, 'anon ejecuta la función pública');
select is(has_function_privilege('anon', 'private.precio_final_publico(uuid, uuid)', 'execute'), false, 'anon no ejecuta precio_final_publico');
select is(has_function_privilege('authenticated', 'private.precio_final_publico(uuid, uuid)', 'execute'), false, 'authenticated no ejecuta precio_final_publico');
select is(has_function_privilege('anon', 'private.disponible_publico(uuid)', 'execute'), false, 'anon no ejecuta disponible_publico');
select is(has_function_privilege('authenticated', 'private.imagen_publica(text)', 'execute'), false, 'authenticated no ejecuta imagen_publica');
select is(has_function_privilege('anon', 'private.imagen_publica(text)', 'execute'), false, 'anon no ejecuta private.imagen_publica');
select is(has_function_privilege('anon', 'publico.imagen_publica(text)', 'execute'), true, 'anon ejecuta el envoltorio publico.imagen_publica (lo usa la política de storage)');
select is(has_schema_privilege('anon', 'private', 'usage'), false, 'anon sigue sin usage sobre private');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);

-- ============================================================================
-- Lectura anónima: se guardan las respuestas y se verifican después
-- ============================================================================

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

insert into res values
  ('a_def', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com')),
  ('a_asc', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, null, 'precio_asc')),
  ('a_desc', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, null, 'precio_desc')),
  ('a_stock', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, true)),
  ('a_max', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, 4000, 'precio_asc')),
  ('a_stock_max', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, true, 4000)),
  ('a_joy', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', 'ca000000-0000-0000-0000-000000000001')),
  ('a_carg', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', 'ca000000-0000-0000-0000-000000000002')),
  ('a_oculta', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', 'ca000000-0000-0000-0000-000000000003')),
  ('a_ajena', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', 'ca000000-0000-0000-0000-0000000000f1')),
  ('a_orden_raro', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, null, 'inventado')),
  ('a_pag0', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, null, 'relevancia', 0)),
  ('a_pagneg', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, null, 'relevancia', -5)),
  ('a_pagnull', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, null, 'relevancia', null)),
  ('a_max0', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, 0)),
  ('a_maxneg', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, -10)),
  ('a_pag99', publico.catalogo_pagina_por_dominio('pc-a.ejemplo.com', null, false, null, 'relevancia', 99)),
  ('a_host', publico.catalogo_pagina_por_dominio('  PC-A.Ejemplo.com.:8080 ')),
  ('b_def', publico.catalogo_pagina_por_dominio('pc-b.ejemplo.com')),
  ('b_asc', publico.catalogo_pagina_por_dominio('pc-b.ejemplo.com', null, false, null, 'precio_asc')),
  ('dos_asc', publico.catalogo_pagina_por_dominio('pc-dos.ejemplo.com', null, false, null, 'precio_asc')),
  ('dos_desc', publico.catalogo_pagina_por_dominio('pc-dos.ejemplo.com', null, false, null, 'precio_desc')),
  ('dos_max', publico.catalogo_pagina_por_dominio('pc-dos.ejemplo.com', null, false, 10000)),
  ('m_1', publico.catalogo_pagina_por_dominio('pc-masiva.ejemplo.com')),
  ('m_2', publico.catalogo_pagina_por_dominio('pc-masiva.ejemplo.com', null, false, null, 'relevancia', 2)),
  ('m_desc', publico.catalogo_pagina_por_dominio('pc-masiva.ejemplo.com', null, false, null, 'precio_desc')),
  ('desconocido', publico.catalogo_pagina_por_dominio('no-existe.ejemplo.com')),
  ('apagada', publico.catalogo_pagina_por_dominio('pc-apagada.ejemplo.com')),
  ('vacio', publico.catalogo_pagina_por_dominio(''));

-- Las imágenes que `anon` puede leer del bucket (FR-031).
create temp table leidas (nombre text);
grant all on leidas to anon;
insert into leidas select o.name from storage.objects o where o.bucket_id = 'productos-imagenes';

reset role;

-- ============================================================================
-- Filtros (FR-032)
-- ============================================================================

select is((select j ->> 'total' from res where clave = 'a_def'), '4', 'tienda A: solo los 4 productos efectivamente visibles (sin oculto, inactivo ni de categoría oculta)');
select is((select j ->> 'tamano' from res where clave = 'a_def'), '24', 'el tamaño de página es 24');
select is((select j ->> 'pagina' from res where clave = 'a_def'), '1', 'sin indicar página es la 1');
select is(pg_temp.nombres((select j from res where clave = 'a_stock')), '["Delta", "Alfa", "Gama"]'::jsonb, 'solo con stock: deja afuera a Beta (sin existencias)');
select is(pg_temp.nombres((select j from res where clave = 'a_max')), '["Delta", "Alfa", "Beta"]'::jsonb, 'precio máximo 4000 filtra sobre el precio final (Gama cuesta más)');
select is(pg_temp.nombres((select j from res where clave = 'a_stock_max')), '["Delta", "Alfa"]'::jsonb, 'stock y precio máximo se combinan');
select is(pg_temp.nombres((select j from res where clave = 'a_joy')), '["Alfa", "Beta"]'::jsonb, 'categoría Joysticks');
select is(pg_temp.nombres((select j from res where clave = 'a_carg')), '["Delta", "Gama"]'::jsonb, 'categoría Cargadores');
select is((select j ->> 'total' from res where clave = 'a_oculta'), '0', 'categoría oculta en la tienda: lista vacía');
select is(pg_temp.nombres((select j from res where clave = 'a_ajena')), '[]'::jsonb, 'categoría de otra organización: lista vacía, sin error');
select is(
  (select jsonb_agg(c ->> 'nombre') from res, jsonb_array_elements(j -> 'categorias') c where clave = 'a_def'),
  '["Joysticks", "Cargadores"]'::jsonb, 'devuelve las categorías visibles de la tienda (sin la oculta)'
);
select is(
  (select (c ->> 'productos')::int from res, jsonb_array_elements(j -> 'categorias') c where clave = 'a_def' and c ->> 'nombre' = 'Joysticks'),
  2, 'con el conteo de productos efectivamente visibles de cada categoría'
);

-- ============================================================================
-- Orden (FR-033)
-- ============================================================================

select is(pg_temp.nombres((select j from res where clave = 'a_def')), '["Delta", "Alfa", "Beta", "Gama"]'::jsonb, 'relevancia: destacados primero y luego por nombre');
select is(pg_temp.nombres((select j from res where clave = 'a_asc')), '["Delta", "Alfa", "Beta", "Gama"]'::jsonb, 'menor precio');
select is(pg_temp.nombres((select j from res where clave = 'a_desc')), '["Gama", "Beta", "Alfa", "Delta"]'::jsonb, 'mayor precio');
select is(pg_temp.nombres((select j from res where clave = 'b_asc')), '["En categoría oculta", "Oculto en A", "Delta", "Alfa", "Gama"]'::jsonb, 'tienda B: su propia regla de precio y su propia visibilidad (oculta Beta; lo oculto en A se ve acá)');
select is(pg_temp.nombres((select j from res where clave = 'b_def')), '["Alfa", "Delta", "En categoría oculta", "Gama", "Oculto en A"]'::jsonb, 'tienda B: sin destacados, por nombre');
select is(pg_temp.nombres((select j from res where clave = 'dos_asc')), '["Dos ARS", "Sin cotiz"]'::jsonb, 'menor precio: el producto sin precio calculable va al final');
select is(pg_temp.nombres((select j from res where clave = 'dos_desc')), '["Dos ARS", "Sin cotiz"]'::jsonb, 'mayor precio: el producto sin precio calculable también va al final');
select is(pg_temp.nombres((select j from res where clave = 'dos_max')), '["Dos ARS"]'::jsonb, 'el producto sin precio no pasa el filtro de precio máximo');
select is(
  (select p ->> 'precio' from res, jsonb_array_elements(j -> 'productos') p where clave = 'dos_asc' and p ->> 'nombre' = 'Sin cotiz'),
  null, 'sin cotización del dólar el precio es null (no se inventa)'
);

-- ============================================================================
-- Paginación de a 24 (FR-032, FR-039)
-- ============================================================================

select is((select j ->> 'total' from res where clave = 'm_1'), '30', 'el total es el del servidor (30)');
select is((select jsonb_array_length(j -> 'productos') from res where clave = 'm_1'), 24, 'la primera página trae 24');
select is((select jsonb_array_length(j -> 'productos') from res where clave = 'm_2'), 6, 'la segunda trae las 6 restantes');
select is((select j -> 'productos' -> 0 ->> 'nombre' from res where clave = 'm_2'), 'P 25', 'la segunda página arranca donde terminó la primera');
select is((select j ->> 'pagina' from res where clave = 'm_2'), '2', 'devuelve la página pedida');
select is(
  (select count(distinct p ->> 'id')::int from res, jsonb_array_elements(j -> 'productos') p where clave in ('m_1', 'm_2')),
  30, 'ninguna fila se repite entre páginas'
);
select is((select j -> 'productos' -> 0 ->> 'nombre' from res where clave = 'm_desc'), 'P 30', 'mayor precio pagina con desempate estable');
select is((select j ->> 'total' from res where clave = 'a_pag99'), '4', 'página fuera de rango: total real');
select is(pg_temp.nombres((select j from res where clave = 'a_pag99')), '[]'::jsonb, 'página fuera de rango: lista vacía');

-- ============================================================================
-- Normalización de parámetros (FR-034)
-- ============================================================================

select is(pg_temp.nombres((select j from res where clave = 'a_orden_raro')), pg_temp.nombres((select j from res where clave = 'a_def')), 'orden desconocido → relevancia');
select is((select j ->> 'pagina' from res where clave = 'a_pag0'), '1', 'página 0 → 1');
select is((select j ->> 'pagina' from res where clave = 'a_pagneg'), '1', 'página negativa → 1');
select is((select j ->> 'pagina' from res where clave = 'a_pagnull'), '1', 'página nula → 1');
select is((select j ->> 'total' from res where clave = 'a_max0'), '4', 'precio máximo 0 → sin límite');
select is((select j ->> 'total' from res where clave = 'a_maxneg'), '4', 'precio máximo negativo → sin límite');
select is((select j from res where clave = 'a_host'), (select j from res where clave = 'a_def'), 'el host se normaliza (mayúsculas, espacios, puerto y punto final)');

-- ============================================================================
-- Host desconocido o empresa desactivada (FR-034)
-- ============================================================================

select is((select j from res where clave = 'desconocido'), null, 'host desconocido → null');
select is((select j from res where clave = 'apagada'), null, 'empresa desactivada → null (igual que el desconocido)');
select is((select j from res where clave = 'vacio'), null, 'host vacío → null');

-- ============================================================================
-- Lista blanca de campos (FR-034)
-- ============================================================================

select is(
  (select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(j) k from res where clave = 'a_def') s),
  '["categorias", "pagina", "productos", "tamano", "total"]'::jsonb, 'campos de la respuesta: sin organizacion_id'
);
select is(
  (select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(p) k from res, jsonb_array_elements(j -> 'productos') p where clave = 'a_def') s),
  '["categoria_id", "destacado", "disponible", "id", "imagen", "nombre", "precio"]'::jsonb,
  'campos de cada producto: sin costos, existencias, proveedor ni organizacion_id'
);
select is(
  (select p ->> 'imagen' from res, jsonb_array_elements(j -> 'productos') p where clave = 'a_def' and p ->> 'nombre' = 'Alfa'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png',
  'la imagen es la de menor posición'
);
select is(
  (select p ->> 'imagen' from res, jsonb_array_elements(j -> 'productos') p where clave = 'a_def' and p ->> 'nombre' = 'Gama'),
  null, 'sin imágenes: null'
);
select is(
  (select jsonb_agg(p -> 'disponible' order by o) from res, jsonb_array_elements(j -> 'productos') with ordinality t(p, o) where clave = 'a_def'),
  '[true, true, false, true]'::jsonb, 'disponible sale de private.disponible_publico (Delta, Alfa, Beta, Gama)'
);

-- ============================================================================
-- Precio final: paridad con private.precio_para (FR-030, SC-004)
-- ============================================================================

create temp table esperado (producto uuid, empresa uuid, neto numeric, final numeric);
grant all on esperado to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
insert into esperado
select p.id, e.id, pp.neto, pp.final
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
  join dominio.producto_empresa pe on pe.producto_id = p.id and pe.empresa_id = e.id
  cross join lateral private.precio_para(p.id, e.id, 'x1') pp
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
reset role;

select is((select count(*)::int from esperado), 14, 'precio_para da precio de los 7 productos asignados en las 2 empresas');
select results_eq(
  $$ select x.producto, private.precio_final_publico(x.producto, x.empresa) from esperado x
      where x.empresa = 'e1000000-0000-0000-0000-000000000001' order by 1 $$,
  $$ select producto, final from esperado where empresa = 'e1000000-0000-0000-0000-000000000001' order by 1 $$,
  'tienda A (precios con IVA): el precio público es precio_para(...).final'
);
select results_eq(
  $$ select x.producto, private.precio_final_publico(x.producto, x.empresa) from esperado x
      where x.empresa = 'e1000000-0000-0000-0000-000000000002' order by 1 $$,
  $$ select producto, neto from esperado where empresa = 'e1000000-0000-0000-0000-000000000002' order by 1 $$,
  'tienda B (precios sin IVA): el precio público es precio_para(...).neto'
);
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'), 1331.00::numeric, 'Alfa en A: 1.000 + 10 % = 1.100, con IVA 21 % = 1.331');
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002'), 1000.00::numeric, 'Alfa en B: precio de lista sin IVA');
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002'), 15000.00::numeric, 'Gama (USD 10) en B: dólar a 1.500');

update dominio.precios_empresa set mostrar_con_iva = true where empresa_id = 'e1000000-0000-0000-0000-000000000002';
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002'), 1210.00::numeric, 'al activar el interruptor de IVA, B publica el final (1.210)');

select is(private.precio_final_publico('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001'), null, 'USD sin cotización: null');
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001'), null, 'producto de otra organización: null');
select is(private.precio_final_publico('a1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000001'), null, 'producto no asignado a la empresa: null');

-- ============================================================================
-- Imágenes públicas (FR-031, D1)
-- ============================================================================

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'productos_imagenes_select_anon'
      and cmd = 'SELECT' and roles = '{anon}'),
  1, 'existe la política de lectura de anon sobre storage.objects'
);
select is(private.imagen_publica('11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png'), true, 'imagen de un producto visible: pública');
select is(private.imagen_publica('11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/beta.png'), true, 'visible en alguna tienda activa (A) aunque B lo oculte: pública');
select is(private.imagen_publica('11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000006/oculto.png'), true, 'oculto en A pero visible en B (tienda activa): pública');
select is(private.imagen_publica('11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000007/inactivo.png'), false, 'producto inactivo (no se publica en ninguna tienda): no pública');
select is(private.imagen_publica('11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000009/apagada.png'), false, 'producto de una tienda desactivada: no pública');
select is(private.imagen_publica('no/existe.png'), false, 'ruta inexistente: no pública');
select is(
  (select bool_and(private.imagen_publica(i.ruta) = exists (
            select 1
              from dominio.tiendas ti
              join dominio.empresas e on e.id = ti.empresa_id and e.activa
              cross join lateral private.catalogo_tienda_efectivo(e.id) x
             where x.producto_id = i.producto_id and x.efectivo))
     from dominio.producto_imagenes i),
  true, 'imagen_publica coincide con la visibilidad efectiva del catálogo'
);
select is(
  (select array_agg(nombre order by nombre) from leidas),
  array[
    '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png',
    '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/segunda.png',
    '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/beta.png',
    '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000006/oculto.png',
    '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000008/categoria-oculta.png'
  ],
  'anon solo lee del bucket las imágenes de productos visibles en alguna tienda activa'
);

select * from finish();
rollback;
