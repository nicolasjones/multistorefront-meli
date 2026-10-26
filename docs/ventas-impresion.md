# Ventas: impresión de factura, remito y presupuesto (F-VTA-19 / MSF-230, F-VTA-21, F-VTA-20)

Desde el comprobante de una **factura confirmada** se imprime la factura interna
o el remito. El PDF A4 lo genera un worker, no el navegador. Spec:
`specs/20261024-100000-ventas-impresion/` (esta historia cubre FR-001…FR-016 de
F-VTA-19; la marca de impreso es F-VTA-21 y el presupuesto con correo, F-VTA-20).

## Alcance

- `dominio.comprobante_documentos` (esquema `dominio`: documento de venta del
  producto): pedido de un documento, con estado `pendiente` / `generado` /
  `fallido`, ruta del PDF, solicitante, fechas y error sanitizado.
- Bucket privado `comprobantes-documentos` (plataforma): los PDF van en
  `<organizacion>/<empresa>/<comprobante>/<documento>.pdf`.
- `dominio.empresas` gana `razon_social` y `cuit` (11 dígitos), que salen
  impresos; se cargan en la ficha de la empresa (pestaña General).
- Worker `workers/comprobantes-pdf` y flow
  `infra/kestra/flows/comprobantes-documentos.yml`.
- Pantalla: botón «Imprimir» (cabecera), tarjeta «Documentos» con «Imprimir
  remito» y el diálogo «Imprimir comprobante» en `ventas/comprobante`.

## RPC

Todas son `security definer`, `search_path = ''`, con `revoke … from public, anon`
y `grant execute … to authenticated`.

| RPC | Qué hace |
|---|---|
| `solicitar_documento_comprobante(p_comprobante_id, p_tipo_documento)` | `factura` o `remito` de una factura `confirmada`; exige `ventas` en `lectura` como mínimo en la empresa. Idempotente: devuelve el `generado` vigente (si el archivo sigue en Storage) o el `pendiente`; si no, crea el pedido, su orden de despacho y el evento `comprobante.documento_solicitado`. |
| `obtener_documento_comprobante(p_documento_id)` | Estado y ruta del pedido. Un `pendiente` que ya no puede completarse (orden agotada, ejecución cerrada o más de 10 minutos) pasa a `fallido`. |
| `listar_documentos_comprobante(p_comprobante_id)` | Pedidos del comprobante, del más reciente al más viejo (la usa F-VTA-21). |

Funciones del worker (en `private`, no ejecutables por `authenticated` ni
`anon`; solo el rol `worker_<org>`): `datos_documento_comprobante(documento)`
devuelve empresa, cliente, cabecera, líneas y totales y la **ruta exacta** donde
subir; `cerrar_documento_comprobante(documento, ruta, error)` cierra
`generado` o `fallido` (idempotente, valida la ruta y sanitiza el error).

## Permisos y seguridad

- La organización y el solicitante salen de la sesión, nunca del llamador.
- La lectura de la tabla y del bucket exige `ventas` en `lectura`/`edicion`,
  organización propia y empresa accesible (RLS). Sin políticas de escritura
  para `authenticated`; `anon` no tiene acceso.
- El navegador abre el PDF con una **URL firmada de 5 minutos**; nunca recibe la
  clave de servicio. El worker la usa solo en el servidor (`worker.env`).
- El error que se muestra es un motivo corto sanitizado; el detalle técnico no
  se guarda ni se muestra.

## Flujo de punta a punta

1. La RPC crea el pedido, una ejecución `manual` auditable (actor = quien pide)
   y su orden en la outbox, con la capacidad
   `generar-documento-venta-<tipo>-<documento>` (una por documento: imprimir
   lo hacen varias personas a la vez, a diferencia de la importación del
   historial).
2. El flow `comprobantes-documentos` corre **cada minuto**, reclama hasta 5
   órdenes con `private.reclamar_despachos_capacidad('generar-documento-venta-', 5, 600)`
   y lanza el worker por SSH en el servidor de la organización con
   `DOCUMENTO_ID` y `EJECUCION_ID` (sin secretos en la línea de comandos).
3. El worker comprueba que la ejecución siga en curso, lee los datos, arma el PDF
   A4, lo sube con `x-upsert` y cierra el pedido. Una falla técnica sale con
   código distinto de cero y el flow la reintenta (3 intentos de SSH y hasta 3
   reclamos). Una falla no reintentable sale con **78** y agota la orden:
   `EJECUCION_NO_EN_CURSO`, `CONFIGURACION_INVALIDA` o `GENERACION_FALLIDA`
   (el armado del PDF falló: el pedido queda `fallido`).
4. La pantalla consulta el avance cada 1,5 s hasta 90 s («Preparando
   documento…»); pasado el tope ofrece «Reintentar», que devuelve el mismo
   pedido pendiente. Al estar listo abre el PDF y confirma con «Enviado a
   imprimir». Si el navegador bloquea la ventana se ofrece «Abrir documento».

Nota operativa: cada pedido crea una fila en `public.capacidades_ejecucion` (una por documento) y
la tabla crece sin tope; no se limpia al cerrar el documento porque la ejecución auditada la
referencia. Queda como deuda de retención junto con la del ciclo de workers.

El reintento tras un corte no duplica nada: la subida pisa el mismo archivo y el
cierre ignora un pedido ya cerrado.

## Contenido de los documentos

Provisorio hasta confirmar el formato con el cliente; hay **una plantilla por
documento** (`workers/comprobantes-pdf/src/plantillas/factura.ts` y `remito.ts`)
sobre un motor común (`src/pdf.ts`). Ambos llevan la leyenda «Documento no válido
como factura». La factura muestra precios sin IVA, subtotal, IVA y total, forma
de pago y envío; el remito, producto, código, cantidad y depósito, **sin
importes**. Lo no cargado (razón social, CUIT, logo, correo…) se omite; el logo
sale de la identidad de la tienda si es PNG/JPEG de hasta 1 MB, y sin él el
documento se genera igual.

## Puesta en marcha de una organización

1. Crear el servidor de la organización y su credencial SSH, como en cualquier
   worker del ciclo (`public.aprovisionar_servidor_organizacion`).
2. Crear la conexión como administrador (sin ella la RPC responde que la
   impresión todavía no está habilitada):

   ```sql
   select public.crear_conexion(
     '<organizacion_id>'::uuid,
     'comprobantes-pdf',
     'credencial-ficticia-del-generador'
   );
   ```

3. En el host de despacho, `worker.env` define `PGHOST`, `PGPORT`, `PGDATABASE`,
   `PGUSER`, `PGPASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (solo en
   el servidor) y `WORKER_NETWORK=worker-egress-comprobantes-pdf`. La red debe
   permitir la salida hacia Supabase; el flow rechaza cualquier otra.
4. Publicar la imagen del worker con el workflow de imágenes y fijar
   `COMPROBANTES_PDF_IMAGEN` (en local, `local/worker-comprobantes-pdf:latest`)
   en `infra/kestra/.env`.
5. Desplegar el flow `producto.ventas/comprobantes-documentos`.
6. Cargar razón social y CUIT en la ficha de cada empresa.

## Marca de impreso y reimpresión

F-VTA-21 (MSF-256). Cada vez que alguien confirma «Imprimir» con el documento ya
generado, queda registrada la impresión y la tarjeta «Documentos» muestra la
última.

- **Tabla** `dominio.comprobante_impresiones` (esquema `dominio`: hecho de negocio
  del producto): comprobante, tipo de documento (`factura`, `remito`,
  `presupuesto`), documento generado, quién (`impreso_por`), cuándo
  (`impreso_en`) y `reimpresion`. RLS por organización y `ventas` en
  `lectura`/`edicion` **en la empresa del comprobante**. **Append-only**: sin
  escritura directa para `authenticated` ni `anon`, y un trigger rechaza
  `update` y `delete` incluso del dueño; la única baja es el borrado en cascada
  de la organización entera.
- **RPC** (`security definer`, `search_path = ''`, `revoke … from public, anon` +
  `grant execute … to authenticated`):

| RPC | Qué hace |
|---|---|
| `registrar_impresion(p_documento_id)` | Registra la impresión de un documento `generado`. Exige `ventas` en `lectura` como mínimo en la empresa del documento; rechaza (`22023`) uno `pendiente` o `fallido`. Es la **primera** impresión si no hay ninguna previa de ese tipo de documento de ese comprobante (aunque el PDF se haya regenerado) y emite `comprobante.impreso`; las siguientes emiten `comprobante.reimpreso`. Serializa por comprobante y tipo para que dos personas a la vez no sean ambas «la primera». |
| `ultimas_impresiones_comprobante(p_comprobante_id)` | La última impresión de cada tipo de documento del comprobante (una fila por tipo). Misma exigencia de permiso. |

- **Pantalla**: el diálogo «Imprimir comprobante» registra la impresión **después**
  de tener el PDF listo y la URL firmada, y **antes** de abrirlo. Si la generación
  falló o se cancela el diálogo, no se registra. Si el registro falla, no se abre
  el PDF: se avisa («…no pudimos registrar la impresión») y «Reintentar» pide el
  mismo documento (idempotente, FR-005) y vuelve a registrar. Límite conocido: si
  el servidor confirma el registro pero la respuesta se pierde, «Reintentar» lo
  registra de nuevo y cuenta una reimpresión de más (aceptado). Si el navegador
  bloquea el popup, la impresión ya quedó registrada y la tarjeta refresca la
  marca igual. La tarjeta muestra
  «Factura impresa · dd/mm hh:mm» (hora de Buenos Aires) y «Remito impreso · …»
  con la última impresión, y la casilla vacía si nunca se imprimió; «Presupuesto
  impreso · …» aparece en un presupuesto (F-VTA-20). Si no se pueden leer
  las marcas se avisa en la tarjeta en vez de mostrar casillas vacías. Al cambiar
  la empresa activa se vuelven a leer (Principio VIII).
- **Reimpresión**: sin límite ni permiso adicional; «Imprimir» sigue disponible
  y reutiliza el PDF vigente.
- **Migraciones**: `20261211130100_comprobante_impresiones.sql` y
  `20261211130200_registrar_impresion.sql` (versiones posteriores a las de
  F-VTA-19, que ya están en la base de la épica; la tasks.md las numera con un
  bloque anterior).
- **Reversión**: aditiva, migración posterior (exportar antes si se quiere
  conservar el historial): quitar `public.ultimas_impresiones_comprobante(uuid)`,
  `public.registrar_impresion(uuid)`, la tabla `dominio.comprobante_impresiones` y
  `private.impresiones_solo_agregar()`. La pantalla sigue imprimiendo, solo que
  sin registrar ni mostrar marcas.
- **Verificación**: `pnpm test:db` (`ventas_impresion_marcas.test.sql`) y
  `pnpm --filter @platform/web test` (`DocumentosComprobante.test.tsx`,
  `ImprimirComprobanteDialog.test.tsx`, `lib/ventasImpresiones.test.ts`).

## Presupuesto y correo (F-VTA-20 / MSF-245)

Un presupuesto se imprime en PDF y se envía por correo al cliente. El PDF lo
genera el mismo worker `comprobantes-pdf` (plantilla `presupuesto.ts`) y el
correo lo manda el flow `comprobantes-correo` de Kestra.

- **Imprimir (FR-020…FR-022)**: `solicitar_documento_comprobante(id, 'presupuesto')`
  acepta un comprobante tipo `presupuesto` en estado `pendiente` o `aceptado`
  (`vencido` se deriva de «válido hasta», así que es un `pendiente`); un
  `convertido` se rechaza. Exige `ventas` en `lectura` en la empresa. A
  diferencia de la factura, el presupuesto se edita: su PDF solo se reutiliza si
  se pidió **después** de la última modificación (`updated_at`); si no, se genera
  uno nuevo y el viejo queda como historial. La plantilla lleva las leyendas
  «Documento no válido como factura · Versión sin valor fiscal», número, fecha,
  «Válido hasta», cliente, líneas y Subtotal sin IVA / IVA / Total (provisoria,
  una sola plantilla; ver *Decisiones abiertas* de la spec).
- **Enviar por correo (FR-023…FR-029)**: `enviar_presupuesto_correo(comprobante_id)`
  exige `ventas` en `edicion` en la empresa (enviar a un tercero no es lo mismo
  que imprimir), toma el correo del cliente y, si no tiene (incluido Consumidor
  final) o está mal formado, rechaza con un mensaje claro **sin crear nada**.
  Pide el PDF (vigente o nuevo), crea la fila de
  `dominio.comprobante_envios_correo` (`pendiente`) y su orden en la outbox
  (`enviar-presupuesto-correo-<envío>`) en la misma transacción. Es idempotente:
  un envío `pendiente` del mismo presupuesto se devuelve tal cual (índice único
  parcial). `listar_envios_correo_presupuesto(comprobante_id)` alimenta la marca
  «Presupuesto enviado por correo · dd/mm hh:mm». Un envío pendiente que ya no
  puede completarse (orden agotada, PDF fallido o 15 minutos) pasa a `fallido`.
- **Esquema (Principio VII)**: `dominio.comprobante_envios_correo` → `dominio`
  (entidad de negocio). RLS de lectura por organización y `ventas` en la empresa
  del envío; sin escritura directa. Las RPC revocan `public`/`anon` y otorgan
  `authenticated`.
- **Flow `comprobantes-correo`** (`infra/kestra/flows/comprobantes-correo.yml`):
  cada minuto reclama `enviar-presupuesto-correo-*` y, por envío, decide con
  `private.datos_envio_correo`: **enviar** (PDF generado: lo baja del bucket
  privado, manda el correo con el PDF adjunto y cierra `enviado`), **esperar**
  (PDF en curso: libera la orden 30 s, hasta 20 veces), **fallar** (PDF fallido)
  o **nada** (ya cerrado). El correo y la descarga se reintentan 3 veces; si
  persiste, el envío queda `fallido` con un motivo fijo (nunca el mensaje del
  SMTP). `private.cerrar_envio_correo` es idempotente y deja los eventos
  `presupuesto.enviado_por_correo` / `presupuesto.envio_fallido` con quien lo pidió.
  La entrega es «al menos una vez»: si Kestra se corta entre enviar y cerrar, el
  reclamo vence y el correo puede salir dos veces.
- **SMTP y remitente**: se usa el SMTP de Kestra existente (`KESTRA_SMTP_HOST`,
  `_PORT`, `_TRANSPORTE`, `_USERNAME`, `_PASSWORD`); el remitente es el global
  `KESTRA_SMTP_FROM` (no hay remitente por empresa en esta historia). Asunto y
  cuerpo son fijos y provisorios.
- **Variables nuevas** (`infra/kestra/.env.example`): `COMPROBANTES_STORAGE_URL`
  (API de Supabase alcanzable desde Kestra) y `SECRET_COMPROBANTES_STORAGE_KEY`
  (clave de servicio de Supabase **en base64**, como todo `SECRET_*`; valor real
  solo en `infra/kestra/.env`, nunca en Git). Es la única credencial nueva: Kestra
  la usa solo para leer el bucket privado `comprobantes-documentos`.
- **Puesta en marcha**: además de la conexión `comprobantes-pdf` de la
  organización (ver arriba), cargar esas dos variables, tener el SMTP de Kestra
  configurado y desplegar el flow `comprobantes-correo`. Sin la conexión, la RPC
  responde «El envío de presupuestos todavía no está habilitado…».
- **Pantallas**: en Presupuestos, cada fila ofrece «Imprimir» (`lectura`) y
  «Enviar por correo» (solo `edicion`), con los avisos «Enviado a imprimir ·
  <número>» y «Presupuesto <número> enviado por correo» y error con «Reintentar».
  En el detalle, el diálogo suma la opción «Presupuesto» y la tarjeta Documentos
  «Enviar por correo» con su marca. Ambas siguen la empresa activa (Principio
  VIII): al cambiarla se corta la acción en curso y se descarta su resultado.
- **Migraciones**: `20261212100100_solicitar_documento_presupuesto.sql`,
  `20261212100200_comprobante_envios_correo.sql` y
  `20261212100300_enviar_presupuesto_correo.sql` (versiones posteriores a las de
  F-VTA-19/21; la tasks.md las numera con un bloque anterior).
- **Reversión**: aditiva, migración posterior: quitar
  `public.listar_envios_correo_presupuesto(uuid)`,
  `public.enviar_presupuesto_correo(uuid)`, `private.expirar_envio_pendiente(uuid)`,
  `private.cerrar_envio_correo(uuid, text)`, `private.aplicar_cierre_envio_correo(uuid, text)`,
  `private.datos_envio_correo(uuid)`, `private.exigir_llamante_kestra()` y la tabla
  `dominio.comprobante_envios_correo` (exportar antes si se quiere conservar el
  historial de envíos); reaplicar el cuerpo de `solicitar_documento_comprobante`
  de `20261211120300`. Para apagar solo el envío, desactivar el flow en Kestra:
  los envíos pendientes pasan a `fallido` a los 15 minutos.
- **Verificación**: `pnpm test:db` (`ventas_impresion_presupuesto.test.sql`),
  `pnpm --filter @workers/comprobantes-pdf test` (`presupuesto.test.ts`),
  `pnpm test:kestra:comprobantes` (`comprobantes-correo.test.mjs`) y
  `pnpm --filter @platform/web test` (`presupuestos.test.tsx`,
  `DocumentosComprobante.test.tsx`, `ImprimirComprobanteDialog.test.tsx`,
  `lib/ventasPresupuestoCorreo.test.ts`).

## Recorrido E2E y revisión de cierre (MSF-565 / T035–T037)

- **E2E** `apps/web/e2e/ventas-impresion.e2e.ts` (SC-009): siembra una organización con una
  factura `confirmada` y un presupuesto, imprime factura y remito desde el diálogo, comprueba las
  marcas «Factura/Remito impreso · dd/mm hh:mm», reimprime el remito (un solo pedido, la segunda
  impresión queda como `reimpresion`), imprime el presupuesto y pide «Enviar por correo». Hace de
  flow `comprobantes-documentos`: corre el worker real (`pnpm --filter @workers/comprobantes-pdf build`
  antes) contra el Postgres local (`E2E_PGHOST/PORT/DATABASE/USER/PASSWORD`, por defecto el de
  `dev:supabase`). Con `E2E_CORREO_KESTRA=1` (Kestra y Mailpit levantados) espera además el correo con
  el PDF adjunto; sin eso verifica el envío pendiente y su orden en la outbox. La latencia de
  generación (clic en «Imprimir» → PDF abierto, y duración del worker) se imprime por consola y queda
  como anotación `latencia-generacion` del informe; el tope es el de la pantalla (90 s). Se omite sin
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Comando: `pnpm --filter @platform/web test:e2e ventas-impresion`.
- **Revisión de seguridad (SC-010)** de RLS, RPC, bucket, funciones `private.*`, worker y flows.
  Sin hallazgos bloqueantes:
  - Las tres tablas (`comprobante_documentos`, `comprobante_impresiones`, `comprobante_envios_correo`)
    están en `dominio`, con RLS, `revoke all … from public, anon, authenticated` y solo `select`
    para `authenticated`; sin escritura directa. `comprobante_impresiones` es append-only (trigger).
  - Las 8 RPC públicas son `security definer` con `search_path = ''`, `revoke … from public, anon` y
    `grant execute … to authenticated`; las funciones `private.*` del worker solo se otorgan a
    `workers_orquestacion` y las del correo a `kestra_orquestacion` (con el gate de rol adentro).
  - El bucket `comprobantes-documentos` es privado, solo PDF, tope 10 MB, sin políticas de
    escritura; el navegador recibe solo URL firmadas de 5 minutos.
  - El worker corre con `--read-only`, `--cap-drop=ALL`, `no-new-privileges`, límites de CPU y
    memoria y red con egress allowlist; el flow pasa nombres de variables, no valores.
  - **Riesgo residual (aceptado, a revisar con el ciclo de workers):** tanto el worker como el flow
    `comprobantes-correo` usan la clave de servicio de Supabase (omite RLS de Storage) para subir o
    bajar PDF. Está confinada al servidor y a un secreto de Kestra (`SECRET_COMPROBANTES_STORAGE_KEY`),
    nunca llega al navegador. Una credencial de Storage acotada al bucket reemplazaría a la clave de
    servicio sin cambiar el contrato.
- **Validación final (SC-011)**: `pnpm lint && pnpm build && pnpm test && pnpm docs:check &&
  pnpm matriz:check && pnpm prototipo:check && pnpm infra:config` y `rls_en_toda_tabla` (`pnpm test:db`).
  Las migraciones de la épica no cambian en este cierre (solo se agrega el E2E y documentación).

## Verificación

- `pnpm test:db` (`ventas_impresion_documentos.test.sql`): aislamiento entre
  organizaciones y empresas, `lectura`/`ninguno`/`anon`, solo `confirmada`,
  idempotencia y funciones del worker no ejecutables por `authenticated`.
- `pnpm --filter @workers/comprobantes-pdf test`: plantillas, PDF A4, paginado,
  cierre `generado`/`fallido` y códigos de salida.
- `pnpm test:kestra:comprobantes` y `pnpm infra:config`: flow válido.
- `pnpm --filter @platform/web test`: diálogo, tarjeta, ficha de empresa y
  `lib/ventasImpresion`.

## Reversión

Las migraciones son aditivas y cada una trae su reversión en el encabezado
(migración posterior). Orden: vaciar el bucket `comprobantes-documentos`, quitar
la política de `storage.objects` y el bucket, eliminar las RPC y funciones
`private`, luego `dominio.comprobante_documentos` y, si ya no se usan, las
columnas `razon_social` y `cuit` (exportarlas antes). Para apagar solo la
función, desactivar el flow en Kestra: los pedidos pendientes pasan a `fallido`
a los 10 minutos y la pantalla muestra el error con «Reintentar».

## Permisos de lectura y alcance de FR-009

- La lectura directa de `dominio.comprobante_documentos` y del bucket
  `comprobantes-documentos` se decide por la empresa **del documento**
  (`private.puede_leer_documento_empresa(uuid)` para la tabla y
  `private.puede_leer_documento_ruta(text)` para la carpeta del bucket, sobre `nivel_ventas_en_empresa`),
  igual que las RPC: tener `ventas` en una tienda no abre los PDF de otra.
- La «condición frente al IVA» del cliente vive en `public.clientes.condicion_iva` (migración aditiva
  `20261211120050`; reversión: `drop constraint clientes_condicion_iva_largo_ck` y `drop column condicion_iva`).
  `private.datos_documento_comprobante` la emite en `datos.cliente.condicion_iva` y la factura imprime
  `Condición frente al IVA: …` solo si está cargada (regla «lo no cargado se omite»).
  Hoy es texto libre (tope de 60 caracteres, sin catálogo): cuando se agregue la edición en la ficha del
  cliente hay que cerrar los valores (lista cerrada o enum) para que no salgan variantes en la factura.
