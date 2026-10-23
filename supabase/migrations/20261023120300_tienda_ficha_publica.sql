-- F-TDA-13 (MSF-372, épica MSF-167, spec 20261023-120000-tienda-catalogo-y-ficha): ficha de producto de la
-- tienda pública. FR-050.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.producto_por_dominio -> `publico` (función de lectura anónima); `publico` sigue SIN tablas.
--
-- Reutiliza, sin tocarlas: private.catalogo_tienda_efectivo (visibilidad efectiva, MSF-312),
-- private.precio_final_publico (F-TDA-12) y private.disponible_publico (F-TDA-18).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.producto_por_dominio(text, uuid);

-- Lista blanca de campos: nunca costos, existencias, proveedor, códigos internos ni organizacion_id.
-- Inexistente, inactivo, oculto, con categoría oculta o de otra empresa → null, la misma respuesta en
-- los cinco casos (y para host desconocido o empresa desactivada), para no revelar si el producto existe.
create or replace function publico.producto_por_dominio(host text, producto uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_empresa uuid;
  v_resultado jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or producto is null then
    return null;
  end if;

  -- «Efectivo» ya incluye: producto activo, asignado a la empresa, no oculto y categoría visible (con su padre).
  select jsonb_build_object(
           'id', p.id,
           'nombre', p.nombre,
           'descripcion', nullif(btrim(p.descripcion), ''),
           'sku', nullif(btrim(p.sku), ''),
           'categoria', case when c.id is null then null
                             else jsonb_build_object('id', c.id, 'nombre', c.nombre) end,
           'precio', private.precio_final_publico(p.id, v_empresa),
           'disponible', private.disponible_publico(p.id),
           'compatibilidad', nullif(array_to_string(p.compatible_con, ', '), ''),
           'imagenes', coalesce((
             select jsonb_agg(jsonb_build_object('posicion', i.posicion, 'ruta', i.ruta) order by i.posicion)
               from dominio.producto_imagenes i
              where i.producto_id = p.id and i.organizacion_id = p.organizacion_id
           ), '[]'::jsonb)
         )
    into v_resultado
    from private.catalogo_tienda_efectivo(v_empresa) x
    join dominio.productos p on p.id = x.producto_id
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
   where x.efectivo and x.producto_id = producto;

  return v_resultado;
end;
$$;

revoke execute on function publico.producto_por_dominio(text, uuid) from public;
grant execute on function publico.producto_por_dominio(text, uuid) to anon, authenticated;

comment on function publico.producto_por_dominio(text, uuid) is
  'F-TDA-13: ficha pública de un producto efectivamente visible de la tienda del host (nombre, descripción, SKU, categoría, precio final, disponibilidad, compatibilidad como texto e imágenes por posición). Lista blanca de campos; null idéntico si el producto no existe, está inactivo, oculto, con categoría oculta o es de otra empresa, o si el dominio no existe / la empresa está desactivada.';
