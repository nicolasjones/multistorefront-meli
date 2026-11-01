# Contrato: analítica de inventario

Épica MSF-140. Lectura para Superset; esquema `analitica` (solo vistas; sin acceso para `anon`/`authenticated`; `select` a `superset_analitica`). Cada fila lleva `organizacion_id`. Sin RPC ni Edge Function nuevas.

## `analitica.inventario_productos_stock` (F-REP-01)

`organizacion_id`, `producto_id`, `producto_nombre`, `sku`, `categoria`, `cantidad`, `minimo`, `estado` (`sin_stock` | `stock_bajo` | `disponible`), `moneda_costo`, `costo`, `costo_ars`, `valor_ars` (= `cantidad × costo_ars`; null sin costo o sin cotización).

## `analitica.inventario_reposicion` (F-REP-02)

`organizacion_id`, `producto_id`, `producto_nombre`, `sku`, `categoria`, `proveedor`, `codigo_proveedor`, `cantidad`, `minimo`, `estado` (`sin_stock` | `stock_bajo`), `faltante_sugerido` (= `greatest(minimo − cantidad, 0)`, provisional).
