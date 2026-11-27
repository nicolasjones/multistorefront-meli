-- MSF-975 (seguimiento de la Fase 5 de listas de precios, lote 93): analítica de ventas por lista de precios.
-- Cada línea de venta guarda `lista_precio_id` y `lista_ajuste_pct` (snapshot, 20270348000000), así que se mide por lista: comprobantes,
-- unidades, ventas netas (sin IVA) y el AJUSTE otorgado (descuento si es negativo, recargo si es positivo) frente al precio central.
-- Decisión: va como vista de analítica del panel (Reportes de ventas); sin tablero de Superset (queda fuera). El MARGEN por lista queda
-- fuera: la línea no guarda el costo ni la cotización de cuando se vendió, y calcularlo con el costo vigente daría un margen distinto cada
-- día; hace falta un snapshot de costo en la línea (seguimiento).
--
-- Criterio (igual que Ventas por período y Más vendidos): facturas suman y notas de crédito restan (`comprobante_cuenta_como_facturado`),
-- por la fecha del comprobante; permisos de Ventas por tienda (`nivel_ventas_en_empresa`). Las líneas sin lista se agrupan en una fila
-- sin lista (`lista_id` nulo) para comparar. Ajuste otorgado = venta - venta / (1 + pct/100), con el porcentaje de la línea: es una
-- estimación sobre el precio central que la lista reemplazó (no incluye promociones ni precios manuales).
--
-- Esquemas (Principio VII): sin tablas nuevas; función de lectura en `public`. Errores: `42501` sin permiso, `22023` período inválido.
--
-- Migración aditiva. Reversión (migración posterior): drop function public.ventas_por_lista_precios(date, date, uuid);

create or replace function public.ventas_por_lista_precios(
  p_desde date,
  p_hasta date,
  p_empresa_id uuid default null
)
returns table (
  lista_id uuid,
  lista_nombre text,
  ajuste_pct_actual numeric,
  comprobantes bigint,
  unidades bigint,
  ventas_netas numeric,
  ajuste_otorgado numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if (select auth.uid()) is null or v_org is null
     or (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver las ventas por lista de precios.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Indicá las fechas Desde y Hasta.' using errcode = '22023';
  end if;
  if p_desde > p_hasta then
    raise exception 'Hasta no puede ser anterior a Desde.' using errcode = '22023';
  end if;
  if p_hasta > (p_desde + interval '5 years')::date then
    raise exception 'El rango máximo es de 5 años.' using errcode = '22023';
  end if;

  return query
  with lineas as (
    select l.lista_precio_id as lid,
           v.id as comprobante,
           case when v.tipo = 'nota_credito' then -1 else 1 end as signo,
           l.cantidad,
           l.subtotal_sin_iva as subtotal,
           coalesce(l.lista_ajuste_pct, 0) as pct
      from dominio.comprobantes_venta_lineas l
      join dominio.comprobantes_venta v
        on v.id = l.comprobante_id and v.organizacion_id = l.organizacion_id
     where l.organizacion_id = v_org
       and v.fecha between p_desde and p_hasta
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and (p_empresa_id is null or v.empresa_id = p_empresa_id)
       and (select private.nivel_ventas_en_empresa(v.empresa_id)) in ('lectura', 'edicion')
  )
  select x.lid,
         ls.nombre,
         ls.ajuste_pct,
         count(distinct x.comprobante),
         sum(x.signo * x.cantidad)::bigint,
         round(sum(x.signo * x.subtotal), 2),
         round(sum(x.signo * (x.subtotal - x.subtotal / (1 + x.pct / 100))), 2)
    from lineas x
    left join dominio.listas_precios ls on ls.id = x.lid and ls.organizacion_id = v_org
   group by x.lid, ls.nombre, ls.ajuste_pct
   order by (x.lid is null), sum(x.signo * x.subtotal) desc, ls.nombre;
end;
$$;

comment on function public.ventas_por_lista_precios(date, date, uuid) is
  'MSF-975: ventas netas (facturas menos notas de crédito, sin IVA) por lista de precios en un período: comprobantes, unidades, ventas y ajuste otorgado estimado frente al precio central; las líneas sin lista van en una fila con lista_id nulo. Exige ventas en lectura o edición; por tienda según nivel_ventas_en_empresa.';

revoke execute on function public.ventas_por_lista_precios(date, date, uuid) from public, anon;
grant execute on function public.ventas_por_lista_precios(date, date, uuid) to authenticated;
