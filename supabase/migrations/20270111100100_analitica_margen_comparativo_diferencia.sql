-- F-REN-06 (MSF-261): suma a `analitica.margen_comparativo_producto` el mejor y el peor margen por
-- producto y la diferencia entre ambos (FR-003). `create or replace view` solo agrega columnas AL FINAL,
-- así que la migración anterior queda intacta y los grants del rol de Superset se conservan.
--   margen_pct_mejor / margen_pct_peor: fracción (0,40 = 40 %), como `margen_pct`.
--   diferencia_pp: (mejor − peor) en PUNTOS PORCENTUALES (40 % vs 33,3 % → 6,67; el tablero lo muestra 6,7).
--   empresa_mejor / empresa_peor: nombre de la empresa; si dos empresas empatan, gana la primera por
--   nombre y luego por id (criterio estable).
--
-- Migración aditiva. Reversión (único camino, invierte esta y 20270111100000_analitica_margen_comparativo.sql):
--   drop view analitica.margen_comparativo_producto;

create or replace view analitica.margen_comparativo_producto as
select
  c.organizacion_id, c.producto_id, c.producto_nombre, c.sku, c.empresa_id, c.empresa_nombre,
  c.precio_neto, c.costo, c.margen, c.margen_pct, c.estado, c.empresas_comparadas,
  max(c.margen_pct) over w as margen_pct_mejor,
  min(c.margen_pct) over w as margen_pct_peor,
  (max(c.margen_pct) over w - min(c.margen_pct) over w) * 100 as diferencia_pp,
  first_value(c.empresa_nombre) over (w_mejor) as empresa_mejor,
  first_value(c.empresa_nombre) over (w_peor) as empresa_peor
from (
  select
    m.*,
    (count(*) over (partition by m.organizacion_id, m.producto_id))::int as empresas_comparadas
  from analitica.margen_producto_canal m
) c
where c.empresas_comparadas >= 2
window
  w as (partition by c.organizacion_id, c.producto_id),
  w_mejor as (partition by c.organizacion_id, c.producto_id
              order by c.margen_pct desc, c.empresa_nombre, c.empresa_id),
  w_peor as (partition by c.organizacion_id, c.producto_id
             order by c.margen_pct, c.empresa_nombre, c.empresa_id);

comment on view analitica.margen_comparativo_producto is
  'F-REN-06: margen del mismo producto por empresa (solo productos en 2 o más empresas) con mejor/peor margen y diferencia en pp. Derivada de margen_producto_canal. Contrato en specs/20261024-130000-rentabilidad-comparativos-e-historia/contracts/analitica-comparativos-historia.md.';
