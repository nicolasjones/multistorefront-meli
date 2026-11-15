-- F-CLI-15 (MSF-391, épica MSF-171, FR-005…FR-008): ranking de clientes filtrado por producto, categoría y provincia.
--
-- Esquema (Principio VII): NO crea tablas ni columnas. `public.ranking_clientes_por_dimension` es una RPC de
-- aplicación (`public`) que lee `dominio.comprobantes_venta`, `dominio.comprobantes_venta_lineas`,
-- `dominio.productos`, `dominio.categorias` (`dominio`), `public.clientes` y `public.clientes_empresas`.
-- La RLS de `dominio.*` exige la sección `ventas`; por eso es `security definer` y verifica la sección `clientes`
-- adentro, como `public.ranking_clientes`.
--
-- Criterio (igual que el ranking básico, MSF-126/MSF-377): `private.comprobante_cuenta_como_facturado`,
-- `private.signo_comprobante` (las notas de crédito restan y no cuentan como comprobante), base sin IVA salvo
-- `p_con_iva` (`subtotal_sin_iva` o `subtotal_sin_iva + iva` por línea), filtros Tipo / Consumidor final / tienda.
--   · Con producto o categoría: `facturado` suma las LÍNEAS que cumplen el filtro (no el comprobante entero) y
--     `comprobantes` cuenta facturas distintas con al menos una de esas líneas. La categoría raíz incluye sus
--     subcategorías; producto y categoría se intersecan. Las líneas de las notas de crédito (devolución de
--     productos) restan con el mismo filtro.
--   · Sin ellos: el importe es el del comprobante, idéntico a `ranking_clientes`.
--   · Provincia: sin mayúsculas ni tildes con `private.clave_texto` (no se habilita ninguna extensión).
-- Un producto o categoría de otra organización o inexistente devuelve vacío (las uniones son por organización).
--
-- Migración aditiva (solo `create function`). Reversión:
--   drop function public.ranking_clientes_por_dimension(date, date, uuid, uuid, text, text, boolean, boolean, integer, integer, uuid);
--
-- NOTA DE VERSIÓN: el contrato nombra `20270114110000`, pero esa versión queda por debajo de la cola ya aplicada
-- (`scripts/verificar-migraciones.mjs`); se usa una versión nueva y mayor.

create or replace function public.ranking_clientes_por_dimension(
  p_desde date,
  p_hasta date,
  p_producto_id uuid default null,
  p_categoria_id uuid default null,
  p_provincia text default null,
  p_tipo text default null,
  p_incluir_consumidor_final boolean default false,
  p_con_iva boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null
)
returns table (
  posicion bigint,
  cliente_id uuid,
  numero integer,
  nombre text,
  tipo text,
  comprobantes bigint,
  facturado numeric,
  participacion numeric,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.organizacion_id();
  v_provincia text := nullif(btrim(p_provincia), '');
begin
  if v_org is null or private.nivel_seccion('clientes') not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver el ranking de clientes.' using errcode = '42501';
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
  if p_tipo is not null and p_tipo not in ('minorista', 'mayorista') then
    raise exception 'Tipo de cliente inválido.' using errcode = '22023';
  end if;
  if length(coalesce(p_provincia, '')) > 100 then
    raise exception 'La provincia no puede superar los 100 caracteres.' using errcode = '22023';
  end if;
  if p_pagina is null or p_pagina < 1 or p_pagina > 1000000 then
    raise exception 'La página debe estar entre 1 y 1.000.000.' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 1000 then
    raise exception 'El tamaño de página debe estar entre 1 y 1000.' using errcode = '22023';
  end if;

  return query
  with clientes_filtrados as (
    select c.id as cid, c.numero as cnumero, c.nombre as cnombre, c.tipo as ctipo
      from public.clientes c
     where c.organizacion_id = v_org
       and (p_tipo is null or c.tipo = p_tipo)
       and (coalesce(p_incluir_consumidor_final, false) or not c.es_consumidor_final)
       and (v_provincia is null or private.clave_texto(c.provincia) = private.clave_texto(v_provincia))
       -- Filtro por tienda (F-CLI-11): solo los clientes habilitados en la elegida.
       and (p_empresa_id is null or exists (
             select 1 from public.clientes_empresas ce
              where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
  ), agregado as (
    select k.cid, k.cnumero, k.cnombre, k.ctipo,
           -- El conteo es de facturas distintas; la nota de crédito resta del importe pero no suma un comprobante.
           count(distinct v.id) filter (where v.tipo = 'factura') as ncomp,
           sum(private.signo_comprobante(v.tipo) * case
                 when p_producto_id is null and p_categoria_id is null
                   then case when p_con_iva then v.total_con_iva else v.total_sin_iva end
                 else l.subtotal_sin_iva + case when p_con_iva then l.iva else 0 end
               end) as total
      from clientes_filtrados k
      join dominio.comprobantes_venta v
        on v.cliente_id = k.cid and v.organizacion_id = v_org
      left join dominio.comprobantes_venta_lineas l
        on l.comprobante_id = v.id and l.organizacion_id = v_org
       -- Sin filtro de producto/categoría no se abren las líneas: el total del comprobante se suma una sola vez.
       and (p_producto_id is not null or p_categoria_id is not null)
     where v.fecha between p_desde and p_hasta
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and (
         (p_producto_id is null and p_categoria_id is null)
         or (
           l.id is not null
           and (p_producto_id is null or l.producto_id = p_producto_id)
           and (p_categoria_id is null or exists (
                 select 1
                   from dominio.productos pr
                   join dominio.categorias ca
                     on ca.id = pr.categoria_id and ca.organizacion_id = pr.organizacion_id
                  where pr.id = l.producto_id and pr.organizacion_id = v_org
                    and (ca.id = p_categoria_id or ca.padre_id = p_categoria_id)))
         )
       )
     group by k.cid, k.cnumero, k.cnombre, k.ctipo
  ), calculado as (
    select a.*,
           sum(a.total) over () as gran_total,
           count(*) over () as filas,
           row_number() over (order by a.total desc, lower(a.cnombre), a.cnumero) as pos
      from agregado a
  )
  select k.pos, k.cid, k.cnumero, k.cnombre, k.ctipo, k.ncomp, k.total,
         -- Porcentaje (0–100) sin redondear: la suma de todas las filas del ranking filtrado es 100.
         case when k.gran_total = 0 then 0::numeric
              else k.total * 100 / k.gran_total end,
         k.filas
    from calculado k
   order by k.pos
   limit p_tamano
  offset (p_pagina - 1) * p_tamano;
end;
$$;

revoke execute on function public.ranking_clientes_por_dimension(date, date, uuid, uuid, text, text, boolean, boolean, integer, integer, uuid)
  from public, anon;
grant execute on function public.ranking_clientes_por_dimension(date, date, uuid, uuid, text, text, boolean, boolean, integer, integer, uuid)
  to authenticated;
