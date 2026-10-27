-- F-REN-07 (MSF-280, épica MSF-127): margen histórico con la cotización de cada fecha.
-- Esquema (Principio VII): `analitica` es solo de vistas y funciones de apoyo; sin tablas ni RLS.
--
-- Funciones (SECURITY DEFINER, `search_path = ''`, sin ejecución para `anon`/`authenticated`):
--   analitica.costo_en_fecha(producto, organización, fecha): último costo de la historia con
--     `vigente_desde <= fecha`; null si no hay (no se inventa un costo anterior al primer registro).
--   analitica.cotizacion_cercana(organización, fecha): carga de `dominio.cotizaciones` de menor
--     distancia temporal a la fecha; a igual distancia, la anterior; null si no hay cotizaciones.
--
-- Vista `analitica.margen_historico_producto_canal`: una fila por producto activo × empresa activa ×
-- fecha de la serie (cada cambio de costo y cada carga de cotización de la organización). El precio es
-- el neto de la tienda vigente hoy en su moneda (regla de precios de la empresa), convertido con la
-- cotización más cercana a ESA fecha, igual que el costo. Sin costo registrado hasta la fecha, sin neto
-- positivo o sin cotización (para importes en USD) no hay fila: no se inventa margen.
-- Aislamiento: igual que la vista base; cada fila lleva `organizacion_id` para la cláusula `rls`.
--
-- Migración aditiva. Reversión (migración posterior; nada guarda datos):
--   drop view analitica.margen_historico_producto_canal;
--   drop function analitica.costo_en_fecha(uuid, uuid, timestamptz);
--   drop function analitica.cotizacion_cercana(uuid, timestamptz);

create or replace function analitica.costo_en_fecha(p_producto uuid, p_organizacion uuid, p_fecha timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select h.costo
  from dominio.producto_costos_historial h
  where h.producto_id = p_producto
    and h.organizacion_id = p_organizacion
    and h.vigente_desde <= p_fecha
  order by h.vigente_desde desc, h.id desc
  limit 1;
$$;

comment on function analitica.costo_en_fecha(uuid, uuid, timestamptz) is
  'F-REN-07: costo vigente de un producto en una fecha (último registrado hasta ella); null si no hay.';

create or replace function analitica.cotizacion_cercana(p_organizacion uuid, p_fecha timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select c.valor
  from dominio.cotizaciones c
  where c.organizacion_id = p_organizacion
  order by abs(extract(epoch from (c.cargada_en - p_fecha))), c.cargada_en, c.id
  limit 1;
$$;

comment on function analitica.cotizacion_cercana(uuid, timestamptz) is
  'F-REN-07: cotización cargada más cercana a la fecha; a igual distancia, la anterior; null si no hay cotizaciones.';

revoke execute on function analitica.costo_en_fecha(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function analitica.cotizacion_cercana(uuid, timestamptz) from public, anon, authenticated;
grant execute on function analitica.costo_en_fecha(uuid, uuid, timestamptz) to superset_analitica;
grant execute on function analitica.cotizacion_cercana(uuid, timestamptz) to superset_analitica;

create or replace view analitica.margen_historico_producto_canal as
select
  f.organizacion_id,
  e.id as empresa_id,
  e.nombre as empresa_nombre,
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.sku,
  f.fecha,
  x.cotizacion,
  x.precio_neto,
  x.costo,
  x.precio_neto - x.costo as margen,
  (x.precio_neto - x.costo) / x.precio_neto as margen_pct
from (
  select h.organizacion_id, h.producto_id, h.vigente_desde as fecha
  from dominio.producto_costos_historial h
  union
  select p2.organizacion_id, p2.id, c.cargada_en
  from dominio.productos p2
  join dominio.cotizaciones c on c.organizacion_id = p2.organizacion_id
) f
join dominio.productos p on p.id = f.producto_id and p.organizacion_id = f.organizacion_id
join dominio.empresas e on e.organizacion_id = p.organizacion_id
left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
cross join lateral (select analitica.cotizacion_cercana(f.organizacion_id, f.fecha) as cotizacion) q
cross join lateral (
  select
    q.cotizacion as cotizacion,
    private.aplicar_regla_precio(
      case when p.moneda = 'ARS' then p.precio_lista
           when p.moneda = 'USD' then round(p.precio_lista * q.cotizacion, 2) end,
      coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
    ) as precio_neto,
    case when p.moneda = 'ARS' then analitica.costo_en_fecha(p.id, p.organizacion_id, f.fecha)
         when p.moneda = 'USD' then round(analitica.costo_en_fecha(p.id, p.organizacion_id, f.fecha) * q.cotizacion, 2) end as costo
) x
where p.activo
  and e.activa
  and q.cotizacion is not null
  and x.precio_neto > 0
  and x.costo is not null;

comment on view analitica.margen_historico_producto_canal is
  'F-REN-07: margen por producto × tienda × fecha (cambios de costo y cargas de cotización), con costo vigente ese día y neto/costo en pesos con la cotización más cercana. Sin fila si falta costo, neto positivo o cotización. Contrato en specs/20261024-130000-rentabilidad-comparativos-e-historia/contracts/analitica-comparativos-historia.md.';

revoke all on analitica.margen_historico_producto_canal from public, anon, authenticated;
grant select on analitica.margen_historico_producto_canal to superset_analitica;
