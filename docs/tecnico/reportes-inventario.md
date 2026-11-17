---
owner: tecnico
sources:
  - specs/20270201-100000-reportes-de-inventario-y-exportacion
  - supabase/migrations/20270202201200_analitica_inventario_productos_stock.sql
  - supabase/migrations/20270202201201_analitica_inventario_reposicion.sql
  - infra/superset/dashboards/inventario
  - infra/superset/superset_config.py
  - apps/web/src/pages/reportes
  - apps/web/src/lib/reportes-inventario.ts
  - apps/web/src/components/navegacion/destinosPanel.ts
  - apps/web/e2e/reportes-inventario.e2e.ts
---

# Reportes de inventario y exportación (técnico, MSF-140)

Implementación de la épica **MSF-140** (spec `20270201-100000-reportes-de-inventario-y-exportacion`):
**F-REP-01** «Productos y stock» (MSF-297), **F-REP-02** «Reposición» (MSF-311) y **F-REP-06**
«Exportar reportes» (MSF-326), más el cierre (MSF-746: docs, seguridad y E2E) y la decisión de mostrar costos
solo con `ver_costos`. La guía de uso está en
[Reportes de inventario (producto)](../producto/reportes-de-inventario.md).

!!! note "Estado"
    Implementado y en la rama de integración (`dokploy`). Migraciones `20270202201200` y `20270202201201`
    (las dos vistas) y `20270438000000` (reporte de solo cantidades, exigencia por acción y allowlist de
    datasets del token), aditivas y con la reversión en su encabezado. Contrato de las vistas:
    `specs/20270201-100000-reportes-de-inventario-y-exportacion/contracts/analitica-inventario.md`. El detalle de
    operación (aislamiento entre tableros, orden de despliegue, reversión) está en
    [Reportes de inventario (operación)](../reportes-inventario.md).

## Alcance

- **F-REP-01**: menú **Reportes**, pantalla `/reportes/inventario`, vista
  `analitica.inventario_productos_stock` y tablero «Inventario · Productos y stock». Para quien no tiene la acción
  `ver_costos`, la vista `analitica.inventario_productos_stock_cantidades` y el tablero «Inventario · Productos y
  stock (cantidades)», sin costo ni valor.
- **F-REP-02**: pantalla `/reportes/reposicion`, vista `analitica.inventario_reposicion` y tablero
  «Inventario · Reposición».
- **F-REP-06**: descarga CSV nativa de Superset con formato para Excel en español.
- **Fuera de alcance**: órdenes de compra y envío de pedidos, reportes de Mercado Libre, y la pantalla de
  alertas de stock (MSF-231 es relacionada, no se usa).

## Pantallas y rutas

| Ruta | Pantalla | Menú | Permiso |
|---|---|---|---|
| `/reportes/inventario` | Productos y stock | Reportes → Productos y stock | sección `stock` ≥ lectura |
| `/reportes/reposicion` | Reposición | Reportes → Reposición | sección `stock` ≥ lectura |

- Destinos en `apps/web/src/components/navegacion/destinosPanel.ts` (grupo `reportes`, ícono
  `AssessmentIcon`), ambos con `seccionPermiso: 'stock'`. Los reportes de Ventas y Rentabilidad no se
  mueven.
- Rutas en `apps/web/src/App.tsx`, envueltas en `RequiereAccesoSeccion` con `stock`: sin la sección no
  se monta la pantalla ni se pide token.
- Constantes en `apps/web/src/lib/reportes-inventario.ts`: `SECCION_INVENTARIO = 'stock'`, los nombres
  con los que `reportes.json` registra los tableros y los títulos/subtítulos.
- `pages/reportes/ProductosYStock.tsx` y `pages/reportes/Reposicion.tsx` arman el `EncabezadoPagina` y
  delegan en `pages/reportes/TableroInventario.tsx`, que monta `ReporteEmbebido` y resuelve los estados
  compartidos (`ProductosYStock` elige el tablero con `tableroProductosStock`: el de costos solo si la base se
  lo lista, si no el de cantidades): carga, error con **Reintentar**, tablero no disponible para la organización y 403
  (`AccesoRestringido`, «No tenés acceso a esta sección»).
- **Empresa activa: no aplica.** El inventario es por organización; las dos pantallas no muestran selector
  de empresa y el token solo acota por `organizacion_id`. `dominio.existencias` y `dominio.productos` no
  tienen `empresa_id`.

## Modelo de datos

**No hay tablas nuevas.** La épica agrega tres **vistas** en el esquema `analitica` (que sigue sin tablas)
y tres filas en `public.reportes` (catálogo de reportes embebibles de la spec 007). La migración `20270438000000`
agrega a `public.reportes` las columnas `accion_requerida` y `datasets_permitidos`.

| Objeto | Esquema | Estado | Cambio |
|---|---|---|---|
| `analitica.inventario_productos_stock` | `analitica` | **nueva (vista)** | Una fila por producto activo con cantidad, mínimo, estado, costo en su moneda, costo en pesos y valor. |
| `analitica.inventario_reposicion` | `analitica` | **nueva (vista)** | Una fila por producto activo sin stock o con stock bajo, con proveedor, código de proveedor y faltante sugerido. |
| `analitica.inventario_productos_stock_cantidades` | `analitica` | **nueva (vista)** | Mismas columnas de producto, cantidad, mínimo y estado que la de stock, **sin** costo ni valor y sin leer `dominio.producto_costos`. |
| `public.reportes` | `public` | existente | Tres filas por `reportes.json`: `seccion = 'stock'`, `filtro_empresa = false`; el tablero con costos lleva `accion_requerida = 'ver_costos'`. Columnas nuevas de `20270438000000`: `accion_requerida` (nullable) y `datasets_permitidos` (`text[]`, allowlist del tablero). |
| `dominio.productos` | `dominio` | existente | Solo se lee (`nombre`, `sku`, `categoria_id`, `moneda`, `proveedor_id`, `codigo_proveedor`, `activo`). |
| `dominio.existencias` | `dominio` | existente | Solo se lee (`cantidad`, `minimo`). |
| `dominio.categorias` | `dominio` | existente | Solo se lee (`nombre`). |
| `dominio.proveedores` | `dominio` | existente | Solo se lee (`razon_social`). |
| `dominio.producto_costos` | `dominio` | existente | Solo se lee (`costo`) para el reporte de stock. |

### `analitica.inventario_productos_stock` (F-REP-01)

Columnas: `organizacion_id`, `producto_id`, `producto_nombre`, `sku`, `categoria`, `cantidad`, `minimo`,
`estado`, `moneda_costo`, `costo`, `costo_ars`, `valor_ars`.

- `estado` usa la misma regla que `public.stock_estados`: `sin_stock` (cantidad = 0), `stock_bajo`
  (0 < cantidad ≤ mínimo) o `disponible`.
- `costo` está en la moneda del producto. `costo_ars = analitica.a_pesos(costo, moneda, organizacion_id)`
  usa la cotización vigente (la misma función que Rentabilidad).
- `valor_ars = cantidad × costo_ars`.
- Sin costo cargado, o USD sin cotización, `costo_ars` y `valor_ars` quedan `null`: no se inventa un
  valor y la fila no suma al total.
- Solo productos activos (`where p.activo`). La vista `inventario_productos_stock_cantidades` (migración
  `20270438000000`) repite estas columnas salvo `moneda_costo`, `costo`, `costo_ars` y `valor_ars`. El tablero muestra las etiquetas **Sin stock / Bajo /
  Normal** con la columna calculada `estado_texto` del dataset.

### `analitica.inventario_reposicion` (F-REP-02)

Columnas: `organizacion_id`, `producto_id`, `producto_nombre`, `sku`, `categoria`, `proveedor`,
`codigo_proveedor`, `cantidad`, `minimo`, `estado`, `faltante_sugerido`.

- Incluye solo productos activos con `cantidad = 0` o `0 < cantidad ≤ minimo`; un producto Normal no
  aparece. Con mínimo 0, cualquier cantidad > 0 es Normal.
- `estado` es `sin_stock` o `stock_bajo`.
- `faltante_sugerido = greatest(minimo − cantidad, 0)`. Es una regla **provisional** (Decisión abierta 4
  de la spec): vive solo en esa expresión de la migración `20270202201201`, así que cambiarla a un
  objetivo de cobertura toca una línea.
- No expone costos ni valores.

El DER del grafo afectado está en [Datos y DER](datos.md#reportes-de-inventario-y-exportacion-msf-140).

## Acceso, permisos y aislamiento

- El acceso sigue la sección de los datos (**Stock**), no la sección `reportes`: `reportes.json` registra
  los dos tableros con `seccion = 'stock'`. `resolver_organizacion_reporte` devuelve acceso solo con
  `lectura` o `edicion` en `stock`; sin ella, `emitir-acceso-reporte` responde 403.
- La pantalla de Refine también bloquea antes: `RequiereAccesoSeccion` no monta el tablero ni pide token.
- **Aislamiento**: cada fila expone `organizacion_id`; el guest token de Superset fuerza la cláusula
  `rls` con ese valor. `anon` y `authenticated` no tienen `USAGE` sobre `analitica` ni `SELECT` sobre las
  vistas; solo el rol `superset_analitica` tiene `select`.
- **Costos y valor solo con `ver_costos`** (Decisión abierta 3, resuelta el 2026-11-14): `reportes.accion_requerida`
  declara una acción de la matriz que, además de la sección, el reporte exige. La evalúa
  `private.cumple_accion_reporte` (respeta la matriz por rol de cada organización y falla cerrado) en
  `resolver_organizacion_reporte` (sin la acción, 403 en `emitir-acceso-reporte`) y en `reportes_visibles_para_mi`
  (no lista el tablero). Quien no la tiene abre «Inventario · Productos y stock (cantidades)»; por defecto
  `ver_costos` en Stock es de Administrador, Administración y Operador (la migración también lo aplica a las
  organizaciones existentes). Reposición no expone costos.
- **Aislamiento entre tableros**: el rol Guest de Superset es único, así que `emitir-acceso-reporte` agrega al
  token una regla `rls` `1 = 0` por cada dataset que no esté en `reportes.datasets_permitidos` del tablero
  (la allowlist la calcula el importador desde los YAML). Sin allowlist no se emite token (503). Detalle y
  riesgos en [Reportes de inventario (operación)](../reportes-inventario.md).
- **Empresa activa: no aplica** (Principio VIII): el inventario es por organización y el token no lleva
  `empresa_id`.
- Verificación: `supabase/tests/database/reportes_inventario_acceso.test.sql`,
  `reportes_inventario_superficie.test.sql` y `reportes_inventario_solo_cantidades.test.sql`.

## Tableros de Superset

Directorio `infra/superset/dashboards/inventario/`:

| Archivo | Contenido |
|---|---|
| `databases/Inventario_analitica.yaml` | Conexión de solo lectura con el rol `superset_analitica`. |
| `datasets/Inventario_analitica/inventario_productos_stock.yaml` | Dataset de la vista de stock; métrica `valor_total = COALESCE(SUM(valor_ars), 0)` y columna calculada `estado_texto`. |
| `datasets/Inventario_analitica/inventario_reposicion.yaml` | Dataset de reposición; columna calculada `estado_texto`. |
| `charts/Productos_y_stock_1.yaml` | Tabla en modo raw con las columnas de producto, stock, costo y valor. |
| `charts/Valor_total_1.yaml` | Big number «Valor total del inventario» sobre `valor_total`. |
| `charts/Reposicion_1.yaml` | Tabla en modo raw ordenada por `estado` ascendente (Sin stock antes que Bajo), `faltante_sugerido` descendente y nombre. |
| `datasets/Inventario_analitica/inventario_productos_stock_cantidades.yaml` | Dataset de la vista de solo cantidades (sin métrica de valor). |
| `charts/Productos_y_stock_cantidades_1.yaml` | Tabla en modo raw con las columnas de producto, cantidad, mínimo y estado. |
| `dashboards/Productos_y_stock_1.yaml` | Tablero `inventario-productos-stock` con filtros nativos Producto, SKU, Categoría y Estado. |
| `dashboards/Productos_y_stock_cantidades_1.yaml` | Tablero `inventario-productos-stock-cantidades`, mismos filtros, sin costo ni valor. |
| `dashboards/Reposicion_1.yaml` | Tablero `inventario-reposicion` con filtros Producto, SKU, Categoría, Estado y Proveedor. |
| `reportes.json` | Registro de los tres reportes: `seccion = 'stock'`, `filtro_empresa = false`, roles por defecto `administracion`, `operador`, `consulta`; el tablero con costos suma `accion_requerida = 'ver_costos'`. |

- Los filtros son **nativos del tablero** (no los inyecta Refine): la pantalla no preselecciona filtros por
  URL. El valor total es una métrica sobre el mismo dataset, así que se recalcula solo con las filas
  filtradas.
- Importación: `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/inventario --entorno staging|production`.
  El importador habilita el embebido por `dashboard_slug` y registra los reportes de forma idempotente (no
  duplica filas y no asigna `administrador`, que tiene acceso incondicional). El workflow de despliegue del
  VPS ejecuta la importación.
- Verificación: `pnpm test:superset:importar-dashboards` e `pnpm infra:config`.

## Exportación a CSV (F-REP-06)

- La descarga es la **nativa de Superset** (menú «...» de la tabla → «Download» → CSV). No hay exportador
  propio en Refine ni otro camino de descarga.
- El tablero de cantidades no trae costo ni valor, así que tampoco su CSV.
- El rol guest ya tiene `can_csv` (`infra/superset/configurar_embebido.py`). Sin token (403 por falta de
  sección) no hay tablero ni descarga.
- `CSV_EXPORT` en `infra/superset/superset_config.py` fija `sep=";"` y `decimal=","`. Es global: también
  aplica a los tableros de Ventas y Rentabilidad.
- El BOM UTF-8 no sale de `encoding="utf-8-sig"` (pandas lo ignora cuando `to_csv` devuelve un `str`): lo
  antepone el `after_request` `_anteponer_bom_csv` registrado por `FLASK_APP_MUTATOR`. Sin BOM, Excel abre
  el archivo como ANSI y rompe tildes y ñ.
- Las fórmulas (`=`, `+`, `-`, `@`) las neutraliza el exportador de Superset
  (`superset.utils.csv.escape_value`); no se agrega código propio.
- Verificación: `pnpm test:superset:config` (`infra/superset/superset_config.test.py`) y el E2E de
  descarga.

## Cómo probarlo

### Prerrequisitos

- Docker y dependencias instaladas (`pnpm install`).
- Base y web locales: `pnpm dev:supabase` y `pnpm dev` (web en `http://localhost:5173`).
- Superset local para la descarga real: `pnpm dev:superset`, con los tableros importados
  (`pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/inventario --entorno staging`).
- Dos usuarios en la misma organización: uno con la sección `stock` en `lectura` o `edicion` y otro sin
  acceso a `stock` (por ejemplo, un rol al que se le puso `stock = ninguno`).
- Datos de ejemplo: productos activos con costo en ARS, con costo en USD y cotización vigente, y sin
  costo; existencias en 0, por debajo del mínimo y por encima; al menos uno con proveedor y
  `codigo_proveedor` cargados.

### Pasos

1. **pgTAP de las vistas y del acceso**: `pnpm test:db`.
   - `[MSF-297:T001]` `reportes_inventario_productos_stock.test.sql`: valor = cantidad × costo convertido,
     producto sin costo sin valor, sin mezcla de organizaciones.
   - `[MSF-297:T002]` `reportes_inventario_acceso.test.sql`: `resolver_organizacion_reporte` con
     `seccion = 'stock'`, 403 sin sección y `anon`/`authenticated` sin `SELECT` en las vistas.
   - `reportes_inventario_solo_cantidades.test.sql`: la vista de cantidades no trae costo ni valor,
     `accion_requerida = 'ver_costos'` en el reporte con costos y su efecto en el token y en la lista.
   - `[MSF-311:T007]` `reportes_inventario_reposicion.test.sql`: incluye Sin stock y Bajo, excluye Normal,
     faltante 10/4 → 6 y sin stock con mínimo 10 → 10.
2. **Vitest de las pantallas**: `pnpm --filter @platform/web test`.
   - `[MSF-297:T004]` `pages/reportes/ProductosYStock.test.tsx`: título, acceso restringido sin `stock`
     sin pedir token, error con reintento y sin selector de empresa propio.
   - `[MSF-311:T008]` `pages/reportes/Reposicion.test.tsx`: los mismos estados y la entrada en el menú.
3. **Tableros**: `pnpm test:superset:importar-dashboards`.
   - `[MSF-297:T003]` y `[MSF-311:T006]`: datasets, filtros nativos, valor total, orden por severidad y
     registro con `seccion = 'stock'`.
4. **Formato del CSV**: `pnpm test:superset:config`.
   - `[MSF-326:T009]`: `CSV_EXPORT` con `sep=";"`, `decimal=","`, BOM sobre una respuesta Flask y
     `can_csv` del rol guest.
5. **Recorrido manual con acceso**: ingresá con el usuario que tiene `stock` y abrí **Reportes →
   Productos y stock**. Verificá el título, la tabla, el **Valor total del inventario** y que al aplicar un
   filtro el total cambie. Después abrí **Reportes → Reposición** y comprobá que solo aparezcan Sin stock
   y Bajo, ordenados por severidad y con el faltante sugerido.
6. **Descarga real**: en un reporte con filtro aplicado, menú «...» de la tabla → **Download** → **CSV**.
   El archivo debe empezar con los bytes `EF BB BF` (`head -c3 archivo.csv | xxd`), traer solo las filas
   filtradas, separar las columnas con `;` y mostrar los decimales con coma al abrirlo en Excel.
7. **Sin acceso**: ingresá con el usuario sin `stock` y entrá a `/reportes/inventario` y
   `/reportes/reposicion`. Debe verse «No tenés acceso a esta sección», sin tablero y sin descarga.
8. **E2E**: con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` de un Supabase local,
   `pnpm --filter @platform/web test:e2e reportes-inventario`.
   - `[MSF-746:T014]`: roles con y sin `stock` en cada reporte. La descarga real solo corre con
     `E2E_SUPERSET=1` y `E2E_INVENTARIO_CORREO` definidos.

### Resultado esperado

- **Dado** un producto con costo en USD y cotización vigente, **cuando** se abre Productos y stock,
  **entonces** el costo en pesos y el valor salen convertidos con esa cotización.
- **Dado** un usuario sin la sección `stock`, **cuando** entra a cualquiera de los dos reportes,
  **entonces** ve «No tenés acceso a esta sección» y no se emite token.
- **Dado** un producto Normal, **cuando** se abre Reposición, **entonces** no aparece; los Sin stock y Bajo
  aparecen con su faltante sugerido.
- **Dado** un filtro aplicado, **cuando** se descarga la tabla, **entonces** el CSV trae exactamente las
  filas filtradas, en UTF-8 con BOM, `;` y coma decimal.

### Cómo automatizarlo

Ya están escritos los pgTAP, Vitest, tests de importación y de configuración, y el E2E
`apps/web/e2e/reportes-inventario.e2e.ts`. La descarga real del CSV **no** corre en el CI público: queda
pendiente de un entorno con Superset (`E2E_SUPERSET=1`). Los pasos 5 a 7 son manuales hasta que exista ese
entorno.

## Pendientes y deuda

- **Capturas del manual**: faltan las imágenes de las dos pantallas en `docs/producto/img/reportes-de-inventario/`
  (se generan con `pnpm docs:capturas`, que necesita el stack local y Superset con los tableros importados).
  Dueño: producto.
- **Decisión 3** (¿los roles con `stock` ven costos y valor?): **resuelta** (solo con `ver_costos`; ver
  «Acceso, permisos y aislamiento»).
- **Decisión 4** (faltante sugerido): provisional como `mínimo − cantidad`; cambiarlo toca solo la
  expresión de la vista `analitica.inventario_reposicion`.
- **Verificación en un Superset real**: confirmar tras importar que los filtros nativos, el valor total y
  la descarga se comportan como se describe. Dueño: QA/operación de Superset.

## Reversión

Todo es aditivo y sin datos propios:

1. `drop view analitica.inventario_productos_stock;` y `drop view analitica.inventario_reposicion;`
   (migraciones posteriores). Para el reporte de solo cantidades y la exigencia por acción, ver la reversión de
   `20270438000000` en su encabezado.
2. Desregistrar los dos reportes por `dashboard_slug` y quitar el directorio
   `infra/superset/dashboards/inventario/`.
3. Para la exportación, quitar `CSV_EXPORT` y `FLASK_APP_MUTATOR` de `infra/superset/superset_config.py`
   (vuelve al formato por defecto de Superset).

Para deshacer la spec completa: `git revert -m 1 <merge>`.
