-- F-TDA-20 (MSF-263, épica MSF-149, spec 20270125-100000-tienda-seo-legal-y-estados): productos
-- relacionados de la ficha pública. FR-010 (D2: misma categoría, destacados primero, luego por nombre).
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.relacionados_por_dominio -> `publico` (función de lectura anónima); `publico` sigue SIN tablas.
--
-- Hasta 4 productos efectivamente visibles (private.catalogo_tienda_efectivo) de la misma categoría que
-- el producto, sin incluirlo; destacados primero y luego lower(nombre), id. precio =
-- private.precio_final_publico, disponible = private.disponible_publico. Lista blanca: nunca costos,
-- existencias, proveedor ni organizacion_id. null idéntico para host desconocido, empresa desactivada y
-- producto inexistente, oculto, inactivo o de otra empresa. Producto visible sin categoría o sin
-- compañeros en su categoría: { "productos": [] }.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.relacionados_por_dominio(text, uuid);

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
  v_actual record;
begin
  select e.id into v_empresa
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
  if v_actual.categoria_id is null then
    return jsonb_build_object('productos', '[]'::jsonb);
  end if;

  return jsonb_build_object('productos', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.producto_id,
             'nombre', g.nombre,
             'precio', private.precio_final_publico(g.producto_id, v_empresa),
             'disponible', private.disponible_publico(g.producto_id),
             'imagen', (select i.ruta from dominio.producto_imagenes i
                         where i.producto_id = g.producto_id order by i.posicion limit 1),
             'categoria_id', g.categoria_id
           ) order by g.destacado desc, lower(g.nombre), g.producto_id)
      from (
        select x.producto_id, x.nombre, x.categoria_id, x.destacado
          from private.catalogo_tienda_efectivo(v_empresa) x
         where x.efectivo
           and x.categoria_id = v_actual.categoria_id
           and x.producto_id <> producto
         order by x.destacado desc, lower(x.nombre), x.producto_id
         limit c_tope
      ) g), '[]'::jsonb));
end;
$$;

revoke execute on function publico.relacionados_por_dominio(text, uuid) from public, anon;
grant execute on function publico.relacionados_por_dominio(text, uuid) to anon, authenticated;

comment on function publico.relacionados_por_dominio(text, uuid) is
  'F-TDA-20: hasta 4 productos efectivamente visibles de la misma categoría que el producto (sin incluirlo; destacados primero, luego por nombre) con precio final, disponibilidad booleana, imagen y categoría. Lista blanca; null idéntico si el dominio no existe, la empresa está desactivada o el producto no existe / está oculto / inactivo / es de otra empresa.';
