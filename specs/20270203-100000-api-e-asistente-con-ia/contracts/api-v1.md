# Contrato · API pública v1 (F-API-01)

**Edge Function**: `supabase/functions/api-v1` (base `/api-v1`).
**OpenAPI**: `openapi/api-v1.json` (OpenAPI 3.1, servido también en `GET /v1/openapi.json`).
**Entrega interna**: [`webhook-entrega.md`](./webhook-entrega.md) + `openapi/entregar-webhook.json`.

## Autenticación y alcances

`Authorization: Bearer <clave>` o `X-API-Key: <clave>`. La clave **no es un JWT
de Supabase**: la Edge Function se despliega con `verify_jwt = false`
(`supabase/config.toml`). Si el gateway sigue validando `Authorization`, el
cliente manda allí la clave anónima (`apikey` + Bearer) y la clave de API en
`X-API-Key`. La organización se deriva **solo** de la clave; ningún parámetro
puede cambiarla.

| Situación | Respuesta |
|---|---|
| Sin cabecera o token mal formado | `401 token_ausente` / `401 token_invalido` |
| Prefijo desconocido o hash que no coincide | `401 token_invalido` (se audita con organización/clave nulas) |
| Clave revocada o vencida | `401 clave_revocada` / `401 clave_vencida` |
| Alcance ausente para la ruta | `403 alcance_insuficiente` |

Alcances: `productos`, `stock`, `precios`, `ventas`. Una clave puede tener uno o varios.

## Límite de uso

60 solicitudes por minuto por clave (`api_claves.limite_por_minuto`, 60 por defecto; hoy no hay pantalla ni RPC para cambiarlo: se ajusta en la base). Al superarlo: `429 limite_excedido` + `Retry-After: <segundos>`. El rechazo se registra en `api_llamadas`.

## Rutas (solo lectura, `GET`)

```ts
GET /api-v1/v1/productos?cursor&limite&actualizado_desde   // alcance productos
GET /api-v1/v1/stock?cursor&limite&actualizado_desde       // alcance stock
GET /api-v1/v1/precios?cursor&limite&actualizado_desde     // alcance precios
GET /api-v1/v1/ventas?cursor&limite&actualizado_desde      // alcance ventas
GET /api-v1/v1/openapi.json                                // contrato (sin clave)
```

- `limite`: 1–100; por defecto 50.
- `actualizado_desde`: ISO-8601 con zona; inclusive.
- `cursor`: opaco, base64url de `(actualizado_en, id)`; en ventas de `(confirmado_en, id)`. Un cursor inválido → `400 cursor_invalido`.

### Respuesta de lista

```json
{ "datos": [ /* … */ ], "siguiente_cursor": "string | null" }
```

### Campos por recurso

```ts
productos: { id, nombre, sku, activo, categoria_id, categoria, moneda, precio_lista, actualizado_en }
stock:     { producto_id, nombre, sku, deposito_id, deposito, cantidad, reservado, disponible, actualizado_en }
precios:   { producto_id, nombre, sku, moneda, precio_lista, precio_x5, precio_x10, precio_x50, actualizado_en }
ventas:    { id, numero, fecha, empresa_id, total_sin_iva, total_con_iva, estado, confirmado_en }
```

`categoria` es la ruta «Padre > Hija» (o el nombre de la raíz). `precio_x5/x10/x50` son `null` si la escala no tiene precio. `ventas` incluye las facturas ya confirmadas (`confirmado_en` no nulo) que no están anuladas (`estado <> 'anulada'`: sigue habiendo cobradas, con deuda, etc.); no incluye presupuestos; no expone cliente ni contacto. Ningún recurso calcula precio por empresa ni IVA.

## Errores

```json
{ "error": { "codigo": "token_invalido", "mensaje": "La clave de API no es válida" } }
```

Códigos: `token_ausente`, `token_invalido`, `clave_vencida`, `clave_revocada`, `alcance_insuficiente`, `limite_excedido`, `cursor_invalido`, `no_encontrado`, `error_interno`. Los mensajes no incluyen tokens, hashes ni detalles internos.

## Versionado y deprecación

Versión en la ruta (`/v1/`). Los cambios aditivos no rompen `v1`; uno incompatible exige `/v2/`. Una ruta o campo en retiro responde `Deprecation` y `Sunset`, con aviso mínimo de 6 meses (D-4). El guard `pnpm test:openapi` exige `BREAKING:` en el PR ante un cambio incompatible.

## RPC (firmas)

```ts
// Administrador de la organización; authenticated
crear_clave_api(p_nombre text, p_alcances text[], p_vence_en timestamptz default null)
  -> table(id uuid, valor text)
rotar_clave_api(p_clave_id uuid) -> table(id uuid, valor text)
revocar_clave_api(p_clave_id uuid) -> void
crear_suscripcion_api(p_url text, p_tipos text[]) -> table(id uuid, secreto text)
actualizar_suscripcion_api(p_id uuid, p_activa boolean) -> void
eliminar_suscripcion_api(p_id uuid) -> void

// service_role (Edge Function api-v1)
api_validar_clave(p_token text)
  -> table(valida boolean, clave_id uuid, organizacion_id uuid, alcances text[], limite_por_minuto integer, motivo text)
api_controlar_limite(p_clave_id uuid) -> table(permitido boolean, reintentar_en_seg integer, restantes integer)
api_registrar_llamada(p_clave_id uuid, p_organizacion_id uuid, p_metodo text, p_ruta text,
                      p_version text, p_estado_http integer, p_duracion_ms integer) -> void

// service_role; filtro de organización dentro del SQL
private.api_leer_productos(p_organizacion_id uuid, p_cursor text, p_limite integer,
                           p_actualizado_desde timestamptz) -> table(filas jsonb, siguiente_cursor text)
private.api_leer_stock(p_organizacion_id uuid, p_cursor text, p_limite integer,
                       p_actualizado_desde timestamptz) -> table(filas jsonb, siguiente_cursor text)
private.api_leer_precios(p_organizacion_id uuid, p_cursor text, p_limite integer,
                         p_actualizado_desde timestamptz) -> table(filas jsonb, siguiente_cursor text)
private.api_leer_ventas(p_organizacion_id uuid, p_cursor text, p_limite integer,
                        p_actualizado_desde timestamptz) -> table(filas jsonb, siguiente_cursor text)

// kestra_orquestacion / service_role
private.api_fanout_evento(p_evento_id uuid) -> integer
private.api_reclamar_entregas(p_limite integer default 20, p_lease_seg integer default 300)
  -> setof public.api_entregas
private.api_resolver_entrega(p_entrega_id uuid, p_estado text, p_estado_http integer, p_error text) -> void
private.purgar_api_llamadas(p_retencion_dias integer default 90) -> integer

// disparadores
private.emitir_precio_actualizado() -> trigger
private.emitir_venta_registrada() -> trigger
```

`crear_clave_api` y `crear_suscripcion_api` devuelven el valor/secreto **una sola vez**; después solo se persiste el hash (clave) o la referencia a Vault (suscripción). Las RPC de `public` son `security definer`, validan Administrador y llevan `grant execute` explícito más `revoke` a `public/anon`.

## Eventos disponibles

| Tipo | Origen | Cuándo |
|---|---|---|
| `stock.actualizado` | `dominio.movimientos_stock` (trigger existente) | Cada movimiento |
| `precio.actualizado` | `dominio.productos.precio_lista/moneda` y `dominio.producto_precios_escala.precio` | Cambio real de precio/moneda |
| `venta.registrada` | `dominio.comprobantes_venta` | Factura que pasa a `estado = 'confirmada'` |

Envoltorio en `cola_eventos`: `{ id, tipo, organizacion_id, ocurrido_en, datos }`, con clave de idempotencia `(organizacion_id, tipo, clave_idempotencia)`. La entrega, firma, reintentos y SSRF están en [`webhook-entrega.md`](./webhook-entrega.md).

`BREAKING:` ninguno: todos los objetos son nuevos y `stock.actualizado` conserva su contrato.

## Códigos de error adicionales

- `400 parametro_invalido`: `limite` fuera de 1–100 o `actualizado_desde` sin zona horaria.
- `405 metodo_no_soportado`: cualquier método que no sea `GET`.
