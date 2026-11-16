-- MSF-846 (parte A): publico.busqueda_pagina_por_dominio superaba el statement_timeout de 3 s (57014) en dev
-- (q=cable: 2,4–3,6 s con 2.204 productos; el catálogo sin búsqueda ~130 ms). Causa medida con EXPLAIN/tiempos:
-- la versión de 20270221100005 calculaba precio vigente (private.precio_vigente_empresa, ~7 ms por producto con
-- el servidor cargado) y disponibilidad para TODOS los productos efectivos antes de filtrar por texto.
--
-- Cambio (solo cuerpo de la función; firma, grants, claves de salida, orden 'relevancia', rate limit y
-- `espera_segundos` idénticos): se materializa UNA vez el set de coincidencias por texto (sin precio ni
-- disponibilidad); el precio solo se calcula para todas las coincidencias cuando el filtro de precio máximo o
-- el orden por precio lo exigen, la disponibilidad solo con solo_con_stock, y en el caso común (relevancia)
-- precio, precio_anterior, disponibilidad e imagen se calculan solo para los 24 productos de la página.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla ni índice; la función vive en `publico`.
-- Migración aditiva e idempotente (create or replace). Reversión (migración posterior): restaurar el cuerpo de
-- 20270221100005_tienda_precio_anterior_home_busqueda.sql (publico.busqueda_pagina_por_dominio).

create or replace function publico.busqueda_pagina_por_dominio(
  host text,
  q text,
  categoria uuid default null,
  solo_con_stock boolean default false,
  precio_max numeric default null,
  orden text default 'relevancia',
  pagina integer default 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tamano constant integer := 24;
  c_minimo constant integer := 2;
  v_empresa uuid;
  v_q text := private.normalizar_busqueda(left(coalesce(q, ''), 100));
  v_umbral real := private.umbral_similitud_busqueda();
  v_orden text := case when orden in ('relevancia', 'precio_asc', 'precio_desc') then orden else 'relevancia' end;
  v_pagina integer := greatest(coalesce(pagina, 1), 1);
  v_max numeric := case when precio_max is null or precio_max <= 0 then null else precio_max end;
  v_solo boolean := coalesce(solo_con_stock, false);
  v_precio_todos boolean;
  v_limite jsonb;
  v_resultado jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  -- Texto vacío o corto: sin resultados, sin consultar ni contar para el límite.
  if char_length(v_q) < c_minimo then
    return jsonb_build_object('limitado', false, 'espera_segundos', null, 'total', 0, 'pagina', v_pagina,
                              'tamano', c_tamano, 'categorias', '[]'::jsonb, 'productos', '[]'::jsonb);
  end if;

  v_limite := private.registrar_pedido_publico(private.visitante_publico(host), private.limite_busquedas_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('limitado', true, 'espera_segundos', v_limite -> 'espera_segundos', 'total', 0,
                              'pagina', v_pagina, 'tamano', c_tamano, 'categorias', '[]'::jsonb,
                              'productos', '[]'::jsonb);
  end if;

  -- El precio decide filtro u orden solo con precio máximo u orden por precio.
  v_precio_todos := v_max is not null or v_orden <> 'relevancia';

  with coincidencias as materialized (
    select x.producto_id, x.nombre, x.categoria_id, x.destacado,
           greatest(extensions.word_similarity(v_q, n.norm), extensions.similarity(n.norm, v_q))
             + case when strpos(n.norm, v_q) = 1 then 0.5 when strpos(n.norm, v_q) > 1 then 0.25 else 0 end as puntaje
      from private.catalogo_tienda_efectivo(v_empresa) x
      cross join lateral (select private.normalizar_busqueda(x.nombre) as norm) n
     where x.efectivo and (categoria is null or x.categoria_id = categoria)
       and (strpos(n.norm, v_q) > 0
            or extensions.word_similarity(v_q, n.norm) >= v_umbral
            or extensions.similarity(n.norm, v_q) >= v_umbral)
  ),
  prod as materialized (
    select c.*,
           case when v_precio_todos
                then (select pv.precio from private.precio_vigente_empresa(c.producto_id, v_empresa, now()) pv)
           end as precio,
           case when v_solo then private.disponible_publico(c.producto_id) end as disponible
      from coincidencias c
  ),
  filtrado as (
    select * from prod f
     where (not v_solo or f.disponible)
       and (v_max is null or (f.precio is not null and f.precio <= v_max))
  ),
  ordenado as (
    select f.*,
           row_number() over (
             order by
               case when v_orden = 'relevancia' then f.puntaje end desc,
               case when v_orden <> 'relevancia' then (case when f.precio is null then 1 else 0 end) end,
               case when v_orden = 'precio_asc' then f.precio end asc,
               case when v_orden = 'precio_desc' then f.precio end desc,
               lower(f.nombre), f.producto_id) as rn
      from filtrado f
  ),
  pagina_ord as (
    select o.producto_id, o.nombre, o.categoria_id, o.destacado, o.rn
      from ordenado o
     where o.rn > (v_pagina - 1)::bigint * c_tamano and o.rn <= v_pagina::bigint * c_tamano
  )
  select jsonb_build_object(
           'limitado', false,
           'espera_segundos', null,
           'total', (select count(*) from filtrado),
           'pagina', v_pagina,
           'tamano', c_tamano,
           'categorias', coalesce(publico.categorias_por_dominio(host) -> 'categorias', '[]'::jsonb),
           'productos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.producto_id,
                      'nombre', g.nombre,
                      'precio', pv.precio,
                      'precio_anterior', pv.precio_anterior,
                      'disponible', private.disponible_publico(g.producto_id),
                      'imagen', (select i.ruta from dominio.producto_imagenes i
                                  where i.producto_id = g.producto_id order by i.posicion limit 1),
                      'categoria_id', g.categoria_id,
                      'destacado', g.destacado
                    ) order by g.rn)
               from pagina_ord g
               cross join lateral private.precio_vigente_empresa(g.producto_id, v_empresa, now()) pv), '[]'::jsonb)
         )
    into v_resultado;
  return v_resultado;
end;
$$;

revoke execute on function publico.busqueda_pagina_por_dominio(text, text, uuid, boolean, numeric, text, integer) from public, anon;
grant execute on function publico.busqueda_pagina_por_dominio(text, text, uuid, boolean, numeric, text, integer) to anon, authenticated;

comment on function publico.busqueda_pagina_por_dominio(text, text, uuid, boolean, numeric, text, integer) is
  'F-TDA-15 + MSF-846: página de 24 de resultados de búsqueda por host, con la forma y los filtros de catalogo_pagina_por_dominio con el precio vigente y precio_anterior si hay promoción, restringida a los productos que coinciden con q (sin tildes ni mayúsculas, con tolerancia a errores de tipeo). Relevancia por similitud. Precio y disponibilidad se calculan solo donde filtro u orden los exigen y para la página. Cuenta para el límite de pedidos. Lista blanca de campos; null si el dominio no existe o la empresa está desactivada.';
