-- F-TDA-10 (MSF-399, épica MSF-191, spec 20261024-120000-tienda-inicio-busqueda-movil): destacados de la
-- home pública con el precio final de la empresa. FR-001 (cierra D8 de MSF-167).
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.destacados_por_dominio -> `publico` (función de lectura anónima); `publico` sigue SIN tablas.
--
-- Hasta 8 destacados (D7) efectivamente visibles (private.catalogo_tienda_efectivo), con precio =
-- private.precio_final_publico y disponible = private.disponible_publico. `hay_productos` indica si la tienda
-- tiene al menos un producto efectivamente visible (la home distingue «Catálogo en preparación» de
-- «sin destacados»). Lista blanca: nunca costos, existencias, proveedor ni organizacion_id. Host
-- desconocido y empresa desactivada devuelven lo mismo: null.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.destacados_por_dominio(text);

create or replace function publico.destacados_por_dominio(host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tope constant integer := 8;
  v_empresa uuid;
  v_resultado jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  with efectivos as (
    select x.producto_id, x.nombre, x.categoria_id, x.destacado
      from private.catalogo_tienda_efectivo(v_empresa) x
     where x.efectivo
  ),
  elegidos as (
    select f.*
      from efectivos f
     where f.destacado
     order by lower(f.nombre), f.producto_id
     limit c_tope
  )
  select jsonb_build_object(
           'hay_productos', exists (select 1 from efectivos),
           'productos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.producto_id,
                      'nombre', g.nombre,
                      'precio', private.precio_final_publico(g.producto_id, v_empresa),
                      'disponible', private.disponible_publico(g.producto_id),
                      'imagen', (select i.ruta from dominio.producto_imagenes i
                                  where i.producto_id = g.producto_id order by i.posicion limit 1),
                      'categoria_id', g.categoria_id
                    ) order by lower(g.nombre), g.producto_id)
               from elegidos g), '[]'::jsonb)
         )
    into v_resultado;
  return v_resultado;
end;
$$;

revoke execute on function publico.destacados_por_dominio(text) from public, anon;
grant execute on function publico.destacados_por_dominio(text) to anon, authenticated;

comment on function publico.destacados_por_dominio(text) is
  'F-TDA-10: hasta 8 destacados efectivamente visibles de la tienda del host (precio final de la empresa, disponibilidad booleana, imagen y categoría) más hay_productos. Lista blanca; null si el dominio no existe o la empresa está desactivada.';
