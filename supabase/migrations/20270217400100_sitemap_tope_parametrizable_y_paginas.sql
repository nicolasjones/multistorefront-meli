-- MSF-149 (hallazgos 7 y 10 de la revisión independiente): `publico.sitemap_por_dominio` (migración
-- 20270212100004, ya aplicada) se reemplaza con la MISMA firma `(host text) returns jsonb`.
--   * El tope de URLs pasa a un parámetro de una función privada (`private.sitemap_urls_tienda`), así un pgTAP
--     de comportamiento lo prueba con una cota baja. La pública sigue usando 50.000 (máximo de sitemaps.org).
--   * Con el tope, el recorte es por prioridad (inicio/catálogo/contacto/páginas, luego categorías, luego
--     productos): si se excede se pierden productos, nunca categorías. Se agrega `truncado` (boolean) a la
--     respuesta para que la Edge Function lo registre en el log. Más de 50.000 URLs se TRUNCA: un sitemap
--     index queda fuera de alcance (no hay hoy tiendas de ese tamaño) y se documenta.
--   * Las páginas de contenido visibles (`/pagina/<slug>`, dominio.tienda_paginas.visible) entran al sitemap:
--     son públicas, están enlazadas desde el menú y el pie y su ruta monta `CabeceraSeo` indexable.
--
-- Esquemas (Principio VII): sin tablas; función privada de soporte en `private`, pública en `publico`.
-- Migración aditiva. Reversión (migración posterior): restaurar la definición de 20270212100004 de
-- `publico.sitemap_por_dominio` y `drop function private.sitemap_urls_tienda(uuid, uuid, integer);`

create or replace function private.sitemap_urls_tienda(p_empresa uuid, p_org uuid, p_tope integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'urls', coalesce(jsonb_agg(jsonb_build_object('ruta', x.ruta, 'modificado', x.modificado) order by x.rn)
                       filter (where x.rn <= greatest(p_tope, 0)), '[]'::jsonb),
    'truncado', coalesce(count(*) > greatest(p_tope, 0), false)
  )
  from (
    select t.ruta, t.modificado, row_number() over (order by t.grupo, t.orden, t.ruta) as rn
      from (
        select 0 as grupo, 0 as orden, '/'::text as ruta, null::text as modificado
        union all select 0, 1, '/catalogo', null
        union all select 0, 2, '/contacto', null
        union all
        select 0, 3, '/pagina/' || pg.slug, to_char(pg.updated_at at time zone 'UTC', 'YYYY-MM-DD')
          from dominio.tienda_paginas pg
         where pg.empresa_id = p_empresa and pg.organizacion_id = p_org and pg.visible
        union all
        select 1, c.posicion, '/categoria/' || c.id::text, to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD')
          from dominio.categorias c
          left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
          left join dominio.categorias_tienda cp on cp.empresa_id = p_empresa and cp.categoria_id = c.padre_id
         where c.organizacion_id = p_org and coalesce(ct.visible, true) and coalesce(cp.visible, true)
        union all
        select 2, 0, '/producto/' || e.producto_id::text, to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD')
          from private.catalogo_tienda_efectivo(p_empresa) e
          join dominio.productos p on p.id = e.producto_id and p.organizacion_id = p_org
         where e.efectivo
      ) t
     order by t.grupo, t.orden, t.ruta
     limit greatest(p_tope, 0) + 1
  ) x;
$$;

revoke execute on function private.sitemap_urls_tienda(uuid, uuid, integer) from public, anon, authenticated;

comment on function private.sitemap_urls_tienda(uuid, uuid, integer) is
  'MSF-149: URLs del sitemap de una tienda con tope parametrizable; devuelve {urls, truncado}. Recorta por prioridad (estáticas y páginas, categorías, productos). Solo la llama publico.sitemap_por_dominio.';

create or replace function publico.sitemap_por_dominio(host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tope constant integer := 50000;
  v_empresa uuid;
  v_org uuid;
  v_dominio text;
begin
  select e.id, e.organizacion_id, ti.dominio into v_empresa, v_org, v_dominio
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;
  return jsonb_build_object('dominio', v_dominio) || private.sitemap_urls_tienda(v_empresa, v_org, c_tope);
end;
$$;

revoke execute on function publico.sitemap_por_dominio(text) from public, anon;
grant execute on function publico.sitemap_por_dominio(text) to anon, authenticated;

comment on function publico.sitemap_por_dominio(text) is
  'F-TDA-21: URLs indexables de la tienda por host (inicio, catálogo, contacto, páginas visibles, categorías visibles y productos efectivamente visibles; tope 50.000 con recorte por prioridad y bandera truncado) con fecha de modificación. Null idéntico si el dominio no existe o la empresa está desactivada. Lista blanca.';
