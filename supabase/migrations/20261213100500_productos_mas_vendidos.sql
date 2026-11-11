-- MSF-414 · F-STK-18 (épica MSF-368, spec 20261024-130000-stock-carga-exportacion-y-avisos, T041):
-- `public.productos_mas_vendidos`: qué productos se vendieron más en un período.
--
-- Esquema (Principio VII): sin tablas nuevas. Lee `dominio.comprobantes_venta` y
-- `dominio.comprobantes_venta_lineas` (dominio del producto) y `dominio.productos`; la función vive en
-- `public` (contrato de la pantalla, como el resto de las RPC de lectura).
--
-- QUÉ CUENTA (FR-402): las UNIDADES (`cantidad`) de las líneas de comprobantes que cuentan como facturados.
-- El predicado es el ÚNICO lugar donde se decide eso: `private.comprobante_cuenta_como_facturado`
-- (hoy: factura que no está en borrador ni anulada). Por lo tanto NO suman los presupuestos, ni los
-- borradores, ni las anuladas. Las líneas «A pedido» (`a_pedido`) SÍ suman: se vendieron igual.
-- Cuenta la FECHA del comprobante (`dominio.comprobantes_venta.fecha`), la de la venta.
--
-- QUIÉN VE QUÉ (FR-403): solo suman las ventas de las tiendas con `ventas` en `lectura`/`edicion` para
-- quien consulta (`private.nivel_ventas_en_empresa`). Un comprobante sin tienda (columna `empresa_id`
-- nula, de las ventas cargadas antes de que existiera la tienda) no tiene tienda visible: no suma.
-- `p_empresa_id` acota a una tienda; una tienda ajena (de otra organización o sin `ventas` visible)
-- devuelve CERO filas, no un error.
--
-- ORDEN (FR-405): unidades descendente y, en empate, el nombre del producto (y el id como último
-- desempate para que el orden sea estable). La posición es GLOBAL (no de la página) y `total_filas` es
-- el total del ranking, no el de la página.
--
-- Seguridad (FR-408): `security definer` con `search_path = ''`; la organización sale de la SESIÓN
-- (`private.organizacion_id()`), nunca de un argumento. Exige la sección `stock` en `lectura`/`edicion`.
-- `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
--
-- Errores: 42501 sin permiso · 22023 dato inválido (mensaje en castellano).
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.productos_mas_vendidos(date, date, uuid, integer, integer);
--
-- NOTA DE VERSIÓN: `tasks.md` nombra `20261206130000`, pero esa versión queda por debajo de la cola ya
-- aplicada (`scripts/verificar-migraciones.mjs`: «versión REUSADA») y la migración no se aplicaría nunca.
-- Se usa una versión nueva y mayor, como se hizo con las migraciones de F-STK-17.

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
           sum(l.cantidad)::bigint as unidades
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
  'MSF-414: productos más vendidos por unidades en un período (opcionalmente de una tienda). Solo facturas que cuentan como facturadas; tiendas con ventas visible. Exige stock en lectura/edicion.';
