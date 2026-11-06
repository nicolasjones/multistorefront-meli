-- Renumerada al integrar la base `dokploy` (máxima `20270203120000`): antes `20270115110100_historial_costos_producto.sql`;
-- la versión vieja quedó bajo la cola aplicada y el aplicador la salteaba.
--
-- F-PRV-07 (MSF-448, épica MSF-445): evolución del costo de un producto según los ingresos
-- de mercadería. Una fila por línea de ingreso registrado (no anulado) que trae costo; una
-- línea sin costo no figura (no se cuenta como cero). Solo lectura.
--
-- `security definer` porque el permiso exigido es Rentabilidad + Proveedores (no Stock, que es
-- lo que pide la RLS de los ingresos). La organización sale de la sesión y se respetan las
-- empresas accesibles del usuario. Esquema: función en `public` (RPC de la app); no crea tablas.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.historial_costos_producto(uuid, uuid);

create or replace function public.historial_costos_producto(
  p_producto_id uuid,
  p_proveedor_id uuid default null
)
returns table (
  proveedor_id uuid,
  proveedor_razon_social text,
  ingreso_id uuid,
  fecha date,
  comprobante text,
  costo_unitario_usd numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if (select auth.uid()) is null or v_organizacion is null
     or (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion')
     or (select private.nivel_seccion('proveedores')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el historial de costos' using errcode = '42501';
  end if;

  return query
  select i.proveedor_id,
         pr.razon_social,
         i.id,
         i.fecha,
         i.comprobante,
         l.costo_unitario_usd
    from dominio.ingresos_mercaderia_lineas l
    join dominio.ingresos_mercaderia i on i.id = l.ingreso_id
    join dominio.proveedores pr on pr.id = i.proveedor_id
   where l.organizacion_id = v_organizacion
     and i.organizacion_id = v_organizacion
     and l.producto_id = p_producto_id
     and l.costo_unitario_usd is not null
     and i.estado = 'registrado'
     and i.empresa_id in (select private.empresas_accesibles())
     and (p_proveedor_id is null or i.proveedor_id = p_proveedor_id)
   order by i.fecha, i.creado_en, i.id;
end;
$$;

comment on function public.historial_costos_producto(uuid, uuid) is
  'F-PRV-07: evolución del costo de un producto por ingreso registrado con costo (opcionalmente de un proveedor). Exige lectura o edición en Rentabilidad y Proveedores.';

revoke execute on function public.historial_costos_producto(uuid, uuid) from public, anon;
grant execute on function public.historial_costos_producto(uuid, uuid) to authenticated;
