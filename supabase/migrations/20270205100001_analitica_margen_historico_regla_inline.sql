-- Rentabilidad · Historia: `analitica.margen_historico_producto_canal` llamaba directo a `private.aplicar_regla_precio`.
-- Migración aditiva (misma definición lógica, mismas columnas y tipos). Reversión: volver a la definición de
-- `20270111110100_analitica_margen_historico.sql`.
--
-- Por qué: el permiso de EJECUTAR una función se comprueba contra quien consulta (acá, el rol de solo lectura de Superset,
-- `superset_analitica`), no contra el dueño de la vista, y ese rol no puede ejecutar funciones de `private`. El tablero
-- «Rentabilidad · Historia» fallaba con «permission denied for function aplicar_regla_precio». La regla de precio de la tienda
-- se escribe dentro de la vista (misma fórmula que `private.aplicar_regla_precio`); si esa función cambia, esta vista debe cambiar.
-- Medido en dev contra la versión anterior sobre 60.588 filas: 0 diferencias.

create or replace view analitica.margen_historico_producto_canal as
select f.organizacion_id, e.id as empresa_id, e.nombre as empresa_nombre, p.id as producto_id, p.nombre as producto_nombre, p.sku,
  f.fecha, x.cotizacion, x.precio_neto, x.costo,
  x.precio_neto - x.costo as margen,
  (x.precio_neto - x.costo) / x.precio_neto as margen_pct
from (
  select h.organizacion_id, h.producto_id, h.vigente_desde as fecha from dominio.producto_costos_historial h
  union
  select p2.organizacion_id, p2.id, c.cargada_en from dominio.productos p2 join dominio.cotizaciones c on c.organizacion_id = p2.organizacion_id
) f
join dominio.productos p on p.id = f.producto_id and p.organizacion_id = f.organizacion_id
join dominio.empresas e on e.organizacion_id = p.organizacion_id
left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
cross join lateral (select analitica.cotizacion_cercana(f.organizacion_id, f.fecha) as cotizacion) q
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
