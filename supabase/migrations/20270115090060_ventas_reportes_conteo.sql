-- F-VTA-22 (MSF-347, épica MSF-338, spec 20270104-100000-ventas-reportes-basicos, FR-005, SC-003):
-- conteo de ventas del período para el estado vacío de la pantalla «Reportes de ventas»
-- («No hay ventas en ese período»).
--
-- Esquema (Principio VII): función en `public` (RPC de la app). SIN tablas nuevas: el conteo sale de
-- `dominio.comprobantes_venta` y `dominio.comprobantes_venta_lineas` (dominio del producto).
--
-- Por qué una RPC y no una consulta desde el navegador: el criterio de qué cuenta como venta vive
-- en UN solo lugar (`private.comprobante_cuenta_como_facturado`, el mismo que usa la vista
-- `analitica.ventas_producto_mas_vendido`) y no se reimplementa en el frontend; además las vistas de
-- `analitica` están cerradas para `authenticated` (las lee solo el rol de Superset), así que el
-- navegador no puede contarlas. Es el mismo patrón que `public.rentabilidad_conteo_margen` (F-REN-02).
--
-- Aislamiento: `SECURITY DEFINER` con la autorización explícita adentro — exige la organización
-- activa y lectura o edición en la sección `reportes` (42501 si no) y cuenta solo comprobantes de
-- esa organización y de las empresas accesibles del usuario (`private.empresas_accesibles()`, las
-- mismas que acotan la cláusula `rls` del guest token): el conteo nunca revela más que el tablero.
-- `p_empresa_id` es opcional y nunca amplía el alcance (una empresa ajena cuenta 0).
--
-- Migración aditiva. Reversión: drop function public.ventas_reportes_conteo(date,date,uuid);

create or replace function public.ventas_reportes_conteo(
  p_desde date,
  p_hasta date,
  p_empresa_id uuid default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_conteo integer;
begin
  if v_organizacion is null or (select private.nivel_seccion('reportes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los reportes de ventas' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  select count(distinct v.id)::integer
    into v_conteo
    from dominio.comprobantes_venta v
    join dominio.comprobantes_venta_lineas l
      on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
   where v.organizacion_id = v_organizacion
     and v.fecha between p_desde and p_hasta
     and v.empresa_id = any (select private.empresas_accesibles())
     and (p_empresa_id is null or v.empresa_id = p_empresa_id)
     and private.comprobante_cuenta_como_facturado(v.tipo, v.estado);
  return coalesce(v_conteo, 0);
end;
$$;

comment on function public.ventas_reportes_conteo(date, date, uuid) is
  'F-VTA-22: comprobantes que cuentan como venta en el período (mismo predicado que la vista del tablero y el mismo alcance de organización y empresas accesibles). 42501 sin la sección reportes.';

revoke execute on function public.ventas_reportes_conteo(date, date, uuid) from public, anon;
grant execute on function public.ventas_reportes_conteo(date, date, uuid) to authenticated;
