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
- **Costos y valor solo con `ver_costos` (Decisión abierta 3, RESUELTA el 2026-11-14)**: el rol Consulta, y
  cualquier rol sin la acción `ver_costos` en Stock (la misma de la matriz de permisos que oculta costos en el
  resto del producto; por defecto Administrador, Administración y Operador), ve **solo cantidades**. Se hace en la base y
  en la UI, no con CSS:
  - Hay dos tableros: «Inventario · Productos y stock» (con costo y valor, `reportes.accion_requerida = 'ver_costos'`)
    e «Inventario · Productos y stock (cantidades)» (slug `inventario-productos-stock-cantidades`, vista
    `analitica.inventario_productos_stock_cantidades`, que **no trae** costo ni valor ni lee `producto_costos`).
  - `resolver_organizacion_reporte` no emite el token del tablero con costos a quien no tiene `ver_costos`
    (403) y `reportes_visibles_para_mi` no lo lista (ambas usan `private.cumple_accion_reporte`, que respeta la
    matriz por rol de cada organización y falla cerrado).
  - La pantalla `/reportes/inventario` monta el tablero con costos si la base se lo lista y, si no, el de
    cantidades: las columnas y tarjetas de costo no existen para ese rol, y tampoco en la descarga CSV.
  - **Aislamiento entre tableros (Superset, allowlist)**: el rol Guest es uno solo y ve todos los datasets embebidos, así
    que el token de un tablero podría pedir por la API (`chart/data`, CSV, `samples`, valores de columna) el dataset de
    otro: el de costos, pero también los de Rentabilidad, Service o Ventas. Por eso el token de **cualquier** tablero
    lleva una regla `rls` `1 = 0` por cada dataset de Superset que no sea del tablero (`reglasDatasetsAjenos` en
    `emitir-acceso-reporte`). La allowlist de cada tablero (`reportes.datasets_permitidos`) la calcula el importador
    desde los YAML (gráficos y filtros nativos) más `datasets_permitidos_extra` de `reportes.json` si un tablero necesita
    datasets que sus YAML no reflejan. Falla cerrado (503, sin token): allowlist vacía (tablero no reimportado), no
    se puede listar Superset o falta algún dataset del tablero. Un tablero nuevo o un dataset nuevo queda vedado por
    defecto: no hay lista negra que mantener. Cubre «Inventario · Reposición» (que ve Consulta) y los demás tableros.
  - **Cuenta de servicio**: necesita `can_read Dataset` y `all_datasource_access` para listar todos los datasets
    (`crear_cuenta_servicio_guest_token.py`, al re-correr `superset-init`; un permiso ausente avisa y no rompe el init).
    No hay un permiso más estrecho porque hay que ver todos para vedar los ajenos. Riesgo: si se filtra su clave puede
    listar nombres de datasets (no datos: no tiene `can_read Chart`, `can_query` ni SQL Lab) y forjar tokens, como ya
    podía. Mitigación: la clave solo vive en el entorno de la Edge Function; rotarla si hay sospecha.
  - **Prueba contra un Superset real**: `pnpm test:superset:aislamiento-tokens` (variables en la cabecera de
    `scripts/verificar-aislamiento-tokens-superset.mjs`; solo lectura y consultas, sin imprimir secretos). Para cada
    tablero prueba cada dataset ajeno por `chart/data` (JSON y CSV), valores de columna y `samples`; esperado: 403/404 o
    200 sin filas, más un control (el tablero lee lo suyo). Lo que **solo se confirma con un Superset real**: que la regla
    anule esas cuatro vías, que la cuenta de servicio liste los datasets con esos permisos y el comportamiento con
    datasets virtuales. La lógica de reglas y la falla cerrada las prueban `pnpm test:edge:emitir-acceso-reporte` y
    `pnpm test:superset:importar-dashboards`. Limitación: el Guest aún puede leer la metadata (nombres de columnas).
  - **Operador** conserva los costos: la matriz inicial da `ver_costos` en Stock a Administrador, Administración y
    Operador (migración `20270325300000`, que también lo aplica a las organizaciones existentes). Consulta, Mostrador,
    Depósito y demás no.
  - **Orden de despliegue**: migración → importador de dashboards (`pnpm superset:importar-dashboards`) → `superset-init`
    (permisos de la cuenta de servicio) → web. Hay que reimportar **los seis directorios** de dashboards apenas se aplique
    la migración: el importador escribe `accion_requerida` y `datasets_permitidos` de cada tablero y, hasta entonces, los
    tableros sin allowlist responden 503 (falla cerrado). Si el importador corriera antes de la migración falla a la vista
    (la columna no existe) y no deja nada a medias. Quitar `accion_requerida` de `reportes.json` la limpia en la base.
  - **Operador, filas pisadas**: la migración deja un `NOTICE` con cuántas filas de `ver_costos` de Operador en Stock
    estaban en `false` y pasan a `true`. Para saberlo antes de desplegar:
    `select count(*) from public.permisos_rol_accion where rol_id = 'operador' and seccion = 'stock' and accion = 'ver_costos' and permitido = false;`
    (anotar el valor en el PR de despliegue; una organización que lo había quitado a propósito debe volver a quitarlo en Roles).
  - Antes del primer import de dashboards tras el despliegue, un rol sin `ver_costos` ve «todavía no está
    disponible» (falla segura). Reposición nunca expuso costos.
- Empresa activa (Principio VIII): no aplica, el inventario es por organización.

### Operación y reversión

- El tablero se importa con `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/inventario --entorno <staging|production>`
  (lo hace el workflow de despliegue del VPS, idempotente).
- Reversión: `drop view analitica.inventario_productos_stock;` (migración
  `20270202201200`; la exigencia por acción y la vista de cantidades son de `20270325300000`, ver su cabecera), desregistrar el reporte por `dashboard_slug` y quitar el directorio. Los tableros no
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
| Costos en `analitica` vs. RLS de `producto_costos` | La vista con costos corre con los privilegios del dueño, por eso su tablero exige además `ver_costos` (token y lista); quien no la tiene abre la vista de cantidades, que no trae costos. Reposición no expone costos |
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

Decisión 3 resuelta (solo cantidades sin `ver_costos`, ver arriba). Decisión 4 (faltante sugerido = mínimo − cantidad)
sigue provisional hasta que Nicolás la confirme.
