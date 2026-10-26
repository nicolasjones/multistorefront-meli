-- F-VTA-14 (MSF-410, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion, FR-045):
-- `public.listar_contrarreembolsos` y `public.resumen_contrarreembolsos`: la lectura de la
-- pestaña «Contrarreembolsos» y de sus tarjetas.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.listar_contrarreembolsos    public (nueva RPC)   listado paginado de contrarreembolsos.
--   public.resumen_contrarreembolsos   public (nueva RPC)   totales de las tarjetas.
--   dominio.contrarreembolsos          dominio (existente)  se lee (RLS de la tabla).
--   dominio.comprobantes_venta         dominio (existente)  se lee (número de la factura).
--   dominio.empresas                    dominio (existente)  se lee (nombre de la tienda).
--   dominio.transportes                 dominio (existente)  se lee (nombre del transporte).
--   public.clientes                     public (existente)   se lee (nombre del cliente).
-- Sin tablas nuevas: esta migración no crea ni altera columnas de ninguna tabla.
--
-- Reglas de las RPC (FR-045):
-- · Son de LECTURA: `security invoker`, así que manda la RLS de `dominio.contrarreembolsos`
--   (organización, empresa accesible y sección `ventas`). Además filtran por organización y por
--   las empresas accesibles: una tienda de otra organización nunca aparece.
-- · `p_empresa_id` es el filtro de tienda (la empresa activa de la barra superior, Principio
--   VIII). Con `null` se listan todas las empresas accesibles.
-- · `p_estado` ∈ ('pendiente', 'cobrado'); con `null` se listan los dos estados.
-- · La paginación es de servidor: `p_pagina` (desde 1) y `p_tamano` (1…100). `filas` es el total
--   de contrarreembolsos que cumplen el filtro, para que la pantalla muestre «1–10 de N».
-- · El resumen trae las tarjetas: «Contrarreembolsos pendientes» (importe y cantidad) y
--   «Cobrados este mes» (importe de los cobrados en el mes en curso).
-- · La organización y el actor salen de la sesión, nunca de un argumento.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.listar_contrarreembolsos(uuid, text, integer, integer);
--   drop function public.resumen_contrarreembolsos(uuid);

-- ============================================================================
-- Listado (FR-045)
-- ============================================================================

create or replace function public.listar_contrarreembolsos(
  p_empresa_id uuid default null,
  p_estado text default null,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  fecha timestamptz,
  empresa_id uuid,
  empresa text,
  comprobante_id uuid,
  numero text,
  cliente text,
  transporte_id uuid,
  transporte text,
  guia text,
  importe numeric,
  estado text,
  actualizado_en timestamptz,
  filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 100);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
  v_estado text := nullif(btrim(coalesce(p_estado, '')), '');
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los contrarreembolsos' using errcode = '42501';
  end if;

  if v_estado is not null and v_estado not in ('pendiente', 'cobrado') then
    raise exception 'El estado del contrarreembolso no es válido: usá pendiente o cobrado' using errcode = '22023';
  end if;

  return query
  select cr.id,
         cr.creado_en,
         cr.empresa_id,
         e.nombre,
         cr.comprobante_id,
         c.numero,
         cl.nombre,
         cr.transporte_id,
         t.nombre,
         cr.guia,
         cr.importe,
         cr.estado,
         cr.actualizado_en,
         count(*) over () as filas
    from dominio.contrarreembolsos cr
    join dominio.empresas e on e.id = cr.empresa_id
    join dominio.comprobantes_venta c on c.id = cr.comprobante_id
    join public.clientes cl on cl.id = c.cliente_id
    join dominio.transportes t on t.id = cr.transporte_id
   where cr.organizacion_id = (select private.organizacion_id())
     and cr.empresa_id in (select private.empresas_accesibles())
     and (p_empresa_id is null or cr.empresa_id = p_empresa_id)
     and (v_estado is null or cr.estado = v_estado)
   order by cr.creado_en desc, cr.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

revoke execute on function public.listar_contrarreembolsos(uuid, text, integer, integer) from public, anon;
grant execute on function public.listar_contrarreembolsos(uuid, text, integer, integer) to authenticated;

comment on function public.listar_contrarreembolsos(uuid, text, integer, integer) is
  'Contrarreembolsos de la organización (F-VTA-14, FR-045): fecha, tienda, factura, cliente, transporte, guía, importe, estado y el total de filas. Filtros de tienda y estado, paginación en servidor. Solo lectura (manda la RLS de dominio).';

-- ============================================================================
-- Resumen de las tarjetas (FR-045)
-- ============================================================================

create or replace function public.resumen_contrarreembolsos(
  p_empresa_id uuid default null
)
returns table (
  pendiente_importe numeric,
  pendiente_cantidad bigint,
  cobrado_mes_importe numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los contrarreembolsos' using errcode = '42501';
  end if;

  return query
  select coalesce(sum(cr.importe) filter (where cr.estado = 'pendiente'), 0),
         count(*) filter (where cr.estado = 'pendiente'),
         coalesce(sum(cr.importe) filter (
           where cr.estado = 'cobrado'
             and cr.cobrado_en >= date_trunc('month', now())
         ), 0)
    from dominio.contrarreembolsos cr
   where cr.organizacion_id = (select private.organizacion_id())
     and cr.empresa_id in (select private.empresas_accesibles())
     and (p_empresa_id is null or cr.empresa_id = p_empresa_id);
end;
$$;

revoke execute on function public.resumen_contrarreembolsos(uuid) from public, anon;
grant execute on function public.resumen_contrarreembolsos(uuid) to authenticated;

comment on function public.resumen_contrarreembolsos(uuid) is
  'Totales de los contrarreembolsos (F-VTA-14, FR-045): importe y cantidad pendientes, e importe cobrado en el mes en curso. Filtro opcional por tienda. Solo lectura (manda la RLS de dominio).';
