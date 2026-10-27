-- F-VTA-18 (MSF-201, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-043):
-- `public.listar_faltantes`, el listado paginado de los faltantes ABIERTOS para la pantalla «Ventas · Faltantes».
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.faltantes_venta    dominio (existente, T028)  el faltante que se lista.
--   dominio.comprobantes_venta dominio (existente)        la factura del faltante (número y fecha del pedido).
--   dominio.productos          dominio (existente)        el producto que faltó (nombre y SKU).
--   dominio.empresas           dominio (existente)        la tienda del faltante.
--   public.clientes            plataforma                el cliente de la factura.
--   public.stock_estados       plataforma (existente)    la lectura de Stock de hoy (estado y disponible).
-- Ninguna tabla se crea ni se altera: esta migración es solo la RPC de lectura.
--
-- Reglas (FR-043):
--   · Solo los faltantes ABIERTOS: los resueltos (el armado se reanudó, FR-042) son historial y no se listan.
--   · Solo de las empresas donde la persona tiene Ventas al menos en lectura: es el mismo criterio de la
--     política de RLS de `dominio.faltantes_venta` (`private.puede_leer_faltantes_empresa`), para que lo que
--     ve la pantalla y lo que deja leer la tabla sean exactamente lo mismo.
--   · `p_empresa_id` acota el listado a una tienda; `null` (todas) es el valor por defecto de la pantalla. Una
--     tienda ajena devuelve CERO filas, no un error: el error delataría que esa tienda existe.
--   · La organización y el actor salen de la sesión (JWT), nunca de un argumento.
--   · Paginación en el servidor: `p_pagina` y `p_tamano` (tope 200 por página) y `filas` con el total del
--     filtro actual, como `public.listar_comprobantes` (F-VTA-09).
--   · Orden estable: el faltante más reciente primero (`desde` descendente) y el id como desempate.
--
-- «Stock hoy»: el estado y el disponible del producto en la lectura de Stock que ya existe
-- (`public.stock_estados`, F-STK-05/F-STK-14). Esa vista es `security_invoker` y su RLS de base exige la
-- sección Stock, que una persona de Ventas puede no tener; por eso la RPC la lee como `security definer` y
-- filtra POR ORGANIZACIÓN de forma explícita (`s.organizacion_id = f.organizacion_id`): solo se expone el
-- stock de los productos de los faltantes que la persona ya puede ver en su organización. No se devuelve
-- stock de otra organización ni de productos ajenos al faltante.
--
-- Errores: 42501 sin sesión con organización.
--
-- Migración aditiva. Reversión (en una migración posterior; el listado no guarda datos):
--   drop function if exists public.listar_faltantes(uuid, integer, integer);

create or replace function public.listar_faltantes(
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10
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

  -- Las empresas visibles: las de la organización donde la persona tiene Ventas al menos en lectura. Es el
  -- mismo predicado que la política de RLS de los faltantes (`private.puede_leer_faltantes_empresa`), así que
  -- el listado no puede mostrar más que la tabla.
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
           s.disponible as stock_disponible
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
     where f.organizacion_id = v_org
       and f.estado = 'abierto'
       and f.empresa_id = any (v_empresas)
       and (p_empresa_id is null or f.empresa_id = p_empresa_id)
  )
  select b.id, b.empresa_id, b.empresa, b.cliente, b.producto, b.sku, b.cantidad_faltante, b.linea_orden,
         b.comprobante_id, b.comprobante, b.fecha, b.desde, b.stock_estado, b.stock_disponible,
         count(*) over () as filas
    from base b
   order by b.desde desc, b.id
   limit v_limite
  offset (v_pagina - 1) * v_limite;
end;
$$;

comment on function public.listar_faltantes(uuid, integer, integer) is
  'Faltantes de venta ABIERTOS, paginados, con cliente, producto, SKU, cantidad, comprobante, fecha del pedido, «desde» y el stock de hoy (estado y disponible). Solo de las empresas donde la persona tiene Ventas en lectura (F-VTA-18, FR-043).';

revoke execute on function public.listar_faltantes(uuid, integer, integer) from public, anon;
grant execute on function public.listar_faltantes(uuid, integer, integer) to authenticated;
