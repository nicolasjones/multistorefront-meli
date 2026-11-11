-- MSF-161 · F-VTA-26 (MSF-257, spec 20261110-100000-ventas-avisos-de-faltantes, FR-008):
-- `public.listar_faltantes` suma `aviso` y `aviso_en` por faltante y el filtro `p_aviso`.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.faltantes_venta              dominio (existente)  el faltante que se lista.
--   dominio.faltantes_avisos             dominio (existente)  el aviso derivado de la cola (F-STK-17).
--   dominio.comprobantes_venta(_lineas)  dominio (existente)  la factura y la línea del faltante.
--   dominio.empresas / dominio.productos dominio (existente)  tienda y producto.
--   public.clientes / public.stock_estados  plataforma        cliente y stock de hoy.
-- Ninguna tabla se crea ni se altera: solo cambia la RPC de lectura.
--
-- Cambio de firma: `listar_faltantes(uuid, integer, integer)` se reemplaza por
-- `listar_faltantes(uuid, integer, integer, text)` (`p_aviso` con valor por defecto: las llamadas por nombre
-- con tres parámetros siguen resolviendo). Un solo `drop` + `create`, con `revoke`/`grant` explícitos.
--
-- Reglas:
--   * `aviso = 'avisado'` si la línea del faltante tiene una fila de la cola en `pendiente` o `enviado`
--     (misma semántica que `public.faltantes_listado` de F-STK-17); si no, `sin_avisar`. `aviso_en` =
--     `coalesce(enviado_en, created_at)` de esa fila cuando está avisado, si no null.
--   * `p_aviso` ∈ {null, 'sin_avisar', 'avisado'}; otro valor -> 22023. (`para_avisar` llega con F-VTA-27.)
--   * Todo lo demás igual que en F-VTA-18 (20270112130300): solo abiertos, solo tiendas con `ventas` al
--     menos en lectura, organización de la sesión, paginación en el servidor (tope 200), orden `desde`
--     descendente y `id`.
--
-- Migración idempotente (`drop … if exists`, `create or replace`). Reversión (migración posterior):
--   drop function if exists public.listar_faltantes(uuid, integer, integer, text);
--   -- y restaurar public.listar_faltantes(uuid, integer, integer) con su grant a authenticated
--   -- (definición de 20270112130300).

drop function if exists public.listar_faltantes(uuid, integer, integer);

create or replace function public.listar_faltantes(
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10,
  p_aviso text default null
)
returns table (
  id uuid,
  empresa_id uuid,
  empresa text,
  cliente text,
  producto text,
  sku text,
  cantidad_faltante integer,
  linea_orden integer,
  comprobante_id uuid,
  comprobante text,
  fecha date,
  desde timestamptz,
  stock_estado text,
  stock_disponible integer,
  aviso text,
  aviso_en timestamptz,
  filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[];
  v_limite integer := least(greatest(coalesce(p_tamano, 10), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver los faltantes' using errcode = '42501';
  end if;
  if p_aviso is not null and p_aviso not in ('sin_avisar', 'avisado') then
    raise exception 'El filtro de aviso no es válido' using errcode = '22023';
  end if;

  -- Las empresas visibles: las de la organización donde la persona tiene Ventas al menos en lectura (mismo
  -- predicado que la política de RLS de los faltantes).
  select coalesce(array_agg(e.id), '{}') into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and (select private.puede_leer_faltantes_empresa(e.id));

  return query
  with base as (
    select f.id,
           f.empresa_id,
           e.nombre as empresa,
           cl.nombre as cliente,
           pr.nombre as producto,
           pr.sku,
           f.cantidad_faltante,
           f.linea_orden,
           c.id as comprobante_id,
           c.numero as comprobante,
           c.fecha,
           f.creado_en as desde,
           s.estado as stock_estado,
           s.disponible as stock_disponible,
           case when a.linea_id is not null then 'avisado' else 'sin_avisar' end as aviso,
           case when a.linea_id is not null then coalesce(a.enviado_en, a.created_at) end as aviso_en
      from dominio.faltantes_venta f
      join dominio.empresas e
        on e.id = f.empresa_id and e.organizacion_id = f.organizacion_id
      join dominio.comprobantes_venta c
        on c.id = f.comprobante_id and c.organizacion_id = f.organizacion_id
      join public.clientes cl
        on cl.id = c.cliente_id and cl.organizacion_id = f.organizacion_id
      join dominio.productos pr
        on pr.id = f.producto_id and pr.organizacion_id = f.organizacion_id
      left join public.stock_estados s
        on s.producto_id = f.producto_id and s.organizacion_id = f.organizacion_id
      left join dominio.comprobantes_venta_lineas l
        on l.comprobante_id = f.comprobante_id and l.orden = f.linea_orden
       and l.organizacion_id = f.organizacion_id
      left join dominio.faltantes_avisos a
        on a.linea_id = l.id and a.organizacion_id = f.organizacion_id
       and a.estado in ('pendiente', 'enviado')
     where f.organizacion_id = v_org
       and f.estado = 'abierto'
       and f.empresa_id = any (v_empresas)
       and (p_empresa_id is null or f.empresa_id = p_empresa_id)
  )
  select b.id, b.empresa_id, b.empresa, b.cliente, b.producto, b.sku, b.cantidad_faltante, b.linea_orden,
         b.comprobante_id, b.comprobante, b.fecha, b.desde, b.stock_estado, b.stock_disponible,
         b.aviso, b.aviso_en,
         count(*) over () as filas
    from base b
   where p_aviso is null or b.aviso = p_aviso
   order by b.desde desc, b.id
   limit v_limite
  offset (v_pagina - 1) * v_limite;
end;
$$;

comment on function public.listar_faltantes(uuid, integer, integer, text) is
  'Faltantes de venta ABIERTOS, paginados, con cliente, producto, SKU, cantidad, comprobante, fecha del pedido, «desde», el stock de hoy y el aviso (sin_avisar | avisado, derivado de la cola de F-STK-17) con su fecha; p_aviso filtra. Solo de las empresas donde la persona tiene Ventas en lectura (F-VTA-18 FR-043, F-VTA-26 FR-008).';

revoke execute on function public.listar_faltantes(uuid, integer, integer, text) from public, anon;
grant execute on function public.listar_faltantes(uuid, integer, integer, text) to authenticated;
