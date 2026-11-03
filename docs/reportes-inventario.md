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
  `20270202201200`), desregistrar el reporte por `dashboard_slug` y quitar el directorio. Los tableros no
  guardan datos.

## Reposición (F-REP-02, MSF-311)

Pantalla `/reportes/reposicion` (menú **Reportes → Reposición**). Embebe el tablero «Inventario · Reposición»
(slug `inventario-reposicion`, mismo directorio y misma sección `stock` que Productos y stock): los productos
activos **sin stock o con stock bajo**, con proveedor, código de proveedor y faltante sugerido, ordenados por
severidad (Sin stock antes que Bajo; dentro de cada grupo, mayor faltante primero), con filtros nativos de
producto, SKU, categoría, estado y proveedor. Sirve para armar el pedido a proveedores; crear órdenes de compra
queda fuera de alcance.

### Vista `analitica.inventario_reposicion`

| Columna | Origen / cálculo |
|---|---|
| `organizacion_id` | Columna sobre la que el guest token fuerza la cláusula `rls`. |
| `producto_id`, `producto_nombre`, `sku`, `categoria` | Igual que Productos y stock (solo productos **activos**). |
| `proveedor`, `codigo_proveedor` | Razón social de `dominio.proveedores` y código del producto; vacíos si no tiene proveedor. |
| `cantidad`, `minimo` | `dominio.existencias`. |
| `estado` | `sin_stock` (cantidad = 0) o `stock_bajo` (0 < cantidad ≤ mínimo), la regla de `public.stock_estados`. Un producto Normal no aparece; con mínimo 0 cualquier cantidad > 0 es Normal. |
| `faltante_sugerido` | `greatest(minimo − cantidad, 0)`: mínimo 10 / cantidad 4 → 6; sin stock con mínimo 10 → 10. |

El faltante es una regla **provisional** (Decisión abierta 4 de la spec): vive solo en esa expresión de la
migración `20270202201201`, así que pasar a un objetivo de cobertura toca una línea. La vista no expone
costos ni valores. Esquema (Principio VII): solo una **vista** en `analitica`, sin tablas nuevas; `select`
solo para `superset_analitica`. Empresa activa (Principio VIII): no aplica, el inventario es por organización.
Reversión: `drop view analitica.inventario_reposicion;`, desregistrar el reporte por `dashboard_slug` y quitar
los YAML de reposición. Verificación: pgTAP `reportes_inventario_reposicion.test.sql`, Vitest
`pages/reportes/Reposicion.test.tsx` y `infra/superset/importar-dashboards.test.mjs`.

## Exportar a CSV (F-REP-06, MSF-140)

La descarga es la nativa de Superset (menú «...» de la tabla → «Download» → CSV) y trae solo las filas
filtradas. El archivo sale en UTF-8 con BOM, separador `;` y coma decimal, para abrirlo en Excel en español
(`CSV_EXPORT` y `_anteponer_bom_csv` en `infra/superset/superset_config.py`, probados por
`pnpm test:superset:config`). Sin la sección `stock` no hay token (403 de `emitir-acceso-reporte`), por lo que
no hay tablero ni descarga; no existe otro camino de descarga. Configuración y procedimiento manual:
[`operar-superset.md`](./operar-superset.md#exportar-reportes-a-csv).

## Revisión de seguridad de la superficie nueva (T013, FR-010)

Verificada con `supabase/tests/database/reportes_inventario_superficie.test.sql` y
`reportes_inventario_acceso.test.sql` (pgTAP, `pnpm test:db`):

| Control | Resultado |
|---|---|
| `anon` | Sin `USAGE` sobre `analitica` ni `SELECT` en las dos vistas |
| `authenticated` | Sin `USAGE` ni `SELECT` en `analitica`; no hay RPC ni Edge Function nuevas |
| Rol `superset_analitica` | Solo `SELECT` en las vistas; no es superusuario ni salta RLS; no lee `producto_costos` directamente |
| Aislamiento | Cada fila lleva `organizacion_id`; el guest token fuerza la cláusula `rls` |
| Costos en `analitica` vs. RLS de `producto_costos` | La vista corre con los privilegios del dueño: quien tiene la sección `stock` ve costo y valor en Productos y stock aunque no tenga `rentabilidad`. Es la Decisión abierta 3 (provisional); Reposición no expone costos |
| Principio VII | Sin tablas nuevas; `analitica` sigue sin tablas; `rls_en_toda_tabla` verde |

## Pruebas E2E (T014)

`apps/web/e2e/reportes-inventario.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`): con la
sección `stock` ambas pantallas muestran su título y sin ella «No tenés acceso a esta sección». La descarga
real del CSV exige un Superset con los tableros importados: el test correspondiente solo corre con
`E2E_SUPERSET=1` y, si no, el formato lo cubre `pnpm test:superset:config` más el procedimiento manual.

## Reversión

Todo es aditivo y sin datos propios: ver la reversión de cada vista arriba y, para la exportación, quitar
`CSV_EXPORT` y `FLASK_APP_MUTATOR`. Para deshacer la spec completa: `git revert -m 1 <merge>`.

## Preguntas abiertas

Decisión 3 (¿los roles con `stock` ven costos y valor?) y Decisión 4 (faltante sugerido = mínimo − cantidad)
siguen provisionales hasta que Nicolás las confirme.
