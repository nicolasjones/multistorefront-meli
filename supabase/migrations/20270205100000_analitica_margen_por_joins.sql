-- Rentabilidad: la vista `analitica.margen_producto_canal` calcula el mismo margen pero con joins en lugar de
-- llamadas a funciones por fila. Migración aditiva (misma definición lógica, mismas columnas y tipos).
--
-- Por qué: la versión anterior llamaba, por cada fila producto × tienda, a `analitica.neto_empresa`,
-- `analitica.a_pesos` y `analitica.costos_adicionales_de`. Son funciones SQL `security definer` con `set search_path`,
-- que el planificador no puede inlinar, y el consolidado, el resumen y el comparativo recalculaban todo varias veces.
-- Con ~4.600 filas (catálogo demo) `rentabilidad_conteo_margen()` tardaba ~40 s y el rol `authenticated` corta a los 8 s:
-- la pantalla de Rentabilidad respondía 500 («No pudimos cargar esta información»). Medido en dev contra la versión
-- anterior: vista base 3,4–4,8 s → 64 ms; consolidado 7 s → 122 ms; 0 diferencias en precio, costo, margen,
-- margen_pct, estado y costos adicionales sobre las 4.574 filas.
--
-- La lógica de negocio no cambia y sigue sin guardarse ningún importe (se calcula al leer):
--   precio_neto          = regla de precio de la tienda (igual a private.aplicar_regla_precio) sobre el precio de lista en pesos
--   precio de lista/costo en pesos = ARS tal cual; USD × cotización vigente (`dominio.cotizacion_inicial`); otra moneda → null
--   costos_adicionales   = Σ (porcentaje del neto | monto fijo) de los costos activos de la tienda
-- Equivalen a `private.precio_neto_empresa`, `private.a_pesos` y `analitica.costos_adicionales_de`, que se conservan
-- (las usan otras vistas y pantallas). Si cambia alguna de esas reglas, esta vista debe cambiar con ella.
--
-- Reversión: volver a la definición de `20270202201002_analitica_margen_costos_adicionales.sql`.

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
join dominio.empresas e on e.organizacion_id = p.organizacion_id
join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
left join dominio.rentabilidad_config c on c.organizacion_id = p.organizacion_id
left join dominio.cotizacion_inicial ci on ci.organizacion_id = p.organizacion_id
left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
cross join lateral (
  select case when p.precio_lista is null then null when p.moneda = 'ARS' then p.precio_lista when p.moneda = 'USD' then round(p.precio_lista * ci.valor, 2) end as lista
) l
cross join lateral (
  -- Regla de precio de la tienda, escrita acá y no como llamada a `private.aplicar_regla_precio`: el permiso de EJECUTAR una
  -- función se comprueba contra quien consulta (el rol de solo lectura de Superset), no contra el dueño de la vista, y ese rol no
  -- puede ejecutar funciones de `private`. Misma fórmula que esa función.
  select case when l.lista is null then null
              when coalesce(r.base, 'central') = 'central_ajuste'
                then round(l.lista * (1 + coalesce(r.ajuste_pct, 0) / 100) / coalesce(r.redondeo_pesos, 10)) * coalesce(r.redondeo_pesos, 10)
              else l.lista end as precio_neto
) n
cross join lateral (
  select n.precio_neto,
         case when k.costo is null then null when p.moneda = 'ARS' then k.costo when p.moneda = 'USD' then round(k.costo * ci.valor, 2) end as costo,
         (select coalesce(sum(case a.tipo when 'porcentaje' then n.precio_neto * a.valor / 100 else a.valor end), 0)
            from dominio.costos_adicionales_canal a where a.empresa_id = e.id and a.activo) as costos_adicionales
) x
where p.activo and e.activa and x.precio_neto > 0 and x.costo is not null;
