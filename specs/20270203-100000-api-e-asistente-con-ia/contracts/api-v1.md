# Contrato · API pública v1 (F-API-01)

Edge Function `supabase/functions/api-v1`; contrato OpenAPI en `openapi/api-v1.json` (OpenAPI 3.1, ruta `/api-v1`). Autenticación `Authorization: Bearer <clave>`; la organización sale de la clave.

## Rutas (todas de solo lectura, `GET`)

```ts
GET /api-v1/v1/productos?cursor&limite&actualizado_desde   // alcance productos
GET /api-v1/v1/stock?cursor&limite&actualizado_desde       // alcance stock
GET /api-v1/v1/precios?cursor&limite&actualizado_desde     // alcance precios
GET /api-v1/v1/ventas?cursor&limite&actualizado_desde      // alcance ventas
GET /api-v1/v1/openapi.json                                // contrato
```

Respuesta de lista: `{ datos: [...], siguiente_cursor: string | null }`. Error uniforme: `{ error: { codigo, mensaje } }`. Códigos: `401`, `403`, `404`, `429` (+ `Retry-After`), `5xx`. Versiones/campos en retiro: cabeceras `Deprecation` y `Sunset`.

## RPC (firmas)

```ts
crear_clave_api(p_nombre text, p_alcances text[], p_vence_en timestamptz) -> { id uuid, valor text }   // authenticated, Administrador
rotar_clave_api(p_clave_id uuid) -> { id uuid, valor text }                                             // authenticated, Administrador
revocar_clave_api(p_clave_id uuid) -> void                                                              // authenticated, Administrador
crear_suscripcion_api(p_url text, p_tipos text[]) -> { id uuid, secreto text }                          // authenticated, Administrador
actualizar_suscripcion_api(p_id uuid, p_activa boolean) -> void                                         // authenticated, Administrador
api_validar_clave(p_token text) -> { clave_id uuid, organizacion_id uuid, alcances text[] }             // service_role
api_controlar_limite(p_clave_id uuid) -> { permitido boolean, reintentar_en_seg integer }               // service_role
api_registrar_llamada(p_clave_id uuid, p_metodo text, p_ruta text, p_estado integer, p_ms integer) -> void // service_role
```

## Eventos (webhooks salientes)

Envoltorio: `{ id, tipo, organizacion_id, ocurrido_en, datos }`. Tipos: `stock.actualizado` (existente), `precio.actualizado`, `venta.registrada`. Cabeceras: `X-Evento-Id`, `X-Firma` (`t=<ts>,v1=<HMAC-SHA256 hex>`).

BREAKING: ninguno (todo es nuevo; `stock.actualizado` no cambia su contrato).
