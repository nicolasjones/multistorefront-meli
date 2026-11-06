-- F-REP-01 (MSF-297, épica MSF-140, spec 20270201-100000-reportes-de-inventario-y-exportacion, FR-002):
-- vista `analitica.inventario_productos_stock` para el tablero «Inventario · Productos y stock».
--
-- Esquema (Principio VII): SIN tablas nuevas. Solo el esquema `analitica` (existente, SOLO vistas y
-- funciones de apoyo). Lee `dominio.productos`, `dominio.existencias`, `dominio.categorias` y
-- `dominio.producto_costos` (dominio del producto). `analitica` no tiene tablas → `rls_en_toda_tabla`
-- (que recorre `public` + `dominio`) sigue verde.
--
-- Aislamiento: sin acceso para `anon` ni `authenticated`; la lee el rol de solo lectura
-- `superset_analitica` y la separación por organización la fuerza la cláusula `rls` del guest token
-- (por eso cada fila expone `organizacion_id`). La vista corre con los privilegios de su dueño: quien
-- abre el tablero ve costo y valor aunque `producto_costos` sea de la sección `rentabilidad`
-- (Decisión abierta 3 de la spec; provisional: todo rol con `stock` los ve).
--
-- Cálculo (FR-002):
--   · una fila por producto ACTIVO con su existencia (`cantidad`, `minimo`);
--   · `estado` con la misma regla que `public.stock_estados` (sin_stock / stock_bajo / disponible);
--   · `costo` está en la moneda del producto (`moneda_costo`); `costo_ars` lo convierte
--     `analitica.a_pesos` con la cotización vigente (la misma función que Rentabilidad);
--   · `valor_ars` = cantidad × costo_ars. Sin costo cargado, o USD sin cotización, `costo_ars` y
--     `valor_ars` quedan null: no se inventa un valor.
--
-- Migración aditiva. Reversión (migración posterior; la vista no guarda datos):
--   drop view analitica.inventario_productos_stock;

create or replace view analitica.inventario_productos_stock as
select
  p.organizacion_id,
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.sku,
  c.nombre as categoria,
  e.cantidad,
  e.minimo,
  case
    when e.cantidad = 0 then 'sin_stock'
    when e.cantidad <= e.minimo then 'stock_bajo'
    else 'disponible'
  end as estado,
  case when k.costo is null then null else p.moneda end as moneda_costo,
  k.costo,
  analitica.a_pesos(k.costo, p.moneda, p.organizacion_id) as costo_ars,
  e.cantidad * analitica.a_pesos(k.costo, p.moneda, p.organizacion_id) as valor_ars
from dominio.productos p
join dominio.existencias e
  on e.producto_id = p.id and e.organizacion_id = p.organizacion_id
left join dominio.categorias c
  on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
left join dominio.producto_costos k
  on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
where p.activo;

comment on view analitica.inventario_productos_stock is
  'F-REP-01: una fila por producto activo con cantidad, mínimo, estado (sin_stock / stock_bajo / disponible), costo en su moneda y en pesos (cotización vigente) y valor = cantidad × costo en pesos; sin costo o sin cotización no hay valor. Contrato en specs/20270201-100000-reportes-de-inventario-y-exportacion/contracts/analitica-inventario.md.';

revoke all on analitica.inventario_productos_stock from public, anon, authenticated;
grant select on analitica.inventario_productos_stock to superset_analitica;
