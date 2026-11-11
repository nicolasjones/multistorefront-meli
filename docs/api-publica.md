# API pública y avisos hacia otros sistemas (F-API-01)

Guía de la API de solo lectura de la organización, de las claves que la
autentican y de los avisos (webhooks) firmados que la plataforma entrega a
sistemas externos. La pantalla **API** del panel (Administración → API, ruta
`/api`) administra claves, suscripciones, entregas y llamadas recientes.

## Claves de API

- Una clave pertenece a **una organización** y la organización se deriva
  siempre de la clave: ningún parámetro de la URL puede cambiarla.
- El valor (`msf_<prefijo>_<secreto>`) se muestra **una sola vez** al crearla o
  rotarla. En la base solo queda el hash y el prefijo.
- Alcances: `productos`, `stock`, `precios`, `ventas`. Una clave puede tener uno
  o varios; si falta el alcance de la ruta responde `403 alcance_insuficiente`.
- Rotar conserva la clave anterior **24 h** (gracia) para cambiar el cliente sin
  cortar el servicio. Revocar la deja inutilizable en la llamada siguiente.
- La clave se administra con `crear_clave_api`, `rotar_clave_api` y
  `revocar_clave_api` (solo Administrador de la organización). La lectura del
  panel nunca incluye el hash.

### Cómo cruza el gateway de Supabase

La clave de API **no es un JWT de Supabase**, así que el gateway no puede
validarla como tal. La Edge Function `api-v1` se despliega con
`verify_jwt = false` (`supabase/config.toml`), y el handler autentica la clave.
Dos formas de llamar:

```http
# 1) Directo (gateway sin validar JWT para api-v1)
Authorization: Bearer msf_<prefijo>_<secreto>

# 2) Con el gateway validando Authorization: clave anónima allí y clave de API acá
apikey: <clave anónima de Supabase>
Authorization: Bearer <clave anónima de Supabase>
X-API-Key: msf_<prefijo>_<secreto>
```

La clave anónima es pública y solo sirve para pasar el gateway; no autoriza
ningún dato. Nunca se usa la clave de servicio desde un sistema externo ni desde
el navegador. En el stack self-hosted el `verify_jwt` de `config.toml` no
necesariamente rige (el gateway se configura aparte): el camino soportado es
`X-API-Key` con la clave anónima en `Authorization`.

## Rutas (solo lectura, `GET`)

Base: `/api-v1`.

| Ruta | Alcance | Contenido |
|---|---|---|
| `/v1/productos` | `productos` | catálogo con categoría, moneda y precio de lista |
| `/v1/stock` | `stock` | stock por producto y depósito |
| `/v1/precios` | `precios` | precios por escala (`x5`, `x10`, `x50`) |
| `/v1/ventas` | `ventas` | facturas confirmadas |
| `/v1/openapi.json` | — | contrato OpenAPI 3.1 (público) |

Parámetros: `cursor` (opaco, base64url de `(actualizado_en, id)`; en ventas de
`(confirmado_en, id)`), `limite` (1–100, por defecto 50) y
`actualizado_desde` (ISO-8601 con zona, inclusive). Un cursor inválido responde
`400 cursor_invalido`; un límite o una fecha inválidos, `400 parametro_invalido`.
El error siempre tiene la forma:

```json
{ "error": { "codigo": "token_invalido", "mensaje": "La clave de API no es válida." } }
```

Límite: **60 solicitudes por minuto por clave**. Al superarlo responde
`429 limite_excedido` con `Retry-After`. El rechazo también queda auditado.

## Eventos y suscripciones

La API avisa por `POST` a una URL `https` de la suscripción los eventos:

| Tipo | Origen |
|---|---|
| `stock.actualizado` | cada movimiento de stock |
| `precio.actualizado` | cambio real de precio de lista o de una escala, o de moneda |
| `venta.registrada` | factura que pasa a `confirmada` |

El cuerpo es `{ id, tipo, organizacion_id, ocurrido_en, datos }`. Se entrega a
lo sumo **una vez por suscripción y evento** (`unique (evento_id,
suscripcion_id)`).

### Firma

```http
X-Evento-Id: <id del evento>
X-Firma: t=<epoch>,v1=<HMAC-SHA256 hex de "<t>.<cuerpo>">
```

El secreto se muestra una sola vez al crear la suscripción, vive en Vault y
nunca llega al navegador. Para verificar: recalcular el HMAC con el cuerpo
recibido y el mismo `t`, y comparar en tiempo constante. Rechazar un `t` viejo
según la tolerancia del receptor.

### Reintentos

La base gobierna los reintentos: **5 intentos** con espera
`60 s × 2^(intentos-1)`; al quinto la entrega queda `agotada` (o `completada` si
el destino respondió 2xx). Kestra no reintenta la llamada HTTP por su cuenta:
cada reclamo de la entrega es un intento. El flow `entregar-webhooks-api` corre
cada minuto y reparte hasta `API_WEBHOOKS_LOTE` eventos (total, no por tipo) y
entregas por corrida.

### SSRF

Al guardar la suscripción y otra vez al entregar se exige `https`, sin
credenciales en la URL y sin hosts que resuelvan a loopback, rangos privados,
link-local o metadata. La entrega se conecta a la **IP ya resuelta y validada**
(no vuelve a resolver el host), así un DNS de TTL corto no puede cambiar a una
IP interna entre la validación y la conexión. No se siguen redirecciones. El
error guardado está saneado (sin secreto ni credenciales).

## Auditoría y retención

Toda llamada, incluidas las rechazadas, queda en `public.api_llamadas` (método,
ruta, versión, estado HTTP, duración; nunca el token ni el cuerpo). Solo el
Administrador la lee. El flow `purgar-api-llamadas` borra lo anterior a
`API_AUDITORIA_RETENCION_DIAS` (90 por defecto).

## Versionado

La versión va en la ruta (`/v1/`). Los cambios aditivos no rompen `v1`; uno
incompatible exige `/v2/`. Una ruta o campo en retiro responde `Deprecation` y
`Sunset` con al menos 6 meses de aviso. `pnpm test:openapi` verifica que
`openapi/api-v1.json` y `openapi/entregar-webhook.json` sean copia del contrato
que viaja con cada función, que todas las rutas estén documentadas y que un
cambio incompatible traiga `BREAKING:` en el commit o el PR.

## Operación y reversión

- Variables de Kestra: `ENTREGAR_WEBHOOK_URL`, `SECRET_ENTREGAR_WEBHOOK_APIKEY`,
  `API_WEBHOOKS_LOTE` y `API_AUDITORIA_RETENCION_DIAS` (ver
  `infra/kestra/.env.example`).
- Migraciones: `20270223100000_api_claves`, `20270223100100_api_llamadas_y_limite`,
  `20270223100200_api_lectura`, `20270223100300_api_suscripciones_entregas` y
  `20270223100400_api_eventos_precio_venta`. Son aditivas; cada encabezado
  documenta el `drop` de sus objetos para revertir.
- Pruebas: `pnpm test:edge:api-v1`, `pnpm test:edge:entregar-webhook`,
  `pnpm test:kestra:webhooks`, `pnpm test:openapi` y los pgTAP
  `api_claves`, `api_llamadas`, `api_aislamiento`, `api_suscripciones_entregas` y
  `api_eventos` (`pnpm test:db`).
