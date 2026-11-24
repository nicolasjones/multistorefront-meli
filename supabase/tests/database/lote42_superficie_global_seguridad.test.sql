-- Lote 42 (MSF-669, MSF-899/917): pruebas globales de seguridad que faltaban.
--   1. Toda función `security definer` de los esquemas propios fija `search_path = ''` (nada que sombrear).
--   2. `anon` ejecuta en `publico` solo una lista cerrada de RPC de la tienda pública: una función nueva abierta a
--      anon rompe este test y obliga a decidirlo a propósito (era lo que dejó pasar MSF-653).
--   3. `anon` no tiene USAGE sobre `private`, `dominio` ni `analitica`.
begin;

select plan(4);

select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'private', 'publico', 'dominio', 'analitica')
      and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']))
  , '',
  'toda función security definer de public/private/publico/dominio/analitica fija search_path vacío'
);

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p
    where p.pronamespace = 'publico'::regnamespace
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proname <> all (array['analitica_por_dominio', 'busqueda_pagina_por_dominio', 'capacidades_opiniones_por_dominio', 'capacidades_tienda_por_dominio', 'catalogo_pagina_por_dominio', 'catalogo_visible_por_dominio', 'categorias_por_dominio', 'confirmar_newsletter', 'contacto_por_dominio', 'contenido_por_dominio', 'destacados_por_dominio', 'enviar_consulta_contacto', 'enviar_lista_pedido', 'estado_tienda_por_dominio', 'identidad_por_dominio', 'imagen_publica', 'legal_por_dominio', 'lista_pedido_por_dominio', 'newsletter_por_dominio', 'opiniones_producto_por_dominio', 'pagina_por_dominio', 'paginas_por_dominio', 'producto_por_dominio', 'redireccion_por_dominio', 'registrar_consulta_whatsapp', 'relacionados_por_dominio', 'seo_tienda_por_dominio', 'sitemap_por_dominio', 'sugerencias_busqueda_por_dominio', 'suscribirse_newsletter', 'tienda_por_dominio']))
  , '',
  'anon solo ejecuta en publico las RPC de la lista cerrada de la tienda pública'
);

select is(
  (select count(*)::int
     from unnest(array['private', 'dominio', 'analitica']) e(esquema)
    where has_schema_privilege('anon', e.esquema, 'usage')),
  0,
  'anon no tiene USAGE sobre private, dominio ni analitica (sus funciones no son alcanzables aunque hereden EXECUTE de PUBLIC)'
);

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'publico'::regnamespace and p.proname in ('crear_consulta_publica', 'registrar_interes_whatsapp')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0,
  'crear_consulta_publica y registrar_interes_whatsapp siguen cerradas a anon y authenticated'
);

select * from finish();
rollback;
