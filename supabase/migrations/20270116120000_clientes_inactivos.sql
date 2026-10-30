-- F-CLI-16 (MSF-400, épica MSF-171, FR-010…FR-012): `public.clientes_inactivos`, la lista de clientes que dejaron de
-- comprar hace más de N días.
--
-- Esquema (Principio VII): sin tablas ni columnas nuevas; la función es una RPC de aplicación en `public` que lee
-- `dominio.comprobantes_venta` (`dominio`) y `public.clientes`/`public.clientes_empresas` (`public`).
--
-- Criterio de negocio (compartido con `ranking_clientes`): `private.comprobante_cuenta_como_facturado` y el signo de
-- `private.signo_comprobante`. «Última compra» = fecha de la última FACTURA que cuenta (una nota de crédito resta
-- importe pero no es una compra). Un cliente sin facturas que cuentan nunca aparece, ni uno archivado.
-- `facturado` es el neto histórico sin IVA (facturas menos notas de crédito); `comprobantes` cuenta solo facturas.
-- «Hoy» se toma en America/Argentina/Buenos_Aires.
--
-- Migración aditiva. Reversión:
--   drop function public.clientes_inactivos(integer, text, boolean, integer, integer, uuid);

create or replace function public.clientes_inactivos(
  p_dias integer default 90,
  p_tipo text default null,
  p_incluir_consumidor_final boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null
)
returns table (
  cliente_id uuid,
  numero integer,
  nombre text,
  tipo text,
  ultima_compra date,
  dias_sin_comprar integer,
  comprobantes bigint,
  facturado numeric,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.organizacion_id();
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if v_org is null or private.nivel_seccion('clientes') not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver los clientes inactivos.' using errcode = '42501';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 3650 then
    raise exception 'Los días sin comprar deben estar entre 1 y 3650.' using errcode = '22023';
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
  with agregado as (
    select c.id as cid, c.numero as cnumero, c.nombre as cnombre, c.tipo as ctipo,
           max(v.fecha) filter (where v.tipo = 'factura') as ultima,
           count(*) filter (where v.tipo = 'factura') as ncomp,
           sum(private.signo_comprobante(v.tipo) * v.total_sin_iva) as total
      from dominio.comprobantes_venta v
      join public.clientes c
        on c.id = v.cliente_id and c.organizacion_id = v.organizacion_id
     where v.organizacion_id = v_org
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and c.archivado_en is null
       and (p_tipo is null or c.tipo = p_tipo)
       and (coalesce(p_incluir_consumidor_final, false) or not c.es_consumidor_final)
       and (p_empresa_id is null or exists (
             select 1 from public.clientes_empresas ce
              where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
     group by c.id, c.numero, c.nombre, c.tipo
    having count(*) filter (where v.tipo = 'factura') > 0
       and max(v.fecha) filter (where v.tipo = 'factura') < v_hoy - p_dias
  ), calculado as (
    select a.*, count(*) over () as filas
      from agregado a
  )
  select k.cid, k.cnumero, k.cnombre, k.ctipo, k.ultima, (v_hoy - k.ultima)::integer, k.ncomp, k.total, k.filas
    from calculado k
   order by k.ultima, lower(k.cnombre), k.cnumero
   limit p_tamano
  offset (p_pagina - 1) * p_tamano;
end;
$$;

revoke execute on function public.clientes_inactivos(integer, text, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.clientes_inactivos(integer, text, boolean, integer, integer, uuid) to authenticated;
