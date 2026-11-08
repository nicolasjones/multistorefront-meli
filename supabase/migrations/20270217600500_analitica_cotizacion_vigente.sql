-- MSF-352 (revisión de F-PRE-06/F-PRE-08, hallazgo ALTO de Code): la rentabilidad convertía el dólar con la cotización
-- INICIAL, no con la que usa la tienda.
--
-- Escenario: inicial 1.000, aplicada 1.500, producto con precio propio USD 12 y costo USD 10. La tienda cobra
-- $ 18.000 y el costo real es $ 15.000, pero `analitica.margen_producto_canal` calculaba $ 12.000 contra $ 10.000. Con un
-- precio propio en pesos de $ 14.000 mostraba margen +40 % cuando el real es −7 %, y la alerta `margen_negativo` no
-- saltaba. Es plata: el margen tiene que usar la misma cotización que el precio.
--
-- Cambios (Principio VII: solo vistas y funciones de apoyo del esquema `analitica`; ninguna tabla):
--   * `analitica.cotizacion_para(org, empresa)`  NUEVA. Envoltorio SECURITY DEFINER de `private.cotizacion_para` (la
--     cotización aplicada según el alcance: la de la empresa con alcance «empresa» —o la general si aún no tiene—, la
--     general con «sistema», la inicial si no hay ninguna). El permiso de EJECUTAR una función se comprueba contra quien
--     consulta (el rol de solo lectura de Superset, que no puede ejecutar funciones de `private`): por eso el envoltorio,
--     con `execute` solo para `superset_analitica` (como `analitica.a_pesos`).
--   * `analitica.margen_producto_canal`  convierte precio y costo en USD con esa cotización, por empresa (calculada
--     una vez por empresa, no por fila). Mismas columnas y orden, grants y comentario.
--   * `analitica.cotizacion_cercana(org, fecha, empresa)`  NUEVA sobrecarga para la historia: la carga APLICADA
--     (`recalculo_aplicado`; una confirmada bajo el umbral no se usó para cobrar) más cercana a la fecha entre las
--     GENERALES (`empresa_id` nulo) y las de ESA empresa. Límite: un cambio de alcance escribe `cotizacion_aplicada` sin
--     fila en `dominio.cotizaciones`, así que no aparece como punto de la historia. Es exacto sin conocer el alcance de cada
--     fecha porque `cargar_cotizacion` guarda `empresa_id` nulo solo con alcance «sistema» y la empresa solo con
--     «empresa» (`private.empresa_de_cotizacion`): las cargas ajenas nunca aplicaron a esta empresa. La de dos
--     argumentos (solo generales) se conserva.
--   * `analitica.margen_historico_producto_canal`  usa la sobrecarga por empresa y no genera filas con fechas de cargas de
--     otra empresa. NO aplica el precio propio: no tiene historial anterior a esta migración (ver
--     `dominio.precios_propios_historial`) y aplicarlo a fechas pasadas falsearía el margen de esos días.
--
-- Evidencia de la limitación que se conserva: `public.productos_precio_costo` y `analitica.a_pesos` de 3 argumentos valúan
-- con la cotización GENERAL porque no tienen empresa (precio central y valorización de stock son de la organización).
--
-- Migración aditiva. Reversión (migración posterior): restaurar las dos vistas a su cuerpo de 20270213200003 y
-- 20270205100001 y
--   drop function analitica.cotizacion_cercana(uuid, timestamptz, uuid);
--   drop function analitica.cotizacion_para(uuid, uuid);

create or replace function analitica.cotizacion_para(p_organizacion uuid, p_empresa uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select private.cotizacion_para(p_organizacion, p_empresa);
$$;

comment on function analitica.cotizacion_para(uuid, uuid) is
  'MSF-352: envoltorio SECURITY DEFINER de private.cotizacion_para para el rol de Superset (misma cotización aplicada que el precio de la tienda, por empresa según el alcance).';

revoke execute on function analitica.cotizacion_para(uuid, uuid) from public, anon, authenticated;
grant execute on function analitica.cotizacion_para(uuid, uuid) to superset_analitica;

create or replace function analitica.cotizacion_cercana(p_organizacion uuid, p_fecha timestamptz, p_empresa uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select c.valor
  from dominio.cotizaciones c
  where c.organizacion_id = p_organizacion and (c.empresa_id is null or c.empresa_id = p_empresa)
    -- Solo las cargas que se APLICARON: una confirmada bajo el umbral se registra pero la tienda nunca cobró con ella.
    and c.recalculo_aplicado
  order by abs(extract(epoch from (c.cargada_en - p_fecha))), c.cargada_en, c.id
  limit 1;
$$;

comment on function analitica.cotizacion_cercana(uuid, timestamptz, uuid) is
  'MSF-352: cotización APLICADA (recalculo_aplicado) más cercana a la fecha entre las generales y las de la empresa (las de otra empresa nunca le aplicaron); a igual distancia, la anterior; null si no hay.';

revoke execute on function analitica.cotizacion_cercana(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function analitica.cotizacion_cercana(uuid, timestamptz, uuid) to superset_analitica;

create or replace view analitica.margen_producto_canal as
select p.organizacion_id, e.id as empresa_id, e.nombre as empresa_nombre, p.id as producto_id, p.nombre as producto_nombre, p.sku,
  x.precio_neto, x.costo, 0::numeric as comision,
  x.precio_neto - x.costo - x.costos_adicionales as margen,
  (x.precio_neto - x.costo - x.costos_adicionales) / x.precio_neto as margen_pct,
  case when ((x.precio_neto - x.costo - x.costos_adicionales) / x.precio_neto) < 0 then 'negativo'
       when ((x.precio_neto - x.costo - x.costos_adicionales) / x.precio_neto) < coalesce(c.umbral_margen_bajo, 0.10) then 'bajo'
       else 'ok' end as estado,
  x.costos_adicionales
from dominio.productos p
-- La cotización se calcula una vez por empresa (`offset 0` evita que el planificador la evalúe por cada producto).
join (
  select e0.id, e0.organizacion_id, e0.nombre, e0.activa, analitica.cotizacion_para(e0.organizacion_id, e0.id) as cotizacion
    from dominio.empresas e0
  offset 0
) e on e.organizacion_id = p.organizacion_id
join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
left join dominio.rentabilidad_config c on c.organizacion_id = p.organizacion_id
left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
left join dominio.precios_propios_empresa pp on pp.producto_id = p.id and pp.empresa_id = e.id and pp.organizacion_id = p.organizacion_id
cross join lateral (
  select case when p.precio_lista is null then null when p.moneda = 'ARS' then p.precio_lista when p.moneda = 'USD' then round(p.precio_lista * e.cotizacion, 2) end as lista
) l
cross join lateral (
  -- Regla de precio de la tienda, escrita acá y no como llamada a `private.aplicar_regla_precio`: el permiso de EJECUTAR una
  -- función se comprueba contra quien consulta (el rol de solo lectura de Superset), no contra el dueño de la vista, y ese rol no
  -- puede ejecutar funciones de `private`. Misma fórmula que esa función.
  select case when pp.importe is not null
                then case pp.moneda when 'ARS' then pp.importe else round(pp.importe * e.cotizacion, 2) end
              when l.lista is null then null
              when coalesce(r.base, 'central') = 'central_ajuste'
                then round(l.lista * (1 + coalesce(r.ajuste_pct, 0) / 100) / coalesce(r.redondeo_pesos, 10)) * coalesce(r.redondeo_pesos, 10)
              else l.lista end as precio_neto
) n
cross join lateral (
  select n.precio_neto,
         case when k.costo is null then null when p.moneda = 'ARS' then k.costo when p.moneda = 'USD' then round(k.costo * e.cotizacion, 2) end as costo,
         (select coalesce(sum(case a.tipo when 'porcentaje' then n.precio_neto * a.valor / 100 else a.valor end), 0)
            from dominio.costos_adicionales_canal a where a.empresa_id = e.id and a.activo) as costos_adicionales
) x
where p.activo and e.activa and x.precio_neto > 0 and x.costo is not null;

create or replace view analitica.margen_historico_producto_canal as
select f.organizacion_id, e.id as empresa_id, e.nombre as empresa_nombre, p.id as producto_id, p.nombre as producto_nombre, p.sku,
  f.fecha, x.cotizacion, x.precio_neto, x.costo,
  x.precio_neto - x.costo as margen,
  (x.precio_neto - x.costo) / x.precio_neto as margen_pct
from (
  select h.organizacion_id, h.producto_id, h.vigente_desde as fecha, null::uuid as empresa_carga
    from dominio.producto_costos_historial h
  union
  select p2.organizacion_id, p2.id, c.cargada_en, c.empresa_id
    from dominio.productos p2 join dominio.cotizaciones c on c.organizacion_id = p2.organizacion_id and c.recalculo_aplicado
) f
join dominio.productos p on p.id = f.producto_id and p.organizacion_id = f.organizacion_id
join dominio.empresas e on e.organizacion_id = p.organizacion_id and (f.empresa_carga is null or f.empresa_carga = e.id)
left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
cross join lateral (select analitica.cotizacion_cercana(f.organizacion_id, f.fecha, e.id) as cotizacion) q
cross join lateral (
  select case when p.moneda = 'ARS' then p.precio_lista when p.moneda = 'USD' then round(p.precio_lista * q.cotizacion, 2) else null end as lista
) l
cross join lateral (
  -- Regla de precio de la tienda escrita acá (igual a `private.aplicar_regla_precio`): el rol de solo lectura de Superset no
  -- puede ejecutar funciones de `private` y el permiso de ejecutar se comprueba contra quien consulta, no contra el dueño de la vista.
  select q.cotizacion,
         case when l.lista is null then null
              when coalesce(r.base, 'central') = 'central_ajuste'
                then round(l.lista * (1 + coalesce(r.ajuste_pct, 0) / 100) / coalesce(r.redondeo_pesos, 10)) * coalesce(r.redondeo_pesos, 10)
              else l.lista end as precio_neto,
         case when p.moneda = 'ARS' then analitica.costo_en_fecha(p.id, p.organizacion_id, f.fecha)
              when p.moneda = 'USD' then round(analitica.costo_en_fecha(p.id, p.organizacion_id, f.fecha) * q.cotizacion, 2)
              else null end as costo
) x
where p.activo and e.activa and (p.moneda = 'ARS' or q.cotizacion is not null) and x.precio_neto > 0 and x.costo is not null;
