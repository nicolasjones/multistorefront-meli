-- F-CLI-14 (MSF-384, épica MSF-171, FR-001/FR-002): comparar el ranking de clientes entre dos períodos.
--
-- Esquema (Principio VII): NO crea tablas ni columnas. `public.ranking_clientes_comparado` es una RPC de aplicación
-- (`public`) que solo lee `dominio.comprobantes_venta` (`dominio`), `public.clientes` y `public.clientes_empresas`.
-- La RLS de `dominio.comprobantes_venta` exige la sección `ventas`; por eso es `security definer` y verifica la sección
-- `clientes` adentro, como `public.ranking_clientes`.
--
-- Reutiliza el criterio del ranking básico (MSF-126/MSF-377): `private.comprobante_cuenta_como_facturado`,
-- `private.signo_comprobante` (notas de crédito restan y no cuentan como comprobante), base sin IVA salvo `p_con_iva`,
-- filtros Tipo / Consumidor final / tienda. `public.ranking_clientes` NO se altera.
--
-- Migración aditiva (solo `create function`). Reversión:
--   drop function public.ranking_clientes_comparado(date, date, date, date, text, boolean, boolean, integer, integer, uuid);

create or replace function public.ranking_clientes_comparado(
  p_desde date,
  p_hasta date,
  p_desde_comparacion date,
  p_hasta_comparacion date,
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
  comprobantes_comparacion bigint,
  facturado_comparacion numeric,
  variacion numeric,
  variacion_porcentaje numeric,
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
  if v_org is null or private.nivel_seccion('clientes') not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver el ranking de clientes.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde_comparacion is null or p_hasta_comparacion is null then
    raise exception 'Indicá las fechas Desde y Hasta.' using errcode = '22023';
  end if;
  if p_desde > p_hasta or p_desde_comparacion > p_hasta_comparacion then
    raise exception 'Hasta no puede ser anterior a Desde.' using errcode = '22023';
  end if;
  if p_hasta > (p_desde + interval '5 years')::date
     or p_hasta_comparacion > (p_desde_comparacion + interval '5 years')::date then
    raise exception 'El rango máximo es de 5 años.' using errcode = '22023';
  end if;
  if p_tipo is not null and p_tipo not in ('minorista', 'mayorista') then
    raise exception 'Tipo de cliente inválido.' using errcode = '22023';
  end if;
  if p_pagina is null or p_pagina < 1 or p_pagina > 1000000 then
    raise exception 'La página debe estar entre 1 y 1.000.000.' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 1000 then
    raise exception 'El tamaño de página debe estar entre 1 y 1000.' using errcode = '22023';
  end if;

  return query
  with base as (
    select c.id as cid, c.numero as cnumero, c.nombre as cnombre, c.tipo as ctipo,
           -- El conteo es de facturas; la nota de crédito resta del importe pero no suma un comprobante.
           count(*) filter (where v.tipo = 'factura' and v.fecha between p_desde and p_hasta) as ncomp,
           coalesce(sum(private.signo_comprobante(v.tipo)
                        * case when p_con_iva then v.total_con_iva else v.total_sin_iva end)
                    filter (where v.fecha between p_desde and p_hasta), 0) as total,
           count(*) filter (where v.tipo = 'factura'
                              and v.fecha between p_desde_comparacion and p_hasta_comparacion) as ncomp_cmp,
           coalesce(sum(private.signo_comprobante(v.tipo)
                        * case when p_con_iva then v.total_con_iva else v.total_sin_iva end)
                    filter (where v.fecha between p_desde_comparacion and p_hasta_comparacion), 0) as total_cmp
      from dominio.comprobantes_venta v
      join public.clientes c
        on c.id = v.cliente_id and c.organizacion_id = v.organizacion_id
     where v.organizacion_id = v_org
       and (v.fecha between p_desde and p_hasta
            or v.fecha between p_desde_comparacion and p_hasta_comparacion)
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and (p_tipo is null or c.tipo = p_tipo)
       and (coalesce(p_incluir_consumidor_final, false) or not c.es_consumidor_final)
       and (p_empresa_id is null or exists (
             select 1 from public.clientes_empresas ce
              where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
     group by c.id, c.numero, c.nombre, c.tipo
  ), calculado as (
    select b.*,
           count(*) over () as filas,
           row_number() over (order by b.total desc, b.total_cmp desc, lower(b.cnombre), b.cnumero) as pos
      from base b
  )
  select k.pos, k.cid, k.cnumero, k.cnombre, k.ctipo, k.ncomp, k.total, k.ncomp_cmp, k.total_cmp,
         k.total - k.total_cmp,
         -- Sin porcentaje sobre una base de comparación nula o negativa.
         case when k.total_cmp > 0 then (k.total - k.total_cmp) * 100 / k.total_cmp end,
         k.filas
    from calculado k
   order by k.pos
   limit p_tamano
  offset (p_pagina - 1) * p_tamano;
end;
$$;

revoke execute on function public.ranking_clientes_comparado(date, date, date, date, text, boolean, boolean, integer, integer, uuid)
  from public, anon;
grant execute on function public.ranking_clientes_comparado(date, date, date, date, text, boolean, boolean, integer, integer, uuid)
  to authenticated;
