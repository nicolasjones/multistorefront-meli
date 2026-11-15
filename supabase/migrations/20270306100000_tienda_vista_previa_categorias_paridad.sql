-- MSF-846 (hallazgo QA 4): public.vista_previa_tienda cuenta y filtra las categorías igual que
-- publico.categorias_por_dominio (20270303400000): `productos` es el total del ÁRBOL (la categoría y sus
-- descendientes, sobre los productos efectivos del borrador) y las categorías sin productos se omiten, como en la
-- tienda pública. Antes devolvía el conteo directo (las categorías padre decían «0 productos») y listaba las vacías,
-- con lo que la selección de las 6 principales (lib/tiendaCategorias.ts, que ordena por `productos`) difería.
-- El orden de salida no cambia (raíces primero, posicion, id); el front ya aplica la misma regla de principales.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla. Aditiva: misma firma y mismas claves; SECURITY
-- DEFINER, search_path vacío, mismos grants (solo authenticated, sin anon) y misma guardia. Idempotente (create or
-- replace). Reversión (migración posterior): restaurar el cuerpo de 20270305100100_tienda_vista_previa_categorias_imagen.sql.

create or replace function public.vista_previa_tienda(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_tope constant integer := 8;
  v_org uuid := (select private.organizacion_id());
  v_nombre text;
  v_activa boolean;
  v_b dominio.tienda_borrador;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede ver la vista previa de esta tienda' using errcode = '42501';
  end if;
  select e.nombre, e.activa into v_nombre, v_activa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  select * into v_b from dominio.tienda_borrador where empresa_id = p_empresa;

  return (
    with recursive efectivos as materialized (
      select x.producto_id, x.nombre, x.categoria_id, x.destacado
        from private.catalogo_tienda_efectivo_borrador(p_empresa, v_b.catalogo) x
       where x.efectivo
    ),
    conteo as materialized (
      select e.categoria_id, count(*) as n from efectivos e where e.categoria_id is not null group by e.categoria_id
    ),
    elegidos as (
      select f.* from efectivos f where f.destacado order by lower(f.nombre), f.producto_id limit c_tope
    ),
    bc as (
      select x.id, x.visible
        from jsonb_to_recordset(coalesce(v_b.catalogo->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
    ),
    cat as (
      select c.id, c.nombre, c.padre_id, c.posicion
        from dominio.categorias c
        left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
        left join dominio.categorias_tienda cp on cp.empresa_id = p_empresa and cp.categoria_id = c.padre_id
        left join bc bcc on bcc.id = c.id
        left join bc bcp on bcp.id = c.padre_id
       where c.organizacion_id = v_org
         and coalesce(bcc.visible, ct.visible, true)
         and coalesce(bcp.visible, cp.visible, true)
    ),
    -- MSF-846: la foto de cada categoría sale como en publico.categorias_por_dominio (20270303400000): la
    -- imagen principal de un producto efectivo de la categoría o de sus subcategorías, en una sola pasada.
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
    select jsonb_build_object(
      'empresa_nombre', v_nombre,
      'en_linea', v_activa,
      'identidad', coalesce(v_b.identidad, private.identidad_vivo(p_empresa)),
      'contenido', coalesce(v_b.contenido, private.contenido_vivo(p_empresa)),
      'hay_productos', exists (select 1 from efectivos),
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
          left join imagen im on im.id = c.id), '[]'::jsonb),
      'destacados', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', g.producto_id,
                 'nombre', g.nombre,
                 'precio', private.precio_final_publico(g.producto_id, p_empresa),
                 'disponible', private.disponible_publico(g.producto_id),
                 'imagen', (select i.ruta from dominio.producto_imagenes i
                             where i.producto_id = g.producto_id order by i.posicion limit 1),
                 'categoria_id', g.categoria_id
               ) order by lower(g.nombre), g.producto_id)
          from elegidos g), '[]'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.vista_previa_tienda(uuid) from public, anon;
grant execute on function public.vista_previa_tienda(uuid) to authenticated;

comment on function public.vista_previa_tienda(uuid) is
  'F-TDA-06 + MSF-846: la home de la tienda con el borrador sobre lo publicado (identidad, contenido, categorías con su imagen, destacados con precio final). Las categorías cuentan el árbol y omiten las vacías, como la tienda pública. Lista blanca: sin costos, stock exacto ni proveedor. Solo lectura; edición en Empresas.';
