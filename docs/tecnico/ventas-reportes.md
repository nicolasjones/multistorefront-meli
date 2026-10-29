---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ventas · reportes básicos (técnico, MSF-338)

Implementación de la épica **MSF-338** (spec `20270104-100000-ventas-reportes-basicos`): **F-VTA-22**
«Productos más vendidos» (MSF-347) y **F-VTA-23** «Ranking de clientes con exportación» (MSF-358), más el
cierre (MSF-568: docs, revisión de seguridad, pgTAP de superficie y E2E). La vista de producto está en
[Ventas · reportes básicos (producto)](../producto/ventas-reportes.md).

!!! note "Estado"
    Implementado en la rama `epic/MSF-338-ventas-y-despacho-ventas-reportes-basico` (historias en
    `feat/story-MSF-347`, `feat/story-MSF-358` y `feat/story-MSF-568`), **pendiente de merge a `main`**.
    Migraciones `20270104090000`–`20270104090200` (todas aditivas, con la reversión en el encabezado).
    Contrato de las vistas:
    `specs/20270104-100000-ventas-reportes-basicos/contracts/analitica-ventas-reportes.md`.

    La rama de la épica trae además su guía operativa en la estructura plana de la documentación
    (`docs/ventas-reportes.md`): esta página es la versión estructurada (producto + técnico) de esa
    información y es la que manda en la sección Técnica.

## Pantalla y rutas

- **Ruta**: `/ventas/reportes` (`apps/web/src/pages/ventas-reportes/`), recurso `ventas-reportes`
  (`apps/web/src/App.tsx`), protegida con `RequiereAccesoSeccion seccion="reportes"`.
- **Menú**: destino `ventas-reportes` («Reportes de ventas», ícono `BarChart`) en
  `apps/web/src/components/navegacion/destinosPanel.ts`, con `seccionPermiso: 'reportes'` (no `ventas`: es
  la sección que exige el token).
- **Marco** (`pages/ventas-reportes/index.tsx`): `EncabezadoPagina` con el título «Reportes de ventas» y
  el subtítulo del prototipo, `Tabs` con «Más vendidos» / «Ranking de clientes», `FiltroEmpresa` (píldoras
  «Todas las tiendas» + las accesibles) y `FiltrosPeriodo` («Desde» / «Hasta» + atajos **Hoy**, **7 días**,
  **Este mes**, **Mes anterior**; abre en **Este mes**).
- **Textos y constantes**: `apps/web/src/lib/ventas-reportes.ts` (sección, título, subtítulo, atajos,
  mensaje de vacío `MENSAJE_SIN_VENTAS = 'No hay ventas en ese período'`, ids de los filtros nativos y el
  código rison de `dashboardUiConfig.urlParams.native_filters`).
- **Tableros**: `TableroReporte.tsx` (embebido + estados), `MasVendidos.tsx`, `RankingClientes.tsx`
  (interruptor «Consumidor final»), `ExportarRankingVentas.tsx` (botón, progreso, cancelación y avisos).
- **Hooks**: `useVentasReportes.ts` (conteo del período, con la clave de filtros para invalidar en render) y
  `useFiltroPorEmpresaActiva` (filtro por empresa activa).

### Cómo viajan los filtros al tablero

Los dos filtros de la pantalla se preseleccionan en el tablero por la URL del embebido
(`dashboardUiConfig.urlParams.native_filters`, en rison):

| Filtro | Id | Columna / valor |
|---|---|---|
| Período | `NATIVE_FILTER-rango` | `fecha` (rango `desde : hasta`) |
| Tienda | `NATIVE_FILTER-empresa` | `empresa_nombre` (el **nombre** de la tienda, que es lo que el dataset expone) |
| «Consumidor final» (solo ranking) | `NATIVE_FILTER-consumidor-final` | `consumidor_final_texto` (`'No'` con el interruptor apagado; `'No','Sí'` con el interruptor encendido) |

El texto viaja en rison con `!` y `'` escapados (`textoRison`, `listaRison`): los nombres salen de la base,
pero se escapan igual. Cambiar un filtro remonta el tablero (nueva `key`): se pide el token otra vez y se
vuelve a montar.

## Modelo de datos

**No hay tablas nuevas.** La épica agrega **vistas** en el esquema `analitica` (solo vistas y funciones),
**dos RPC** en `public` y **una columna** en `public.reportes`.

| Objeto | Esquema | Estado | Cambio |
|---|---|---|---|
| `analitica.ventas_producto_mas_vendido` | `analitica` | **nueva (vista)** | Productos más vendidos: grano empresa × producto × depósito × fecha. |
| `analitica.ventas_ranking_clientes` | `analitica` | **nueva (vista)** | Ranking de clientes: grano empresa × cliente × fecha. |
| `analitica.comprobante_cuenta_como_facturado(text, text)` | `analitica` | **nueva (función)** | Envoltorio `security definer` de `private.comprobante_cuenta_como_facturado`. |
| `analitica.signo_comprobante(text)` | `analitica` | **nueva (función)** | Envoltorio `security definer` de `private.signo_comprobante`. |
| `analitica.stock_de_producto(uuid, uuid)` | `analitica` | **nueva (función)** | Envoltorio `security definer` de `public.stock_estados`. |
| `public.ventas_reportes_conteo(date, date, uuid)` | `public` | **nueva (RPC)** | Comprobantes que cuentan como venta en el período (estado vacío de la pantalla). |
| `public.leer_ranking_ventas(date, date, boolean, uuid, integer, integer)` | `public` | **nueva (RPC)** | Lectura del ranking para la exportación a Excel (misma vista que el tablero). |
| `public.reportes` | `public` | **alterada** | Columna `filtro_empresa boolean not null default false` (migración `20270104090050`). |
| `dominio.comprobantes_venta` / `dominio.comprobantes_venta_lineas` | `dominio` | **existentes** | Solo se leen. |
| `public.clientes` | `public` | **existente** | Solo se lee (`numero`, `nombre`, `tipo`, `es_consumidor_final`). |
| `public.stock_estados` | `public` | **existente** | Solo se lee (`cantidad`, `estado`). |

El DER completo está en [Datos y DER](datos.md#ventas-reportes-basicos-msf-338).

### `analitica.ventas_producto_mas_vendido`

Migración `20270104090000_analitica_ventas_producto_mas_vendido.sql`. Columnas: `organizacion_id`,
`empresa_id`, `empresa_nombre`, `producto_id`, `producto_nombre`, `sku`, `categoria`, `deposito_id`,
`deposito_nombre`, `unidades bigint`, `facturado numeric`, `stock_hoy numeric`, `stock_estado text`,
`fecha date`.

- `unidades` = Σ `signo_comprobante(tipo)` × cantidad de las líneas del producto (**la nota de crédito
  resta unidades**).
- `facturado` = Σ `signo_comprobante(tipo)` × (`subtotal_sin_iva` + `iva`) de las líneas: el total **con
  IVA**, el mismo `total_con_iva` que muestra el listado y la exportación de comprobantes, para que el
  reporte cuadre con lo exportado (CA-VTA-22-1).
- `stock_hoy` / `stock_estado` salen de `public.stock_estados` (stock **vigente del producto en la
  organización**, no por depósito): es la única fuente del estado y ningún consumidor lo recalcula.
- `categoria` es el nombre de la categoría del producto (`dominio.categorias.nombre`); `null` si el
  producto no tiene.
- Un comprobante **sin `empresa_id`** no produce fila.
- Permisos: `revoke all … from public, anon, authenticated` y `grant select … to superset_analitica`.

### `analitica.ventas_ranking_clientes`

Migración `20270104090100_analitica_ventas_ranking_clientes.sql`. Columnas: `organizacion_id`,
`empresa_id`, `empresa_nombre`, `posicion bigint`, `cliente_id`, `numero integer`, `nombre`, `tipo`,
`consumidor_final boolean`, `fecha date`, `comprobantes bigint`, `facturado numeric`,
`participacion numeric`, `ultimo_comprador date`.

- `comprobantes` cuenta **solo facturas** que cuentan (la nota de crédito resta del importe pero **no** suma
  un comprobante).
- `facturado` = Σ `signo_comprobante(tipo)` × `total_con_iva` (con IVA, la misma base que «Más vendidos»).
- `posicion` = `row_number()` por facturación descendente con desempate por nombre y número — el mismo
  criterio que `public.ranking_clientes` (MSF-126), para que los dos rankings coincidan.
- `participacion` = porcentaje (0–100, sin redondear) sobre el total del alcance visible; con total cero es
  0.
- `ultimo_comprador` = fecha del comprobante más reciente que cuenta del cliente **en esa tienda** (con
  varias tiendas, el tablero toma el máximo).
- `consumidor_final` es la **marca** (`public.clientes.es_consumidor_final`): la vista **no excluye a
  nadie**, la exclusión se decide donde se aplica (filtro nativo del tablero y parámetro de la RPC).
- **`posicion` y `participacion` se recalculan sobre el filtro**: en la vista son del cliente en todo el
  alcance visible; cuando la pantalla o la RPC filtran por período o tienda, el filtro se aplica **antes**
  de agregar y la posición y la participación se **recalculan** con la misma fórmula. Por eso el tablero
  **no usa** esas dos columnas y las calcula como métricas.

### RPC de `public`

| RPC | Qué hace | Seguridad |
|---|---|---|
| `ventas_reportes_conteo(p_desde date, p_hasta date, p_empresa_id uuid default null) returns integer` | Comprobantes que cuentan como venta en el período. Es lo que decide el estado vacío «No hay ventas en ese período» (SC-003). `p_empresa_id` acota a una tienda y **nunca amplía** el alcance (una empresa ajena cuenta 0). | `security definer`, `set search_path = ''`; exige organización activa y `reportes` ≥ lectura (`42501`); `revoke … from public, anon`; `grant execute … to authenticated` |
| `leer_ranking_ventas(p_desde date, p_hasta date, p_incluir_consumidor_final boolean default false, p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 1000) returns table (posicion, cliente_id, numero, nombre, tipo, comprobantes, facturado, participacion, ultimo_comprador, total_filas)` | Lectura del ranking para la exportación. Lee la **misma vista** que el tablero (una sola fuente), agrega por cliente (el grano de la vista es empresa × cliente × fecha) y **recalcula posición y participación sobre el resultado filtrado** (período, tienda y «Consumidor final»), con la misma fórmula y el mismo desempate que las métricas del tablero. Devuelve una página (`p_pagina`, `p_tamano`, **tope de 5.000 filas** por pedido) y `total_filas` del alcance. | `security definer`, `set search_path = ''`; autorización **dentro**: organización activa + `reportes` ≥ lectura (`42501` si no) y acotado a `private.empresas_accesibles()`; `revoke … from public, anon`; `grant execute … to authenticated` |

Las dos RPC son `stable` y `security definer` **por una razón**: las vistas de `analitica` están cerradas
para `authenticated` (las lee solo el rol `superset_analitica`), y el criterio de qué cuenta como venta
tiene que vivir en **un solo lugar** (`private.comprobante_cuenta_como_facturado`). Es el mismo patrón que
`public.rentabilidad_conteo_margen` (MSF-120).

Errores: `42501` sin la sección `reportes` · `22023` rango de fechas inválido, página o tamaño de lote
inválido. Los mensajes están en castellano.

## El cálculo (predicado y signo)

El criterio **no se reimplementa** en ninguna de las dos historias:

- **Predicado**: `private.comprobante_cuenta_como_facturado(tipo, estado)` — cuenta la **factura** y la
  **nota de crédito**; nunca el `borrador`, la `anulada` ni el presupuesto. Lo fijó Ventas (MSF-177).
- **Signo**: `private.signo_comprobante(tipo)` — la nota de crédito vale −1.
- **Importe**: total **con IVA** (`total_con_iva`), el mismo del listado y de la exportación de
  comprobantes.

Como el rol de Superset no tiene acceso a `private`, las vistas llaman a los **envoltorios**
`analitica.comprobante_cuenta_como_facturado` y `analitica.signo_comprobante` (`security definer`,
`set search_path = ''`), con `revoke … from public, anon, authenticated` y `grant execute … to
superset_analitica`. `analitica.stock_de_producto` envuelve `public.stock_estados` (que es
`security_invoker`) por el mismo motivo.

Un cliente con **solo notas de crédito** en el período tiene facturación neta **negativa** (el neto real,
sin piso en cero): es la decisión 3 de la spec, **provisional** hasta que el cliente la confirme.

## Filtro por empresa en el guest token

`emitir-acceso-reporte` (spec 007) ya forzaba la organización en la cláusula `rls` del guest token. La
épica la **extiende** con las empresas accesibles de quien llama (FR-004):

```sql
organizacion_id = '<uuid de la organización>'
  AND empresa_id IN ('<uuid>', …)
```

- La lista sale de `public.empresas_para_selector()` (que expone `private.empresas_accesibles()`),
  ejecutada **como el usuario que llama**.
- Los identificadores se validan **uno por uno** (`clausulaRls` en
  `supabase/functions/emitir-acceso-reporte/handler.ts`): lo que no es UUID se descarta, porque la lista
  se interpola como texto SQL y nunca es texto libre del cliente.
- **Sin empresas accesibles** la cláusula es `… AND false`: es un filtro de datos, no una decisión de
  autorización (esa la tomó `resolver_organizacion_reporte`); un token sin ese filtro dejaría ver empresas
  ajenas.
- **Si no se pueden resolver** la función responde `503 { "error": "alcance_no_resuelto" }` y **no pide
  token** a Superset: fallar abierto mostraría filas ajenas.
- La extensión es **opt-in por reporte**: la cláusula `rls` se aplica a **todos** los datasets del tablero,
  así que un tablero cuyas vistas no exponen `empresa_id` (los consolidados por organización de
  Rentabilidad) quedaría con una consulta inválida. Por eso `public.reportes` suma
  `filtro_empresa boolean not null default false` y el importador escribe el valor desde `reportes.json`:
  los tableros de Ventas · Reportes lo declaran en `true` y los de Rentabilidad quedan en `false` (conservan
  la cláusula solo por organización).

!!! warning "BREAKING del comportamiento del token (no de la firma)"
    El guest token de los reportes con `filtro_empresa = true` deja de ver todas las empresas de la
    organización: pasa a ver **solo las accesibles de quien llama**. Lo habilitan los tableros de Ventas ·
    Reportes.

El filtro por empresa **de la pantalla** (`FiltroEmpresa`) se aplica **adentro** del tablero (filtro nativo
`NATIVE_FILTER-empresa`): el token es el máximo alcanzable y el filtro lo acota.

## Tableros de Superset

YAML versionados en `infra/superset/dashboards/ventas-reportes/` (dataset, gráfico, tablero y
`reportes.json`), importados con `infra/superset/importar-dashboards.mjs` y registrados en `public.reportes`
con `seccion = 'reportes'` de forma **idempotente** (upsert por `superset_dashboard_uuid`).

```bash
pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/ventas-reportes --entorno staging
pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/ventas-reportes --entorno production
```

### «Más vendidos» (F-VTA-22)

| Pieza | Qué es |
|---|---|
| Dataset | `analitica.ventas_producto_mas_vendido` (grano empresa × producto × depósito × fecha). |
| Gráfico | Tabla (`table`, modo `aggregate`): agrupa por `producto_nombre` + `sku` y suma. |
| Métricas | `posicion` (`ROW_NUMBER() OVER (ORDER BY SUM(unidades) DESC, producto_nombre, sku)`), `unidades_total` (`SUM(unidades)`), `facturado_total` (`SUM(facturado)`) y `stock_hoy_texto` (estado del stock con las etiquetas de la app). |
| Columnas | Producto, SKU, #, Unidades, Facturado, Stock hoy (el viz de tabla de Superset pone primero las columnas de agrupación). |
| Orden | Por unidades descendentes: `timeseries_limit_metric: unidades_total` + `order_desc: true` (en Superset 6.1.0 el viz de tabla **ignora `order_by_cols` en modo aggregate**). `posicion` va primera en `metrics` solo para el orden de las columnas: si fuera la métrica de orden, mostraría los **menos** vendidos primero. |
| Filtros nativos | `NATIVE_FILTER-rango` (rango de fechas, `fecha`), `NATIVE_FILTER-empresa` (`empresa_nombre`), `NATIVE_FILTER-categoria` (`categoria`), `NATIVE_FILTER-deposito` (`deposito_nombre`). |

El grupo es `producto_nombre` + `sku` porque `dominio.productos` **no** exige nombre único por organización
(el índice `productos_org_nombre_idx` no es único): agrupar solo por nombre fusionaría dos productos homónimos
en una fila. El SKU sí es único por organización (`productos_org_sku_uidx`).

### «Ranking de clientes» (F-VTA-23)

| Pieza | Qué es |
|---|---|
| Dataset | `analitica.ventas_ranking_clientes` (grano empresa × cliente × fecha). |
| Gráfico | Tabla (`table`, modo `aggregate`): agrupa por `nombre` + `numero` + `tipo_texto` y suma. |
| Métricas | `posicion` (`ROW_NUMBER() OVER (ORDER BY SUM(facturado) DESC, lower(nombre), numero)`), `comprobantes_total`, `facturado_total`, `participacion_total` (`SUM(facturado) / SUM(SUM(facturado)) OVER ()`) y `ultimo_comprador` (`MAX(ultimo_comprador)`). |
| Columnas | Cliente, Nº, Tipo, #, Comprobantes, Facturado, Participación (con barra) y Último comprador. |
| Barra de participación | `conditional_formatting` con `objectFormatting: CELL_BAR` sobre la columna Participación. |
| Orden | Por facturación neta descendente (`timeseries_limit_metric: facturado_total` + `order_desc: true`). |
| Filtros nativos | `NATIVE_FILTER-rango`, `NATIVE_FILTER-empresa` y `NATIVE_FILTER-consumidor-final` (`consumidor_final_texto`, valor inicial «No» = excluido). |

El grupo es `nombre` + `numero` + `tipo_texto` por la misma razón que en «Más vendidos» (`public.clientes`
no exige nombre único por organización); `numero` es el correlativo por organización y sí es único.

`reportes.json` declara los dos tableros:

```json
{ "nombre": "Ventas · Más vendidos", "dashboard_slug": "ventas-mas-vendidos",
  "seccion": "reportes", "filtro_empresa": true, "rolesPorDefecto": ["administracion"] }
```

(«Ventas · Ranking de clientes», `ventas-ranking-clientes`, igual). `administrador` no se lista: tiene acceso
incondicional y la tabla `reportes_roles_default` lo prohíbe con un `CHECK`.

**Límites conocidos**: el viz de tabla muestra primero las columnas de agrupación (por eso «Cliente», «Nº»
y «Tipo» preceden al «#», al revés del prototipo); la barra de participación y la llegada de los filtros
nativos preseleccionados **no están verificados contra un Superset real** (no hay Superset en desarrollo).

## Exportación a Excel

`apps/web/src/lib/exportarRankingVentas.ts` + `apps/web/src/pages/ventas-reportes/ExportarRankingVentas.tsx`.

- **Una sola fuente**: las filas salen de `public.leer_ranking_ventas`, que lee la **misma vista** que el
  tablero (`analitica.ventas_ranking_clientes`): el Excel y la pantalla no pueden discrepar (SC-004).
- **Por lotes**: la RPC devuelve una página (`p_tamano` con tope de 5.000) y `total_filas`; el navegador baja
  el ranking **completo** de a 1.000 filas por pedido (`TAMANO_LOTE_EXPORTACION`).
- **Tope**: `TOPE_FILAS_RANKING_VENTAS = 100_000` clientes por archivo. Con más filas la exportación se
  rechaza con un mensaje que pide acotar el período o los filtros (**no** baja un archivo a medias).
- **Columnas**: las del tablero — Cliente, Nº, Tipo, #, Comprobantes, Facturado, Participación y Último
  comprador — y, después de una fila en blanco, el contexto (Período, si el «Consumidor final» está
  Incluido o Excluido), la cantidad de clientes y el total facturado.
- **Neutralización**: todo texto va con `neutralizarFormula` (apóstrofo delante de `=`, `+`, `-`, `@`, el
  helper de F-CLI-09) y `type: String`, para que la planilla no interprete un nombre de cliente como
  fórmula.
- **Carga diferida**: `write-excel-file/browser` se importa recién al exportar (no pesa en el recorrido
  principal).
- **Archivo**: `ranking-clientes-ventas-<desde>_<hasta>.xlsx`, hoja «Ranking de clientes».
- **Interacción**: progreso («Exportando X de Y clientes…»), **Cancelar exportación**, aviso de éxito
  («Exportación lista: el archivo se descargó.»), aviso de vacío («No hay clientes en el ranking con esos
  filtros. Probá con otro período o activá el «Consumidor final».») y error con **Reintentar**.
- **La base autoriza, no el botón**: el botón solo se monta con `reportes` ≥ lectura
  (`useNivelSeccion(SECCION_REPORTES)`), pero la RPC vuelve a comprobarlo y responde `42501` sin permiso
  (SC-005).

La **participación viaja en dos escalas**: la RPC la devuelve en porcentaje (0–100) y el Excel la escribe
como fracción con formato `0.0%`; las dos pantallas muestran el mismo número.

## Permisos

- Sin la sección `reportes`: la ruta muestra «No tenés acceso a esta sección» y **no pide token**.
- La sección es **por empresa**: el nivel sale de la empresa activa (`private.nivel_seccion('reportes')`).
  La matriz inicial (`20261013130002_roles_basicos_permisos.sql`) deja `reportes` en **edición** para
  `administrador` y `administracion`, y en **ninguno** para `operador`, `consulta`, `mostrador`, `deposito`
  y `miembro`.
- Las RPC de `public` **hacen la autorización adentro** (`security definer`): organización activa,
  `reportes` ≥ lectura y acotado a `private.empresas_accesibles()`.
- `resolver_organizacion_reporte` (spec 007) sigue siendo la autoridad para emitir el token: sin sección
  devuelve `null` y la función responde 403 **sin emitir token**.

## Pruebas

- **pgTAP** (`pnpm test:db`):
  `supabase/tests/database/ventas_reportes_mas_vendido.test.sql` (suma solo la empresa filtrada, coincide
  con el listado exportado, las notas restan, presupuestos y anuladas no cuentan, `anon`/`authenticated`
  sin acceso),
  `ventas_reportes_ranking.test.sql` (orden por facturación neta, participación sobre el total, exclusión
  del «Consumidor final», cliente con solo notas de crédito con facturación **negativa**),
  `ventas_reportes_leer_ranking.test.sql` (superficie de acceso, rechazo 42501 sin la sección, mismas filas
  y total que la vista, filtros, paginación y aislamiento) y
  `ventas_reportes_superficie.test.sql` (la revisión de seguridad del cierre).
- **Vitest**: `apps/web/src/pages/ventas-reportes/*.test.tsx` (acceso restringido, vacío, error con
  reintento, reencuadre al cambiar de empresa, interruptor de «Consumidor final»),
  `apps/web/src/lib/ventas-reportes.test.ts` (rison de los filtros nativos, atajos de período),
  `apps/web/src/lib/exportarRankingVentas.test.ts` (neutralización, lotes, topes, contexto) y
  `apps/web/src/pages/ventas-reportes/rankingClientes.contrato.test.ts` (paridad entre las columnas del
  `.xlsx` y las del tablero).
- **Edge Function**: `node --test supabase/functions/emitir-acceso-reporte/handler.test.ts` (cláusula `rls`
  con y sin filtro por empresa).
- **Superset**: `pnpm test:superset:importar-dashboards` (dataset, tablero y registro idempotente).
- **E2E**: `apps/web/e2e/ventas-reportes.e2e.ts` (cierre MSF-568, T015): acceso restringido de Operador y
  Consulta con el rechazo `42501` del servidor, pantalla para Administración y Administrador, cambio de
  empresa que reencuadra el filtro de tienda y exportación del ranking a `.xlsx`. Se omite sin
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (no corre en el CI público) y **no monta Superset**.
- **Guards**: `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm prototipo:check`, `pnpm matriz:check` y
  `pnpm docs:check`.

## Revisión de seguridad del cierre (T014, FR-010)

Verificada con `supabase/tests/database/ventas_reportes_superficie.test.sql` además de los tests de cada
historia. Resultado: **sin hallazgos bloqueantes**.

| Control | Resultado |
|---|---|
| `anon` | Sin `USAGE` sobre `analitica`, sin `SELECT` en las vistas y sin `EXECUTE` en las dos RPC. |
| `authenticated` | Sin `USAGE` ni `SELECT` sobre `analitica`; lee solo por las RPC (autorizan adentro). |
| Rol `superset_analitica` | Solo `SELECT` en las vistas y `execute` en los envoltorios; no es superusuario ni salta RLS; no lee `dominio.comprobantes_venta*` ni `public.clientes`. |
| RPC `security definer` | `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated` y autorización explícita adentro. |
| Token por empresa | `organizacion_id` + `empresa_id IN (…)` forzados en el servidor; UUIDs validados; `503` (no token) si no se puede resolver el alcance. |
| Principio VII | Sin tablas nuevas; `analitica` sigue sin tablas; `rls_en_toda_tabla` sigue verde. |
| Exportación | El servidor rechaza sin la sección `reportes` (42501); el botón oculto no es la autorización; los textos del archivo van neutralizados. |

## Reversión

Todo es **aditivo** y no guarda datos. Para quitar la funcionalidad, en migraciones posteriores (no en el
mismo PR que lo crea):

1. `drop function public.leer_ranking_ventas(date, date, boolean, uuid, integer, integer)` y
   `drop function public.ventas_reportes_conteo(date, date, uuid)`.
2. `drop view analitica.ventas_ranking_clientes, analitica.ventas_producto_mas_vendido` y las funciones de
   apoyo `analitica.stock_de_producto(uuid, uuid)`,
   `analitica.signo_comprobante(text)` y `analitica.comprobante_cuenta_como_facturado(text, text)`.
3. `alter table public.reportes drop column filtro_empresa`.
4. Dar de baja las filas de `public.reportes` de los dos tableros y restaurar
   `emitir-acceso-reporte`/`resolver_organizacion_reporte` a la versión previa.
5. El código de la pantalla (`apps/web/src/pages/ventas-reportes/`, `apps/web/src/lib/ventas-reportes.ts`,
   `apps/web/src/lib/exportarRankingVentas.ts`) y el menú se vuelven con el `git revert` del PR.

## Pendientes

| Qué falta | Por qué | Dueño |
|---|---|---|
| **Verificación en un Superset real** | Que los filtros nativos preseleccionados lleguen al tablero (`NATIVE_FILTER-rango`, `-empresa`, `-consumidor-final`) y que la barra de participación se pinte: hoy está verificado contra los YAML y los tests del importador | plataforma / Superset |
| **Rótulo del E2E y `**Jira Epic**:` en la spec** | `pnpm cobertura:e2e` ata cada test a su épica con `[EPICA:TASK]` y la línea `**Jira Epic**: MSF-338` del `spec.md`; hoy el E2E no tiene rótulo y la spec no la declara, así que el manifiesto lo reporta como «épica desconocida» | responsable de plataforma (cierre de MSF-338) |
| **E2E que monte el tablero** | El E2E actual valida el marco, el filtro, el botón y el acceso contra la base, pero no monta Superset: no cubre las filas de los tableros | responsable de plataforma |
| **Vacío del ranking cuando solo hay ventas al «Consumidor final»** | `ventas_reportes_conteo` cuenta comprobantes y no distingue el «Consumidor final»; la RPC de lectura ya podría distinguirlo mirando `total_filas` | Producto / Ventas |

## Fuera de alcance

- Los **avisos «avisame cuando vuelva»** (tercera pestaña del prototipo) y el botón «Avisar».
- El **desglose por tienda** que dibuja el prototipo (el filtro por tienda sí está).
- La **exportación de «Más vendidos»** a Excel.
- El **reporte de ventas por período y canal** (F-REP-05, MSF-248) y el **desglose por empresa** de
  MSF-192: hay que decidir a quién pertenece cada reporte (el de ranking se solapa con F-CLI-08/F-CLI-09 de
  MSF-126).
- La **exportación nativa de Superset**: la del panel es propia (decisión 2 de la spec).
- Mercado Libre y el resto de los canales en los reportes (Etapa 2).

## Para seguir

- **[Ventas · reportes básicos (producto)](../producto/ventas-reportes.md)** — qué resuelve y cómo se prueba.
- **[Datos y DER](datos.md#ventas-reportes-basicos-msf-338)** — el modelo de datos de la épica.
- **[API y RPC](api.md#ventas-reportes-basicos-msf-338)** — los contratos públicos.
- **[Operar Superset](../operar-superset.md)** — importar y publicar los tableros.
- **[Rentabilidad](rentabilidad.md)** — el mismo esquema `analitica` y el mismo embebido (MSF-120).
