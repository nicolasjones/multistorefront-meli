-- F-REN-08 (MSF-209, épica MSF-192): `analitica.margen_producto_canal` descuenta los costos adicionales
-- activos de cada tienda. Esquema: `analitica` (solo vistas y funciones; no almacena datos).
--
-- `analitica.costos_adicionales_de(empresa, neto)` = costos por UNIDAD: Σ porcentaje × neto / 100 +
-- Σ montos de los costos activos de la empresa. Es SECURITY DEFINER (como los envoltorios de MSF-120)
-- porque el rol de Superset no toca `dominio`. F-REN-09 la reutiliza para ventas reales.
--
-- Redefinición COMPATIBLE de la vista: mismas columnas en el mismo orden y `costos_adicionales` al final;
-- `margen` pasa a ser neto − costo − costos adicionales (BREAKING solo con costos activos; sin ellos los
-- valores son idénticos a MSF-120). `comision` sigue en 0. Las vistas derivadas (resumen, comparativo,
-- historia) leen esta vista y heredan el cambio. `create or replace` conserva los grants.
--
-- Migración aditiva. Reversión (migración posterior): restituir la vista con su definición de
-- 20261130100200 y luego
--   drop function analitica.costos_adicionales_de(uuid, numeric);

create or replace function analitica.costos_adicionales_de(p_empresa_id uuid, p_neto numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case c.tipo when 'porcentaje' then p_neto * c.valor / 100 else c.valor end), 0)
    from dominio.costos_adicionales_canal c
   where c.empresa_id = p_empresa_id and c.activo;
$$;

comment on function analitica.costos_adicionales_de(uuid, numeric) is
  'F-REN-08: costos adicionales por unidad de una tienda (% sobre el neto + montos), solo los activos. SECURITY DEFINER para el rol de Superset.';

revoke execute on function analitica.costos_adicionales_de(uuid, numeric) from public, anon, authenticated;

create or replace view analitica.margen_producto_canal as
select
  p.organizacion_id,
  e.id as empresa_id,
  e.nombre as empresa_nombre,
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.sku,
  x.precio_neto,
  x.costo,
  0::numeric as comision,
  x.precio_neto - x.costo - x.costos_adicionales as margen,
  (x.precio_neto - x.costo - x.costos_adicionales) / x.precio_neto as margen_pct,
  case
    when (x.precio_neto - x.costo - x.costos_adicionales) / x.precio_neto < 0 then 'negativo'
    when (x.precio_neto - x.costo - x.costos_adicionales) / x.precio_neto < coalesce(c.umbral_margen_bajo, 0.10) then 'bajo'
    else 'ok'
  end as estado,
  x.costos_adicionales
from dominio.productos p
join dominio.empresas e on e.organizacion_id = p.organizacion_id
join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
left join dominio.rentabilidad_config c on c.organizacion_id = p.organizacion_id
cross join lateral (
  select
    n.precio_neto,
    analitica.a_pesos(k.costo, p.moneda, p.organizacion_id) as costo,
    analitica.costos_adicionales_de(e.id, n.precio_neto) as costos_adicionales
  from (select analitica.neto_empresa(p.id, e.id) as precio_neto) n
) x
where p.activo
  and e.activa
  and x.precio_neto > 0
  and x.costo is not null;

comment on view analitica.margen_producto_canal is
  'F-REN-01/F-REN-08: margen por producto y tienda sobre el neto sin IVA (margen = neto − costo − comisión − costos adicionales; comisión 0). Sin fila si falta costo, neto positivo o cotización. Contrato en specs/20270201-100000-rentabilidad-real-y-reportes-de-ventas/contracts/.';
