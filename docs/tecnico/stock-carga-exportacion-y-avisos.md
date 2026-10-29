---
owner: tecnico
sources:
  - supabase/migrations
  - apps/web/src/pages/stock
---

# Stock · carga inicial, exportación y avisos (MSF-368)

Contratos, datos y operación de la épica MSF-368: F-STK-07 · MSF-380 (carga inicial por planilla), F-STK-08 ·
MSF-388 (exportación a CSV), F-STK-09 · MSF-394 (aviso de reposición), F-STK-17 · MSF-405 (faltantes con aviso)
y F-STK-18 · MSF-414 (productos más vendidos). El detalle de producto (qué resuelve, para quién y límites) está en
[Stock · carga inicial, exportación y avisos](../producto/stock-carga-exportacion-y-avisos.md).

!!! warning "Estado de la rama"
    La implementación vive en `epic/MSF-368-stock-stock-carga-exportacion-y-avisos`; a la fecha de esta página no
    está mergeada a `main`. Las migraciones, rutas, funciones y pruebas citadas existen en esa rama; en `main`
    todavía no están. La spec vive en `specs/20261024-130000-stock-carga-exportacion-y-avisos/` (rama de la épica).

## Migraciones (aditivas)

| Migración | Contenido |
|-----------|-----------|
| `20261212140000_stock_avisos_reposicion.sql` | `dominio.stock_avisos_reposicion` (registro de cada resumen) y `dominio.stock_alertas_avisadas` (marca de alerta ya avisada); RLS de solo lectura |
| `20261212140100_stock_resumen_reposicion_rpc.sql` | `private.destinatarios_resumen_reposicion`, `private.productos_nuevos_en_alerta`, `public.organizaciones_con_resumen_pendiente`, `public.generar_resumen_reposicion`, `public.cerrar_resumen_reposicion` (solo `service_role`) |
| `20261213100000_stock_cargas_iniciales.sql` | `dominio.cargas_iniciales_stock` (una fila por producto que ya tuvo carga inicial) + disparador de inmutabilidad |
| `20261213100100_stock_carga_inicial_rpc.sql` | Motivo de sistema «Carga inicial de stock»; `private.validar_filas_carga_stock`; `public.validar_carga_stock` y `public.aplicar_carga_inicial_stock` |
| `20261213100200_faltantes_avisos.sql` | `dominio.faltantes_avisos` (cola de avisos), `private.faltante_abierta`, `public.faltantes_avisos_pendientes`, `public.tomar_aviso_faltante`, `public.cerrar_aviso_faltante` (solo `service_role`) |
| `20261213100300_faltantes_listado.sql` | Vista `public.faltantes_listado` (`security_invoker`) |
| `20261213100400_avisar_faltantes.sql` | `public.avisar_faltantes(p_lineas uuid[])` |
| `20261213100500_productos_mas_vendidos.sql` | `public.productos_mas_vendidos(...)` (sin tablas nuevas) |

Cada archivo trae su reversión en el encabezado. Nada se destruye en el mismo PR que lo crea. El DER del grafo
afectado está en [Datos y DER](datos.md#stock-carga-inicial-exportacion-y-avisos-msf-368).

Los números de versión son **nuevos y mayores** a propósito: con los que nombra `tasks.md` (`2026120612…`,
`2026120613…`) la migración quedaba por debajo de la cola ya aplicada en dokploy y no se aplicaba nunca (guard
`scripts/verificar-migraciones.mjs`: «versión REUSADA»).

## Modelo de datos

Todo lo nuevo es negocio de Stock → esquema **`dominio`** (Principio VII), salvo la vista de lectura, que es
contrato de pantalla en `public` (como `stock_estados`). Ninguna tabla nueva admite escritura directa de
`authenticated`.

| Tabla | Estado | Cambio |
|---|---|---|
| `dominio.cargas_iniciales_stock` | **nueva** | Una fila por producto que ya tuvo su carga inicial: `organizacion_id`, `producto_id`, `deposito_id`, `movimiento_id`, `cantidad`, `clave_idempotencia`, `actor_id`, `actor_nombre`, `creado_en`. `unique (organizacion_id, producto_id)`: es lo que impide una segunda carga inicial, incluso simultánea. |
| `dominio.stock_avisos_reposicion` | **nueva** | Un resumen por organización: `generado_en`, `estado` (`pendiente`/`enviado`/`fallido`/`sin_destinatario`), `intentos`, `ultimo_error` (≤ 500), `enviado_en`, `productos jsonb` (foto de los incluidos), `sin_stock`, `stock_bajo`, `updated_at` (reserva de 2 minutos). |
| `dominio.stock_alertas_avisadas` | **nueva** | Marca por producto del estado con el que ya se avisó (`stock_bajo`/`sin_stock`), `avisado_en`. PK `(organizacion_id, producto_id)`. |
| `dominio.faltantes_avisos` | **nueva** | Un aviso por línea faltante: `linea_id` (PK), `organizacion_id`, `empresa_id`, `cliente_id`, `estado` (`pendiente`/`enviado`/`agotado`), `intentos`, `ultimo_error` (≤ 500), `enviado_en`, `created_at`, `updated_at`. FK compuestas a `dominio.empresas` y `public.clientes`: el aviso no puede apuntar a otra organización. |
| `public.faltantes_listado` (vista) | **nueva** | Lectura de los faltantes abiertos, `security_invoker`. |
| `dominio.existencias`, `dominio.movimientos_stock`, `dominio.productos`, `dominio.depositos`, `dominio.comprobantes_venta`, `dominio.comprobantes_venta_lineas`, `dominio.reservas_stock`, `dominio.empresas`, `public.clientes`, `public.organizaciones` | existentes | Se leen (o, en el caso de existencias/movimientos, los escribe `registrar_movimiento_stock` desde la RPC de carga). Sin cambios de esquema. |
| `dominio.motivos_movimiento` | existente | Se leen y se **siembra** el motivo de sistema «Carga inicial de stock» (`aplica_a = {ajuste}`) para las organizaciones existentes y para las nuevas (`private.sembrar_motivos_movimiento`). Sin cambios de esquema. |

### RLS

- Las cuatro tablas nuevas tienen RLS por `organizacion_id` con `private.nivel_seccion('stock') in ('lectura','edicion')`
  para `select`. **Sin** `insert`/`update`/`delete` directos; `anon` sin privilegios (`revoke all … from public, anon,
  authenticated` + `grant select … to authenticated`).
- `dominio.cargas_iniciales_stock` es **de solo agregado**: el disparador `cargas_iniciales_stock_inmutable`
  (`private.rechazar_cambio_carga_inicial_stock`) rechaza `update`/`delete` con `42501`; solo deja pasar la cascada
  de la organización.
- `dominio.faltantes_avisos` filtra por **tienda**: `private.nivel_ventas_en_empresa(empresa_id) in ('lectura','edicion')`.
- `public.faltantes_listado` es `security_invoker`: rige la RLS de las tablas de base, y ya filtra por
  `private.nivel_ventas_en_empresa(c.empresa_id)`.

## RPC

### Carga inicial (F-STK-07)

| RPC | Hace | Seguridad |
|---|---|---|
| `public.validar_carga_stock(p_deposito uuid, p_filas jsonb)` | Vista previa: no escribe. Devuelve `fila, sku, producto, stock_actual, en_planilla, quedara, diferencia, estado, mensaje` por fila | `security definer`, `search_path = ''`, `stable`; exige `edicion` en Stock (`42501` «Tu rol no puede cargar stock por planilla»); depósito activo de la organización o `22023` |
| `public.aplicar_carga_inicial_stock(p_deposito uuid, p_filas jsonb, p_clave uuid default gen_random_uuid())` | Aplica **solo las filas válidas**: un movimiento `ajuste` por diferencia vía `registrar_movimiento_stock` (motivo de sistema «Carga inicial de stock», nota = `motivo` de la planilla) y una fila en `cargas_iniciales_stock`. Todo en una transacción: un fallo inesperado revierte todo | *security definer*; `revoke … from public, anon`, `grant execute … to authenticated` |

- **Reglas por fila** (`private.validar_filas_carga_stock`): «SKU vacío», «SKU repetido en la planilla», «SKU no
  existe», «Cantidad inválida», «Motivo demasiado largo (máximo 500)», «Ya tuvo carga inicial», «Por debajo de lo
  reservado». «Sin cambios» (cantidad igual a la actual) no es error, no genera movimiento y **no consume** la
  carga inicial.
- **Idempotencia y concurrencia:** la organización se serializa con `pg_advisory_xact_lock`; un reintento con la
  **misma `p_clave`** devuelve lo que esa clave ya aplicó (sin mover stock otra vez); `unique (organizacion_id,
  producto_id)` hace que de dos cargas simultáneas **una gane** y la otra reciba «Ya tuvo carga inicial».
- **El servidor revalida** al aplicar: las filas que dejaron de ser válidas se omiten y se informan.
- Devuelve `jsonb`: `aplicadas`, `omitidas`, `repetido` y `detalle` (por fila: `fila`, `sku`, `estado`, `mensaje`).
- Registra la actividad `stock.carga_inicial` (depósito, ajustes y filas omitidas).

### Faltantes (F-STK-17)

| RPC / vista | Hace | Seguridad |
|---|---|---|
| `public.faltantes_listado` (vista) | Una fila por línea «A pedido» de **factura confirmada** con **reserva activa** (`referencia = 'comprobante:' \|\| c.id \|\| ':linea:' \|\| l.orden`). Trae tienda, cliente, producto, SKU, pedido, comprobante, `desde`, estado de stock y si ya se avisó | `security_invoker`; `anon` sin acceso; `grant select … to authenticated` |
| `public.avisar_faltantes(p_lineas uuid[])` | Encola el aviso: omite y cuenta **ya avisados**, **sin stock disponible hoy**, **cliente sin correo** y **sin `ventas` en edición**; registra una fila por línea en `faltantes_avisos` y deja **un correo por cliente**. Devuelve `encolados`, `lineas_avisadas`, `omitidos_ya_avisados`, `omitidos_sin_stock`, `omitidos_sin_correo`, `omitidos_sin_permiso` | *security definer*; `revoke … from public, anon`, `grant execute … to authenticated`; exige `stock` en `lectura`/`edicion` y `ventas` en **edición** en la tienda de cada línea; 1–200 líneas por llamada (`22023`) |
| `public.faltantes_avisos_pendientes(p_tope, p_limite)` | Clientes con avisos pendientes (o a reintentar) | Solo `service_role` |
| `public.tomar_aviso_faltante(p_cliente uuid, p_tope integer default 5)` | Toma los avisos de un cliente y los reserva 2 minutos; si el tope está cumplido y la reserva venció, el aviso queda `agotado` | Solo `service_role` |
| `public.cerrar_aviso_faltante(p_cliente uuid, p_enviado boolean, p_error text default null, p_tope integer default 5)` | Cierra como `enviado` o deja `pendiente`/`agotado` con el error saneado | Solo `service_role` |

- La línea **sale sola** de la lista cuando su reserva se descuenta o se libera: no hay cierre manual.
- `private.faltante_abierta(p_linea_id)` aplica el mismo criterio que la vista, sin el filtro por persona: la usan
  las RPC de la cola. Si el faltante se cerró antes de salir el correo, la línea **vuelve a «Sin avisar»** y no se
  manda ningún correo.
- El error que se guarda se **sanea**: se borran las direcciones de correo (el SMTP puede devolverlas) y se acota a
  300 caracteres.
- `20261213100200` da `execute` a `authenticated` sobre `private.nivel_ventas_en_empresa(uuid)` (la usan la
  política y la vista).

### Resumen de reposición (F-STK-09)

| RPC / función | Hace | Seguridad |
|---|---|---|
| `private.productos_nuevos_en_alerta(p_organizacion uuid)` | Productos hoy en `stock_bajo`/`sin_stock` **sin marca**, o avisados como `stock_bajo` que hoy están `sin_stock`. Orden: «Sin stock» primero y luego por nombre | *security definer*; `revoke … from public, anon, authenticated` |
| `private.destinatarios_resumen_reposicion(p_organizacion uuid)` | Correos de los **miembros activos con `edicion` en Stock** | *security definer*; sin ejecución para `authenticated` |
| `public.organizaciones_con_resumen_pendiente()` | Organizaciones a procesar: con productos nuevos en alerta, con un resumen `pendiente` cuya reserva venció, o con **marcas huérfanas** (producto ya avisado que no está en alerta: si no se limpiaran, al volver a caer no se reavisaría) | Solo `service_role` |
| `public.generar_resumen_reposicion(p_organizacion uuid, p_tope integer default 5)` | Arma y **reserva** el resumen (2 minutos) y devuelve `resumen_id, sin_stock, stock_bajo, productos, destinatarios`. Con `destinatarios` vacío el resumen queda `sin_destinatario` y **no marca productos** | Solo `service_role` |
| `public.cerrar_resumen_reposicion(p_resumen uuid, p_enviado boolean, p_error text default null)` | Marca el resumen y, **solo si se entregó**, marca los productos como avisados | Solo `service_role` |

### Más vendidos (F-STK-18)

```ts
public.productos_mas_vendidos(
  p_desde date,
  p_hasta date,
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 25
) returns table (
  posicion bigint, producto_id uuid, nombre text, sku text,
  unidades bigint, total_filas bigint
)
```

- *security definer* con `search_path = ''`; la organización sale de `private.organizacion_id()` (la sesión), nunca
  de un argumento. `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
- Exige la sección **`stock` en `lectura`/`edicion`**: sin permiso, `42501` («Sin permiso para ver los productos más
  vendidos.»). El rango máximo es de 5 años (`22023`).
- Suma las **unidades** (`cantidad`) de las líneas de comprobantes que **cuentan como facturados**, con un único
  predicado: `private.comprobante_cuenta_como_facturado` (hoy: factura que no está en borrador ni anulada). Las
  líneas «A pedido» **sí suman**; presupuestos, borradores y anuladas **no**.
- El **orden** lo calcula la base (unidades desc, luego nombre, luego id como último desempate); la **posición es
  global** y `total_filas` es el total del ranking, no el de la página. El tope es de 200 filas por página.
- Solo cuentan las **tiendas con `ventas` visible** (`private.nivel_ventas_en_empresa`); `p_empresa_id` acota a una
  tienda y una tienda ajena devuelve **cero filas**, no un error. Un comprobante **sin tienda** no suma.
- Usa los índices `comprobantes_venta_fecha_idx (organizacion_id, fecha)` y
  `comprobantes_venta_empresa_fecha_idx (organizacion_id, empresa_id, fecha desc)`.

## Edge Functions

| Función | Qué hace | Quién la llama |
|---|---|---|
| `supabase/functions/enviar-resumen-reposicion` | Por cada organización: genera el resumen, arma el correo (**asunto** con los totales; por producto nombre, SKU, stock, disponible, mínimo y estado; tope de **50 productos**; enlace `<PANEL_URL>/stock`), lo envía y lo cierra | El flow `avisos-reposicion-stock` (diario) con `{"barrer": true}` |
| `supabase/functions/enviar-aviso-faltante` | Toma los avisos **por cliente** y manda **un correo por cliente** con el detalle de todos sus productos que volvieron a tener stock; cierra los avisos | El flow `avisos-faltantes` (cada minuto) con `{"barrer": true}` |

- Las dos exigen el secreto compartido en la cabecera **`x-aviso-token`**, comparado en **tiempo constante**
  (`timingSafeEqual`); sin él responden `503`. El destinatario **nunca** viene del pedido (lo resuelve la base), así
  que la función no es un relay abierto.
- La **clave de servicio** vive solo en la función: en el navegador nunca.
- Garantía **al menos una vez**: si el correo salió pero la base no pudo cerrar el resumen o el aviso, el próximo
  barrido lo vuelve a enviar (se prefiere un duplicado a perder el aviso).
- El error que se registra va **saneado** (sin correos, IP ni host) y genérico; el detalle SMTP queda en los
  registros de la función.
- `enviar-resumen-reposicion` responde `502` si hay fallas, para que Kestra marque el flow.

## Kestra y variables

| Flow | Cron | Qué hace |
|---|---|---|
| `infra/kestra/flows/avisos-reposicion-stock.yml` | `0 9 * * *` (diario; la hora es la del servidor de Kestra) | POST a `enviar-resumen-reposicion` |
| `infra/kestra/flows/avisos-faltantes.yml` | `* * * * *` (cada minuto) | POST a `enviar-aviso-faltante` |

| Dónde | Variable | Para qué |
|---|---|---|
| `supabase/functions/.env.example` | `AVISOS_REPOSICION_TOKEN` | Secreto compartido con el flow |
| `supabase/functions/.env.example` | `AVISOS_FALTANTES_TOKEN` | Ídem para los avisos de faltantes |
| `infra/kestra/.env.example` | `AVISOS_REPOSICION_URL`, `AVISOS_REPOSICION_APIKEY` | URL de la función y clave pública (anon) para cruzar el gateway |
| `infra/kestra/.env.example` | `SECRET_AVISOS_REPOSICION_TOKEN`, `SECRET_AVISOS_FALTANTES_TOKEN` | El mismo token **en base64** (Kestra decodifica los `SECRET_*`) |

El repo **prohíbe disparar HTTP desde SQL** (`docs/adoptar-ciclo-ejecuciones.md` §3.1): la base solo calcula y
registra, y el flow es el «disparo». Los valores reales viven solo en los secretos de la función y en
`infra/kestra/.env`, nunca en Git.

## Interfaz (`apps/web`)

- **Rutas y pestañas.** `/stock/excel`, `/stock/faltantes` y `/stock/mas-vendidos` en `apps/web/src/App.tsx`, con
  carga diferida, `RequiereOrganizacionActiva` y `RequiereAccesoSeccion seccion="stock"`. La tira
  `apps/web/src/pages/stock/PestanasStock.tsx` suma **«Faltantes»**, **«Actualizar por Excel»** (solo con `edicion`)
  y **«Más vendidos»** (con `lectura` o `edicion`). No hay recurso Refine propio: se llega desde la pestaña.
- **Carga inicial.** `apps/web/src/pages/stock/excel.tsx` + `apps/web/src/lib/cargaStock.ts`: la planilla se lee en
  el navegador (import diferido de la librería de Excel), `MAXIMO_FILAS_CARGA = 2000` y
  `MAXIMO_BYTES_PLANILLA = 5 MB`; la plantilla (`stock.xlsx`, columnas `sku`, `cantidad`, `motivo`) se genera en el
  navegador. La validación real es la del servidor.
- **Exportación.** `apps/web/src/lib/exportarCsv.ts` (formato), `apps/web/src/hooks/useExportarCsv.ts` (lotes) y
  `apps/web/src/components/stock/ExportarCsvBoton.tsx` (botón). Las pantallas declaran sus columnas en **un solo
  arreglo** que usan la tabla y el CSV (`columnasStock` en `list.tsx`, `COLUMNAS` en `movimientos.tsx`), así que no
  se desfasan.
- **Faltantes.** `apps/web/src/pages/stock/faltantes.tsx` + `apps/web/src/lib/faltantes.ts`: tabla con casilla por
  fila y «seleccionar todo» en el encabezado de la columna de casillas (como en el prototipo), filtro `FiltroEmpresa`
  y pie «N seleccionados de M faltantes».
- **Más vendidos.** `apps/web/src/pages/stock/mas-vendidos.tsx` + `apps/web/src/lib/masVendidos.ts` +
  `apps/web/src/hooks/useMasVendidos.ts`: paginación de a 25 y período con `apps/web/src/lib/periodosRanking.ts`
  (mismo rango máximo de 5 años y misma zona `America/Argentina/Buenos_Aires` que el ranking de clientes).

### Formato del CSV (F-STK-08)

- **UTF-8 con BOM**, separador **`;`**, fin de línea **CRLF** y comillas dobles escapadas duplicándolas: abre
  bien en Excel con configuración regional en castellano.
- Los textos que empiezan con `=`, `+`, `-`, `@`, tab o retorno se neutralizan con `neutralizarFormula`
  (apóstrofo inicial), la misma función de las otras exportaciones.
- Nombre `stock-actual-AAAA-MM-DD.csv` / `movimientos-stock-AAAA-MM-DD.csv`, con la fecha de hoy en la zona de la
  organización.
- Se pide **por lotes**: 200 filas en Stock actual y 100 en Movimientos (tope de `listar_movimientos_stock`). Tope
  global de **100.000 filas**: si hay más, se exportan las primeras y se avisa que se afinen los filtros.
- La corrida usa **el contexto congelado** del momento del clic (empresa, depósito y filtros); las cifras por
  depósito se arman de cero en cada corrida.
- Los lotes se piden por desplazamiento (offset), que no es atómico: si entran movimientos mientras corre, el CSV
  puede repetir o saltear una fila. Aceptado para este alcance.
- Sin filas: se descarga el CSV con solo encabezados y se avisa «No hay filas para exportar». Si algo falla, **no
  se descarga nada** y aparece un aviso con «Reintentar».

### Empresa activa (Principio VIII)

- **No aplica** en la carga inicial ni en la exportación: el stock es único y compartido.
- **Sí aplica** en Faltantes y Más vendidos: al cambiar la empresa se invalidan las consultas, la paginación vuelve
  a la página 1, la **selección se descarta**, el diálogo «Avisar a los clientes» abierto **se cierra con aviso**
  («Cambiaste de empresa: se cerró el aviso a los clientes») y una respuesta tardía de la empresa anterior no pisa la
  nueva. Nunca se muestran filas ni totales de la empresa anterior.

## Pruebas

- pgTAP (`pnpm test:db`): `supabase/tests/database/stock_carga_inicial.test.sql`,
  `stock_resumen_reposicion.test.sql`, `faltantes_listado.test.sql`, `faltantes_avisos.test.sql` y
  `productos_mas_vendidos.test.sql`; más `stock_carga_exportacion_avisos_cierre.test.sql` (cierre de seguridad y
  esquemas de la épica).
- Vitest: `apps/web/src/lib/cargaStock.test.ts`, `exportarCsv.test.ts`, `faltantes.test.ts`, `masVendidos.test.ts`;
  `apps/web/src/pages/stock/excel.test.tsx`, `faltantes.test.tsx`, `faltantes.empresa.test.tsx`,
  `mas-vendidos.test.tsx`, `list.test.tsx`, `movimientos.test.tsx`; `apps/web/src/hooks/useMasVendidos.test.tsx`.
- Handlers: `node --test supabase/functions/enviar-resumen-reposicion/handler.test.ts` y
  `node --test supabase/functions/enviar-aviso-faltante/handler.test.ts`.
- Flows: `pnpm test:kestra:avisos-reposicion`, `pnpm test:kestra:avisos-faltantes` y `pnpm infra:config`.

## Contratos que cambian (alto riesgo)

1. `private.sembrar_motivos_movimiento` suma el motivo «Carga inicial de stock» a los siete motivos vigentes: el
   conjunto de motivos por organización pasa de 7 a 8 (reversible con el comando del encabezado de la migración).
2. `dominio.motivos_movimiento` recibe una fila nueva por organización: las pantallas de Motivos y de Listas
   configurables muestran un motivo más.
3. `private.nivel_ventas_en_empresa(uuid)` pasa a tener `execute` para `authenticated` (la usan la política de
   `faltantes_avisos` y la vista `faltantes_listado`).
4. No hay cambios en `registrar_movimiento_stock`, `listar_movimientos_stock` ni `stock_estados`: la exportación y
   las pantallas nuevas **leen las mismas fuentes y la misma RLS** que las existentes.

## Reversión

En orden, en migraciones posteriores y exportando antes los datos (el libro de movimientos es de solo agregado):

1. `20261213100500`: `drop function public.productos_mas_vendidos(date, date, uuid, integer, integer)`.
2. `20261213100400`: `drop function public.avisar_faltantes(uuid[])`.
3. `20261213100300`: `drop view public.faltantes_listado`.
4. `20261213100200`: `drop function public.faltantes_avisos_pendientes(integer, integer)`,
   `public.tomar_aviso_faltante(uuid, integer)`, `public.cerrar_aviso_faltante(uuid, boolean, text, integer)` y
   `private.faltante_abierta(uuid)`; `drop table dominio.faltantes_avisos`; `revoke execute on function
   private.nivel_ventas_en_empresa(uuid) from authenticated`.
5. `20261213100100`: `drop function public.validar_carga_stock(uuid, jsonb)` y
   `public.aplicar_carga_inicial_stock(uuid, jsonb, uuid)`; restaurar `private.sembrar_motivos_movimiento` de
   `20261202130000` y desactivar el motivo «Carga inicial de stock» desde Motivos (el libro es de solo agregado:
   con ajustes ya registrados no se borra).
6. `20261213100000`: `drop table dominio.cargas_iniciales_stock` y `drop function
   private.rechazar_cambio_carga_inicial_stock()`.
7. `20261212140100`: `drop function public.generar_resumen_reposicion(uuid, integer)`,
   `public.cerrar_resumen_reposicion(uuid, boolean, text)` y `public.organizaciones_con_resumen_pendiente()`, más
   las funciones `private` de apoyo.
8. `20261212140000`: `drop table dominio.stock_alertas_avisadas` y `drop table dominio.stock_avisos_reposicion`.

Además: desactivar en Kestra los flows `avisos-reposicion-stock` y `avisos-faltantes`, retirar las funciones
`enviar-resumen-reposicion` y `enviar-aviso-faltante`, y quitar las pestañas y rutas `/stock/excel`,
`/stock/faltantes` y `/stock/mas-vendidos`. Los **correos ya enviados no se pueden retirar**, y los ajustes ya
aplicados se corrigen con un movimiento contrario, no se borran.
