-- F-PRV-03 (MSF-367, épica MSF-205): productos de un proveedor para su ficha.
-- Esquema (Principio VII): sin tablas nuevas; función de superficie en `public` sobre
-- `dominio.productos`.
--
-- `security invoker`: rige la RLS del llamador (`productos`); además se exige de forma
-- explícita lectura/edición en `proveedores` y en `productos`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.productos_de_proveedor(uuid, integer, integer);

create or replace function public.productos_de_proveedor(
  p_proveedor_id uuid,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  nombre text,
  codigo_proveedor text,
  activo boolean,
  total_filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 100);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('proveedores')) not in ('lectura', 'edicion')
     or (select private.nivel_seccion('productos')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los productos de un proveedor' using errcode = '42501';
  end if;

  return query
    select pr.id, pr.nombre, pr.codigo_proveedor, pr.activo,
           count(*) over () as total_filas
      from dominio.productos pr
     where pr.proveedor_id = p_proveedor_id
       and pr.organizacion_id = (select private.organizacion_id())
     order by lower(pr.nombre), pr.id
     limit v_tamano offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.productos_de_proveedor(uuid, integer, integer) is
  'F-PRV-03: productos asignados a un proveedor (nombre, código del proveedor, estado), paginados (tope 100). Exige proveedores y productos.';

revoke execute on function public.productos_de_proveedor(uuid, integer, integer) from public, anon;
grant execute on function public.productos_de_proveedor(uuid, integer, integer) to authenticated;
