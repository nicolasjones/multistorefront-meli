-- F-TDA-21 (MSF-279, épica MSF-149): datos para buscadores de la tienda pública. Verifica FR-020, FR-023,
-- FR-025 y SC-006: lista blanca, descripción por defecto, `null` idéntico para host desconocido y empresa
-- desactivada, reactivar cambia el resultado, sitemap solo con lo visible y de la propia tienda, tope y
-- `anon` ejecuta las dos funciones.
begin;

select plan(19);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'seo-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'seo-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'seo-apagada.ejemplo.com');

-- Solo A tiene contenido publicado (subtítulo) e identidad (logo); B usa la descripción por defecto.
insert into dominio.tienda_contenido (empresa_id, organizacion_id, subtitulo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks y repuestos');
insert into dominio.tienda_identidad (empresa_id, organizacion_id, logo_ruta) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-1.png');

insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks', 1),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cables', 2);

insert into dominio.categorias_tienda (empresa_id, categoria_id, organizacion_id, visible) values
  ('e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', false);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Visible', 'S-1', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Oculto', 'S-2', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'S-3', 1000, 'ARS', false, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Solo B', 'S-4', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Solo apagada', 'S-5', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001');

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111');

insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', false, false);

select is(has_function_privilege('anon', 'publico.seo_tienda_por_dominio(text)', 'execute'), true, 'anon ejecuta seo_tienda_por_dominio');
select is(has_function_privilege('anon', 'publico.sitemap_por_dominio(text)', 'execute'), true, 'anon ejecuta sitemap_por_dominio');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

insert into res values
  ('seo_a', publico.seo_tienda_por_dominio('seo-a.ejemplo.com')),
  ('seo_a_host', publico.seo_tienda_por_dominio('  SEO-A.Ejemplo.com.:8080 ')),
  ('seo_b', publico.seo_tienda_por_dominio('seo-b.ejemplo.com')),
  ('seo_apagada', publico.seo_tienda_por_dominio('seo-apagada.ejemplo.com')),
  ('seo_desconocido', publico.seo_tienda_por_dominio('no-existe.ejemplo.com')),
  ('map_a', publico.sitemap_por_dominio('seo-a.ejemplo.com')),
  ('map_a_host', publico.sitemap_por_dominio('  SEO-A.Ejemplo.com.:8080 ')),
  ('map_b', publico.sitemap_por_dominio('seo-b.ejemplo.com')),
  ('map_apagada', publico.sitemap_por_dominio('seo-apagada.ejemplo.com')),
  ('map_desconocido', publico.sitemap_por_dominio('no-existe.ejemplo.com'));

reset role;

create function pg_temp.rutas(j jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(u ->> 'ruta' order by o), '[]'::jsonb)
    from jsonb_array_elements(j -> 'urls') with ordinality t(u, o);
$$;

-- seo_tienda_por_dominio
select is(
  (select j - 'logo_ruta' from res where clave = 'seo_a'),
  '{"dominio": "seo-a.ejemplo.com", "nombre": "Tienda A", "descripcion": "Joysticks y repuestos", "indexable": true}'::jsonb,
  'tienda A: dominio canónico, nombre, descripción del subtítulo e indexable'
);
select is((select j ->> 'logo_ruta' from res where clave = 'seo_a'), '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo-1.png', 'tienda A: ruta del logo');
select is((select j ->> 'descripcion' from res where clave = 'seo_b'), 'Tienda B · tienda online', 'sin subtítulo: descripción por defecto «<nombre> · tienda online»');
select is((select j -> 'logo_ruta' from res where clave = 'seo_b'), 'null'::jsonb, 'sin identidad: logo_ruta nulo');
select is((select j from res where clave = 'seo_a_host'), (select j from res where clave = 'seo_a'), 'el host se normaliza');
select is(
  (select array_agg(k order by k) from (select distinct jsonb_object_keys(j) k from res where clave = 'seo_a') s),
  array['descripcion', 'dominio', 'indexable', 'logo_ruta', 'nombre'],
  'lista blanca: sin organizacion_id ni datos internos'
);
select is(
  (select count(*)::int from res where clave in ('seo_apagada', 'seo_desconocido') and j is null),
  2, 'empresa desactivada y host desconocido: null idéntico'
);

-- sitemap_por_dominio
select is(
  pg_temp.rutas((select j from res where clave = 'map_a')),
  '["/", "/catalogo", "/contacto", "/categoria/ca000000-0000-0000-0000-000000000001", "/producto/a1000000-0000-0000-0000-000000000001"]'::jsonb,
  'tienda A: inicio, catálogo, contacto, categoría visible y solo el producto efectivamente visible'
);
select is((select j ->> 'dominio' from res where clave = 'map_a'), 'seo-a.ejemplo.com', 'el sitemap trae el dominio canónico');
select is((select j from res where clave = 'map_a_host'), (select j from res where clave = 'map_a'), 'el host del sitemap se normaliza');
select is(
  pg_temp.rutas((select j from res where clave = 'map_b')),
  '["/", "/catalogo", "/contacto", "/categoria/ca000000-0000-0000-0000-000000000001", "/categoria/ca000000-0000-0000-0000-000000000002", "/producto/a1000000-0000-0000-0000-000000000001", "/producto/a1000000-0000-0000-0000-000000000004"]'::jsonb,
  'tienda B: solo sus productos y sus categorías (la categoría oculta en A sí es visible en B), nunca los de A'
);
select is(
  (select u ->> 'modificado' from res, jsonb_array_elements(j -> 'urls') u where clave = 'map_a' and u ->> 'ruta' like '/producto/%'),
  to_char((select updated_at at time zone 'UTC' from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'), 'YYYY-MM-DD'),
  'el producto trae su fecha de modificación AAAA-MM-DD'
);
select is(
  (select count(*)::int from res where clave in ('map_apagada', 'map_desconocido') and j is null),
  2, 'sitemap: empresa desactivada y host desconocido devuelven null idéntico'
);

-- Tope: constante única de 50.000 (límite del protocolo sitemaps.org) aplicada al total de URLs.
select ok(
  (select prosrc ~ 'c_tope constant integer := 50000;' and prosrc ~ 'limit c_tope'
     from pg_proc where oid = 'publico.sitemap_por_dominio(text)'::regprocedure),
  'el tope de 50.000 URLs es una constante única y se aplica con limit'
);

-- FR-025: reactivar cambia el resultado sin otra acción (y apagar lo vuelve idéntico a desconocida).
update dominio.empresas set activa = true where id = 'e1000000-0000-0000-0000-000000000003';
select isnt(publico.seo_tienda_por_dominio('seo-apagada.ejemplo.com'), null::jsonb, 'reactivada: la tienda vuelve a tener datos SEO');
select is(
  pg_temp.rutas(publico.sitemap_por_dominio('seo-apagada.ejemplo.com')),
  '["/", "/catalogo", "/contacto", "/categoria/ca000000-0000-0000-0000-000000000001", "/categoria/ca000000-0000-0000-0000-000000000002", "/producto/a1000000-0000-0000-0000-000000000005"]'::jsonb,
  'reactivada: el sitemap vuelve a listar sus URLs visibles'
);

select * from finish();
rollback;
