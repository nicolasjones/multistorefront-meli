-- F-TDA-21 (MSF-279, épica MSF-149, spec 20270125-100000-tienda-seo-legal-y-estados): datos para
-- buscadores de la tienda pública. FR-020 (metadatos), FR-023 (sitemap), FR-025 (desactivada = desconocida).
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.seo_tienda_por_dominio -> `publico` (función de lectura anónima); `publico` sigue SIN tablas.
--   * publico.sitemap_por_dominio    -> `publico` (ídem).
--
-- Reglas: SECURITY DEFINER (saltea a propósito la RLS de dominio.* y filtra por host y empresa.activa),
-- stable, search_path vacío, lista blanca (nunca organizacion_id, costos ni existencias). Host desconocido,
-- inválido y empresa desactivada devuelven lo mismo: null. Al reactivar la empresa vuelven a responder sin
-- otra acción.
--   * seo_tienda_por_dominio: { dominio (canónico de dominio.tiendas), nombre, descripcion (subtítulo
--     publicado o «<nombre> · tienda online»), logo_ruta, indexable } — `indexable` es true por ahora:
--     punto de extensión del «no indexar» de borrador / vista previa (MSF-133).
--   * sitemap_por_dominio: { dominio, urls[{ruta, modificado}] } con inicio, catálogo, contacto, categorías
--     visibles y productos efectivamente visibles (private.catalogo_tienda_efectivo), hasta c_tope (50.000,
--     el máximo del protocolo sitemaps.org, constante única). `modificado` es una fecha AAAA-MM-DD o null.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.seo_tienda_por_dominio(text);
--   drop function publico.sitemap_por_dominio(text);

create or replace function publico.seo_tienda_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'dominio', ti.dominio,
    'nombre', e.nombre,
    'descripcion', coalesce(nullif(btrim(c.subtitulo), ''), e.nombre || ' · tienda online'),
    'logo_ruta', i.logo_ruta,
    'indexable', true
  )
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
    left join dominio.tienda_contenido c on c.empresa_id = e.id
    left join dominio.tienda_identidad i on i.empresa_id = e.id
   where ti.dominio = private.normalizar_host(host) and e.activa;
$$;

revoke execute on function publico.seo_tienda_por_dominio(text) from public, anon;
grant execute on function publico.seo_tienda_por_dominio(text) to anon, authenticated;

comment on function publico.seo_tienda_por_dominio(text) is
  'F-TDA-21: datos SEO de la tienda por host (dominio canónico, nombre, descripción, logo_ruta e indexable). Null idéntico si el dominio no existe o la empresa está desactivada. Lista blanca.';

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

  return jsonb_build_object(
    'dominio', v_dominio,
    'urls', coalesce((
      select jsonb_agg(jsonb_build_object('ruta', u.ruta, 'modificado', u.modificado) order by u.grupo, u.orden, u.ruta)
        from (
          select * from (
            select 0 as grupo, 0 as orden, '/'::text as ruta, null::text as modificado
            union all select 0, 1, '/catalogo', null
            union all select 0, 2, '/contacto', null
            union all
            select 1, c.posicion, '/categoria/' || c.id::text, to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD')
              from dominio.categorias c
              left join dominio.categorias_tienda ct on ct.empresa_id = v_empresa and ct.categoria_id = c.id
              left join dominio.categorias_tienda cp on cp.empresa_id = v_empresa and cp.categoria_id = c.padre_id
             where c.organizacion_id = v_org and coalesce(ct.visible, true) and coalesce(cp.visible, true)
            union all
            select 2, 0, '/producto/' || x.producto_id::text, to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD')
              from private.catalogo_tienda_efectivo(v_empresa) x
              join dominio.productos p on p.id = x.producto_id and p.organizacion_id = v_org
             where x.efectivo
          ) t
          order by t.grupo, t.orden, t.ruta
          limit c_tope
        ) u), '[]'::jsonb)
  );
end;
$$;

revoke execute on function publico.sitemap_por_dominio(text) from public, anon;
grant execute on function publico.sitemap_por_dominio(text) to anon, authenticated;

comment on function publico.sitemap_por_dominio(text) is
  'F-TDA-21: URLs indexables de la tienda por host (inicio, catálogo, contacto, categorías visibles y productos efectivamente visibles; tope 50.000) con fecha de modificación. Null idéntico si el dominio no existe o la empresa está desactivada. Lista blanca.';
