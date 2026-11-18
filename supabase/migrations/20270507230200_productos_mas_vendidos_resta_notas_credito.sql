-- Lote 41: `public.productos_mas_vendidos` sumaba la cantidad de las líneas de las NOTAS DE CRÉDITO como si fueran ventas:
-- `private.comprobante_cuenta_como_facturado` incluye `nota_credito` (desde 20261212120500_facturado_neto_notas.sql) y la función
-- agregaba `sum(l.cantidad)` sin signo, así que una devolución subía el ranking del producto devuelto. El resto de los reportes
-- (Ventas por período, Rentabilidad: `analitica.signo_comprobante`) restan las notas: el ranking también. Criterio: unidades
-- NETAS = Σ facturas − Σ notas de crédito emitidas (no anuladas, del período por la fecha de la nota). Un producto con más
-- devoluciones que ventas en el período queda con unidades negativas y al final del ranking.
--
-- Se parte de la definición vigente (20261213100500_productos_mas_vendidos.sql): mismos parámetros, columnas, permisos y orden;
-- solo cambia el `sum`. Migración aditiva (create or replace). Reversión (migración posterior): volver a la definición de
-- 20261213100500_productos_mas_vendidos.sql (`sum(l.cantidad)::bigint`).

create or replace function public.productos_mas_vendidos(
  p_desde date,
  p_hasta date,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  posicion bigint,
  producto_id uuid,
  nombre text,
  sku text,
  unidades bigint,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.organizacion_id();
begin
  if v_org is null or (select private.nivel_seccion('stock')) not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver los productos más vendidos.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Indicá las fechas Desde y Hasta.' using errcode = '22023';
  end if;
  if p_desde > p_hasta then
    raise exception 'Hasta no puede ser anterior a Desde.' using errcode = '22023';
  end if;
  -- Mismo rango máximo que el ranking de clientes (FR-004): el servidor revalida el período.
  if p_hasta > (p_desde + interval '5 years')::date then
    raise exception 'El rango máximo es de 5 años.' using errcode = '22023';
  end if;
  if p_pagina is null or p_pagina < 1 or p_pagina > 1000000 then
    raise exception 'La página debe estar entre 1 y 1.000.000.' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 200 then
    raise exception 'El tamaño de página debe estar entre 1 y 200.' using errcode = '22023';
  end if;

  return query
  with agregado as (
    select l.producto_id as pid, p.nombre as pnombre, p.sku as psku,
           sum(case when v.tipo = 'nota_credito' then -l.cantidad else l.cantidad end)::bigint as unidades
      from dominio.comprobantes_venta_lineas l
      join dominio.comprobantes_venta v
        on v.id = l.comprobante_id and v.organizacion_id = l.organizacion_id
      join dominio.productos p
        on p.id = l.producto_id and p.organizacion_id = l.organizacion_id
     where l.organizacion_id = v_org
       and v.fecha between p_desde and p_hasta
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and (p_empresa_id is null or v.empresa_id = p_empresa_id)
       and (select private.nivel_ventas_en_empresa(v.empresa_id)) in ('lectura', 'edicion')
     group by l.producto_id, p.nombre, p.sku
  ), calculado as (
    select a.*,
           count(*) over () as filas,
           row_number() over (order by a.unidades desc, lower(a.pnombre), a.pid) as pos
      from agregado a
  )
  select k.pos, k.pid, k.pnombre, k.psku, k.unidades, k.filas
    from calculado k
   order by k.pos
   limit p_tamano
  offset (p_pagina - 1) * p_tamano;
end;
$$;

revoke execute on function public.productos_mas_vendidos(date, date, uuid, integer, integer) from public, anon;
grant execute on function public.productos_mas_vendidos(date, date, uuid, integer, integer) to authenticated;

comment on function public.productos_mas_vendidos(date, date, uuid, integer, integer) is
  'MSF-414: productos más vendidos por unidades NETAS en un período (opcionalmente de una tienda): las facturas suman y las notas de crédito (que cuentan como facturadas) restan la cantidad devuelta. Tiendas con ventas visible. Exige stock en lectura/edicion.';
