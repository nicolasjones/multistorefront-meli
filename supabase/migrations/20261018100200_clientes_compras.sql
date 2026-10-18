-- F-CLI-10 (MSF-269, épica MSF-126, FR-012): historial de compras en la ficha del cliente.
-- Esquema: sin tablas nuevas; lee `dominio.comprobantes_venta` (M1) y `public.clientes`.
--
-- `public.compras_de_cliente` es `security definer`: la sección `clientes` se verifica
-- adentro (la RLS de comprobantes exige `ventas`) y la organización sale de
-- `private.organizacion_id()`, nunca del llamador. Un cliente de otra organización (o
-- inexistente) devuelve cero filas. El total del año usa el predicado único
-- `private.comprobante_cuenta_como_facturado` (F-CLI-08) y la base sin IVA.
-- Si el cliente no tiene comprobantes, una fila centinela (`numero is null`,
-- `facturado_anio = 0`) permite mostrar `$ 0` sin una segunda llamada.
--
-- Aditiva. Reversión (en una migración posterior):
--   drop function public.compras_de_cliente(uuid, integer, integer);

create or replace function public.compras_de_cliente(
  p_cliente_id uuid,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  facturado_anio numeric,
  numero text,
  fecha date,
  tipo text,
  estado text,
  total_sin_iva numeric,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.organizacion_id();
  v_hoy date;
  v_inicio date;
  v_total numeric;
begin
  if v_org is null or private.nivel_seccion('clientes') not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver las compras del cliente.' using errcode = '42501';
  end if;
  if p_cliente_id is null then
    raise exception 'Indicá el cliente.' using errcode = '22023';
  end if;
  if p_pagina is null or p_pagina < 1 or p_pagina > 1000000 then
    raise exception 'La página debe estar entre 1 y 1.000.000.' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 100 then
    raise exception 'El tamaño de página debe estar entre 1 y 100.' using errcode = '22023';
  end if;

  -- Cliente ajeno o inexistente: sin filas (no revela si existe en otra organización).
  if not exists (
    select 1 from public.clientes c where c.id = p_cliente_id and c.organizacion_id = v_org
  ) then
    return;
  end if;

  select (now() at time zone o.zona_horaria)::date
    into v_hoy
    from public.organizaciones o
   where o.id = v_org;
  v_hoy := coalesce(v_hoy, current_date);
  v_inicio := date_trunc('year', v_hoy)::date;

  select coalesce(sum(v.total_sin_iva), 0)
    into v_total
    from dominio.comprobantes_venta v
   where v.organizacion_id = v_org
     and v.cliente_id = p_cliente_id
     and v.fecha between v_inicio and v_hoy
     and private.comprobante_cuenta_como_facturado(v.tipo, v.estado);

  return query
  select v_total, k.cnumero, k.cfecha, k.ctipo, k.cestado, k.ctotal, k.filas
    from (
      select v.numero as cnumero, v.fecha as cfecha, v.tipo as ctipo, v.estado as cestado,
             v.total_sin_iva as ctotal, count(*) over () as filas
        from dominio.comprobantes_venta v
       where v.organizacion_id = v_org
         and v.cliente_id = p_cliente_id
       order by v.fecha desc, v.numero desc
       limit p_tamano
      offset (p_pagina - 1) * p_tamano
    ) k;

  if not exists (
    select 1 from dominio.comprobantes_venta v
     where v.organizacion_id = v_org and v.cliente_id = p_cliente_id
  ) then
    return query select v_total, null::text, null::date, null::text, null::text, null::numeric, 0::bigint;
  end if;
end;
$$;

revoke execute on function public.compras_de_cliente(uuid, integer, integer) from public, anon;
grant execute on function public.compras_de_cliente(uuid, integer, integer) to authenticated;
