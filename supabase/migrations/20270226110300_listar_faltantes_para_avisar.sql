-- MSF-161 · F-VTA-27 (MSF-270, spec 20261110-100000-ventas-avisos-de-faltantes, FR-103):
-- `public.listar_faltantes` reconoce el estado «Para avisar» y lo acepta como filtro.
--
-- Esquema (Principio VII), verificado objeto por objeto: igual que 20270226100300 (solo lecturas de
-- `dominio.faltantes_venta`, `dominio.faltantes_avisos`, comprobantes, empresas, productos, clientes y
-- `public.stock_estados`). Ninguna tabla se crea ni se altera. Misma firma que F-VTA-26: `create or replace`
-- sin `drop`.
--
-- Reglas:
--   * `aviso`: `avisado` (cola `pendiente`/`enviado`) > `para_avisar` (`para_avisar_en` no nulo y sin aviso en
--     curso; `aviso_en = para_avisar_en`) > `sin_avisar`. Un `agotado` no cuenta como avisado.
--   * `p_aviso` ∈ {null, 'sin_avisar', 'avisado', 'para_avisar'}; otro valor -> 22023.
--   * Con `p_aviso = 'para_avisar'` el orden es del más antiguo al más nuevo (`desde` ascendente, `id`); sin
--     ese filtro, el orden de siempre (`desde` descendente, `id`).
--
-- Migración idempotente (`create or replace`). Reversión (migración posterior): restaurar el cuerpo de
-- 20270226100300 (`create or replace public.listar_faltantes(uuid, integer, integer, text)`).

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
  if p_aviso is not null and p_aviso not in ('sin_avisar', 'avisado', 'para_avisar') then
    raise exception 'El filtro de aviso no es válido' using errcode = '22023';
  end if;

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
           case
             when a.linea_id is not null then 'avisado'
             when f.para_avisar_en is not null then 'para_avisar'
             else 'sin_avisar'
           end as aviso,
           case
             when a.linea_id is not null then coalesce(a.enviado_en, a.created_at)
             else f.para_avisar_en
           end as aviso_en
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
   order by case when p_aviso = 'para_avisar' then b.desde end asc nulls last,
            b.desde desc,
            b.id
   limit v_limite
  offset (v_pagina - 1) * v_limite;
end;
$$;

comment on function public.listar_faltantes(uuid, integer, integer, text) is
  'Faltantes de venta ABIERTOS, paginados, con cliente, producto, SKU, cantidad, comprobante, fecha del pedido, «desde», el stock de hoy y el aviso (sin_avisar | para_avisar | avisado) con su fecha; p_aviso filtra y con para_avisar ordena del más antiguo al más nuevo. Solo de las empresas donde la persona tiene Ventas en lectura (F-VTA-18 FR-043, F-VTA-26 FR-008, F-VTA-27 FR-103).';

revoke execute on function public.listar_faltantes(uuid, integer, integer, text) from public, anon;
grant execute on function public.listar_faltantes(uuid, integer, integer, text) to authenticated;
