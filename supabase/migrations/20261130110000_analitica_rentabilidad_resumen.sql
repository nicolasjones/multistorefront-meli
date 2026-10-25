-- F-REN-02 (MSF-221, épica MSF-120): vistas del Resumen de rentabilidad.
-- Esquema (Principio VII): `analitica` (solo vistas, sin tablas ni RLS), igual que la vista de origen.
-- Aislamiento: igual que `analitica.margen_producto_canal`: sin acceso para `anon` ni `authenticated`;
-- las lee el rol de solo lectura de Superset y la cláusula `rls` del guest token separa por
-- `organizacion_id` (cada vista lo expone). Derivan de `analitica.margen_producto_canal`: la fórmula
-- del margen y el umbral viven en un solo lugar.
--
-- Ponderación (FR-012, supuesto a confirmar): una unidad de cada producto en cada tienda, o sea
-- Σ márgenes ÷ Σ precios netos sobre las filas producto × tienda (no el promedio simple de los %).
-- «Productos con margen calculado» y los conteos de bajos/negativos cuentan productos DISTINTOS
-- por su peor estado en cualquier tienda (un producto negativo en una tienda y bajo en otra cuenta
-- solo como negativo; los dos conteos nunca se superponen).
--
-- Migración aditiva. Reversión (migración posterior; las vistas no guardan datos):
--   drop view analitica.rentabilidad_consolidado;
--   drop view analitica.rentabilidad_resumen_empresa;

create or replace view analitica.rentabilidad_resumen_empresa as
select
  m.organizacion_id,
  m.empresa_id,
  m.empresa_nombre,
  count(*)::int as productos,
  sum(m.margen) / sum(m.precio_neto) as margen_promedio_pct,
  avg(m.margen) as margen_por_unidad,
  count(*) filter (where m.estado = 'bajo')::int as con_margen_bajo,
  count(*) filter (where m.estado = 'negativo')::int as con_margen_negativo
from analitica.margen_producto_canal m
group by m.organizacion_id, m.empresa_id, m.empresa_nombre;

comment on view analitica.rentabilidad_resumen_empresa is
  'F-REN-02: una fila por empresa con margen calculado: productos, margen promedio % (Σ márgenes ÷ Σ netos), margen por unidad en pesos y conteos de bajos/negativos. Contrato en specs/20261023-170000-rentabilidad-margen/contracts/analitica-margen.md.';

create or replace view analitica.rentabilidad_consolidado as
with por_producto as (
  select
    m.organizacion_id,
    m.producto_id,
    bool_or(m.estado = 'negativo') as negativo,
    bool_or(m.estado = 'bajo') as bajo
  from analitica.margen_producto_canal m
  group by m.organizacion_id, m.producto_id
),
conteos as (
  select
    p.organizacion_id,
    count(*)::int as productos_con_margen,
    count(*) filter (where p.bajo and not p.negativo)::int as con_margen_bajo,
    count(*) filter (where p.negativo)::int as con_margen_negativo
  from por_producto p
  group by p.organizacion_id
),
sumas as (
  select m.organizacion_id, sum(m.margen) / sum(m.precio_neto) as margen_promedio_ponderado_pct
  from analitica.margen_producto_canal m
  group by m.organizacion_id
)
select
  c.organizacion_id,
  c.productos_con_margen,
  s.margen_promedio_ponderado_pct,
  c.con_margen_bajo,
  c.con_margen_negativo,
  coalesce(k.umbral_margen_bajo, 0.10) as umbral_margen_bajo
from conteos c
join sumas s on s.organizacion_id = c.organizacion_id
left join dominio.rentabilidad_config k on k.organizacion_id = c.organizacion_id;

comment on view analitica.rentabilidad_consolidado is
  'F-REN-02: una fila por organización con margen calculado: productos distintos, margen promedio ponderado (Σ márgenes ÷ Σ netos), conteos de productos bajos/negativos (por su peor estado) y umbral vigente.';

revoke all on analitica.rentabilidad_resumen_empresa from public, anon, authenticated;
revoke all on analitica.rentabilidad_consolidado from public, anon, authenticated;
grant select on analitica.rentabilidad_resumen_empresa to superset_analitica;
grant select on analitica.rentabilidad_consolidado to superset_analitica;
