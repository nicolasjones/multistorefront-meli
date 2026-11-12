-- MSF-825 (bugs MSF-826, MSF-827, MSF-830, MSF-832): la tienda pública de la demo no cargaba el catálogo
-- ni las categorías (HTTP 500 «canceling statement due to statement timeout» bajo `anon`, tope de 3 s) y
-- mostraba ~170 categorías, muchas vacías.
--
-- Causas medidas en dev con 2.204 productos publicados por tienda:
--   * publico.categorias_por_dominio: el conteo (`conteo`) se evaluaba una vez POR CATEGORÍA (subconsulta
--     correlacionada sobre un CTE que el planificador reescribe en línea), o sea ~170 llamadas a
--     private.catalogo_tienda_efectivo: 2,5 s con la caché tibia y más de 3 s en frío.
--   * publico.catalogo_pagina_por_dominio: calculaba el precio de TODOS los productos con
--     private.precio_vigente_empresa antes de paginar: 44 s (≈ 20 ms por producto; las funciones
--     subyacentes, llamadas directo, tardan 75 ms en total).
--
-- Cambios (aditivos; mismas firmas, mismo contrato de campos):
--   1. categorias_por_dominio: conteo materializado, una sola pasada; el conteo incluye las subcategorías
--      (la raíz «Consolas» suma sus hijas) y solo se devuelven las categorías con productos visibles en
--      la tienda (FR-001 de MSF-827). Las que se quedan sin productos desaparecen de menú, home y filtros.
--   2. catalogo_pagina_por_dominio: el precio se calcula con las mismas funciones y la misma regla que
--      precio_vigente_empresa, pero directo (sin la función envoltorio); y filtrar por una categoría
--      incluye sus subcategorías, para que el conteo de la tarjeta coincida con el listado al entrar.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla; `publico` sigue SIN tablas.
-- Seguridad: igual que antes (SECURITY DEFINER, search_path vacío, lista blanca de campos, filtro por
-- host y empresa.activa). El subárbol de categorías se limita a la organización de la tienda.
--
-- Reversión: volver a aplicar las definiciones de 20261023150000_tienda_categorias_publicas.sql y
-- 20270221100004_tienda_precio_anterior.sql.

create or replace function publico.categorias_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive t as (
    select e.id as empresa_id, e.organizacion_id
      from dominio.tiendas ti
      join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
     where ti.dominio = private.normalizar_host(host) and e.activa
  ),
  conteo as materialized (
    select x.categoria_id, count(*) as n
      from t, lateral private.catalogo_tienda_efectivo(t.empresa_id) x
     where x.efectivo and x.categoria_id is not null
     group by x.categoria_id
  ),
  cat as materialized (
    select c.id, c.nombre, c.padre_id, c.posicion
      from t
      join dominio.categorias c on c.organizacion_id = t.organizacion_id
      left join dominio.categorias_tienda ct on ct.empresa_id = t.empresa_id and ct.categoria_id = c.id
      left join dominio.categorias_tienda cp on cp.empresa_id = t.empresa_id and cp.categoria_id = c.padre_id
     where coalesce(ct.visible, true) and coalesce(cp.visible, true)
  ),
  arbol(raiz, id, nivel) as (
    select c.id, c.id, 0 from cat c
    union all
    select a.raiz, c.id, a.nivel + 1 from arbol a join cat c on c.padre_id = a.id where a.nivel < 10
  ),
  total as (
    select a.raiz as id, sum(k.n) as n
      from arbol a join conteo k on k.categoria_id = a.id
     group by a.raiz
  )
  select case when not exists (select 1 from t) then null else jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nombre', c.nombre,
               'padre_id', c.padre_id,
               'productos', tt.n
             ) order by (c.padre_id is not null), c.posicion, c.id)
        from cat c
        join total tt on tt.id = c.id), '[]'::jsonb)
  ) end;
$$;

revoke execute on function publico.categorias_por_dominio(text) from public;
grant execute on function publico.categorias_por_dominio(text) to anon, authenticated;

comment on function publico.categorias_por_dominio(text) is
  'MSF-386/MSF-825: categorías visibles de la tienda por host con productos efectivamente visibles (id, nombre, padre_id y conteo que incluye las subcategorías), en el orden de Catálogo. Las categorías sin productos no se devuelven. Null si el dominio no existe o la empresa está desactivada. Sin columnas internas.';

create or replace function publico.catalogo_pagina_por_dominio(
  host text,
  categoria uuid default null,
  solo_con_stock boolean default false,
  precio_max numeric default null,
  orden text default 'relevancia',
  pagina integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tamano constant integer := 24;
  v_empresa uuid;
  v_org uuid;
  v_orden text := case when orden in ('relevancia', 'precio_asc', 'precio_desc') then orden else 'relevancia' end;
  v_pagina integer := greatest(coalesce(pagina, 1), 1);
  v_max numeric := case when precio_max is null or precio_max <= 0 then null else precio_max end;
  v_solo boolean := coalesce(solo_con_stock, false);
  v_precio_global boolean := v_orden <> 'relevancia' or v_max is not null;
  v_resultado jsonb;
begin
  select e.id, e.organizacion_id into v_empresa, v_org
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  -- Los productos de una categoría oculta o ajena no son «efectivos»: la lista sale vacía sin error.
  -- Filtrar por una categoría incluye sus subcategorías (el subárbol queda dentro de la organización).
  with recursive sub(id, nivel) as (
    select c.id, 0 from dominio.categorias c where c.id = categoria and c.organizacion_id = v_org
    union all
    select c.id, s.nivel + 1 from dominio.categorias c join sub s on c.padre_id = s.id
     where c.organizacion_id = v_org and s.nivel < 10
  ),
  prod as (
    select x.producto_id, x.nombre, x.categoria_id, x.destacado,
           pg.precio,
           private.disponible_publico(x.producto_id) as disponible
      from private.catalogo_tienda_efectivo(v_empresa) x
      -- El precio vigente (con promoción) solo se calcula para TODOS los productos cuando el filtro de precio o
      -- el orden por precio lo necesitan; con el orden «relevancia» y sin tope de precio se calcula solo para
      -- los 24 de la página (CTE `pagina`). Mismo cálculo y regla que private.precio_vigente_empresa, sin la
      -- función envoltorio (≈ 20 ms por producto); `offset 0` evita que el planificador repita las llamadas.
      cross join lateral (
        select case when v_precio_global then private.precio_final_publico(x.producto_id, v_empresa) end as n,
               case when v_precio_global then private.promocion_vigente(x.producto_id, v_empresa, now()) end as pr
        offset 0
      ) bg
      cross join lateral (
        select case when not v_precio_global or bg.n is null then null
                    when bg.pr is null then bg.n
                    else private.precio_con_iva_visible(x.producto_id, v_empresa, bg.pr) end as precio
      ) pg
     where x.efectivo and (categoria is null or x.categoria_id in (select s.id from sub s))
  ),
  filtrado as (
    select * from prod f
     where (not v_solo or f.disponible)
       and (v_max is null or (f.precio is not null and f.precio <= v_max))
  ),
  pagina_ord as (
    select f.*
      from filtrado f
     order by
       case when v_orden = 'relevancia' then (case when f.destacado then 0 else 1 end)
            else (case when f.precio is null then 1 else 0 end) end,
       case when v_orden = 'precio_asc' then f.precio end asc,
       case when v_orden = 'precio_desc' then f.precio end desc,
       lower(f.nombre), f.producto_id
     offset ((v_pagina - 1)::bigint * c_tamano) limit c_tamano
  ),
  -- Precio vigente y precio anterior de los productos de la página (misma regla que arriba).
  pagina as (
    select g.producto_id, g.nombre, g.categoria_id, g.destacado, g.disponible, g.precio as orden_precio,
           pv.precio, pv.precio_anterior
      from pagina_ord g
      cross join lateral (
        select private.precio_final_publico(g.producto_id, v_empresa) as n,
               private.promocion_vigente(g.producto_id, v_empresa, now()) as pr
        offset 0
      ) b
      cross join lateral (
        select case when b.n is null then null
                    when b.pr is null then b.n
                    else private.precio_con_iva_visible(g.producto_id, v_empresa, b.pr) end as precio,
               case when b.n is null or b.pr is null then null else b.n end as precio_anterior
      ) pv
  )
  select jsonb_build_object(
           'total', (select count(*) from filtrado),
           'pagina', v_pagina,
           'tamano', c_tamano,
           'categorias', coalesce(publico.categorias_por_dominio(host) -> 'categorias', '[]'::jsonb),
           'productos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.producto_id,
                      'nombre', g.nombre,
                      'precio', g.precio,
                      'precio_anterior', g.precio_anterior,
                      'disponible', g.disponible,
                      'imagen', (select i.ruta from dominio.producto_imagenes i
                                  where i.producto_id = g.producto_id order by i.posicion limit 1),
                      'categoria_id', g.categoria_id,
                      'destacado', g.destacado
                    ) order by
                      case when v_orden = 'relevancia' then (case when g.destacado then 0 else 1 end)
                           else (case when g.orden_precio is null then 1 else 0 end) end,
                      case when v_orden = 'precio_asc' then g.orden_precio end asc,
                      case when v_orden = 'precio_desc' then g.orden_precio end desc,
                      lower(g.nombre), g.producto_id)
               from pagina g), '[]'::jsonb)
         )
    into v_resultado;
  return v_resultado;
end;
$$;

revoke execute on function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer) from public;
grant execute on function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer) to anon, authenticated;
