-- MSF-309 (F-VTA-38, épica MSF-275): consulta en solo lectura de las ventas y los cobros
-- históricos importados en F-VTA-37.
--
-- Esquemas (Principio VII), verificados:
--   public.listar_historial_ventas / public.listar_historial_cobros  RPC de plataforma (nuevas):
--     son funciones de lectura, no tablas; consultan dominio.historial_comprobantes y
--     dominio.historial_cobros (dominio, F-VTA-37) y dominio.empresas solo para el nombre de la tienda.
--   Sin tablas nuevas ni alteradas.
--
-- security invoker: el llamador hereda la RLS de las tablas `historial_*` (organización, empresas
-- accesibles y nivel `lectura`/`edicion` de `ventas`); sin permiso no vuelven filas. El filtro de
-- tienda repite `private.empresas_accesibles()` por defensa en profundidad: una tienda ajena
-- devuelve cero filas, no un error que delate su existencia.
-- Búsqueda: cliente, número de cliente o número de comprobante, sin mayúsculas ni tildes, con el
-- texto literal (se escapan \ % _). Orden estable: fecha desc, número desc, id. Tope 200 por página;
-- una página fuera de rango no devuelve filas. `total_filas` es el total del filtro actual;
-- `fecha_desde`/`fecha_hasta` son el rango de fechas de ese mismo filtro (indicadores «Desde/Hasta»).
--
-- Migración aditiva. Reversión (migración posterior, nunca en este PR):
--   drop function public.listar_historial_ventas(text, uuid, integer, integer, date, date);
--   drop function public.listar_historial_cobros(text, uuid, integer, integer, date, date);

create or replace function public.listar_historial_ventas(
  p_busqueda text default null,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_desde date default null,
  p_hasta date default null
)
returns table (
  id uuid,
  empresa_id uuid,
  empresa_nombre text,
  tipo text,
  numero text,
  fecha date,
  cliente_nombre text,
  cliente_numero text,
  operador text,
  estado_final text,
  total numeric,
  total_filas bigint,
  fecha_desde date,
  fecha_hasta date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text;
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select h.id, h.empresa_id, e.nombre, h.tipo, h.numero, h.fecha, h.cliente_nombre, h.cliente_numero,
         h.operador, h.estado_final, h.total,
         count(*) over () as total_filas,
         min(h.fecha) over () as fecha_desde,
         max(h.fecha) over () as fecha_hasta
    from dominio.historial_comprobantes h
    left join dominio.empresas e on e.id = h.empresa_id
   where h.organizacion_id = (select private.organizacion_id())
     and h.empresa_id in (select private.empresas_accesibles())
     and (p_empresa_id is null or h.empresa_id = p_empresa_id)
     and (p_desde is null or h.fecha >= p_desde)
     and (p_hasta is null or h.fecha <= p_hasta)
     and (v_patron is null
          or translate(lower(h.cliente_nombre), 'áéíóúü', 'aeiouu') like v_patron
          or translate(lower(coalesce(h.cliente_numero, '')), 'áéíóúü', 'aeiouu') like v_patron
          or translate(lower(h.numero), 'áéíóúü', 'aeiouu') like v_patron)
   order by h.fecha desc, h.numero desc, h.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_historial_ventas(text, uuid, integer, integer, date, date) is
  'Ventas históricas paginadas (F-VTA-38). Solo lectura; rige la RLS de dominio.historial_comprobantes.';

revoke execute on function public.listar_historial_ventas(text, uuid, integer, integer, date, date) from public, anon;
grant execute on function public.listar_historial_ventas(text, uuid, integer, integer, date, date) to authenticated;

create or replace function public.listar_historial_cobros(
  p_busqueda text default null,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_desde date default null,
  p_hasta date default null
)
returns table (
  id uuid,
  empresa_id uuid,
  empresa_nombre text,
  fecha date,
  comprobante_numero text,
  cliente_nombre text,
  cliente_numero text,
  cuenta_cobro text,
  aprobado_por text,
  importe numeric,
  total_filas bigint,
  fecha_desde date,
  fecha_hasta date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text;
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select h.id, h.empresa_id, e.nombre, h.fecha, h.comprobante_numero, h.cliente_nombre, h.cliente_numero,
         h.cuenta_cobro, h.aprobado_por, h.importe,
         count(*) over () as total_filas,
         min(h.fecha) over () as fecha_desde,
         max(h.fecha) over () as fecha_hasta
    from dominio.historial_cobros h
    left join dominio.empresas e on e.id = h.empresa_id
   where h.organizacion_id = (select private.organizacion_id())
     and h.empresa_id in (select private.empresas_accesibles())
     and (p_empresa_id is null or h.empresa_id = p_empresa_id)
     and (p_desde is null or h.fecha >= p_desde)
     and (p_hasta is null or h.fecha <= p_hasta)
     and (v_patron is null
          or translate(lower(h.cliente_nombre), 'áéíóúü', 'aeiouu') like v_patron
          or translate(lower(coalesce(h.cliente_numero, '')), 'áéíóúü', 'aeiouu') like v_patron
          or translate(lower(h.comprobante_numero), 'áéíóúü', 'aeiouu') like v_patron)
   order by h.fecha desc, h.comprobante_numero desc, h.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_historial_cobros(text, uuid, integer, integer, date, date) is
  'Cobros históricos paginados (F-VTA-38). Solo lectura; rige la RLS de dominio.historial_cobros.';

revoke execute on function public.listar_historial_cobros(text, uuid, integer, integer, date, date) from public, anon;
grant execute on function public.listar_historial_cobros(text, uuid, integer, integer, date, date) to authenticated;
