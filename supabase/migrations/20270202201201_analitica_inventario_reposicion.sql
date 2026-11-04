-- F-REP-02 (MSF-311, épica MSF-140, spec 20270201-100000-reportes-de-inventario-y-exportacion, FR-005/FR-006):
-- vista `analitica.inventario_reposicion` para el tablero «Inventario · Reposición».
--
-- Esquema (Principio VII): SIN tablas nuevas. Solo el esquema `analitica` (existente, SOLO vistas y
-- funciones de apoyo). Lee `dominio.productos`, `dominio.existencias`, `dominio.categorias` y
-- `dominio.proveedores` (dominio del producto). `analitica` no tiene tablas → `rls_en_toda_tabla`
-- (que recorre `public` + `dominio`) sigue verde.
--
-- Aislamiento: sin acceso para `anon` ni `authenticated`; la lee el rol de solo lectura
-- `superset_analitica` y la separación por organización la fuerza la cláusula `rls` del guest token
-- (por eso cada fila expone `organizacion_id`). No expone costos ni valores.
--
-- Cálculo:
--   · solo productos ACTIVOS cuyo estado es `sin_stock` (cantidad = 0) o `stock_bajo`
--     (0 < cantidad ≤ mínimo): la misma regla que `public.stock_estados`. Con mínimo 0 cualquier
--     cantidad > 0 es Normal y no aparece;
--   · `faltante_sugerido` = greatest(minimo − cantidad, 0): lo que falta para volver al mínimo
--     (FR-006). Regla provisional (Decisión abierta 4): vive SOLO en esta expresión, así que pasar
--     a un objetivo de cobertura toca únicamente esta línea;
--   · `proveedor` es la razón social del proveedor del producto (null si no tiene `proveedor_id`).
--
-- Migración aditiva. Reversión (migración posterior; la vista no guarda datos):
--   drop view analitica.inventario_reposicion;

create or replace view analitica.inventario_reposicion as
select
  p.organizacion_id,
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.sku,
  c.nombre as categoria,
  pr.razon_social as proveedor,
  p.codigo_proveedor,
  e.cantidad,
  e.minimo,
  case when e.cantidad = 0 then 'sin_stock' else 'stock_bajo' end as estado,
  greatest(e.minimo - e.cantidad, 0) as faltante_sugerido
from dominio.productos p
join dominio.existencias e
  on e.producto_id = p.id and e.organizacion_id = p.organizacion_id
left join dominio.categorias c
  on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
left join dominio.proveedores pr
  on pr.id = p.proveedor_id and pr.organizacion_id = p.organizacion_id
where p.activo
  and (e.cantidad = 0 or e.cantidad <= e.minimo);

comment on view analitica.inventario_reposicion is
  'F-REP-02: productos activos sin stock o con stock bajo (regla de public.stock_estados), con proveedor, código de proveedor y faltante sugerido = mínimo − cantidad (provisional). Contrato en specs/20270201-100000-reportes-de-inventario-y-exportacion/contracts/analitica-inventario.md.';

revoke all on analitica.inventario_reposicion from public, anon, authenticated;
grant select on analitica.inventario_reposicion to superset_analitica;
