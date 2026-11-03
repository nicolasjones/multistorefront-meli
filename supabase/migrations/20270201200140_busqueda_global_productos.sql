-- F-INI-03 (MSF-374, épica MSF-156): búsqueda global de productos desde la barra superior. FR-031, FR-034.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla. `public.buscar_productos_global` es una
-- RPC de plataforma (la usa el encabezado de todo el panel) que consulta `dominio.productos`.
--
-- security invoker: el llamador hereda la RLS de `dominio.productos` (organización y
-- `nivel_seccion('productos')` en lectura/edición). Sin permiso la base devuelve 0 filas (spec, US3.5).
-- Búsqueda por nombre y SKU: sin mayúsculas ni tildes (`private.normalizar_busqueda`). El nombre admite
-- subcadena o similitud `pg_trgm` (tolera errores leves de tipeo, umbral `private.umbral_similitud_busqueda`);
-- el SKU solo subcadena: SKU parecidos (CAB-200 / CAB-300) son productos distintos, no un error de tipeo.
-- Mínimo 2 caracteres (error 22023) y tope de resultados (1..20, por defecto 8).
-- Usa el índice de expresión `productos_nombre_busqueda_trgm` (MSF F-TDA-15) para el nombre.
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   drop function public.buscar_productos_global(text, integer);
--   revoke execute on function private.umbral_similitud_busqueda() from authenticated;

create or replace function public.buscar_productos_global(p_q text, p_limite integer default 8)
returns table (producto_id uuid, nombre text, sku text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_q text := private.normalizar_busqueda(left(coalesce(p_q, ''), 100));
  v_limite integer := least(greatest(coalesce(p_limite, 8), 1), 20);
  v_umbral real := private.umbral_similitud_busqueda();
begin
  if char_length(v_q) < 2 then
    raise exception 'Escribí al menos 2 caracteres para buscar' using errcode = '22023';
  end if;

  return query
  with candidatos as (
    select p.id, p.nombre, p.sku,
           private.normalizar_busqueda(p.nombre) as norm_nombre,
           private.normalizar_busqueda(p.sku) as norm_sku
      from dominio.productos p
     where p.organizacion_id = (select private.organizacion_id())
  )
  select c.id, c.nombre, c.sku
    from candidatos c
   where strpos(c.norm_nombre, v_q) > 0
      or strpos(c.norm_sku, v_q) > 0
      or extensions.word_similarity(v_q, c.norm_nombre) >= v_umbral
   order by (case when c.norm_sku = v_q then 3
                  when strpos(c.norm_sku, v_q) = 1 or strpos(c.norm_nombre, v_q) = 1 then 2
                  when strpos(c.norm_nombre, v_q) > 0 or strpos(c.norm_sku, v_q) > 0 then 1
                  else 0 end) desc,
            extensions.word_similarity(v_q, c.norm_nombre) desc,
            c.norm_nombre, c.id
   limit v_limite;
end;
$$;

comment on function public.buscar_productos_global(text, integer) is
  'F-INI-03: búsqueda global de productos por nombre o SKU (mín. 2 caracteres, tope 20). Rige la RLS de dominio.productos.';

revoke execute on function public.buscar_productos_global(text, integer) from public, anon;
grant execute on function public.buscar_productos_global(text, integer) to authenticated;

-- La RPC es security invoker: el llamador debe poder ejecutar el helper de umbral (revocado en
-- 20261203110000). Es una constante de configuración sin datos; igual que `normalizar_busqueda`.
grant execute on function private.umbral_similitud_busqueda() to authenticated;
