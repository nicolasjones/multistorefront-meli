-- F-TDA-15 (MSF-413, épica MSF-191): búsqueda pública de productos. Cubre SC-004 y verifica FR-020, FR-021,
-- FR-022, FR-023 y FR-029: unaccent + índice trigrama + normalización inmutable, tolerancia a tildes,
-- mayúsculas y errores de tipeo, tope de 6 sugerencias, orden por relevancia, comodines/comillas/texto
-- largo o vacío como texto literal, aislamiento entre tiendas, lista blanca de campos, límite por visitante
-- y minuto (permite 30, rechaza el 31, vuelve en el minuto siguiente), tabla de control con RLS y sin
-- privilegios para anon/authenticated, y que la IP nunca se guarda. Las llamadas se hacen como postgres
-- (las funciones son SECURITY DEFINER) salvo la sección «anon», que las ejecuta con el rol anónimo.
begin;

select plan(84);

-- ============================================================================
-- Fixture (como postgres: RLS no aplica)
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

-- Org 1: tienda A, tienda B y una apagada (E3). Org 2: una tienda.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'bq-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'bq-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'bq-apagada.ejemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', 'bq-dos.ejemplo.com');

insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('ca000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'Cargadores', 1),
  ('ca000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'Otros', 2),
  ('ca000000-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'Ajena', 1);

-- Org 1: «Cargador USB-C» $ 1.500 (Cargadores), «Cargador inalámbrico» $ 2.500, ocho «Cargador modelo N»
-- ($ 100·N), «Cargador oculto» (oculto en A), «Cable HDMI» $ 800, «Oferta 100% real», «Cámara» (con tilde).
-- «Solo en B» solo en la tienda B. Org 2: «Cargador ajeno».
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Cargador USB-C', 'BQ-1', 1500, 'ARS', true, 'ca000000-0000-0000-0000-0000000000b1'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cargador inalámbrico', 'BQ-2', 2500, 'ARS', true, 'ca000000-0000-0000-0000-0000000000b2'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cable HDMI', 'BQ-3', 800, 'ARS', true, 'ca000000-0000-0000-0000-0000000000b2'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cargador oculto', 'BQ-4', 100, 'ARS', true, 'ca000000-0000-0000-0000-0000000000b2'),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Oferta 100% real', 'BQ-5', 100, 'ARS', true, 'ca000000-0000-0000-0000-0000000000b2'),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Cámara', 'BQ-6', 900, 'ARS', true, 'ca000000-0000-0000-0000-0000000000b2'),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Solo en B', 'BQ-7', 100, 'ARS', true, 'ca000000-0000-0000-0000-0000000000b2'),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Cargador inactivo', 'BQ-8', 100, 'ARS', false, 'ca000000-0000-0000-0000-0000000000b2'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Cargador ajeno', 'BD-1', 700, 'ARS', true, 'ca000000-0000-0000-0000-0000000000f1');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id)
select ('a1000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       '11111111-1111-1111-1111-111111111111', 'Cargador modelo ' || n, 'BQ-M' || n, 100 * n, 'ARS', true,
       'ca000000-0000-0000-0000-0000000000b2'
  from generate_series(1, 8) n;

-- A: todo menos «Solo en B». B: «Cargador USB-C», «Cable HDMI», «Cámara» y «Solo en B».
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id
  from dominio.productos p
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111' and p.id <> 'a1000000-0000-0000-0000-000000000007';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000002', p.organizacion_id
  from dominio.productos p
 where p.id in ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003',
                'a1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000007');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

-- «Cargador oculto» no se ve en A.
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', false, false);

-- Stock: solo «Cargador USB-C» (3) y «Cable HDMI» (4).
update dominio.existencias set cantidad = 3 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 4 where producto_id = 'a1000000-0000-0000-0000-000000000003';

-- Ayudantes (como postgres; limpian el contador para que cada bloque parta de cero).
create function pg_temp.reiniciar() returns void language sql as $$ delete from public.limite_pedidos_publicos; $$;
create function pg_temp.nombres(j jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(p ->> 'nombre' order by o), '[]'::jsonb)
    from jsonb_array_elements(j -> 'productos') with ordinality t(p, o);
$$;
create function pg_temp.claves(j jsonb) returns text[] language sql as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(j) k;
$$;
create function pg_temp.sugerir(p_host text, p_q text) returns jsonb language sql as $$
  select publico.sugerencias_busqueda_por_dominio(p_host, p_q);
$$;

-- ============================================================================
-- FR-020 · extensión, normalización e índice
-- ============================================================================

select is((select count(*)::int from pg_extension where extname = 'unaccent'), 1, 'unaccent está instalada');
select is((select count(*)::int from pg_extension where extname = 'pg_trgm'), 1, 'pg_trgm está instalada');
select is(
  (select provolatile::text from pg_proc where oid = 'private.normalizar_busqueda(text)'::regprocedure),
  'i', 'normalizar_busqueda es inmutable'
);
select is(private.normalizar_busqueda('  CÁRGADOR   Ñandú  '), 'cargador nandu', 'normalizar_busqueda: minúsculas, sin tildes y espacios colapsados');
select is(private.normalizar_busqueda(null), '', 'normalizar_busqueda: null es vacío');
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'dominio' and tablename = 'productos' and indexname = 'productos_nombre_busqueda_trgm'),
  1, 'existe el índice trigrama productos_nombre_busqueda_trgm'
);

-- ============================================================================
-- Privilegios y estructura (FR-022, FR-029)
-- ============================================================================

select is(has_function_privilege('anon', 'publico.sugerencias_busqueda_por_dominio(text, text)', 'execute'), true, 'anon ejecuta las sugerencias');
select is(has_function_privilege('anon', 'publico.busqueda_pagina_por_dominio(text, text, uuid, boolean, numeric, text, integer)', 'execute'), true, 'anon ejecuta la página de resultados');
select is(has_function_privilege('authenticated', 'publico.sugerencias_busqueda_por_dominio(text, text)', 'execute'), true, 'authenticated ejecuta las sugerencias');
select is(has_function_privilege('anon', 'private.normalizar_busqueda(text)', 'execute'), false, 'anon no ejecuta normalizar_busqueda');
-- El índice de expresión la ejecuta al escribir productos: los roles que escriben necesitan EXECUTE.
select is(has_function_privilege('authenticated', 'private.normalizar_busqueda(text)', 'execute'), true, 'authenticated ejecuta normalizar_busqueda para mantener el índice de expresión');
select is(has_function_privilege('service_role', 'private.normalizar_busqueda(text)', 'execute'), true, 'service_role ejecuta normalizar_busqueda para mantener el índice de expresión');
select is(has_function_privilege('anon', 'private.registrar_pedido_publico(text, integer)', 'execute'), false, 'anon no ejecuta registrar_pedido_publico');
select is(has_function_privilege('authenticated', 'private.registrar_pedido_publico(text, integer)', 'execute'), false, 'authenticated no ejecuta registrar_pedido_publico');
select is(has_function_privilege('anon', 'private.visitante_publico(text)', 'execute'), false, 'anon no ejecuta visitante_publico');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.limite_pedidos_publicos'::regclass),
  true, 'public.limite_pedidos_publicos tiene RLS activada'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'limite_pedidos_publicos'),
  0, 'public.limite_pedidos_publicos no tiene políticas'
);
select is(
  (select bool_or(has_table_privilege(rol, 'public.limite_pedidos_publicos', privilegio))
     from unnest(array['anon', 'authenticated']) rol
     cross join unnest(array['select', 'insert', 'update', 'delete']) privilegio),
  false, 'anon y authenticated no tienen privilegios sobre public.limite_pedidos_publicos'
);

-- ============================================================================
-- FR-021 · sugerencias: tildes, mayúsculas y errores de tipeo
-- ============================================================================

select pg_temp.reiniciar();

-- Con 10 cargadores visibles y el tope de 6, el desempate es por nombre: «inalámbrico» y los
-- «modelo 1..5» entran primero. Por eso se comparan conjuntos, no una sugerencia puntual.
select is(
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'cargdor')) @> '["Cargador inalámbrico", "Cargador modelo 1"]'::jsonb,
  true, '«cargdor» (error de tipeo) encuentra los cargadores'
);
select is(
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'CARGADOR')),
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'cargdor')),
  '«CARGADOR» (mayúsculas) da el mismo resultado que «cargdor»'
);
select is(
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'cárgador')),
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'cargdor')),
  '«cárgador» (con tilde) da el mismo resultado que «cargdor»'
);
select is(
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'camara')),
  '["Cámara"]'::jsonb, '«camara» (sin tilde) encuentra «Cámara»'
);
select is(
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'inalambrico')),
  '["Cargador inalámbrico"]'::jsonb, '«inalambrico» (sin tilde) encuentra «Cargador inalámbrico»'
);
select is(
  jsonb_array_length(pg_temp.sugerir('bq-a.ejemplo.com', 'cargador') -> 'productos'),
  6, 'el tope de sugerencias es 6 (hay más de 6 cargadores visibles)'
);
select is(
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'cable hdmi')) -> 0,
  '"Cable HDMI"'::jsonb, 'el orden es por relevancia: la coincidencia exacta va primera'
);
select is(
  pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'cargador usb')) -> 0,
  '"Cargador USB-C"'::jsonb, 'por relevancia, «cargador usb» pone primero a «Cargador USB-C»'
);

-- Precio final, disponibilidad y lista blanca.
select is(
  (select (p ->> 'precio')::numeric from jsonb_array_elements(pg_temp.sugerir('bq-a.ejemplo.com', 'cable hdmi') -> 'productos') p limit 1),
  (select (p ->> 'precio')::numeric from jsonb_array_elements(publico.catalogo_pagina_por_dominio('bq-a.ejemplo.com') -> 'productos') p where p ->> 'nombre' = 'Cable HDMI'),
  'el precio de la sugerencia es el precio final del catálogo'
);
select is(
  (select (p ->> 'disponible')::boolean from jsonb_array_elements(pg_temp.sugerir('bq-a.ejemplo.com', 'cable hdmi') -> 'productos') p limit 1),
  true, '«Cable HDMI» (con stock) figura disponible'
);
select is(
  (select (p ->> 'disponible')::boolean from jsonb_array_elements(pg_temp.sugerir('bq-a.ejemplo.com', 'inalambrico') -> 'productos') p limit 1),
  false, '«Cargador inalámbrico» (sin stock) figura sin disponibilidad'
);
select is(
  pg_temp.claves(pg_temp.sugerir('bq-a.ejemplo.com', 'cable hdmi')),
  array['espera_segundos', 'limitado', 'productos'], 'la respuesta de sugerencias solo trae limitado, espera_segundos y productos'
);
select is(
  (select pg_temp.claves(p) from jsonb_array_elements(pg_temp.sugerir('bq-a.ejemplo.com', 'cable hdmi') -> 'productos') p limit 1),
  array['categoria_id', 'disponible', 'id', 'imagen', 'nombre', 'precio'], 'cada sugerencia solo trae la lista blanca de campos'
);

-- Texto vacío, corto, largo y literal.
select pg_temp.reiniciar();
select is(pg_temp.sugerir('bq-a.ejemplo.com', ''), '{"limitado": false, "espera_segundos": null, "productos": []}'::jsonb, 'texto vacío: lista vacía');
select is(pg_temp.sugerir('bq-a.ejemplo.com', 'c') -> 'productos', '[]'::jsonb, 'texto de 1 carácter: lista vacía');
select is(pg_temp.sugerir('bq-a.ejemplo.com', null) -> 'productos', '[]'::jsonb, 'texto nulo: lista vacía');
select is((select pedidos from public.limite_pedidos_publicos limit 1), null, 'texto vacío, corto o nulo no cuenta para el límite');
select is(jsonb_typeof(pg_temp.sugerir('bq-a.ejemplo.com', repeat('cargador ', 200)) -> 'productos'), 'array', 'texto largo (1.800 caracteres): responde sin error');
select is(pg_temp.sugerir('bq-a.ejemplo.com', '%%') -> 'productos', '[]'::jsonb, '«%%» es texto literal: no devuelve todo el catálogo');
select is(pg_temp.sugerir('bq-a.ejemplo.com', '____') -> 'productos', '[]'::jsonb, '«____» es texto literal: no devuelve todo el catálogo');
select is(
  pg_temp.sugerir('bq-a.ejemplo.com', $$o'brien"; drop table dominio.productos; --$$) -> 'productos', '[]'::jsonb,
  'comillas y SQL en el texto son literales'
);
select is(to_regclass('dominio.productos') is not null, true, 'dominio.productos sigue existiendo');

-- ============================================================================
-- FR-029 · aislamiento y visibilidad
-- ============================================================================

select pg_temp.reiniciar();
select is(pg_temp.nombres(pg_temp.sugerir('bq-b.ejemplo.com', 'cargador')), '["Cargador USB-C"]'::jsonb, 'la tienda B solo encuentra su cargador');
select is(pg_temp.nombres(pg_temp.sugerir('bq-b.ejemplo.com', 'inalambrico')), '[]'::jsonb, 'la tienda B no encuentra productos de A');
select is(pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'solo en b')), '[]'::jsonb, 'la tienda A no encuentra productos de B');
select is(pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'ajeno')), '[]'::jsonb, 'una tienda no encuentra productos de otra organización');
select is(pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'cargador oculto')) @> '["Cargador oculto"]'::jsonb, false, 'un producto oculto no aparece');
select is(pg_temp.nombres(pg_temp.sugerir('bq-a.ejemplo.com', 'inactivo')) @> '["Cargador inactivo"]'::jsonb, false, 'un producto inactivo no aparece');
select is(pg_temp.nombres(pg_temp.sugerir('bq-dos.ejemplo.com', 'cargador')), '["Cargador ajeno"]'::jsonb, 'la otra organización encuentra solo lo suyo');
select is(pg_temp.sugerir('no-existe.ejemplo.com', 'cargador'), null::jsonb, 'dominio desconocido: null');
select is(pg_temp.sugerir('bq-apagada.ejemplo.com', 'cargador'), pg_temp.sugerir('no-existe.ejemplo.com', 'cargador'), 'empresa desactivada responde igual que un dominio desconocido');
select is(
  pg_temp.nombres(pg_temp.sugerir('  BQ-B.Ejemplo.com.:8080 ', 'cargador')), '["Cargador USB-C"]'::jsonb,
  'el host se normaliza (espacios, mayúsculas, punto final y puerto)'
);

-- ============================================================================
-- FR-023 · página de resultados
-- ============================================================================

select pg_temp.reiniciar();

select is(
  pg_temp.claves(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador')),
  (select array_agg(k order by k)
     from unnest(pg_temp.claves(publico.catalogo_pagina_por_dominio('bq-a.ejemplo.com')) || array['espera_segundos', 'limitado']) k),
  'la página de resultados tiene la forma del catálogo más limitado y espera_segundos'
);
select is(
  (publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador') ->> 'total')::int, 10,
  'total: los 10 cargadores visibles de A (sin el oculto ni el inactivo)'
);
select is((publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador') ->> 'tamano')::int, 24, 'el tamaño de página es 24');
select is(
  jsonb_array_length(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador', null, false, null, 'relevancia', 2) -> 'productos'),
  0, 'la página 2 de 10 resultados está vacía'
);
select is(
  (publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador', null, true) ->> 'total')::int, 1,
  'solo con stock: queda «Cargador USB-C»'
);
select is(
  (publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador', null, false, 700) ->> 'total')::int, 7,
  'precio máximo 700: los modelos 1 a 7'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador', 'ca000000-0000-0000-0000-0000000000b1')),
  '["Cargador USB-C"]'::jsonb, 'filtro por categoría'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador', null, false, null, 'precio_asc')) -> 0,
  '"Cargador modelo 1"'::jsonb, 'menor precio primero'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador', null, false, null, 'precio_desc')) -> 0,
  '"Cargador inalámbrico"'::jsonb, 'mayor precio primero'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador', null, false, null, 'inventado'))
    = pg_temp.nombres(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador')),
  true, 'un orden inválido se normaliza a relevancia'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargdor'))
    = pg_temp.nombres(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'CÁRGADOR')),
  true, 'el error de tipeo y la tilde dan los mismos resultados'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('bq-b.ejemplo.com', 'cargador')), '["Cargador USB-C"]'::jsonb,
  'la página de resultados de B solo trae lo de B'
);
select is(publico.busqueda_pagina_por_dominio('no-existe.ejemplo.com', 'cargador'), null::jsonb, 'resultados: dominio desconocido es null');
select is(
  publico.busqueda_pagina_por_dominio('bq-apagada.ejemplo.com', 'cargador'), null::jsonb,
  'resultados: empresa desactivada responde igual que un dominio desconocido'
);
select is(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', '%%') -> 'productos', '[]'::jsonb, 'resultados: «%%» es texto literal');
select is((publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', '') ->> 'total')::int, 0, 'resultados: texto vacío no devuelve nada');
select is(
  (select pg_temp.claves(p) from jsonb_array_elements(publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cable hdmi') -> 'productos') p limit 1),
  array['categoria_id', 'destacado', 'disponible', 'id', 'imagen', 'nombre', 'precio'],
  'cada resultado solo trae la lista blanca de campos'
);
select is(
  (select count(*)::int from jsonb_array_elements(publico.catalogo_pagina_por_dominio('bq-a.ejemplo.com') -> 'productos')), 13,
  'catalogo_pagina_por_dominio sigue intacta (13 productos visibles de A)'
);

-- ============================================================================
-- FR-022 · límite por visitante y minuto
-- ============================================================================

select pg_temp.reiniciar();

select is(
  (select count(*)::int
     from generate_series(1, 30) n
    where (pg_temp.sugerir('bq-a.ejemplo.com', 'cargador') ->> 'limitado')::boolean = false),
  30, 'se permiten 30 pedidos en el minuto'
);
select is(
  (select (pg_temp.sugerir('bq-a.ejemplo.com', 'cargador') ->> 'limitado')::boolean), true, 'el pedido 31 se rechaza'
);
select is(
  (select jsonb_array_length(j -> 'productos') = 0 and (j ->> 'espera_segundos')::int between 1 and 60
     from (select pg_temp.sugerir('bq-a.ejemplo.com', 'cargador') as j) x),
  true, 'rechazado: sin productos y con entre 1 y 60 segundos de espera'
);
select is(
  (publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador') ->> 'limitado')::boolean, true,
  'las sugerencias y los resultados completos comparten el mismo contador'
);
select is(
  (select (j ->> 'total')::int = 0 and jsonb_array_length(j -> 'productos') = 0
     from (select publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargador') as j) x),
  true, 'resultados limitados: total 0 y sin productos'
);
select is(
  (pg_temp.sugerir('bq-b.ejemplo.com', 'cargador') ->> 'limitado')::boolean, false,
  'el contador es por host: la tienda B no está limitada'
);

-- Pasado el minuto vuelve a funcionar: la ventana vieja deja de contar.
update public.limite_pedidos_publicos set ventana = ventana - interval '1 minute';
select is(
  (pg_temp.sugerir('bq-a.ejemplo.com', 'cargador') ->> 'limitado')::boolean, false,
  'al minuto siguiente la búsqueda vuelve a funcionar'
);
-- Las ventanas de más de 10 minutos se purgan en la misma llamada.
update public.limite_pedidos_publicos set ventana = ventana - interval '11 minutes'
 where visitante = private.visitante_publico('bq-b.ejemplo.com');
select pg_temp.sugerir('bq-a.ejemplo.com', 'cargador');
select is(
  (select count(*)::int from public.limite_pedidos_publicos where ventana < now() - interval '10 minutes'), 0,
  'las ventanas de más de 10 minutos se purgan'
);

-- La IP del proxy nunca se guarda: solo su hash (sha256 de la última IP de x-forwarded-for + host).
select pg_temp.reiniciar();
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 198.51.100.9"}', true);
select pg_temp.sugerir('bq-a.ejemplo.com', 'cargador');
select set_config('request.headers', '', true);
select is(
  (select visitante from public.limite_pedidos_publicos),
  encode(sha256(convert_to('198.51.100.9|bq-a.ejemplo.com', 'UTF8')), 'hex'),
  'el visitante es el hash de la última IP del proxy + host'
);
select is(
  (select count(*)::int from public.limite_pedidos_publicos where visitante like '%203.0.113%' or visitante like '%198.51.100%'),
  0, 'la IP no se guarda en claro'
);
select pg_temp.reiniciar();
select is(
  private.visitante_publico('bq-a.ejemplo.com') = private.visitante_publico('bq-b.ejemplo.com'), false,
  'visitantes de hosts distintos no comparten contador'
);

-- ============================================================================
-- Como anon (rol de la tienda pública)
-- ============================================================================

select pg_temp.reiniciar();
create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

insert into res values
  ('sug', publico.sugerencias_busqueda_por_dominio('bq-a.ejemplo.com', 'cargdor')),
  ('pag', publico.busqueda_pagina_por_dominio('bq-a.ejemplo.com', 'cargdor')),
  ('desc', publico.sugerencias_busqueda_por_dominio('no-existe.ejemplo.com', 'cargdor'));

reset role;

select is(jsonb_array_length((select j -> 'productos' from res where clave = 'sug')), 6, 'anon obtiene las sugerencias');
select is((select (j ->> 'total')::int from res where clave = 'pag'), 10, 'anon obtiene la página de resultados');
select is((select j from res where clave = 'desc'), null::jsonb, 'anon: dominio desconocido es null');
select is((select sum(pedidos)::int from public.limite_pedidos_publicos), 2, 'los pedidos de anon se cuentan en el límite (las dos búsquedas con resultado)');

select * from finish();
rollback;
