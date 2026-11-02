# Reportes de inventario (épica MSF-140)

Guía del menú **Reportes** y de los tableros de inventario. Spec:
[`specs/20270201-100000-reportes-de-inventario-y-exportacion/`](../specs/20270201-100000-reportes-de-inventario-y-exportacion/spec.md) ·
contrato de las vistas:
[`contracts/analitica-inventario.md`](../specs/20270201-100000-reportes-de-inventario-y-exportacion/contracts/analitica-inventario.md) ·
operación de los tableros: [`operar-superset.md`](./operar-superset.md).

## Productos y stock (F-REP-01, MSF-297)

Pantalla `/reportes/inventario` (menú **Reportes → Productos y stock**). Embebe el tablero de Superset
«Inventario · Productos y stock» (`infra/superset/dashboards/inventario/`, slug
`inventario-productos-stock`): tabla de productos con cantidad, mínimo, estado, costo y valor, el
**valor total del inventario** y los filtros nativos de producto/SKU, categoría y estado. El valor total
refleja solo las filas filtradas.

### Vista `analitica.inventario_productos_stock`

| Columna | Origen / cálculo |
|---|---|
| `organizacion_id` | Columna sobre la que el guest token fuerza la cláusula `rls`. |
| `producto_id`, `producto_nombre`, `sku` | `dominio.productos` (solo productos **activos**). |
| `categoria` | `dominio.categorias` (vacía si el producto no tiene). |
| `cantidad`, `minimo` | `dominio.existencias`. |
| `estado` | `sin_stock` (cantidad = 0), `stock_bajo` (0 < cantidad ≤ mínimo) o `disponible`: la misma regla que `public.stock_estados`. El tablero lo muestra como Sin stock / Bajo / Normal. |
| `moneda_costo`, `costo` | `dominio.producto_costos` y la moneda del producto; vacíos sin costo. |
| `costo_ars` | `analitica.a_pesos(costo, moneda, organizacion)`: USD × cotización vigente (la misma función que Rentabilidad). |
| `valor_ars` | `cantidad × costo_ars`. |

**No se inventa un valor**: un producto sin costo, o con costo en USD sin cotización, aparece con su
stock pero sin `costo_ars` ni `valor_ars`, y no suma al total.

### Permisos y esquema

- El acceso sigue la sección **Stock** (`stock`), no `reportes`: `public.reportes.seccion = 'stock'`
  (`reportes.json`). Sin `lectura`/`edicion` en `stock`, la pantalla muestra «Acceso restringido» sin
  pedir token y `emitir-acceso-reporte` responde 403 (`resolver_organizacion_reporte`).
- Esquema (Principio VII): solo una **vista** en `analitica` (sin tablas nuevas); `select` solo para
  `superset_analitica`, sin acceso para `anon`/`authenticated`. El alta del reporte en `public.reportes`
  es plataforma.
- **Costos visibles (Decisión abierta 3 de la spec)**: la vista corre con privilegios del dueño, así que
  quien abre el tablero ve costo y valor aunque `producto_costos` sea de la sección `rentabilidad`.
  Provisional: todo rol con acceso a Stock los ve. Si la respuesta es «solo cantidades», se separa el
  valor en un segundo tablero con `seccion = 'rentabilidad'`.
- Empresa activa (Principio VIII): no aplica, el inventario es por organización.

### Operación y reversión

- El tablero se importa con `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/inventario --entorno <staging|production>`
  (lo hace el workflow de despliegue del VPS, idempotente).
- Reversión: `drop view analitica.inventario_productos_stock;` (migración
  `20270201090000`), desregistrar el reporte por `dashboard_slug` y quitar el directorio. Los tableros no
  guardan datos.
