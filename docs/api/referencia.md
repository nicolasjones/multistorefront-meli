---
owner: tecnico
sources: []
---

<!-- GENERADO por scripts/openapi-a-markdown.mjs a partir de openapi/api-v1.json. No editar a mano: `pnpm openapi:escribir`. -->

# Referencia de la API pública v1

!!! tip "Contrato máquina-legible"
    El mismo contenido está en formato OpenAPI 3.1: se sirve **sin clave** en `GET <URL de Supabase>/functions/v1/api-v1/v1/openapi.json` y se puede importar en Postman, Insomnia o un generador de clientes.

API de **solo lectura** del catálogo, el stock, los precios y las ventas de la organización a la que pertenece la clave. La organización sale **siempre de la clave**: ningún parámetro la cambia.

## Empezar

1. En el panel, **Administración → API → Crear clave**, elegí los alcances (`productos`, `stock`, `precios`, `ventas`) y copiá la clave: se muestra una sola vez.
2. Llamá con `Authorization: Bearer msf_<prefijo>_<secreto>` a `<URL de Supabase>/functions/v1/api-v1/v1/<recurso>`. En los ejemplos, `$BASE` es `<URL de Supabase>/functions/v1/api-v1` y `$CLAVE_API` es tu clave.
3. Si la respuesta trae `siguiente_cursor`, pedí la página siguiente con `?cursor=<valor>`.

## Sincronización incremental

Guardá el instante de tu última sincronización y pedí `?actualizado_desde=<ISO-8601 con zona>`: solo llega lo que cambió desde entonces (inclusive). En precios, un cambio solo de escala (`x5`, `x10`, `x50`) cuenta como cambio del producto. En **ventas**, `actualizado_desde` filtra por la fecha de confirmación: no detecta cambios de estado ni anulaciones (ver el recurso).

## Límites

**60 solicitudes por minuto por clave**. Al superarlas responde `429 limite_excedido` con la cabecera `Retry-After` (segundos). Cada organización puede tener hasta 50 claves vigentes.

## Errores

Siempre con la forma `{ "error": { "codigo": "...", "mensaje": "..." } }`; decidí por `codigo`, no por `mensaje`.

## Avisos

Además de consultar, podés suscribirte desde el panel a eventos que la plataforma envía por `POST` a tu URL `https`, firmados con HMAC-SHA256. Ver «Avisos (webhooks)» más abajo.

## Versionado

La versión va en la ruta (`/v1/`). Los cambios aditivos (campos nuevos) no rompen `v1`: **tu código debe ignorar los campos que no conoce**. Un cambio incompatible exige `/v2/`, y lo que se retira avisa con `Deprecation` y `Sunset` con al menos 6 meses de antelación.

## Cómo se autentica

- **bearerAuth** (HTTP bearer): Clave de API de la organización (`msf_<prefijo>_<secreto>`), en `Authorization: Bearer <clave>`.
- **apiKeyAuth** (cabecera `X-API-Key`): Alternativa cuando el gateway sigue validando `Authorization`: mandar allí la clave anónima (`apikey` + `Authorization: Bearer <anon>`) y la clave de API acá. La organización sale siempre de esta clave.

## Recursos

### `GET /v1/productos`

**Catálogo de la organización**

Requiere el alcance `productos`. Máximo 100 filas por página (por defecto 50).

**Paginación:** pasá `siguiente_cursor` en `?cursor=` hasta que sea `null`. **Sincronización incremental:** guardá el instante de la última sincronización y pedí `?actualizado_desde=`.

**Parámetros**

| Nombre | Dónde | Tipo | Obligatorio | Qué es |
|---|---|---|---|---|
| `cursor` | URL | texto | no | Cursor opaco de la página anterior. Un cursor inválido responde `400 cursor_invalido`. Ejemplo: `MTc2NzIyNTYwMDAwMDAwMHwzZjZjMmQxZS04YTQ3LTRiNWUtOWMxMC0yYTdkNWU4YjlmMDE`. |
| `limite` | URL | entero | no | Filas por página: de 1 a 100 (por defecto 50). Ejemplo: `50`. |
| `actualizado_desde` | URL | texto (date-time) | no | ISO-8601 con zona. Trae solo lo actualizado desde ese instante (inclusive). Si la zona es un offset con `+` (por ejemplo `+03:00`), codificalo como `%2B03:00` en la URL: un `+` sin codificar llega como espacio y responde `400 parametro_invalido`. Ejemplo: `2027-03-01T00:00:00-03:00`. |

**Respuestas**

| Estado | Cuándo |
|---|---|
| `200` | Página del catálogo. |
| `400` | Un parámetro de la consulta no es válido (cursor inválido incluido). Códigos: `cursor_invalido`, `parametro_invalido`. |
| `401` | Falta la clave, no es válida, o está revocada o vencida. Códigos: `token_ausente`, `token_invalido`, `clave_vencida`, `clave_revocada`. |
| `403` | La clave no tiene el alcance que pide la ruta. Códigos: `alcance_insuficiente`. |
| `429` | Se superó el límite de uso de la clave. La cabecera `Retry-After` dice en cuántos segundos reintentar. Códigos: `limite_excedido`. |
| `500` | No se pudo completar la llamada. Códigos: `error_interno`. |

**Ejemplo de respuesta `200`**

```json
{
  "datos": [
    {
      "id": "3f6c2d1e-8a47-4b5e-9c10-2a7d5e8b9f01",
      "nombre": "Control inalámbrico negro",
      "sku": "CTRL-0042",
      "activo": true,
      "categoria_id": "c4a8e2b6-5d19-4e73-8f0a-1b3c7d9e5a44",
      "categoria": "Consolas > Accesorios",
      "moneda": "ARS",
      "precio_lista": 45900,
      "actualizado_en": "2027-03-02T14:05:31.482Z"
    }
  ],
  "siguiente_cursor": "MTc2NzIyNTYwMDAwMDAwMHwzZjZjMmQxZS04YTQ3LTRiNWUtOWMxMC0yYTdkNWU4YjlmMDE"
}
```

**Ejemplo de llamada**

=== "curl"

    ```bash
    curl -s "$BASE/v1/productos?limite=2" \
      -H "Authorization: Bearer $CLAVE_API"
    ```

=== "fetch"

    ```javascript
    const r = await fetch(`${process.env.BASE}/v1/productos?limite=2`, {
      headers: { Authorization: `Bearer ${process.env.CLAVE_API}` },
    })
    const { datos, siguiente_cursor } = await r.json()
    ```

### `GET /v1/stock`

**Stock por producto y depósito**

Requiere el alcance `stock`. Máximo 100 filas por página (por defecto 50).

**Paginación:** pasá `siguiente_cursor` en `?cursor=` hasta que sea `null`. **Sincronización incremental:** guardá el instante de la última sincronización y pedí `?actualizado_desde=`.

**Parámetros**

| Nombre | Dónde | Tipo | Obligatorio | Qué es |
|---|---|---|---|---|
| `cursor` | URL | texto | no | Cursor opaco de la página anterior. Un cursor inválido responde `400 cursor_invalido`. Ejemplo: `MTc2NzIyNTYwMDAwMDAwMHwzZjZjMmQxZS04YTQ3LTRiNWUtOWMxMC0yYTdkNWU4YjlmMDE`. |
| `limite` | URL | entero | no | Filas por página: de 1 a 100 (por defecto 50). Ejemplo: `50`. |
| `actualizado_desde` | URL | texto (date-time) | no | ISO-8601 con zona. Trae solo lo actualizado desde ese instante (inclusive). Si la zona es un offset con `+` (por ejemplo `+03:00`), codificalo como `%2B03:00` en la URL: un `+` sin codificar llega como espacio y responde `400 parametro_invalido`. Ejemplo: `2027-03-01T00:00:00-03:00`. |

**Respuestas**

| Estado | Cuándo |
|---|---|
| `200` | Página del stock. |
| `400` | Un parámetro de la consulta no es válido (cursor inválido incluido). Códigos: `cursor_invalido`, `parametro_invalido`. |
| `401` | Falta la clave, no es válida, o está revocada o vencida. Códigos: `token_ausente`, `token_invalido`, `clave_vencida`, `clave_revocada`. |
| `403` | La clave no tiene el alcance que pide la ruta. Códigos: `alcance_insuficiente`. |
| `429` | Se superó el límite de uso de la clave. La cabecera `Retry-After` dice en cuántos segundos reintentar. Códigos: `limite_excedido`. |
| `500` | No se pudo completar la llamada. Códigos: `error_interno`. |

**Ejemplo de respuesta `200`**

```json
{
  "datos": [
    {
      "producto_id": "3f6c2d1e-8a47-4b5e-9c10-2a7d5e8b9f01",
      "nombre": "Control inalámbrico negro",
      "sku": "CTRL-0042",
      "deposito_id": "c4a8e2b6-5d19-4e73-8f0a-1b3c7d9e5a44",
      "deposito": "Depósito central",
      "cantidad": 120,
      "reservado": 8,
      "disponible": 112,
      "actualizado_en": "2027-03-02T15:10:02.117Z"
    }
  ],
  "siguiente_cursor": "MTc2NzIyNTYwMDAwMDAwMHwzZjZjMmQxZS04YTQ3LTRiNWUtOWMxMC0yYTdkNWU4YjlmMDE"
}
```

**Ejemplo de llamada**

=== "curl"

    ```bash
    curl -s "$BASE/v1/stock?limite=2" \
      -H "Authorization: Bearer $CLAVE_API"
    ```

=== "fetch"

    ```javascript
    const r = await fetch(`${process.env.BASE}/v1/stock?limite=2`, {
      headers: { Authorization: `Bearer ${process.env.CLAVE_API}` },
    })
    const { datos, siguiente_cursor } = await r.json()
    ```

### `GET /v1/precios`

**Precios de lista y escalas**

Requiere el alcance `precios`. No calcula precio final por empresa ni IVA.

**Paginación:** pasá `siguiente_cursor` en `?cursor=` hasta que sea `null`. **Sincronización incremental:** guardá el instante de la última sincronización y pedí `?actualizado_desde=`.

**Parámetros**

| Nombre | Dónde | Tipo | Obligatorio | Qué es |
|---|---|---|---|---|
| `cursor` | URL | texto | no | Cursor opaco de la página anterior. Un cursor inválido responde `400 cursor_invalido`. Ejemplo: `MTc2NzIyNTYwMDAwMDAwMHwzZjZjMmQxZS04YTQ3LTRiNWUtOWMxMC0yYTdkNWU4YjlmMDE`. |
| `limite` | URL | entero | no | Filas por página: de 1 a 100 (por defecto 50). Ejemplo: `50`. |
| `actualizado_desde` | URL | texto (date-time) | no | ISO-8601 con zona. Trae solo lo actualizado desde ese instante (inclusive). Si la zona es un offset con `+` (por ejemplo `+03:00`), codificalo como `%2B03:00` en la URL: un `+` sin codificar llega como espacio y responde `400 parametro_invalido`. Ejemplo: `2027-03-01T00:00:00-03:00`. |

**Respuestas**

| Estado | Cuándo |
|---|---|
| `200` | Página de precios. |
| `400` | Un parámetro de la consulta no es válido (cursor inválido incluido). Códigos: `cursor_invalido`, `parametro_invalido`. |
| `401` | Falta la clave, no es válida, o está revocada o vencida. Códigos: `token_ausente`, `token_invalido`, `clave_vencida`, `clave_revocada`. |
| `403` | La clave no tiene el alcance que pide la ruta. Códigos: `alcance_insuficiente`. |
| `429` | Se superó el límite de uso de la clave. La cabecera `Retry-After` dice en cuántos segundos reintentar. Códigos: `limite_excedido`. |
| `500` | No se pudo completar la llamada. Códigos: `error_interno`. |

**Ejemplo de respuesta `200`**

```json
{
  "datos": [
    {
      "producto_id": "3f6c2d1e-8a47-4b5e-9c10-2a7d5e8b9f01",
      "nombre": "Control inalámbrico negro",
      "sku": "CTRL-0042",
      "moneda": "ARS",
      "precio_lista": 45900,
      "precio_x5": 43500,
      "precio_x10": 41800,
      "precio_x50": null,
      "actualizado_en": "2027-03-02T16:00:00.000Z"
    }
  ],
  "siguiente_cursor": "MTc2NzIyNTYwMDAwMDAwMHwzZjZjMmQxZS04YTQ3LTRiNWUtOWMxMC0yYTdkNWU4YjlmMDE"
}
```

**Ejemplo de llamada**

=== "curl"

    ```bash
    curl -s "$BASE/v1/precios?limite=2" \
      -H "Authorization: Bearer $CLAVE_API"
    ```

=== "fetch"

    ```javascript
    const r = await fetch(`${process.env.BASE}/v1/precios?limite=2`, {
      headers: { Authorization: `Bearer ${process.env.CLAVE_API}` },
    })
    const { datos, siguiente_cursor } = await r.json()
    ```

### `GET /v1/ventas`

**Facturas confirmadas**

Requiere el alcance `ventas`. Solo facturas (`tipo = factura`) confirmadas; no expone cliente ni contacto.

**Paginación:** pasá `siguiente_cursor` en `?cursor=` hasta que sea `null`. **Sincronización incremental:** guardá el instante de la última sincronización y pedí `?actualizado_desde=`.

**Ojo con la sincronización incremental:** en este recurso `actualizado_desde` filtra por la fecha de **confirmación**, así que trae las facturas confirmadas nuevas, pero **no** avisa cuando una factura ya enviada cambia de estado (por ejemplo a cobrado) ni cuando se anula (una factura anulada deja de aparecer en la lista). Para mantener los estados al día, volvé a leer periódicamente una ventana reciente (por ejemplo los últimos 30 días) y actualizá lo que cambió.

**Parámetros**

| Nombre | Dónde | Tipo | Obligatorio | Qué es |
|---|---|---|---|---|
| `cursor` | URL | texto | no | Cursor opaco de la página anterior. Un cursor inválido responde `400 cursor_invalido`. Ejemplo: `MTc2NzIyNTYwMDAwMDAwMHwzZjZjMmQxZS04YTQ3LTRiNWUtOWMxMC0yYTdkNWU4YjlmMDE`. |
| `limite` | URL | entero | no | Filas por página: de 1 a 100 (por defecto 50). Ejemplo: `50`. |
| `actualizado_desde` | URL | texto (date-time) | no | ISO-8601 con zona. Trae solo lo actualizado desde ese instante (inclusive). Si la zona es un offset con `+` (por ejemplo `+03:00`), codificalo como `%2B03:00` en la URL: un `+` sin codificar llega como espacio y responde `400 parametro_invalido`. Ejemplo: `2027-03-01T00:00:00-03:00`. |

**Respuestas**

| Estado | Cuándo |
|---|---|
| `200` | Página de ventas. |
| `400` | Un parámetro de la consulta no es válido (cursor inválido incluido). Códigos: `cursor_invalido`, `parametro_invalido`. |
| `401` | Falta la clave, no es válida, o está revocada o vencida. Códigos: `token_ausente`, `token_invalido`, `clave_vencida`, `clave_revocada`. |
| `403` | La clave no tiene el alcance que pide la ruta. Códigos: `alcance_insuficiente`. |
| `429` | Se superó el límite de uso de la clave. La cabecera `Retry-After` dice en cuántos segundos reintentar. Códigos: `limite_excedido`. |
| `500` | No se pudo completar la llamada. Códigos: `error_interno`. |

**Ejemplo de respuesta `200`**

```json
{
  "datos": [
    {
      "id": "9b1e4c77-0d3a-4f68-a2b5-6c8e1d4f7a22",
      "numero": "0001-00012345",
      "fecha": "2027-03-02",
      "empresa_id": "7e2a9c3d-1f58-4b60-9d84-0a6b2c4e8f13",
      "total_sin_iva": 100000,
      "total_con_iva": 121000,
      "estado": "cobrado",
      "confirmado_en": "2027-03-02T17:45:09.301Z"
    }
  ],
  "siguiente_cursor": "MTc2NzIyNTYwMDAwMDAwMHwzZjZjMmQxZS04YTQ3LTRiNWUtOWMxMC0yYTdkNWU4YjlmMDE"
}
```

**Ejemplo de llamada**

=== "curl"

    ```bash
    curl -s "$BASE/v1/ventas?actualizado_desde=2027-03-01T00:00:00-03:00" \
      -H "Authorization: Bearer $CLAVE_API"
    ```

=== "fetch"

    ```javascript
    const r = await fetch(`${process.env.BASE}/v1/ventas?actualizado_desde=2027-03-01T00:00:00-03:00`, {
      headers: { Authorization: `Bearer ${process.env.CLAVE_API}` },
    })
    const { datos, siguiente_cursor } = await r.json()
    ```

## Códigos de error

Todos los errores tienen la forma `{ "error": { "codigo": "...", "mensaje": "..." } }`.

| Código | Estado HTTP |
|---|---|
| `token_ausente` | 401 |
| `token_invalido` | 401 |
| `clave_vencida` | 401 |
| `clave_revocada` | 401 |
| `alcance_insuficiente` | 403 |
| `limite_excedido` | 429 |
| `cursor_invalido` | 400 |
| `parametro_invalido` | 400 |
| `no_encontrado` | 404 |
| `metodo_no_soportado` | 405 |
| `error_interno` | 500 |

## Objetos de la API

### Producto

| Campo | Tipo | Siempre viene | Qué es |
|---|---|---|---|
| `id` | texto (uuid) | sí | Identificador del producto. |
| `nombre` | texto | sí |  |
| `sku` | texto | sí | Código del producto (SKU). |
| `activo` | verdadero/falso | sí | `false` si el producto está dado de baja. |
| `categoria_id` | texto (uuid) · puede ser nulo | sí |  |
| `categoria` | texto · puede ser nulo | sí | Ruta «Padre > Hija» de la categoría. |
| `moneda` | texto | sí | Moneda del precio de lista (hoy `ARS` o `USD`). |
| `precio_lista` | número | sí | Precio de lista sin IVA, en `moneda`. |
| `actualizado_en` | texto (date-time) | sí | Último cambio del producto. |

```json
{
  "id": "3f6c2d1e-8a47-4b5e-9c10-2a7d5e8b9f01",
  "nombre": "Control inalámbrico negro",
  "sku": "CTRL-0042",
  "activo": true,
  "categoria_id": "c4a8e2b6-5d19-4e73-8f0a-1b3c7d9e5a44",
  "categoria": "Consolas > Accesorios",
  "moneda": "ARS",
  "precio_lista": 45900,
  "actualizado_en": "2027-03-02T14:05:31.482Z"
}
```

### Stock

| Campo | Tipo | Siempre viene | Qué es |
|---|---|---|---|
| `producto_id` | texto (uuid) | sí |  |
| `nombre` | texto | sí |  |
| `sku` | texto | sí |  |
| `deposito_id` | texto (uuid) | sí |  |
| `deposito` | texto | sí |  |
| `cantidad` | número | sí | Unidades físicas en el depósito. |
| `reservado` | número | sí | Unidades reservadas (comprometidas). |
| `disponible` | número | sí | `cantidad - reservado`. |
| `actualizado_en` | texto (date-time) | sí | Último movimiento de stock de esta pareja producto-depósito. |

```json
{
  "producto_id": "3f6c2d1e-8a47-4b5e-9c10-2a7d5e8b9f01",
  "nombre": "Control inalámbrico negro",
  "sku": "CTRL-0042",
  "deposito_id": "c4a8e2b6-5d19-4e73-8f0a-1b3c7d9e5a44",
  "deposito": "Depósito central",
  "cantidad": 120,
  "reservado": 8,
  "disponible": 112,
  "actualizado_en": "2027-03-02T15:10:02.117Z"
}
```

### Precios

| Campo | Tipo | Siempre viene | Qué es |
|---|---|---|---|
| `producto_id` | texto (uuid) | sí |  |
| `nombre` | texto | sí |  |
| `sku` | texto | sí |  |
| `moneda` | texto | sí | Moneda de los precios (hoy `ARS` o `USD`). |
| `precio_lista` | número | sí | Precio de lista (escala x1) sin IVA. |
| `precio_x5` | número · puede ser nulo | sí | Precio sin IVA por compra de 5 o más; `null` si no tiene precio cargado. |
| `precio_x10` | número · puede ser nulo | sí | Ídem para 10 o más. |
| `precio_x50` | número · puede ser nulo | sí | Ídem para 50 o más. |
| `actualizado_en` | texto (date-time) | sí | Lo último que cambió: el producto o cualquiera de sus escalas. |

```json
{
  "producto_id": "3f6c2d1e-8a47-4b5e-9c10-2a7d5e8b9f01",
  "nombre": "Control inalámbrico negro",
  "sku": "CTRL-0042",
  "moneda": "ARS",
  "precio_lista": 45900,
  "precio_x5": 43500,
  "precio_x10": 41800,
  "precio_x50": null,
  "actualizado_en": "2027-03-02T16:00:00.000Z"
}
```

### Venta

| Campo | Tipo | Siempre viene | Qué es |
|---|---|---|---|
| `id` | texto (uuid) | sí |  |
| `numero` | texto | sí | Número del comprobante. |
| `fecha` | texto (date) | sí | Fecha del comprobante (día). |
| `empresa_id` | texto (uuid) · puede ser nulo | sí | Empresa emisora, si tiene. |
| `total_sin_iva` | número | sí | Total sin IVA. |
| `total_con_iva` | número | sí | Total con IVA. |
| `estado` | texto | sí | Estado de la factura **al momento de la consulta** (confirmada, cobrado, deuda, etc.; nunca `anulada`, porque las anuladas no se listan). |
| `confirmado_en` | texto (date-time) | sí | Cuándo se confirmó. Es el criterio de orden y de `actualizado_desde`, y no cambia aunque la factura cambie de estado. |

```json
{
  "id": "9b1e4c77-0d3a-4f68-a2b5-6c8e1d4f7a22",
  "numero": "0001-00012345",
  "fecha": "2027-03-02",
  "empresa_id": "7e2a9c3d-1f58-4b60-9d84-0a6b2c4e8f13",
  "total_sin_iva": 100000,
  "total_con_iva": 121000,
  "estado": "cobrado",
  "confirmado_en": "2027-03-02T17:45:09.301Z"
}
```

## Avisos (webhooks)

Cabeceras: `X-Evento-Id` (id del evento) y `X-Firma: t=<segundos>,v1=<hex>`, donde `v1` es el HMAC-SHA256 en hexadecimal de `"<t>.<cuerpo>"` con el secreto de la suscripción (se muestra una sola vez al crearla). **Verificá la firma** recalculándola con el cuerpo recibido tal cual y comparando en tiempo constante, y rechazá un `t` viejo. Respondé `2xx` en menos de 10 segundos para confirmar. Si no, la plataforma reintenta: son **5 intentos en total** (el original y 4 reintentos) con una espera mínima de 1, 2, 4 y 8 minutos entre intentos; después la entrega queda `agotada`. La entrega es **al menos una vez**: por reintentos puede llegar repetida, así que usá `id` para ignorar los que ya procesaste. Una suscripción pausada no recibe los eventos que ocurren mientras está pausada.

**Cobertura:** el aviso se emite por cada movimiento de stock del producto y por cada reserva o liberación, pero **no** por movimientos de variantes ni por traslados entre depósitos (el total del producto no cambia, pero sí el stock de cada depósito). Si necesitás ver todo, además de los avisos hacé un barrido periódico de `/v1/stock?actualizado_desde=`.

**Sobre del aviso (igual en los tres eventos)**

| Campo | Tipo | Siempre viene | Qué es |
|---|---|---|---|
| `id` | texto (uuid) | sí | Identificador del evento (el mismo en `X-Evento-Id`); sirve para ignorar repetidos. |
| `tipo` | texto | sí | Tipo de evento. Valores: `stock.actualizado`, `precio.actualizado`, `venta.registrada`. |
| `organizacion_id` | texto (uuid) | sí |  |
| `ocurrido_en` | texto (date-time) | sí | Cuándo ocurrió el cambio. |
| `datos` | objeto | sí |  |

**Cabeceras que recibís**

| Nombre | Dónde | Tipo | Obligatorio | Qué es |
|---|---|---|---|---|
| `X-Evento-Id` | cabecera | texto (uuid) | sí | Identificador del evento. |
| `X-Firma` | cabecera | texto | sí | `t=<segundos>,v1=<HMAC-SHA256 hex de "<t>.<cuerpo>">`. Ejemplo: `t=1803996332,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd`. |

### `stock.actualizado`

**Cambió el stock de un producto**

**Ejemplo del cuerpo**

```json
{
  "id": "b8d1f0a2-6c4e-4a39-8e57-3d9b2f1c6a70",
  "tipo": "stock.actualizado",
  "organizacion_id": "7e2a9c3d-1f58-4b60-9d84-0a6b2c4e8f13",
  "ocurrido_en": "2027-03-02T14:05:31.482Z",
  "datos": {
    "organizacion_id": "7e2a9c3d-1f58-4b60-9d84-0a6b2c4e8f13",
    "producto_id": "3f6c2d1e-8a47-4b5e-9c10-2a7d5e8b9f01",
    "movimiento_id": "1f4a7c9e-2b60-4d83-a915-6e0c3b8d2f47",
    "tipo_movimiento": "salida",
    "cantidad": 112,
    "diferencia": -8,
    "deposito_id": "c4a8e2b6-5d19-4e73-8f0a-1b3c7d9e5a44",
    "reservado": 8,
    "disponible": 104
  }
}
```

**Campos de `datos`**

| Campo | Tipo | Siempre viene | Qué es |
|---|---|---|---|
| `organizacion_id` | texto (uuid) | sí |  |
| `producto_id` | texto (uuid) | sí |  |
| `movimiento_id` | texto (uuid) · puede ser nulo | sí | Movimiento de stock que originó el evento (nulo en una reserva). |
| `reserva_id` | texto (uuid) · puede ser nulo | no | Solo en eventos de reserva o liberación. |
| `tipo_movimiento` | texto | sí | `entrada`, `salida` o `ajuste`; `reserva` o `liberacion` cuando el cambio es una reserva. |
| `cantidad` | número | sí | Cantidad total del producto tras el cambio. |
| `diferencia` | número | sí | Variación de la cantidad (0 en reservas). |
| `deposito_id` | texto (uuid) · puede ser nulo | sí |  |
| `reservado` | número | sí |  |
| `disponible` | número | sí | `cantidad - reservado`. |

### `precio.actualizado`

**Cambió el precio de lista o de una escala**

**Ejemplo del cuerpo**

```json
{
  "id": "d2e47a1b-93c5-4f08-b6a2-7c1e0f5d8a93",
  "tipo": "precio.actualizado",
  "organizacion_id": "7e2a9c3d-1f58-4b60-9d84-0a6b2c4e8f13",
  "ocurrido_en": "2027-03-02T16:00:00.000Z",
  "datos": {
    "organizacion_id": "7e2a9c3d-1f58-4b60-9d84-0a6b2c4e8f13",
    "producto_id": "3f6c2d1e-8a47-4b5e-9c10-2a7d5e8b9f01",
    "escala": "x5",
    "precio": 43500,
    "moneda": null
  }
}
```

**Campos de `datos`**

| Campo | Tipo | Siempre viene | Qué es |
|---|---|---|---|
| `organizacion_id` | texto (uuid) | sí |  |
| `producto_id` | texto (uuid) | sí |  |
| `escala` | texto | sí | `x1` (precio de lista), `x5`, `x10` o `x50`. |
| `precio` | número · puede ser nulo | sí | Nuevo precio sin IVA. |
| `moneda` | texto · puede ser nulo | sí | Moneda del producto en los eventos de `x1` (precio de lista); nulo en las escalas. |

### `venta.registrada`

**Una factura pasó a confirmada**

**Ejemplo del cuerpo**

```json
{
  "id": "a05c9e3f-1b7d-4c62-9e48-5f2a8d0b6c11",
  "tipo": "venta.registrada",
  "organizacion_id": "7e2a9c3d-1f58-4b60-9d84-0a6b2c4e8f13",
  "ocurrido_en": "2027-03-02T17:45:09.301Z",
  "datos": {
    "organizacion_id": "7e2a9c3d-1f58-4b60-9d84-0a6b2c4e8f13",
    "comprobante_id": "9b1e4c77-0d3a-4f68-a2b5-6c8e1d4f7a22",
    "numero": "0001-00012345",
    "tipo": "factura",
    "total_sin_iva": 100000,
    "total_con_iva": 121000,
    "confirmado_en": "2027-03-02T17:45:09.301Z"
  }
}
```

**Campos de `datos`**

| Campo | Tipo | Siempre viene | Qué es |
|---|---|---|---|
| `organizacion_id` | texto (uuid) | sí |  |
| `comprobante_id` | texto (uuid) | sí |  |
| `numero` | texto | sí |  |
| `tipo` | texto | sí | Siempre `factura`. |
| `total_sin_iva` | número | sí |  |
| `total_con_iva` | número | sí |  |
| `confirmado_en` | texto (date-time) | sí |  |
