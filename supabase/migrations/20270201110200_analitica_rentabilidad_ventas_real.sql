-- F-REN-09 (MSF-223, épica MSF-192, spec 20270201-100000-rentabilidad-real-y-reportes-de-ventas, FR-008):
-- vista `analitica.rentabilidad_ventas_real`, el margen de lo efectivamente vendido.
--
-- Esquema (Principio VII): SIN tablas nuevas; solo una vista del esquema `analitica` (solo vistas y funciones de
-- apoyo). Lee `dominio.comprobantes_venta`, `dominio.comprobantes_venta_lineas` (con el costo y la cotización
-- guardados por 20270201110100), `dominio.empresas`, `dominio.productos` y `dominio.rentabilidad_config`.
-- `analitica` no tiene tablas → `rls_en_toda_tabla` sigue verde.
--
-- Aislamiento: sin acceso para `anon` ni `authenticated`; la lee el rol `superset_analitica` y la separación por
-- organización la fuerza la cláusula `rls` del guest token (`organizacion_id`). El costo y el margen no los ve nadie
-- sin la sección `rentabilidad`: el tablero se registra con esa sección y la vista no se concede a ningún otro rol.
--
-- Cálculo (FR-008): el predicado y el signo NO se reimplementan: `analitica.comprobante_cuenta_como_facturado`
-- (factura o nota de crédito; no borrador, no anulada, no presupuesto) y `analitica.signo_comprobante` (nota = −1).
--   · `unidades`  = Σ signo × cantidad.
--   · `vendido`   = Σ signo × subtotal_sin_iva (neto sin IVA, como el margen de lista).
--   · `costo`     = Σ signo × cantidad × costo_unitario GUARDADO en la línea (un cambio posterior de costo o
--                   cotización no lo mueve). Las líneas sin costo guardado NO entran (no se inventa costo).
--   · `costos_adicionales` = Σ signo × cantidad × `analitica.costos_adicionales_de(empresa, neto unitario)` con
--                   los costos VIGENTES al consultar (supuesto 4): % sobre el neto vendido + monto por unidad.
--   · `margen` = vendido − costo − costos_adicionales; `margen_pct` = margen / vendido (null si vendido ≤ 0).
-- Un producto dado de baja o una empresa pausada con ventas hechas SÍ cuentan (no se filtra por activo).
--
-- Grano: empresa × producto × fecha. El tablero suma por período; `estado` de cada fila sale del umbral de la
-- organización (`umbral_margen_bajo`, 10 % por defecto) y el tablero lo recalcula sobre el total del período.
--
-- Rendimiento: `organizacion_id` y `empresa_id` son columnas del GROUP BY y del escaneo de
-- `dominio.comprobantes_venta`, así que el filtro del token se empuja al escaneo (Postgres empuja un filtro sobre columnas del GROUP BY; el EXPLAIN queda por correr contra una base con datos).
--
-- Migración aditiva. Reversión (migración posterior; la vista no guarda datos):
--   drop view analitica.rentabilidad_ventas_real;

create or replace view analitica.rentabilidad_ventas_real as
with lineas as (
  select
    v.organizacion_id,
    v.empresa_id,
    l.producto_id,
    v.fecha,
    analitica.signo_comprobante(v.tipo) as signo,
    l.cantidad,
    l.subtotal_sin_iva,
    l.costo_unitario
  from dominio.comprobantes_venta v
  join dominio.comprobantes_venta_lineas l
    on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
  where analitica.comprobante_cuenta_como_facturado(v.tipo, v.estado)
    and l.costo_unitario is not null
),
agregado as (
  select
    x.organizacion_id,
    x.empresa_id,
    x.producto_id,
    x.fecha,
    sum(x.signo * x.cantidad)::bigint as unidades,
    sum(x.signo * x.subtotal_sin_iva)::numeric as vendido,
    sum(x.signo * x.cantidad * x.costo_unitario)::numeric as costo,
    sum(x.signo * x.cantidad * analitica.costos_adicionales_de(x.empresa_id, x.subtotal_sin_iva / x.cantidad))::numeric
      as costos_adicionales
  from lineas x
  group by x.organizacion_id, x.empresa_id, x.producto_id, x.fecha
)
select
  a.organizacion_id,
  a.empresa_id,
  e.nombre as empresa_nombre,
  a.producto_id,
  p.nombre as producto_nombre,
  p.sku,
  a.fecha,
  a.unidades,
  a.vendido,
  a.costo,
  a.costos_adicionales,
  a.vendido - a.costo - a.costos_adicionales as margen,
  case when a.vendido > 0 then (a.vendido - a.costo - a.costos_adicionales) / a.vendido end as margen_pct,
  case
    when a.vendido - a.costo - a.costos_adicionales < 0 then 'negativo'
    when a.vendido > 0
     and (a.vendido - a.costo - a.costos_adicionales) / a.vendido < coalesce(c.umbral_margen_bajo, 0.10) then 'bajo'
    else 'ok'
  end as estado,
  coalesce(c.umbral_margen_bajo, 0.10) as umbral_margen_bajo
from agregado a
join dominio.empresas e on e.id = a.empresa_id and e.organizacion_id = a.organizacion_id
join dominio.productos p on p.id = a.producto_id and p.organizacion_id = a.organizacion_id
left join dominio.rentabilidad_config c on c.organizacion_id = a.organizacion_id;

comment on view analitica.rentabilidad_ventas_real is
  'F-REN-09: margen de lo efectivamente vendido por empresa × producto × fecha, con el costo y la cotización guardados en cada línea al confirmar; las notas de crédito restan; los costos adicionales son los vigentes al consultar; las líneas sin costo guardado no entran. Contrato en specs/20270201-100000-rentabilidad-real-y-reportes-de-ventas/contracts/.';

revoke all on analitica.rentabilidad_ventas_real from public, anon, authenticated;
grant select on analitica.rentabilidad_ventas_real to superset_analitica;
