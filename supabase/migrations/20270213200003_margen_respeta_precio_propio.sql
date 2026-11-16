-- MSF-423 (F-PRE-08, épica MSF-352) · FR-014, corrección hallada en la revisión retroactiva: el margen actual por producto
-- y canal (Rentabilidad y la alerta `margen_negativo`) calculaba el neto con la regla de la empresa e ignoraba el precio
-- propio, así que un producto vendido a un precio propio por debajo del costo no aparecía con margen negativo.
--
-- Cambio: `analitica.margen_producto_canal` usa el precio propio (ARS directo; USD × la cotización de la organización,
-- igual que el resto de la vista) cuando existe y la regla de siempre cuando no. Mismas columnas y orden. La vista
-- «Historia» (`margen_historico_producto_canal`) NO cambia: el precio propio no tiene historial y aplicarlo a fechas
-- pasadas falsearía el margen de esos días.
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla (solo se reemplaza una vista de solo lectura).
-- Migración aditiva. Reversión (migración posterior): restaurar la vista a su cuerpo de 20270205100000.

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
left join dominio.precios_propios_empresa pp on pp.producto_id = p.id and pp.empresa_id = e.id and pp.organizacion_id = p.organizacion_id
cross join lateral (
  select case when p.precio_lista is null then null when p.moneda = 'ARS' then p.precio_lista when p.moneda = 'USD' then round(p.precio_lista * ci.valor, 2) end as lista
) l
cross join lateral (
  -- Regla de precio de la tienda, escrita acá y no como llamada a `private.aplicar_regla_precio`: el permiso de EJECUTAR una
  -- función se comprueba contra quien consulta (el rol de solo lectura de Superset), no contra el dueño de la vista, y ese rol no
  -- puede ejecutar funciones de `private`. Misma fórmula que esa función.
  select case when pp.importe is not null
                then case pp.moneda when 'ARS' then pp.importe else round(pp.importe * ci.valor, 2) end
              when l.lista is null then null
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
