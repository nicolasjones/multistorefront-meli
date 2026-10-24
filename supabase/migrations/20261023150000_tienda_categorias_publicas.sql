-- MSF-386 · F-TDA-11 (épica MSF-167, spec 20261023-120000-tienda-catalogo-y-ficha, FR-001, FR-002, FR-060):
-- categorías visibles de la tienda para el menú y el pie del front público.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.categorias_por_dominio -> `publico` (función de lectura anónima); `publico` sigue SIN tablas.
--
-- Reglas: SECURITY DEFINER (saltea a propósito la RLS de dominio.* y filtra por el host y
-- empresa.activa), stable, search_path vacío, lista blanca de campos (nunca organizacion_id, costos ni
-- columnas internas). Host desconocido, inválido y empresa desactivada devuelven lo mismo: null.
-- Categorías visibles = la categoría y su padre (misma regla que publico.catalogo_visible_por_dominio),
-- en el orden de Catálogo (raíces primero, luego posición). `productos` cuenta solo productos
-- efectivamente visibles (private.catalogo_tienda_efectivo) asignados directamente a la categoría.
--
-- Rendimiento: el conteo se agrega una sola vez (group by) y se une por categoría, O(productos + categorías).
-- Sin caché a propósito: es la misma exposición anónima que publico.catalogo_visible_por_dominio (una
-- llamada por carga de página); si el tráfico lo exige, se cachea en el borde o con una vista materializada.
--
-- Migración aditiva. Reversión:
--   drop function publico.categorias_por_dominio(text);

create or replace function publico.categorias_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select e.id as empresa_id, e.organizacion_id
      from dominio.tiendas ti
      join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
     where ti.dominio = private.normalizar_host(host) and e.activa
  ),
  prod as (
    select x.categoria_id
      from t, lateral private.catalogo_tienda_efectivo(t.empresa_id) x
     where x.efectivo and x.categoria_id is not null
  ),
  conteo as (
    select categoria_id, count(*) as n from prod group by categoria_id
  ),
  cat as (
    select c.id, c.nombre, c.padre_id, c.posicion
      from t
      join dominio.categorias c on c.organizacion_id = t.organizacion_id
      left join dominio.categorias_tienda ct on ct.empresa_id = t.empresa_id and ct.categoria_id = c.id
      left join dominio.categorias_tienda cp on cp.empresa_id = t.empresa_id and cp.categoria_id = c.padre_id
     where coalesce(ct.visible, true) and coalesce(cp.visible, true)
  )
  select case when not exists (select 1 from t) then null else jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nombre', c.nombre,
               'padre_id', c.padre_id,
               'productos', coalesce((select k.n from conteo k where k.categoria_id = c.id), 0)
             ) order by (c.padre_id is not null), c.posicion, c.id)
        from cat c), '[]'::jsonb)
  ) end;
$$;

revoke execute on function publico.categorias_por_dominio(text) from public;
grant execute on function publico.categorias_por_dominio(text) to anon, authenticated;

comment on function publico.categorias_por_dominio(text) is
  'MSF-386: categorías visibles de la tienda por host (id, nombre, padre_id y conteo de productos efectivamente visibles), en el orden de Catálogo. Null si el dominio no existe o la empresa está desactivada. Sin columnas internas.';
