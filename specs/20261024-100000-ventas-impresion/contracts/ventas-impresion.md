# Contratos · Ventas impresión (MSF-213)

Todas las RPC de `public` llevan `security definer`, `set search_path = ''`, `revoke execute … from public, anon` y `grant execute … to authenticated` en su migración (regla del repo; un test pgTAP falla si `anon` ejecuta otra). Las firmas se verifican contra `main` al implementar; lo **existente** de MSF-159 se cita, no se redefine.

## F-VTA-19

- `solicitar_documento_comprobante(p_comprobante_id uuid, p_tipo_documento text) returns dominio.comprobante_documentos` — `p_tipo_documento` ∈ (`factura`, `remito`) en esta historia (F-VTA-20 suma `presupuesto`); exige `ventas` ≥ `lectura` en la empresa del comprobante; solo comprobante `factura` `confirmada`; idempotente: devuelve el `generado` vigente o el `pendiente` existente; si no, crea un `pendiente`, la orden de outbox (capacidad `generar-documento-venta-<tipo>`) y el evento `comprobante.documento_solicitado`.
- `obtener_documento_comprobante(p_documento_id uuid) returns dominio.comprobante_documentos` — lectura del estado (`pendiente`/`generado`/`fallido`) y ruta; `ventas` ≥ `lectura`.
- `listar_documentos_comprobante(p_comprobante_id uuid) returns setof dominio.comprobante_documentos` — documentos del comprobante.
- `private.datos_documento_comprobante(p_documento_id uuid) returns jsonb` — empresa (razón social, CUIT, nombre, dirección, ruta del logo), cliente, cabecera, líneas y totales; **no ejecutable por `authenticated`** (lo usa el worker con su conexión).
- `private.cerrar_documento_comprobante(p_documento_id uuid, p_ruta text, p_error text) returns void` — cierra `generado` o `fallido`; idempotente; **no ejecutable por `authenticated`**.
- `dominio.empresas`: columnas aditivas `razon_social text`, `cuit text` (11 dígitos) y `grant update (razon_social, cuit)`.
- Storage: bucket privado `comprobantes-documentos`; política `select` sobre `storage.objects` por organización y `ventas`.
- Worker `workers/comprobantes-pdf` (`@workers/comprobantes-pdf`): entrada `DOCUMENTO_ID`, `EJECUCION_ID` y conexión Postgres/Storage por el entorno del host (no por línea de comandos); salida según `workers/CONTRATO.md`.
- Flow `infra/kestra/flows/comprobantes-documentos.yml`: reclama `private.reclamar_despachos_capacidad('generar-documento-venta-', …)`.

## F-VTA-21

- `registrar_impresion(p_documento_id uuid) returns dominio.comprobante_impresiones` — exige `ventas` ≥ `lectura`; el documento debe estar `generado`; emite `comprobante.impreso` la primera vez y `comprobante.reimpreso` después.
- `ultimas_impresiones_comprobante(p_comprobante_id uuid) returns table (tipo_documento text, ultima_en timestamptz, ultima_por uuid, cantidad integer)` — lectura para la tarjeta «Documentos».

## F-VTA-20

- `solicitar_documento_comprobante(...)` — **extiende** el dominio de `p_tipo_documento` con `presupuesto` (comprobante tipo `presupuesto`); la firma no cambia (no es BREAKING).
- `enviar_presupuesto_correo(p_comprobante_id uuid) returns dominio.comprobante_envios_correo` — exige `ventas` = `edicion`; destinatario = correo del cliente; rechaza (`22023`) si no tiene; idempotente (un `pendiente` por presupuesto); orden de outbox `enviar-presupuesto-correo` y evento `presupuesto.enviado_por_correo` / `presupuesto.envio_fallido`.
- `listar_envios_correo_presupuesto(p_comprobante_id uuid) returns setof dominio.comprobante_envios_correo` — lectura para la marca.
- `private.cerrar_envio_correo(p_envio_id uuid, p_estado text, p_error text) returns void` — cierre por el flow; **no ejecutable por `authenticated`**.
- Flow `infra/kestra/flows/comprobantes-correo.yml`: `io.kestra.plugin.notifications.mail.MailSend` con el SMTP de `KESTRA_SMTP_*` (patrón de `aviso-fallo-copias.yml`).
