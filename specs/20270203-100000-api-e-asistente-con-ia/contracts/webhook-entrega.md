# Contrato · Entrega de webhooks (`entregar-webhook`)

**Edge Function**: `supabase/functions/entregar-webhook` (invocada por el flow de Kestra).
**OpenAPI**: `openapi/entregar-webhook.json` (contrato interno, no expuesto al público).

## Flujo

1. El flow `entregar-webhooks-api` reclama un evento de `public.cola_eventos` (`private.reclamar_eventos`, lease, máximo 5 intentos).
2. `private.api_fanout_evento(evento_id)` inserta una fila en `public.api_entregas` por cada suscripción activa que incluya el tipo; `on conflict (evento_id, suscripcion_id) do nothing`.
3. El flow resuelve el evento y reclama entregas con `private.api_reclamar_entregas` (lease de 300 s).
4. La Edge Function entrega cada `api_entregas` firmada y llama `private.api_resolver_entrega`.

## Solicitud de la Edge Function

```ts
POST /entregar-webhook
{ "entrega_id": "uuid", "evento_id": "uuid", "suscripcion_id": "uuid" }
```

Autenticación interna: cabecera de servicio de Supabase (`service_role`), nunca una clave de cliente. La Edge Function lee la suscripción/entrega, el evento y el secreto de Vault (`secreto_vault_id`).

## Envío al destino

```http
POST <url de la suscripción>
Content-Type: application/json
X-Evento-Id: <evento_id>
X-Firma: t=<epoch>,v1=<hmac-sha256-hex>
```

- Cuerpo = evento serializado `{ id, tipo, organizacion_id, ocurrido_en, datos }`.
- `v1` = HMAC-SHA256 de `<t>.<cuerpo>` con el secreto de la suscripción; `t` = epoch en segundos.
- Timeout de 10 s; no sigue redirecciones.
- SSRF al entregar: resuelve DNS y rechaza loopback, rangos privados, link-local y metadata del proveedor. Si el destino cambia respecto de la validación al guardar, la entrega falla.
- Respuesta `2xx` = `completada`; cualquier otro estado o error de red = reintento.

## Reintentos y estado

| Intento | Espera antes del siguiente |
|---|---|
| 1 | 60 s |
| 2 | 120 s |
| 3 | 240 s |
| 4 | 480 s |
| 5 | — (estado final `agotada`) |

`api_entregas.estado`: `pendiente`, `reclamada`, `completada`, `agotada`. `ultimo_estado_http` guarda el último código; `ultimo_error_sanitizado` se recorta a 500 caracteres y nunca incluye el secreto, la URL con credenciales ni cabeceras de autenticación. La suscripción puede pausarse (`activa = false`); las entregas ya generadas terminan su ciclo.

`BREAKING:` ninguno (endpoint y objetos nuevos).
