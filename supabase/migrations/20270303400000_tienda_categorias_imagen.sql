-- MSF-841 (tramo A, punto 4): foto de categoría en publico.categorias_por_dominio.
--
-- El prototipo (MJC_*, SJ_*) muestra una foto por categoría en la home y el menú. No hay campo de
-- configuración: la foto es la imagen principal (la de menor `posicion`) de UN producto efectivamente
-- visible de esa categoría o de sus subcategorías; `null` si ninguno tiene imagen. Se devuelve la RUTA del
-- bucket `productos-imagenes` (el front la firma como hace con las fotos de los productos).
-- Elección determinista: el primer producto por nombre (sin distinguir mayúsculas) y, en empate, por id.
--
-- RENDIMIENTO (crítico): la función es pública para `anon` con statement_timeout de 3 s y ya tuvo un bug de
-- timeout (MSF-825, 20270228300400; .specify/bugs/tienda-demo-categorias-y-catalogo-timeout/). Por eso la
-- foto se calcula en UNA pasada y sin subconsultas correlacionadas por fila ni funciones por producto:
--   1. `efectivos` (materializado): los productos visibles de la tienda, calculados UNA sola vez con
--      private.catalogo_tienda_efectivo; de ahí salen el conteo (antes era su propio CTE) y las fotos.
--   2. `img_producto` (materializado): `distinct on (producto_id)` sobre `producto_imagenes` unido a
--      `efectivos`: la imagen principal de cada producto, una pasada por el índice (producto_id, posicion).
--   3. `imagen` (materializado): `distinct on (raiz)` sobre el árbol recursivo ya calculado (`arbol`) unido
--      a `efectivos` e `img_producto`: una foto por categoría. Son O(productos × profundidad) filas.
--   4. El resultado final solo hace un `left join` por id a `imagen`.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla; `publico` sigue SIN tablas.
-- Seguridad: igual que antes (SECURITY DEFINER, search_path vacío, lista blanca de campos, filtro por host y
-- empresa.activa, grants sin cambios). La ruta de la imagen sale de productos de la organización de la tienda.
-- Aditiva: mismo nombre y firma; solo agrega la clave `imagen` a cada categoría.
--
-- Reversión: volver a aplicar la definición de 20270228300400_tienda_publica_rendimiento_y_categorias.sql.

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
  efectivos as materialized (
    select x.producto_id, x.nombre, x.categoria_id
      from t, lateral private.catalogo_tienda_efectivo(t.empresa_id) x
     where x.efectivo and x.categoria_id is not null
  ),
  conteo as materialized (
    select e.categoria_id, count(*) as n
      from efectivos e
     group by e.categoria_id
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
  ),
  img_producto as materialized (
    select distinct on (pi.producto_id) pi.producto_id, pi.ruta
      from efectivos e
      join dominio.producto_imagenes pi on pi.producto_id = e.producto_id
     order by pi.producto_id, pi.posicion
  ),
  imagen as materialized (
    select distinct on (a.raiz) a.raiz as id, ip.ruta
      from arbol a
      join efectivos e on e.categoria_id = a.id
      join img_producto ip on ip.producto_id = e.producto_id
     order by a.raiz, lower(e.nombre), e.producto_id
  )
  select case when not exists (select 1 from t) then null else jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nombre', c.nombre,
               'padre_id', c.padre_id,
               'productos', tt.n,
               'imagen', im.ruta
             ) order by (c.padre_id is not null), c.posicion, c.id)
        from cat c
        join total tt on tt.id = c.id
        left join imagen im on im.id = c.id), '[]'::jsonb)
  ) end;
$$;

revoke execute on function publico.categorias_por_dominio(text) from public;
grant execute on function publico.categorias_por_dominio(text) to anon, authenticated;

comment on function publico.categorias_por_dominio(text) is
  'MSF-386/MSF-825/MSF-841: categorías visibles de la tienda por host con productos efectivamente visibles (id, nombre, padre_id, conteo que incluye las subcategorías e imagen: ruta de la imagen principal de un producto visible de la categoría o sus subcategorías, null si no hay), en el orden de Catálogo. Las categorías sin productos no se devuelven. Null si el dominio no existe o la empresa está desactivada. Sin columnas internas.';
