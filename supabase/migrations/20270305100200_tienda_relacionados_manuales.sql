-- MSF-846 (parte A, punto 3): la ficha pública usa los «Productos relacionados» manuales del panel.
-- Hasta ahora publico.relacionados_por_dominio (20270212100003) tomaba hasta 4 de la misma categoría e ignoraba
-- dominio.producto_relacionados (F-CAT-18, 20270220120100).
--
-- Regla nueva (mismo contrato de salida: { productos: [{ id, nombre, precio, disponible, imagen, categoria_id }] }):
--   1. Primero los relacionados manuales del producto, en su orden (`orden`, desempate por id), hasta 4, solo los efectivamente
--      visibles en ESA tienda (private.catalogo_tienda_efectivo) y de la misma organización que la empresa.
--   2. Si faltan para llegar a 4, se completa con la regla anterior (misma categoría, destacados primero, luego
--      nombre e id), sin repetir los manuales ni el propio producto.
-- Un producto sin categoría con relacionados manuales visibles los devuelve; sin manuales ni categoría sigue
-- devolviendo { productos: [] }. null idéntico para host desconocido, empresa desactivada y producto
-- inexistente, oculto, inactivo o de otra tienda. Precio = private.precio_final_publico y disponible =
-- private.disponible_publico, como hoy. Lista blanca: nunca costos, existencias, proveedor ni organizacion_id.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla; la función vive en `publico` (sigue SIN tablas).
-- Seguridad: SECURITY DEFINER con search_path vacío; los vínculos se filtran por la organización de la empresa
-- de la tienda y se cruzan con los efectivos de esa empresa, así que no sale nada de otras organizaciones ni de
-- productos no visibles. Grants sin cambios (revoke public/anon; grant anon, authenticated, como la función actual).
--
-- Migración aditiva e idempotente (create or replace). Reversión (migración posterior): restaurar el cuerpo de
-- 20270212100003_tienda_relacionados.sql (publico.relacionados_por_dominio).

create or replace function publico.relacionados_por_dominio(host text, producto uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tope constant integer := 4;
  v_empresa uuid;
  v_org uuid;
  v_actual record;
begin
  select e.id, e.organizacion_id into v_empresa, v_org
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or producto is null then
    return null;
  end if;

  select x.producto_id, x.categoria_id into v_actual
    from private.catalogo_tienda_efectivo(v_empresa) x
   where x.efectivo and x.producto_id = producto;
  if not found then
    return null;
  end if;

  return jsonb_build_object('productos', coalesce((
    with efectivos as materialized (
      select x.producto_id, x.nombre, x.categoria_id, x.destacado
        from private.catalogo_tienda_efectivo(v_empresa) x
       where x.efectivo and x.producto_id <> producto
    ),
    manuales as (
      select e.producto_id, e.nombre, e.categoria_id, e.destacado, 0 as grupo, pr.orden as orden_manual
        from dominio.producto_relacionados pr
        join efectivos e on e.producto_id = pr.relacionado_id
       where pr.producto_id = producto and pr.organizacion_id = v_org
       order by pr.orden, pr.relacionado_id
       limit c_tope
    ),
    relleno as (
      select e.producto_id, e.nombre, e.categoria_id, e.destacado, 1 as grupo, 0 as orden_manual
        from efectivos e
       where v_actual.categoria_id is not null
         and e.categoria_id = v_actual.categoria_id
         and e.producto_id not in (select m.producto_id from manuales m)
       order by e.destacado desc, lower(e.nombre), e.producto_id
       limit c_tope
    ),
    elegidos as (
      select u.*
        from (select * from manuales union all select * from relleno) u
       order by u.grupo, u.orden_manual, u.destacado desc, lower(u.nombre), u.producto_id
       limit c_tope
    )
    select jsonb_agg(jsonb_build_object(
             'id', g.producto_id,
             'nombre', g.nombre,
             'precio', private.precio_final_publico(g.producto_id, v_empresa),
             'disponible', private.disponible_publico(g.producto_id),
             'imagen', (select i.ruta from dominio.producto_imagenes i
                         where i.producto_id = g.producto_id order by i.posicion limit 1),
             'categoria_id', g.categoria_id
           ) order by g.grupo, g.orden_manual, g.destacado desc, lower(g.nombre), g.producto_id)
      from elegidos g), '[]'::jsonb));
end;
$$;

revoke execute on function publico.relacionados_por_dominio(text, uuid) from public, anon;
grant execute on function publico.relacionados_por_dominio(text, uuid) to anon, authenticated;

comment on function publico.relacionados_por_dominio(text, uuid) is
  'F-TDA-20 + MSF-846: hasta 4 productos relacionados efectivamente visibles en la tienda: primero los relacionados manuales del producto (en su orden) y, si faltan, los de la misma categoría (destacados primero, luego por nombre), sin incluirlo ni repetir. Precio final, disponibilidad booleana, imagen y categoría. Lista blanca; null idéntico si el dominio no existe, la empresa está desactivada o el producto no existe / está oculto / inactivo / es de otra empresa.';
