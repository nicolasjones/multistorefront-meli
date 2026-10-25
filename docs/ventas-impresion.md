# Ventas: impresión de factura y remito (F-VTA-19 / MSF-230)

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
