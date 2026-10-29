---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
  - workers/historial-importador
  - infra/kestra
---

# Ventas · historial de consulta (técnico, MSF-275)

Implementación de la épica **MSF-275** (spec `ventas-historial-de-consulta`): importación del historial del
panel actual (**F-VTA-37**, MSF-293), consulta de ventas y cobros históricos (**F-VTA-38**, MSF-309) y consulta
de cotizaciones históricas del dólar (**F-VTA-39**, MSF-322). La vista de producto está en
[Ventas · historial de consulta](../producto/ventas-historial-consulta.md).

!!! note "Estado"
    Implementado en la rama `epic/MSF-275-ventas-y-despacho-ventas-historial-de-consulta`, **pendiente de merge
    a `main`**. Los archivos citados en esta página están en esa rama: hasta el merge, `main` no tiene ni las
    migraciones `historial_*` ni las pantallas `/historial`.

## Pantalla y rutas

- **Consulta**: `/historial` (menú **Ventas › Historial**, etiqueta `Historial`, sección `ventas`; registro en
  `apps/web/src/App.tsx` → `resources` y `Routes`). La ruta exige organización activa y nivel `lectura` o
  `edicion` en la sección `ventas` (`RequiereAccesoSeccion`): sin ese nivel muestra «Acceso restringido» y la
  entrada de menú no aparece.
- **Importación**: `/historial/importar`. **No tiene entrada de menú** (excepción al Principio VI, aceptada por
  ser una pantalla transitoria de migración): se llega desde el botón **Ver ejecuciones** de la pantalla de
  ejecuciones. La pantalla además exige `private.puede_escribir()`: sin ese permiso muestra «Solo un
  administrador con una organización activa puede importar el historial».
- Archivos: `apps/web/src/pages/historial/list.tsx` (pestañas Ventas/Cobros y estructura),
  `apps/web/src/pages/historial/CotizacionesTab.tsx` (pestaña de cotizaciones),
  `apps/web/src/pages/historial/importar.tsx` (importación),
  `apps/web/src/hooks/useHistorialVentasCobros.ts`, `apps/web/src/hooks/useHistorialCotizaciones.ts`,
  `apps/web/src/lib/historial.ts` (subida, validación y traducción de errores) y
  `apps/web/src/lib/formatoHistorial.ts` (fechas e importes).

### Qué muestra cada pestaña

- **Ventas** (`list.tsx`): Comprobante (número original + etiqueta «Histórico»), Tienda, Fecha, Cliente,
  Operador, Estado final y Total.
- **Cobros** (`list.tsx`): Fecha, Comprobante (número original + «Histórico»), Tienda, Cliente, Cuenta de cobro,
  Aprobado por e Importe.
- **Cotizaciones del dólar** (`CotizacionesTab.tsx`): Fecha, Dólar comprador, Dólar vendedor y Cargó. **Global de
  la organización**: sin `empresa_id`, sin filtro de tienda y sin depender de la empresa activa.

Encabezado: «Historial», etiqueta «Solo lectura», subtítulo «Consulta de lo registrado antes de la plataforma.
No se puede editar ni borrar.» y un aviso informativo con el texto del prototipo. Indicadores: «Desde: …» y
«Hasta: …» (rango del filtro actual, devuelto por la RPC), «N registros mostrados» y «Página N · X–Y de Z».
Estados: carga, error con «Reintentar», «Sin resultados» y el vacío «Todavía no hay historial importado.».
Importes alineados a la derecha; en pantalla angosta las tablas pasan a tarjetas (`ContenidoAdaptable`).

**Sin acciones de edición, anulación ni borrado.** El botón **Exportar** del prototipo (`Historial.dc.html`) quedó
**fuera de alcance** (la épica pide buscar y ver en solo lectura).

### Empresa activa (Principio VIII)

El filtro **Tienda** parte de la empresa activa de la barra superior (`useFiltroPorEmpresaActiva`, F-ROL-06) y los
chips lo sobreescriben hasta que la activa cambie. Al cambiar de empresa o de organización, `list.tsx` remonta el
panel (`key` con organización + empresa + pestaña): página 1, búsqueda limpia y recarga completa, sin filas de la
empresa anterior. La pestaña de cotizaciones **no** depende de la empresa activa: se remonta solo al cambiar de
organización. Test: `apps/web/src/pages/historial/list.test.tsx` («sigue a la empresa activa…»).

## Modelo de datos

Las tres tablas van en el esquema **`dominio`** (Principio VII): es dato de negocio archivado, no plataforma. La
única FK real es `organizacion_id → public.organizaciones`; la relación con `dominio.empresas` es **lógica**
(`empresa_id` sin FK) para que una empresa viva no pueda arrastrar ni bloquear el archivo histórico.

Migraciones (todas aditivas, con la reversión en el encabezado):

| Archivo | Qué trae |
|---|---|
| `supabase/migrations/20261021162800_historial_tablas.sql` | Las tres tablas `dominio.historial_*`, sus índices y la RLS. |
| `supabase/migrations/20261021162900_historial_bucket.sql` | Bucket privado `historial-importaciones` y sus policies. |
| `supabase/migrations/20261021163000_historial_solicitar_importacion.sql` | `private.capacidad_importacion_historial` y `public.solicitar_importacion_historial`. |
| `supabase/migrations/20261021163100_historial_ultimo_numero.sql` | `public.historial_ultimo_numero`. |
| `supabase/migrations/20261021163200_historial_funciones_worker.sql` | `private.autorizar_worker_importacion`, `private.datos_importacion_historial`, `private.empresas_importacion_historial` y `private.importar_historial_lote`. |
| `supabase/migrations/20261021163300_historial_reclamo_despachos.sql` | `private.reclamar_despachos_capacidad` (reclamo de la outbox acotado por capacidad). |
| `supabase/migrations/20261021164200_historial_listar_ventas_cobros.sql` | `public.listar_historial_ventas` y `public.listar_historial_cobros`. |
| `supabase/migrations/20261022110201_historial_listar_cotizaciones.sql` | `public.listar_historial_cotizaciones`. |

> Las versiones `20261021162900`–`20261021163300` renombraron lo que la spec llamaba `20261021163400`–`20261021163800`
> (nota de merge en `tasks.md`): sin cambios de contenido ni de orden relativo.

| Tabla | Estado | Cambio |
|---|---|---|
| `dominio.historial_comprobantes` | nueva | Ventas archivadas: empresa, tipo, número original, fecha, cliente (nombre y número), operador, estado final y total. |
| `dominio.historial_cobros` | nueva | Cobros archivados: empresa, fecha, comprobante, cliente, cuenta de cobro, aprobado por e importe. |
| `dominio.historial_cotizaciones_dolar` | nueva | Cotizaciones archivadas, globales de la organización (sin `empresa_id`). |
| `public.organizaciones` | existente | FK `organizacion_id` (`on delete cascade`); sin cambios de esquema. |
| `dominio.empresas` | existente | Relación **lógica** por `empresa_id`, sin FK: el archivo no depende de la vida de la empresa. |

Claves naturales (idempotencia al reimportar, `on conflict do nothing`):

- `historial_comprobantes`: `unique (organizacion_id, empresa_id, tipo, numero)`.
- `historial_cobros`: `unique (organizacion_id, empresa_id, comprobante_numero, fecha, importe)` — un comprobante
  puede tener más de un cobro, por eso la clave se completa con fecha e importe.
- `historial_cotizaciones_dolar`: `unique (organizacion_id, fecha)`.

Índices de búsqueda: `(organizacion_id, empresa_id, fecha desc, id)` y
`(organizacion_id, empresa_id, numero)` en comprobantes; `(organizacion_id, empresa_id, fecha desc, id)` y
`(organizacion_id, empresa_id, comprobante_numero)` en cobros.

El modelo completo y el DER están en [Datos y DER](datos.md#historial-de-ventas-importado-msf-275).

## RLS, permisos y bucket

- **RLS** en las tres tablas: `select` para `authenticated` con
  `organizacion_id = (select private.organizacion_id())`, `empresa_id in (select private.empresas_accesibles())`
  (en comprobantes y cobros) y `(select private.nivel_seccion('ventas')) in ('lectura','edicion')`. Las
  cotizaciones son globales: solo organización + sección.
- **Sin políticas ni grants de escritura** para `authenticated`: `revoke all … from public, anon, authenticated`
  y `grant select … to authenticated`. La **única** vía de escritura es
  `private.importar_historial_lote`, ejecutada por el worker con su rol de servicio.
- `anon` no tiene ningún privilegio.
- **Sin FKs ni disparadores hacia tablas vivas** (comprobantes, cobros, stock, saldos, cotización vigente): el
  historial no puede alterarlos. Lo demuestra pgTAP (`historial_importacion.test.sql`).
- **Bucket** `historial-importaciones`: privado (`public = false`), `file_size_limit` 50 MB, MIME de CSV/Excel.
  Policies por prefijo `<organizacion_id>/`: `select`, `insert` y `delete` solo para quien tiene
  `private.puede_escribir()`; sin policy de `update` (el archivo de una ejecución creada no se reemplaza). El
  borrado se permite solo si **ninguna** ejecución referencia el archivo: la pantalla borra la planilla cuando la
  RPC rechazó la solicitud y la dejó huérfana; el original de una importación aceptada se conserva como
  original auditado.

## RPC

Todas en `public` o `private`, `security invoker` (las de lectura) o `security definer` justificadas (las del
worker), `search_path = ''`, con `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
La organización sale de la sesión (`private.organizacion_id()`), nunca de un parámetro.

| RPC | Qué hace |
|---|---|
| `public.solicitar_importacion_historial(p_tipo, p_archivo)` | Valida tipo, archivo y permiso; crea la ejecución `manual` con `iniciar_ejecucion_worker` y su orden de outbox. Devuelve el id de la ejecución. Rechaza una segunda importación del mismo tipo en curso (`YA_EN_CURSO`). |
| `public.historial_ultimo_numero(p_tipo, p_empresa_id)` | Mayor número histórico de comprobantes o cobros (opcionalmente de una empresa), para que la numeración nueva arranque en uno posterior. Rige la RLS de quien llama. |
| `public.listar_historial_ventas(p_busqueda, p_empresa_id, p_pagina, p_tamano, p_desde, p_hasta)` | Ventas históricas paginadas (tope 200). Búsqueda por cliente, número de cliente o número de comprobante, sin mayúsculas ni tildes y con el texto literal (`%` y `_` no son comodines). Orden estable: fecha desc, número desc, id. Devuelve `total_filas` y el rango `fecha_desde`/`fecha_hasta` del filtro actual. |
| `public.listar_historial_cobros(p_busqueda, p_empresa_id, p_pagina, p_tamano, p_desde, p_hasta)` | Ídem para cobros. |
| `public.listar_historial_cotizaciones(p_busqueda, p_pagina, p_tamano)` | Cotizaciones históricas paginadas (tope 200), globales de la organización, sin filtro de empresa. Búsqueda por fecha contra `DD/MM/YYYY` y `YYYY-MM-DD` (sirve una fecha completa o una parte, como `03/2020`). Orden: fecha desc, id. |
| `private.capacidad_importacion_historial(p_tipo)` | Devuelve la conexión `historial-ventas` de la organización y su capacidad por tipo (`importar-historial-<tipo>`, `tiempo_max_seg = 3600`), creada al primer uso. Exige `private.puede_escribir()`. |
| `private.autorizar_worker_importacion(p_ejecucion_id)` | Autoriza al worker sobre su ejecución en curso y devuelve (organización, tipo, archivo). Verifica que el archivo sea `<organizacion>/<nombre>.csv|xlsx` y exista en el bucket. |
| `private.datos_importacion_historial(p_ejecucion_id)` | Tipo y ruta del archivo de la ejecución. Solo `workers_orquestacion`. |
| `private.empresas_importacion_historial(p_ejecucion_id)` | Empresas de la organización, para validar el nombre de tienda de cada fila. |
| `private.importar_historial_lote(p_ejecucion_id, p_tipo, p_filas)` | Inserta un lote ya validado (máximo 5000 filas) con `on conflict do nothing` y devuelve `nuevas`/`existentes`. **Única** vía de escritura del historial. |
| `private.reclamar_despachos_capacidad(p_prefijo_clave, p_limite, p_duracion_reclamo_seg)` | Reclamo de la outbox filtrado por prefijo de capacidad (`importar-historial-`): el flow no roba órdenes de otros productos. Solo `kestra_orquestacion`. |

### Errores que traduce la pantalla

`apps/web/src/lib/historial.ts` mapea los códigos de la RPC a mensajes accionables; nunca muestra el error crudo del
worker.

| Código | Significado |
|---|---|
| `NO_AUTORIZADO` | El rol no puede importar en la organización. |
| `TIPO_INVALIDO` | El tipo no es `comprobantes`, `cobros` o `cotizaciones`. |
| `ARCHIVO_INVALIDO` | La planilla no está en el bucket de la organización o no es CSV/Excel. |
| `SIN_CONEXION_HISTORIAL` | La organización no tiene habilitada la importación del historial. |
| `YA_EN_CURSO` | Ya hay una importación de ese tipo en curso. |

El detalle completo de la importación queda en `/ejecuciones/<id>`.

## Worker y flow de Kestra

- **Worker** `workers/historial-importador` (contrato `workers/CONTRATO.md`): `src/index.ts` (entrypoint),
  `src/importar.ts` (orquestación), `src/lector.ts` (CSV/XLSX), `src/campos.ts` (mapeo por tipo),
  `src/validar.ts` (validación todo-o-nada), `src/infra.ts` (puertos: Supabase y Postgres). Entrada:
  `ORGANIZACION_ID`, `EJECUCION_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `PG*` del servidor. **Códigos
  de salida**: `0` éxito, `78` no reintentable (validación, ejecución cerrada, configuración), `1` falla técnica
  (la reintenta el flow).
- **Flow** `infra/kestra/flows/historial-importador.yml` (namespace `producto.ventas`): un `Schedule` cada dos
  minutos reclama la outbox con `private.reclamar_despachos_capacidad('importar-historial-', 5, 3600)`, resuelve
  el servidor de la organización con `private.datos_despacho_conexion` y lanza el worker por SSH con Docker
  (`--read-only`, `--cap-drop=ALL`, red de egress `worker-egress-historial-ventas`, CPU/memoria acotados). La orden
  se resuelve con `private.resolver_despacho_ejecucion` (`confirmar`, `liberar` o `agotar`). Un código `78` se
  agota en el primer intento: reintentar repetiría la validación sobre una planilla que no va a cambiar. Una
  falla técnica libera la orden y se reintenta hasta 3 reclamos.

### Flujo de una importación

1. La pantalla sube la planilla al bucket con la sesión del administrador, en la ruta
   `<organizacion_id>/<uuid>.<csv|xlsx>`.
2. `solicitar_importacion_historial` valida tipo, archivo y permiso, y crea en la misma transacción la ejecución
   `manual` y la orden de outbox.
3. El flow reclama solo las órdenes de capacidades `importar-historial-*`, resuelve el servidor de la organización
   y ejecuta el worker por SSH y Docker.
4. El worker descarga la planilla con la clave de servicio, valida **todas** las filas y, si hay un solo rechazo,
   **no inserta nada**. Si la planilla es válida, inserta por lotes de 1000 filas con `on conflict do nothing`.
5. Cierra la ejecución como `exitosa` (`IMPORTADAS:<n>`, detalle con `nuevas` y `existentes`) o `fallida`
   (detalle con el total de rechazos y hasta 100 rechazos con fila, columna y motivo). Los rechazos nunca
   incluyen el valor de la celda.
6. El flow confirma la orden; una falla no reintentable (código 78) la agota en el primer intento; una falla
   técnica la libera hasta 3 reclamos.

Reimportar la misma planilla es seguro: las claves naturales evitan duplicados y las filas existentes se cuentan
como `existentes`.

### Mapeo de columnas

Los encabezados se comparan sin mayúsculas, tildes, espacios ni signos (`numero de cliente`, `Número_de_Cliente`
y `NUMERODECLIENTE` son la misma columna); las columnas no reconocidas se ignoran. Las obligatorias se marcan con
`*`.

| Tipo | Columnas y alias aceptados |
|---|---|
| `comprobantes` | `Tienda`* (`empresa`, `sucursal`, `local`), `Tipo` (`tipo de comprobante`), `Comprobante`* (`numero`, `nro`, `numero de comprobante`), `Fecha`*, `Cliente`* (`nombre del cliente`, `razón social`), `Número de cliente` (`código de cliente`), `Operador` (`vendedor`, `usuario`), `Estado final` (`estado`), `Total`* (`importe total`) |
| `cobros` | `Tienda`*, `Fecha`*, `Comprobante`* (`número de comprobante`), `Cliente`*, `Número de cliente`, `Cuenta de cobro` (`cuenta`), `Aprobado por` (`aprobador`), `Importe`* (`monto`) |
| `cotizaciones` | `Fecha`*, `Dólar comprador`* (`comprador`, `compra`), `Dólar vendedor`* (`vendedor`, `venta`), `Cargó` (`cargado por`, `usuario`) |

Normalización:

- **Fecha**: `dd/mm/aaaa` (también con `-` o `.`), `aaaa-mm-dd` o la celda de fecha de Excel; se valida que exista
  en el calendario.
- **Importes**: coma o punto decimal; con ambos separadores manda el último. Con un solo punto, `1.234` es mil
  doscientos treinta y cuatro y `1.23` es uno con veintitrés. Se admiten `$`, `ARS` y `USD` como adorno. En
  cotizaciones el valor no puede ser negativo. Antes de escribir se rechazan valores que exceden la precisión de
  las columnas destino (`numeric(14,2)` o `numeric(14,4)`).
- **Tienda**: se compara con las empresas de la organización sin distinguir mayúsculas, tildes ni espacios; una
  tienda inexistente rechaza la fila (no se crean empresas).
- **Codificación y separador del CSV**: UTF-8 (con o sin BOM) o Windows-1252; separador `,`, `;`, tabulación o
  `|`.

### Puesta en marcha de una organización

La ejecución cuelga de una conexión de plataforma, porque el ciclo de workers necesita un servidor, una
credencial y una capacidad auditables. El importador no se conecta a ningún sistema externo real: la credencial
es ficticia y solo habilita la conexión.

1. Crear un servidor para la organización y su credencial SSH, como en cualquier worker del ciclo
   (`public.aprovisionar_servidor_organizacion`).
2. Crear la conexión del importador como administrador:

   ```sql
   select public.crear_conexion(
     '<organizacion_id>'::uuid,
     'historial-ventas',
     'credencial-ficticia-del-importador'
   );
   ```

   El catálogo `sistemas_externos` se entrega vacío: la entrada `historial-ventas` se carga sola al primer uso de
   la capacidad (`importar-historial-<tipo>`, que vence a la hora con `tiempo_max_seg = 3600`).
3. En el host de despacho, `worker.env` debe definir, además de `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` y
   `PGPASSWORD`: `SUPABASE_URL`; `SUPABASE_SERVICE_ROLE_KEY` (solo en el servidor, nunca en el navegador); y
   `WORKER_NETWORK=worker-egress-historial-ventas`. La red debe permitir la salida hacia Supabase. El flow
   rechaza cualquier otra red con «Red de egress no autorizada». `workers/egress-allowlists.json` no declara este
   worker: la red se crea a mano en el host (paso manual, igual que el resto de los workers hoy, cuyo `workers`
   está vacío).
4. Publicar la imagen del worker con el workflow de imágenes y fijar `HISTORIAL_IMPORTADOR_IMAGEN` (en local,
   `local/worker-historial-importador:latest`) en `infra/kestra/.env`.
5. Desplegar el flow `producto.ventas/historial-importador`. El `Schedule` reclama la outbox cada dos minutos; no
   hay webhook ni URL de despacho en la base.

## Revisión de seguridad del conjunto (cierre MSF-275)

Revisión manual de lo entregado en F-VTA-37/38/39, con las lentes `authz-security`, `crypto-secrets` y
`supply-chain-security`. **Sin hallazgos que bloqueen.**

- **Autorización (RLS/RPC)**: las tres tablas `dominio.historial_*` tienen RLS y solo `select` para
  `authenticated`; `anon` no tiene privilegios. Las RPC de lectura son `security invoker` con `search_path = ''`,
  `revoke … from public, anon` y grant explícito a `authenticated`: la organización sale de la sesión, nunca de un
  parámetro. Las funciones `security definer` (`private.*` del worker) se conceden solo a `workers_orquestacion` y
  `private.capacidad_importacion_historial` valida `puede_escribir()` antes de escribir.
- **Secretos y bucket**: `SUPABASE_SERVICE_ROLE_KEY` vive solo en el `worker.env` del servidor; el worker no la
  registra en logs y los rechazos no incluyen el valor de la celda. El bucket es privado, con políticas por prefijo
  de organización, solo `.csv`/`.xlsx`, tope de 50 MB y sin borrado del original de una ejecución creada.
- **Dependencias**: el worker usa `papaparse`, `read-excel-file` y `pg` con versiones exactas (`fflate` solo en
  pruebas). `pnpm audit --prod` informa 14 avisos, todos en `axios` y `follow-redirects` vía
  `apps/web › @nangohq/frontend` (spec de conexiones OAuth): ninguno alcanza al worker ni a este flujo.
  Corresponde a la spec de conexiones OAuth (seguimiento propio de esa spec); no se tocan dependencias ajenas a
  esta entrega.
- **Límite conocido**: la gestión de la conexión `historial-ventas` y del servidor es manual (ver «Puesta en
  marcha»); es un paso operativo, no una exposición.

## Límites conocidos

- **Búsqueda sin índice trigram**: `listar_historial_ventas` y `listar_historial_cobros` filtran con
  `translate(lower(...)) like '%x%'` y calculan el total con `count(*) over ()`; cada página recorre todo el
  filtro. Volumen esperado: miles a pocas decenas de miles de filas por organización. Si el historial supera
  ~100 000 filas, corresponde agregar un índice `gin (... gin_trgm_ops)` sobre la expresión normalizada en una
  migración aditiva; hoy no se justifica sin un caso medido. Sin lote importado grande no hay tiempos reales que
  medir: la medición con `explain analyze` queda como criterio de reapertura.
- **Cobros idénticos:** dos cobros con el mismo comprobante, fecha e importe comparten clave natural y el segundo
  se cuenta como `existente`; el origen no trae un identificador propio (decisión de la spec).
- **Reintento tras fallo de cierre:** si `cerrar` falla después de insertar, el reintento encuentra todo como
  «existente» y el cierre reporta `nuevas=0` aunque se hayan cargado filas; el conteo de un reintento puede
  subestimar las nuevas.
- **Planillas grandes:** el límite de subida es 50 MB, pero un `.xlsx` se expande en memoria y el contenedor tiene
  512 MB; una planilla enorme puede caer por memoria (137) y el flow la reintenta 3 veces sin éxito. Partir la
  planilla en varias. El worker corta en 200 000 filas por importación y la base acepta hasta 5000 filas por
  lote.
- **Tiendas homónimas:** si dos empresas de la organización comparten nombre, la base toma la más antigua
  (`order by e.created_at limit 1`) mientras el worker normaliza sin tildes ni signos; evitar nombres duplicados
  antes de importar.
- **`private.reclamar_despachos_capacidad`** resetea reclamos vencidos de todas las capacidades, no solo de
  `importar-historial-*` (mismo comportamiento que la función genérica de spec 019).
- **`visuallyHidden`:** `pages/historial/list.tsx` replica la constante local que ya usan Clientes, Proveedores y
  Ranking (no existe un helper compartido); el comentario `estilos-sueltos: ok` documenta la excepción a la regla
  de lint.

## Pruebas

- pgTAP: `supabase/tests/database/historial_importacion.test.sql` (tablas, RLS, RPC, bucket y funciones del
  worker), `supabase/tests/database/historial_listar_ventas_cobros.test.sql`,
  `supabase/tests/database/historial_listar_cotizaciones.test.sql` y
  `supabase/tests/database/historial_reclamo_despachos.test.sql` (el reclamo filtrado por capacidad no roba
  órdenes de otros flows y recupera reclamos vencidos).
- Vitest del panel: `apps/web/src/pages/historial/list.test.tsx`, `apps/web/src/pages/historial/importar.test.tsx`,
  `apps/web/src/pages/historial/CotizacionesTab.test.tsx`,
  `apps/web/src/hooks/useHistorialVentasCobros.test.tsx`, `apps/web/src/hooks/useHistorialCotizaciones.test.tsx` y
  `apps/web/src/lib/historial.test.ts`.
- Vitest del worker: `workers/historial-importador/test/` (`lector.test.ts`, `campos.test.ts`,
  `importar.test.ts`).
- `pnpm infra:config` valida el Compose de Kestra, no la sintaxis del flow.
- **No hay E2E de esta épica**: los rótulos `[MSF-275:T0xx]` previstos están en
  [Ventas · historial de consulta (producto)](../producto/ventas-historial-consulta.md#cómo-automatizarlo).

## Reversión

Las migraciones son **aditivas**. Para deshacer la funcionalidad, en una migración posterior y después de exportar
los datos:

```sql
revoke execute on function private.reclamar_despachos_capacidad(text, integer, integer)
  from kestra_orquestacion;
drop function private.reclamar_despachos_capacidad(text, integer, integer);
drop function public.solicitar_importacion_historial(text, text);
drop function private.capacidad_importacion_historial(text);
drop table dominio.historial_cotizaciones_dolar;
drop table dominio.historial_cobros;
drop table dominio.historial_comprobantes;
```

Después, vaciar y quitar el bucket `historial-importaciones` desde la API de Storage. Las RPC de lectura se
sueltan con `drop function public.listar_historial_ventas(text, uuid, integer, integer, date, date);`,
`drop function public.listar_historial_cobros(text, uuid, integer, integer, date, date);` y
`drop function public.listar_historial_cotizaciones(text, integer, integer);`. Nunca en el mismo PR que crea las
tablas.

## Notas operativas

- **Sin entrada de menú** para la pantalla de importación: es una herramienta puntual de migración y se llega
  desde el botón de Ejecuciones (excepción al Principio VI, aceptada para una pantalla transitoria).
- **El original de una importación aceptada se conserva** en el bucket (auditoría). Solo se borra la planilla que
  quedó huérfana porque la RPC rechazó la solicitud.
- **El detalle del cierre de la ejecución** es la fuente de la verdad del resultado: `nuevas`, `existentes`,
  `total_rechazos` y la lista de rechazos (hasta 100). La pantalla de importación muestra un resumen y el resto
  queda en `/ejecuciones/<id>`.

## Para seguir

- **[Ventas · historial de consulta (producto)](../producto/ventas-historial-consulta.md)** — qué resuelve, para
  quién y cómo se prueba a mano.
- **[Datos y DER](datos.md#historial-de-ventas-importado-msf-275)** — el modelo y el ERD.
- **[API y RPC](api.md#historial-de-ventas-msf-275)** — el contrato de las funciones.
- **[Flujos](flujos.md#importación-del-historial-msf-275)** — el flujo de datos y los estados de la ejecución.
- **[Dólar y recálculo](dolar-y-recalculo.md)** — la cotización **vigente** (no es el historial).
