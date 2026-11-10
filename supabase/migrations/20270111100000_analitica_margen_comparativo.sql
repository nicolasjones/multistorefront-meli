-- F-REN-06 (MSF-261, épica MSF-127): vista `analitica.margen_comparativo_producto`.
-- Esquema (Principio VII): `analitica` es solo de vistas y funciones de apoyo; no hay tablas nuevas ni RLS.
-- Deriva de `analitica.margen_producto_canal` (MSF-120, sin duplicar fórmulas): una fila por producto y
-- empresa, SOLO para productos con margen en 2 o más empresas (`empresas_comparadas` >= 2). Las reglas de
-- exclusión (sin costo, sin neto positivo, sin cotización) ya las aplica la vista base: sin fila, no se
-- inventa margen.
-- Aislamiento: igual que la vista base. Sin acceso para `anon` ni `authenticated`; la lee el rol
-- `superset_analitica` y la separación por organización la fuerza la cláusula `rls` del guest token
-- (por eso cada fila lleva `organizacion_id`).
--
-- Migración aditiva. Reversión (migración posterior; nada guarda datos):
--   drop view analitica.margen_comparativo_producto;

create or replace view analitica.margen_comparativo_producto as
select
  c.organizacion_id, c.producto_id, c.producto_nombre, c.sku, c.empresa_id, c.empresa_nombre,
  c.precio_neto, c.costo, c.margen, c.margen_pct, c.estado, c.empresas_comparadas
from (
  select
    m.*,
    (count(*) over (partition by m.organizacion_id, m.producto_id))::int as empresas_comparadas
  from analitica.margen_producto_canal m
) c
where c.empresas_comparadas >= 2;

comment on view analitica.margen_comparativo_producto is
  'F-REN-06: margen del mismo producto por empresa, solo productos con margen en 2 o más empresas. Derivada de margen_producto_canal. Contrato en specs/20261024-130000-rentabilidad-comparativos-e-historia/contracts/analitica-comparativos-historia.md.';

revoke all on analitica.margen_comparativo_producto from public, anon, authenticated;
grant select on analitica.margen_comparativo_producto to superset_analitica;
