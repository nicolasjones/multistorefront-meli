-- MSF-528 (seguimiento de MSF-205, T029): la ficha del proveedor muestra el Costo de cada producto.
-- Esquema (Principio VII): sin tablas nuevas; la función de superficie sigue en `public` y lee
-- `dominio.productos` + `dominio.producto_costos`.
--
-- El costo vive en `producto_costos` (RLS: sección `rentabilidad` en lectura/edición). Al ser
-- `security invoker`, el left join solo trae filas a quien ve Rentabilidad; el `case` lo hace
-- explícito: sin Rentabilidad `costo` es null, sin romper la ficha. `moneda` es la del producto.
-- «Último ingreso» sigue fuera: depende del ingreso de mercadería (MSF-219), no hay fuente.
--
-- Cambia el `returns table` (no admite `create or replace`): drop + create. Reversión (migración
-- posterior): `drop function public.productos_de_proveedor(uuid, integer, integer)` y volver a crear
-- la versión de `20261018190700_productos_de_proveedor.sql` (sin `costo` ni `moneda`).

drop function public.productos_de_proveedor(uuid, integer, integer);

create function public.productos_de_proveedor(
  p_proveedor_id uuid,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  nombre text,
  codigo_proveedor text,
  activo boolean,
  moneda text,
  costo numeric,
  total_filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 100);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
  v_ve_costo boolean;
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('proveedores')) not in ('lectura', 'edicion')
     or (select private.nivel_seccion('productos')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los productos de un proveedor' using errcode = '42501';
  end if;

  v_ve_costo := (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion');

  return query
    select pr.id, pr.nombre, pr.codigo_proveedor, pr.activo, pr.moneda,
           case when v_ve_costo then pc.costo else null end,
           count(*) over () as total_filas
      from dominio.productos pr
      left join dominio.producto_costos pc
        on pc.producto_id = pr.id and pc.organizacion_id = pr.organizacion_id
     where pr.proveedor_id = p_proveedor_id
       and pr.organizacion_id = (select private.organizacion_id())
     order by lower(pr.nombre), pr.id
     limit v_tamano offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.productos_de_proveedor(uuid, integer, integer) is
  'F-PRV-03 + MSF-528: productos asignados a un proveedor (nombre, código, estado, moneda y costo), paginados (tope 100). Exige proveedores y productos; costo solo con Rentabilidad (null si no).';

revoke execute on function public.productos_de_proveedor(uuid, integer, integer) from public, anon;
grant execute on function public.productos_de_proveedor(uuid, integer, integer) to authenticated;
