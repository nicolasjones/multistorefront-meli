# Operar Superset local

Conocimiento operativo encontrado al ejercitar por primera vez la analítica
embebida (spec 007) contra datos reales en un producto derivado — no es una
funcionalidad de negocio, es infraestructura/configuración que cualquier
producto derivado que use este Superset va a pisar igual. `infra/superset/`
tiene la configuración real (`superset_config.py`,
`crear_cuenta_servicio_guest_token.py`, `configurar_embebido.py`,
`compose.yaml`).

## Qué se configura solo en cada `superset-init`

La analítica embebida depende de tres piezas de estado que antes se cargaban
a mano y se perdían al recrear contenedores o volúmenes. Ahora las deja
listas `compose.yaml` y `configurar_embebido.py`, que corre en
`superset-init` después de `crear_cuenta_servicio_guest_token.py`. El script
es idempotente y solo agrega: nunca saca un permiso ni un dominio cargado a
mano. Imprime `configurar_embebido: N cambios` con el detalle.

Dashboards o embeds creados en la UI después del init se cubren volviendo a
correr el init (no recrea `superset`):

```sh
docker compose -f infra/superset/compose.yaml run --rm superset-init
```

### Red cruzada entre proyectos Docker

Las Edge Functions de Supabase y Superset son de dos proyectos Compose
distintos, cada uno con su propia red. `emitir-acceso-reporte` llama a
`http://superset:8088`, así que el servicio `superset` se une a la red que
crea `supabase start` (`supabase_network_<project_id>`) con alias
`superset`. `host.docker.internal` no sirve: el runtime de Edge Functions
sandboxea la red de cada isolate.

- La red se declara `external`: **Supabase tiene que estar levantado antes**
  que `pnpm dev:superset`. Si no, Compose falla con `network
  supabase_network_… declared as external, but could not be found`.
- Un producto derivado cambia el default del nombre de red en
  `compose.yaml` por su `project_id` de `supabase/config.toml`, o define
  `SUPABASE_DOCKER_NETWORK` en `infra/superset/.env`.
- `compose.vps.yaml` la saca: en el VPS no hay stack local de Supabase.
- `emitir-acceso-reporte` corta cada llamada a Superset a los 10 s. Si falta
  la red, devuelve 503 `analitica_no_disponible` en vez de colgarse hasta el
  wall-clock.

### Orígenes permitidos del embed

Superset rechaza con 403 la carga del iframe (`GET /embedded/<uuid>`) si el
`Referer` no está en `allow_domain_list` del embed. El script agrega a cada
embed los mismos orígenes que `CORS_OPTIONS` de `superset_config.py`:
`REFINE_ORIGIN` y las variantes `localhost`/`127.0.0.1` con `WEB_PORT`.
Si Refine cambia de puerto, alcanza con ajustar `WEB_PORT` en
`infra/superset/.env` y volver a correr el init. Superset y Refine tienen
que ver el mismo `WEB_PORT`: cada `compose.yaml` lee el `.env` de su propia
carpeta.

### Permisos del rol `Guest`

`GUEST_ROLE_NAME` (`"Guest"`) no trae de fábrica lo que un dashboard
embebido necesita. Hay dos capas: el bootstrap del SDK (sin ella el
navegador muestra "Something went wrong with embedded authentication") y el
pedido de datos de cada chart (sin ella cada chart muestra `"Data error:
Forbidden"`). El guest token resuelve *a qué* dashboard y a qué filas
accede (`resources`/RLS); el rol resuelve *qué puede hacer* adentro.

`configurar_embebido.py` (`PERMISOS_GUEST`) otorga:

| Permiso | View menu | Para qué |
|---|---|---|
| `can_read` | `CurrentUserRestApi` | bootstrap del SDK |
| `can_read` | `Dashboard` | bootstrap del SDK |
| `can_read` | `Chart`, `Dataset` | datos de cada chart |
| `can_get`, `can_external_metadata`, `can_external_metadata_by_name` | `Datasource` | datos de cada chart |
| `can_query`, `can_time_range`, `can_query_form_data` | `Api` | datos de cada chart |
| `can_csv` | `Superset` | exportar a CSV/Excel/imagen desde el menú "..." |
| `can_share_chart` | `Superset` | "Copy permalink"/"Share by email"; "Embed code" se bloquea aparte (sección siguiente) |
| `datasource_access` | cada dataset usado por un dashboard con embed | derivado de la metadata: charts y filtros nativos |

Si `superset init` no registra alguno de los pares fijos (nombre mal
escrito o cambio de versión de Superset), el script falla en vez de crear
un par que nadie chequea.

**A propósito NO se otorga** `can_view_query` (`Dashboard`): "View query" no
debe quedar visible para quien entra por guest token.

### Verificación de punta a punta

`pnpm test:superset:embebido` (`scripts/verificar-superset-embebido.mjs`)
recorre el mismo camino que el SDK, sin credenciales admin de Superset:
login en Supabase, `emitir-acceso-reporte` por cada reporte visible,
`GET /embedded/<uuid>` con el `Referer` de Refine y `POST
/api/v1/chart/data` de cada chart con el guest token. Nunca imprime tokens.

```sh
SUPABASE_URL=http://127.0.0.1:8100 SUPABASE_ANON_KEY=<anon> VERIFICAR_EMAIL=<usuario> VERIFICAR_PASSWORD=<password> WEB_ORIGIN=http://localhost:3100 pnpm test:superset:embebido
```

## "Embed code" no se puede aislar solo con permisos de rol

Superset agrupa "Copy permalink to clipboard", "Share chart by email" y
"Embed code" bajo el mismo permiso de rol (`can_share_chart`) — sacar el
permiso saca los tres juntos, no se puede aislar solo "Embed code" a nivel
de rol. Por eso `EMBEDDABLE_CHARTS` va en `False` en `FEATURE_FLAGS` de
`superset_config.py` (default real de Superset: `True`) en vez de resolverse
con permisos — así se conserva "Copy permalink"/"Share by email" sin
exponer "Embed code" a nadie. Requiere reiniciar el contenedor de Superset
para tomar el cambio (`docker restart` alcanza, no hace falta recrear — el
alias de red de arriba sobrevive un restart).

## Mapeo de UUIDs: dashboard propio vs. UUID de embedding

Cada dashboard tiene dos UUIDs distintos, fáciles de confundir:

- `dashboard.uuid` — identidad interna del dashboard en Superset.
- El UUID de **embedding** (`POST /api/v1/dashboard/<id>/embedded`) — es el
  que se usa como `dashboard_uuid` en el guest token y en la tabla de
  reportes de cada producto (spec 007). Son distintos: el título interno
  del dashboard en Superset no tiene por qué coincidir con el nombre de
  negocio que el producto le da al reporte.

## Tableros de Rentabilidad (MSF-120)

Rentabilidad usa dos tableros embebidos (`Resumen` y `Por producto`) que leen **solo** el esquema `analitica` de
la base de la app con el rol `superset_analitica` (solo lectura). Se importan desde
`infra/superset/dashboards/rentabilidad/` con `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/rentabilidad --entorno staging|production`,
que además registra los reportes en `public.reportes` con `seccion = 'rentabilidad'`. La conexión necesita
`SUPERSET_ANALITICA_DB_HOST` y `SUPERSET_ANALITICA_DB_PASSWORD` (nunca en Git; el rol nace `nologin` y el operador le
asigna login y contraseña por entorno). El aislamiento entre organizaciones lo fuerza la cláusula `rls`
(`organizacion_id`) del guest token, no la base: ver la revisión de seguridad y la reversión en
[`rentabilidad.md`](./rentabilidad.md).

## Tableros de Ventas · Reportes (F-VTA-22, MSF-347)

«Más vendidos» es el primer tablero de **Ventas · Reportes**: la tabla de productos más
vendidos en un período (unidades, facturado neto y estado del stock vigente). Vive en
`infra/superset/dashboards/ventas-reportes/` y se importa con
`pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/ventas-reportes --entorno staging|production`,
que además registra el reporte en `public.reportes` con `seccion = 'reportes'` y
`filtro_empresa = true` (el registro es idempotente: reimportar no duplica la fila). La conexión
(`Ventas analitica`) usa el mismo rol de solo lectura `superset_analitica` que la de Rentabilidad:
no puede leer nada fuera de `analitica`. El aislamiento entre organizaciones **y** empresas lo
fuerza la cláusula `rls` del guest token (`organizacion_id` + `empresa_id`), no la base.

`filtro_empresa` (columna de `public.reportes`, migración `20270104090050`) es **opt-in por
tablero**: la cláusula `rls` del guest token se aplica a todos los datasets del tablero, así que
solo puede llevar `empresa_id` si todas las vistas del tablero exponen esa columna. Ventas ·
Reportes lo declara en `true`; los tableros de Rentabilidad quedan en `false` (consolidados por
organización) y su cláusula sigue siendo solo `organizacion_id`. El importador toma el valor de
`reportes.json`; si falta, escribe `false`.

- **Dataset**: `analitica.ventas_producto_mas_vendido` (vista del contrato
  `specs/20270104-100000-ventas-reportes-basicos/contracts/analitica-ventas-reportes.md`). Su grano
  es empresa × producto × depósito × fecha: los **filtros nativos** (rango de fechas, empresa,
  categoría y ubicación de stock) se aplican sobre ese grano y el **gráfico** agrupa por producto y
  suma (métricas `unidades_total`, `facturado_total`, `posicion` y `stock_hoy_texto` del dataset).
- **Agrupación**: el gráfico agrupa por `producto_nombre` + `sku`. El nombre del producto **no** es
  único por organización (`productos_org_nombre_idx` no es único), así que agrupar solo por nombre
  fusionaba dos productos homónimos y su «Stock hoy» podía no ser el de ninguno; el SKU sí es único
  por organización (`productos_org_sku_uidx`), de modo que nombre + SKU identifican un producto igual
  que su id. Por eso el SKU es una columna de la tabla (el prototipo lo dibuja bajo el nombre).
- **Filtros nativos** (ids, para preseleccionarlos desde Refine por `dashboardUiConfig.urlParams`):
  `NATIVE_FILTER-rango` (rango de fechas, columna `fecha`), `NATIVE_FILTER-empresa` (`empresa_nombre`),
  `NATIVE_FILTER-categoria` (`categoria`) y `NATIVE_FILTER-deposito` (`deposito_nombre`).
- **Orden**: por unidades descendentes. En Superset 6.1.0 el viz de tabla **ignora `order_by_cols` en
  modo aggregate** (es un control solo-raw) y ordena por la métrica de `timeseries_limit_metric`, en
  descendente si `order_desc` está activo: el chart versiona `timeseries_limit_metric: unidades_total`
  + `order_desc: true`. `posicion` va primera en `metrics` solo por el **orden de las columnas**
  (`#`, Unidades, Facturado, Stock hoy), nunca para ordenar: es un `ROW_NUMBER` ascendente y, si
  fuera la primera métrica, el tablero mostraría los menos vendidos primero. La posición usa el mismo
  criterio (unidades descendentes, desempate por nombre y SKU), así el número es estable entre
  corridas.
- **Config que no se versiona**: `columns`, `include_time`, `server_page_length` y `order_by_cols` no
  hacen nada en 6.1.0 con este gráfico (son controles de modo raw o de paginación de servidor) y se
  quitaron para no confundir el mantenimiento.
- **Límites conocidos**: el viz de tabla de Superset muestra primero las columnas de agrupación, así
  que **«Producto» y «SKU» preceden a «#»** (el prototipo los trae al revés); «Stock hoy» es el **estado**
  del stock como texto («Sin stock» / «Stock bajo» / «Disponible»), no el chip con color del prototipo,
  porque el viz de tabla no dibuja chips. La pantalla de Refine (`/ventas/reportes`) preselecciona los
  filtros nativos de período y de empresa por `dashboardUiConfig.urlParams.native_filters` (rison):
  **verificar en un Superset real** tras importar que el rango de fechas y la tienda llegan
  preseleccionados; si la versión no los respeta, el tablero abre sin filtro (y el usuario los puede
  cambiar desde la barra de filtros del tablero). Verificar también que la posición arranca en 1 y que
  la fila más vendida es la primera.

## Tablero «Ranking de clientes» (F-VTA-23, MSF-358)

Es el segundo tablero de **Ventas · Reportes**: el ranking de clientes por facturación neta
(comprobantes, facturado, participación con barra y última compra). Vive en el mismo directorio
`infra/superset/dashboards/ventas-reportes/` y se importa **con el mismo paquete** que «Más
vendidos» (`pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/ventas-reportes --entorno staging|production`):
se registran los dos reportes en `public.reportes` con `seccion = 'reportes'` y `filtro_empresa = true`
(el registro es idempotente: reimportar no duplica la fila).

- **Dataset**: `analitica.ventas_ranking_clientes` (vista del contrato
  `specs/20270104-100000-ventas-reportes-basicos/contracts/analitica-ventas-reportes.md`). Su grano es
  empresa × cliente × fecha: los **filtros nativos** (rango de fechas, empresa y «Consumidor final») se
  aplican sobre ese grano y el **gráfico** agrupa por cliente y suma.
- **Agrupación**: el gráfico agrupa por `nombre` + `numero` + `tipo_texto`. El nombre del cliente **no**
  es único por organización (`clientes_org_nombre_idx` no es único), así que agrupar solo por nombre
  fusionaría dos clientes homónimos y su facturación sería la suma de dos; el `numero` (correlativo por
  organización) sí es único (`clientes_org_numero_uq`), de modo que nombre + número identifican a un
  cliente igual que su `id` — el mismo desempate que usa `public.ranking_clientes`.
- **Filtros nativos**: `NATIVE_FILTER-rango` (rango de fechas, columna `fecha`), `NATIVE_FILTER-empresa`
  (`empresa_nombre`) y `NATIVE_FILTER-consumidor-final` (`consumidor_final_texto`, columna calculada
  «Sí» / «No»). El valor inicial del tablero **excluye** al «Consumidor final»; la pantalla de Refine
  (`/ventas/reportes`, pestaña «Ranking de clientes») lo mueve con su interruptor.
- **Barra de participación**: la columna `Participación` se dibuja con el formato de celda `CELL_BAR`
  (`conditional_formatting` del chart), que pinta una barra proporcional al valor de la celda.
- **Verificar en un Superset real** tras importar (no hay Superset en el entorno de desarrollo):
  que la barra de participación se pinte, que el filtro de «Consumidor final» llegue preseleccionado
  con «No» y que la posición arranque en 1 con el cliente de mayor facturación primero. Si la versión
  no respeta los `native_filters` de la URL, el tablero abre sin filtro (y el usuario los puede cambiar
  desde la barra de filtros del tablero).
- **Volumen esperado**: la vista deja una fila por empresa × cliente × día, así que el costo del
  tablero es del orden de la cantidad de clientes × tiendas y no de la cantidad de comprobantes. No se
  midió con 10.000 clientes por organización (el `row_limit` del gráfico es 10.000, como el de «Más
  vendidos»).

> Guía funcional, permisos, exportación y revisión de seguridad de **Ventas · Reportes**:
> [`ventas-reportes.md`](./ventas-reportes.md). La superficie se cubre con
> `supabase/tests/database/ventas_reportes_superficie.test.sql` y el recorrido con
> `apps/web/e2e/ventas-reportes.e2e.ts`.

## Tablero «Rentabilidad · Por producto» (F-REN-03, MSF-242)

Vive en `infra/superset/dashboards/rentabilidad/` junto al Resumen y se importa con el mismo paquete (slug `rentabilidad-por-producto`, registrado en `reportes.json` con `seccion = 'rentabilidad'`). Reusa el dataset `margen_producto_canal` (vista `analitica.margen_producto_canal`, una fila por producto y tienda), al que se le sumaron **columnas calculadas aditivas** (texto es-AR, colores, `estado_etiqueta`, `producto_busqueda`); la cláusula `rls` del guest token sigue siendo `organizacion_id`.

- **Tabla**: gráfico Handlebars `Productos por canal` (columnas del prototipo, barra de margen %, chip de estado, contador «N filas», «Sin resultados / Cambiá el filtro o la búsqueda.», negativos en el rojo de error). Orden fijo por margen % ascendente (menor margen primero).
- **Filtros nativos**: `Estado` (`estado_etiqueta`), `Canal` (`empresa_nombre`, solo tiendas) y `Buscar producto o SKU` (`producto_busqueda`).
- **Filtro inicial desde el resumen**: la pantalla `/rentabilidad/productos?estado=bajo_o_negativo|negativo` pasa `native_filters` (rison) por `dashboardUiConfig.urlParams` del SDK de embebido, apuntando al filtro `NATIVE_FILTER-estado`. Los valores salen de una lista cerrada (`apps/web/src/lib/rentabilidad.ts`). **Verificar en un Superset real** tras importar que el filtro llega preseleccionado; si la versión no lo respeta, el tablero abre sin filtro (ordenado por menor margen, donde aparecen primero los negativos).
- **Desvío (T025, selector «Mayor/Menor margen primero»)**: no existe como control; Superset no ofrece un orden como filtro nativo ni se pudo hacer con Handlebars sin scripts. El orden queda fijo por menor margen primero. Seguimiento propio: **MSF-556** (Tarea `seguimiento`).
- **Límites conocidos**: `Buscar producto o SKU` es un `filter_select` (lista desplegable con búsqueda), no un campo de texto libre (desvío del prototipo, seguimiento **MSF-556**); la tabla Handlebars no pagina (`row_limit` 10000, `server_page_length` no aplica) — el volumen esperado (estimación sin medición) es de cientos de filas producto×tienda por organización; no se midió con 10.000 filas.
- El contrato visible se fija en `apps/web/src/pages/rentabilidad/tableroPorProducto.contrato.test.ts` y las filas/filtros/orden contra Postgres en `supabase/tests/database/rentabilidad_por_producto.test.sql`.

## Tablero «Rentabilidad · Comparativo» (F-REN-06, MSF-261)

Vive en `infra/superset/dashboards/rentabilidad/` (slug `rentabilidad-comparativo`, registrado en `reportes.json` con `seccion = 'rentabilidad'`; el importador lo registra una sola vez, es idempotente). Lee la vista `analitica.margen_comparativo_producto` (solo productos con margen en 2 o más empresas; el rol `superset_analitica` solo hace `select`), sin cuentas de Mercado Libre.

- **Dataset virtual** `margen_comparativo_producto`: una fila por producto y por orden. Agrupa el margen % de cada empresa en `margenes_html` (nombres escapados), y expone `diferencia_pp`, `empresa_mejor`, `empresa_peor` y `organizacion_id` (columna del `rls` del guest token).
- **Orden por diferencia sin Jinja**: el dataset repite cada producto con `orden_etiqueta` = «Mayor diferencia primero» / «Menor diferencia primero» y su `posicion`; el filtro nativo `Orden por diferencia` (selección única, por defecto «Mayor…») elige el conjunto y la tabla ordena por `posicion`. No hace falta activar `ENABLE_TEMPLATE_PROCESSING`.
- **Filtros nativos**: `Buscar producto o SKU` (`producto_busqueda`, mismo límite de lista desplegable que «Por producto») y `Orden por diferencia`.
- **Vacío**: «Sin resultados» cuando no hay productos comparables o el filtro no coincide.
- Verificación: `supabase/tests/database/rentabilidad_comparativo.test.sql` y `rentabilidad_comparativo_aislamiento.test.sql` (vista y token por organización) e `infra/superset/importar-dashboards.test.mjs` (YAML y reporte).

## Tablero «Rentabilidad · Historia» (F-REN-07, MSF-280)

Vive en `infra/superset/dashboards/rentabilidad/` (slug `rentabilidad-historia`, registrado en `reportes.json` con `seccion = 'rentabilidad'`; idempotente). Lee la vista `analitica.margen_historico_producto_canal` (rol `superset_analitica` solo `select`), sin cuentas de Mercado Libre.

- **Dataset** `margen_historico_producto_canal`: una fila por producto × empresa × fecha; expone `organizacion_id` (columna del `rls` del guest token), `producto_etiqueta` (nombre y SKU, para el selector) y columnas de texto en pesos para la tabla.
- **Filtro nativo `Producto`** (selección única, obligatorio: `enableEmptyFilter`). Sin producto elegido Superset no dibuja series mezcladas. Si el SDK embebido no respetara el filtro obligatorio, es un desvío a documentar (ver riesgos del plan).
- **Gráficos**: serie `echarts_timeseries_line` de margen % por empresa a lo largo de la fecha, y tabla de apoyo (fecha, empresa, cotización, costo, neto, margen, margen %; la más reciente primero).
- **Vacío**: «Sin historia para este producto» con el motivo de negocio (falta un costo registrado o una cotización cargada).
- Verificación: `supabase/tests/database/rentabilidad_historia.test.sql` y `rentabilidad_historia_aislamiento.test.sql`, `infra/superset/importar-dashboards.test.mjs` y `tableroHistoria.contrato.test.ts`.
