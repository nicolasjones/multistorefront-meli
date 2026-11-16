-- F-PRE-11 (MSF-439, épica MSF-363): cálculo único del precio vigente con promoción y vista de estado.
-- FR-014, FR-015.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * private.promocion_vigente / precio_con_iva_visible / precio_vigente_empresa / precios_promocion_sesion
--     -> `private` (cálculo; sin acceso para anon, y authenticated solo a la variante de sesión).
--   * public.promociones_precio_estado -> `public` (vista `security_invoker`; no almacena datos).
--
-- Orden del cálculo (una sola fórmula, la de Precios; no se duplica):
--   neto normal de la empresa (precio_final_publico: escala x1 + regla) ─┐
--   si hay promoción NO anulada con desde ≤ ahora < hasta ⇒ el neto es el precio promocional (fijo, sin IVA)
--   → alícuota del producto/categoría → interruptor «Precios que ve el cliente» de la empresa.
--
-- Desvío respecto del plan: el «precio normal» (y el anterior) sale de `private.precio_final_publico`, no de
-- `private.precio_neto_empresa`. Es el precio que la tienda ya muestra hoy (incluye la escala x1 y el
-- interruptor de IVA), así que SIN promoción el resultado es idéntico al actual y `precio_anterior` es lo
-- que el cliente veía antes. La promoción solo sustituye el neto de partida.
--
-- Si el precio normal no es calculable (producto no asignado a la empresa, USD sin cotización) el
-- resultado es null: no se inventa un precio.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.promociones_precio_estado;
--   drop function private.precios_promocion_sesion(uuid, uuid, numeric);
--   drop function private.precio_vigente_empresa(uuid, uuid, timestamptz);
--   drop function private.precio_con_iva_visible(uuid, uuid, numeric);
--   drop function private.promocion_vigente(uuid, uuid, timestamptz);

-- Precio promocional (sin IVA) que rige en `p_ahora`, o null. El intervalo es [desde, hasta).
create or replace function private.promocion_vigente(p_producto uuid, p_empresa uuid, p_ahora timestamptz default now())
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select x.precio_promocional
    from dominio.promociones_precio x
   where x.producto_id = p_producto
     and x.empresa_id = p_empresa
     and x.anulada_at is null
     and x.desde <= p_ahora
     and p_ahora < x.hasta
   order by x.desde desc
   limit 1;
$$;

revoke execute on function private.promocion_vigente(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Aplica alícuota e interruptor de la empresa a un neto dado (misma regla que precio_final_publico).
create or replace function private.precio_con_iva_visible(p_producto uuid, p_empresa uuid, p_neto numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce(r.mostrar_con_iva, false)
             then private.aplicar_iva(p_neto, al.porcentaje, coalesce(al.exento, false))
           else p_neto
         end
    from dominio.productos p
    join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
    left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
    left join dominio.alicuotas_iva al
      on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
   where p.id = p_producto;
$$;

revoke execute on function private.precio_con_iva_visible(uuid, uuid, numeric) from public, anon, authenticated;

-- FR-014 · cálculo único. `precio_anterior` es el precio normal y solo viene con una promoción vigente
-- (null si no la hay). Sin guardia de sesión (la usan las funciones públicas bajo `anon`): el aislamiento
-- lo da quien la llama, igual que precio_final_publico.
create or replace function private.precio_vigente_empresa(p_producto uuid, p_empresa uuid, p_ahora timestamptz default now())
returns table (precio numeric, precio_anterior numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when n.v is null then null
           when pr.v is null then n.v
           else private.precio_con_iva_visible(p_producto, p_empresa, pr.v)
         end,
         case when n.v is null or pr.v is null then null else n.v end
    from (select private.precio_final_publico(p_producto, p_empresa) as v) n
    cross join (select private.promocion_vigente(p_producto, p_empresa, p_ahora) as v) pr;
$$;

comment on function private.precio_vigente_empresa(uuid, uuid, timestamptz) is
  'F-PRE-11: precio público vigente de un producto para una empresa en p_ahora: la promoción (si rige) reemplaza el neto, luego alícuota e interruptor de IVA. precio_anterior = precio normal, solo con promoción vigente. Sin promoción ≡ private.precio_final_publico. Sin acceso para anon/authenticated.';

revoke execute on function private.precio_vigente_empresa(uuid, uuid, timestamptz) from public, anon, authenticated;

-- Variante para la vista de estado (la lee `authenticated`): solo responde si producto y empresa son de
-- la organización de la sesión. Devuelve el precio normal que ve el cliente y el promocional con la misma
-- regla de IVA, ambos comparables entre sí.
create or replace function private.precios_promocion_sesion(p_producto uuid, p_empresa uuid, p_promocional numeric)
returns table (precio_normal numeric, precio_promocional_visible numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select private.precio_final_publico(p_producto, p_empresa),
         private.precio_con_iva_visible(p_producto, p_empresa, p_promocional)
   where exists (
           select 1 from dominio.productos p
            where p.id = p_producto and p.organizacion_id = (select private.organizacion_id())
         )
     and exists (
           select 1 from dominio.empresas e
            where e.id = p_empresa and e.organizacion_id = (select private.organizacion_id())
         );
$$;

comment on function private.precios_promocion_sesion(uuid, uuid, numeric) is
  'F-PRE-11: precio normal y promocional (ambos como los ve el cliente) para la vista promociones_precio_estado. Acotada a la organización de la sesión; fuera de ella no devuelve filas.';

revoke execute on function private.precios_promocion_sesion(uuid, uuid, numeric) from public, anon;
grant execute on function private.precios_promocion_sesion(uuid, uuid, numeric) to authenticated;

-- FR-015 · estado derivado por fecha (sin tarea programada). `security_invoker`: rige la RLS de la tabla.
create or replace view public.promociones_precio_estado
with (security_invoker = true)
as
select
  x.id,
  x.organizacion_id,
  x.empresa_id,
  e.nombre as empresa_nombre,
  x.producto_id,
  p.nombre as producto_nombre,
  p.sku as producto_sku,
  x.precio_promocional,
  x.desde,
  x.hasta,
  x.anulada_at,
  x.created_at,
  x.updated_at,
  s.estado,
  v.precio_normal,
  v.precio_promocional_visible,
  case when s.estado = 'vigente' then v.precio_promocional_visible else v.precio_normal end as precio_vigente
from dominio.promociones_precio x
join dominio.productos p on p.id = x.producto_id and p.organizacion_id = x.organizacion_id
join dominio.empresas e on e.id = x.empresa_id and e.organizacion_id = x.organizacion_id
cross join lateral (
  select case
           when x.anulada_at is not null then 'anulada'
           when now() < x.desde then 'programada'
           when now() < x.hasta then 'vigente'
           else 'vencida'
         end as estado
) s
left join lateral private.precios_promocion_sesion(x.producto_id, x.empresa_id, x.precio_promocional) v on true;

comment on view public.promociones_precio_estado is
  'F-PRE-11: cada promoción con su estado derivado por fecha (programada, vigente, vencida, anulada), el precio normal y el vigente de la empresa tal como los ve el cliente.';

revoke all on public.promociones_precio_estado from public, anon, authenticated;
grant select on public.promociones_precio_estado to authenticated;
