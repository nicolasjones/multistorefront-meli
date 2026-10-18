-- F-CLI-08 (MSF-238, épica MSF-126, FR-003…FR-007): ranking de clientes por facturación.
-- Esquema: sin tablas nuevas; lee `dominio.comprobantes_venta` (M1) y `public.clientes`.
--
-- `private.comprobante_cuenta_como_facturado` es el ÚNICO lugar donde se fija qué
-- comprobantes suman (hoy: factura no anulada); Ventas lo ajusta cuando fije el
-- criterio. `public.ranking_clientes` es `security definer`: la sección `clientes`
-- se verifica adentro (la RLS de comprobantes exige `ventas`) y la organización
-- sale de `private.organizacion_id()`, nunca del llamador.
--
-- El predicado no se concede a `authenticated`: lo ejecutan las funciones `security definer`.
--
-- Aditiva. Reversión (en una migración posterior):
--   drop function public.ranking_clientes(date, date, text, boolean, boolean, integer, integer);
--   drop function private.comprobante_cuenta_como_facturado(text, text);

create or replace function private.comprobante_cuenta_como_facturado(p_tipo text, p_estado text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tipo = 'factura' and p_estado <> 'anulada'
$$;

revoke execute on function private.comprobante_cuenta_como_facturado(text, text) from public, anon;

create or replace function public.ranking_clientes(
  p_desde date,
  p_hasta date,
  p_tipo text default null,
  p_incluir_consumidor_final boolean default false,
  p_con_iva boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25
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
  if p_pagina is null or p_pagina < 1 then
    raise exception 'La página debe ser 1 o mayor.' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 1000 then
    raise exception 'El tamaño de página debe estar entre 1 y 1000.' using errcode = '22023';
  end if;

  return query
  with agregado as (
    select c.id as cid, c.numero as cnumero, c.nombre as cnombre, c.tipo as ctipo,
           count(*) as ncomp,
           sum(case when p_con_iva then v.total_con_iva else v.total_sin_iva end) as total
      from dominio.comprobantes_venta v
      join public.clientes c
        on c.id = v.cliente_id and c.organizacion_id = v.organizacion_id
     where v.organizacion_id = v_org
       and v.fecha between p_desde and p_hasta
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and (p_tipo is null or c.tipo = p_tipo)
       and (coalesce(p_incluir_consumidor_final, false) or not c.es_consumidor_final)
     group by c.id, c.numero, c.nombre, c.tipo
  ), calculado as (
    select a.*,
           sum(a.total) over () as gran_total,
           count(*) over () as filas,
           row_number() over (order by a.total desc, lower(a.cnombre), a.cnumero) as pos
      from agregado a
  )
  select k.pos, k.cid, k.cnumero, k.cnombre, k.ctipo, k.ncomp, k.total,
         -- Porcentaje (0–100) sin redondear: la pantalla lo muestra con una decimal y
         -- así la suma de todas las filas del ranking es 100 (FR-006).
         case when k.gran_total = 0 then 0::numeric
              else k.total * 100 / k.gran_total end,
         k.filas
    from calculado k
   order by k.pos
   limit p_tamano
  offset (p_pagina - 1) * p_tamano;
end;
$$;

revoke execute on function public.ranking_clientes(date, date, text, boolean, boolean, integer, integer) from public, anon;
grant execute on function public.ranking_clientes(date, date, text, boolean, boolean, integer, integer) to authenticated;
