-- F-PRE-07 (MSF-172, épica MSF-114): precio neto por empresa (cálculo al leer).
-- Esquema: sin tablas nuevas (funciones en `private`, vista y RPC de lectura en `public` que no
-- almacenan datos; Principio VII). No se guarda ningún precio en pesos.
--
-- Contrato: neto = central                                      (base «central» o sin regla)
--                | round(central × (1 + ajuste/100) / 10) × 10  (base «central_ajuste»)
-- La moneda de la tienda es ARS. Punto de extensión: el «precio propio por empresa» (MSF-352)
-- se sumaría dentro de `private.precio_neto_empresa`, no en las pantallas.
--
-- La vista y la vista previa devuelven filas solo a quien tiene la sección `empresas`
-- (lectura o edición): la regla vive bajo esa sección y, sin verla, el cálculo se vería como
-- «Igual al central» (un precio equivocado). Mejor sin filas que un precio engañoso.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.previsualizar_precios_empresa(uuid, text, numeric, integer);
--   drop view public.precios_empresa_neto;
--   drop function private.precio_neto_empresa(uuid, uuid);
--   drop function private.aplicar_regla_precio(numeric, text, numeric, integer);

create or replace function private.aplicar_regla_precio(
  p_central numeric, p_base text, p_ajuste numeric, p_redondeo integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_central is null then null
    when p_base = 'central_ajuste' then
      round(p_central * (1 + p_ajuste / 100) / p_redondeo) * p_redondeo
    else p_central
  end;
$$;

comment on function private.aplicar_regla_precio(numeric, text, numeric, integer) is
  'F-PRE-07: aplica la regla de la empresa a un precio central en pesos. Única fórmula del neto.';

-- Neto de un producto para una empresa. Una empresa que el llamador no ve (o de otra
-- organización que el producto) no inventa un precio: devuelve null.
create or replace function private.precio_neto_empresa(p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select private.aplicar_regla_precio(
    private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id),
    coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
  )
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  where p.id = p_producto;
$$;

comment on function private.precio_neto_empresa(uuid, uuid) is
  'F-PRE-07: precio neto (sin IVA, en pesos) de un producto para una empresa; null si USD sin cotización o empresa ajena.';

create or replace view public.precios_empresa_neto
with (security_invoker = true)
as
select
  p.id as producto_id,
  e.id as empresa_id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.moneda,
  x.central as central_ars,
  private.aplicar_regla_precio(
    x.central, coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
  ) as neto_ars
from dominio.productos p
join dominio.empresas e on e.organizacion_id = p.organizacion_id
left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
cross join lateral (select private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id) as central) x
where (select private.nivel_seccion('empresas')) in ('lectura', 'edicion');

comment on view public.precios_empresa_neto is
  'F-PRE-07: central y neto en pesos (sin IVA) por producto y empresa. Solo con la sección empresas.';

revoke all on public.precios_empresa_neto from public, anon, authenticated;
grant select on public.precios_empresa_neto to authenticated;

-- Vista previa del ajuste sin guardar: misma fórmula, en el servidor, sobre una muestra de
-- productos activos de la organización (los primeros por nombre).
create or replace function public.previsualizar_precios_empresa(
  p_empresa uuid,
  p_base text,
  p_ajuste_pct numeric default 0,
  p_muestra integer default 6
)
returns table (
  producto_id uuid,
  nombre text,
  sku text,
  moneda text,
  central_ars numeric,
  neto_ars numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_ajuste numeric;
begin
  if v_organizacion is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los precios de la empresa' using errcode = '42501';
  end if;
  if p_base is null or p_base not in ('central', 'central_ajuste') then
    raise exception 'Elegí una base de precio válida' using errcode = '23514';
  end if;
  v_ajuste := case when p_base = 'central' then 0 else p_ajuste_pct end;
  if v_ajuste is null or v_ajuste <= -100 or v_ajuste <> round(v_ajuste, 3) then
    raise exception 'El ajuste debe ser mayor a −100 %% y tener hasta 3 decimales' using errcode = '23514';
  end if;
  if abs(v_ajuste) >= 10000 then
    raise exception 'El ajuste es demasiado grande' using errcode = '22003';
  end if;
  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_organizacion
  ) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'P0002';
  end if;

  return query
  select p.id, p.nombre, p.sku, p.moneda, x.central,
         private.aplicar_regla_precio(x.central, p_base, v_ajuste, 10)
    from dominio.productos p
    cross join lateral (select private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id) as central) x
   where p.organizacion_id = v_organizacion and p.activo
   order by lower(p.nombre), p.id
   limit least(greatest(coalesce(p_muestra, 6), 1), 20);
end;
$$;

comment on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) is
  'F-PRE-07: neto de una muestra de productos con una regla sin guardar. 42501 sin sección empresas, 23514 inválido, P0002 empresa inexistente.';

revoke execute on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) from public, anon;
grant execute on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) to authenticated;

revoke execute on function private.aplicar_regla_precio(numeric, text, numeric, integer) from public, anon;
revoke execute on function private.precio_neto_empresa(uuid, uuid) from public, anon;
grant execute on function private.aplicar_regla_precio(numeric, text, numeric, integer) to authenticated;
grant execute on function private.precio_neto_empresa(uuid, uuid) to authenticated;
