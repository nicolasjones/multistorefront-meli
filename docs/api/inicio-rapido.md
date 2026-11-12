# Empezar con la API

Esta guía te lleva de cero a una integración que **trae el catálogo, se mantiene al día y recibe avisos**. Para el detalle de cada campo y de cada error, mirá la [referencia](referencia.md).

La API es de **solo lectura**: consulta catálogo, stock, precios y ventas de **tu organización**. La organización sale siempre de la clave, no se puede cambiar por parámetro.

## 1. Conseguí una clave

1. En el panel: **Administración → API → Crear clave**. Solo la ve y la crea un Administrador.
2. Elegí los **alcances** que necesita tu integración (`productos`, `stock`, `precios`, `ventas`). Dale a cada sistema solo lo que necesita.
3. Copiá la clave **en ese momento**: se muestra una sola vez. Tiene la forma `msf_<prefijo>_<secreto>`. Si la perdés, rotá la clave y usá la nueva.

Tratala como una contraseña: no la pongas en código que se publica, ni en el navegador ni en una app móvil.

## 2. Tu primera llamada

Necesitás la **URL base**, que te informa quien administra la plataforma. Tiene la forma `https://<servidor>/functions/v1/api-v1`.

```bash
export BASE="https://<servidor>/functions/v1/api-v1"
export CLAVE_API="msf_xxxxxxxx_xxxxxxxxxxxxxxxxxxxx"

curl -s "$BASE/v1/productos?limite=2" -H "Authorization: Bearer $CLAVE_API"
```

Si la clave y el alcance son correctos, la respuesta es una página:

```json
{
  "datos": [ { "id": "…", "nombre": "…", "sku": "…", "precio_lista": 45900 } ],
  "siguiente_cursor": "MTc2NzIy…"
}
```

Si no, el error trae un `codigo` estable (por ejemplo `token_invalido` o `alcance_insuficiente`): decidí por el código, no por el mensaje.

## 3. Recorrer todas las páginas

Cada respuesta trae `siguiente_cursor`. Mientras no sea `null`, pedí la página siguiente con `?cursor=`. Las páginas no repiten filas.

=== "Node.js"

    ```javascript
    async function traerTodo(recurso) {
      const filas = []
      let cursor = null
      do {
        const url = new URL(`${process.env.BASE}/v1/${recurso}`)
        url.searchParams.set('limite', '100')
        if (cursor) url.searchParams.set('cursor', cursor)
        const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CLAVE_API}` } })
        if (!r.ok) throw new Error(`${r.status} ${(await r.json()).error?.codigo}`)
        const { datos, siguiente_cursor } = await r.json()
        filas.push(...datos)
        cursor = siguiente_cursor
      } while (cursor)
      return filas
    }
    ```

=== "Python"

    ```python
    import os, requests

    def traer_todo(recurso):
        filas, cursor = [], None
        while True:
            params = {"limite": 100, **({"cursor": cursor} if cursor else {})}
            r = requests.get(f"{os.environ['BASE']}/v1/{recurso}", params=params,
                             headers={"Authorization": f"Bearer {os.environ['CLAVE_API']}"})
            r.raise_for_status()
            cuerpo = r.json()
            filas += cuerpo["datos"]
            cursor = cuerpo["siguiente_cursor"]
            if not cursor:
                return filas
    ```

## 4. Mantenerte al día (sincronización incremental)

No vuelvas a bajar todo cada vez. Guardá **el instante en que empezó** tu última sincronización y la próxima vez pedí solo lo que cambió:

```bash
curl -s "$BASE/v1/stock?actualizado_desde=2027-03-01T00:00:00-03:00" \
  -H "Authorization: Bearer $CLAVE_API"
```

- Guardá el instante **del inicio** de la corrida, no el del final: así no perdés lo que cambió mientras corría.
- `actualizado_desde` es **inclusive**, así que una fila puede llegarte dos veces: guardá por `id` (o `producto_id` + `deposito_id` en stock) con *upsert*, no con *insert*.
- La fecha lleva zona horaria. Si la zona es un offset con `+` (por ejemplo `+03:00`), codificalo como `%2B03:00` en la URL.
- En precios, un cambio solo de una escala (`x5`, `x10`, `x50`) también cuenta como cambio del producto.

## 5. Límites y errores

| Situación | Qué hacer |
|---|---|
| `429 limite_excedido` | Esperá los segundos de la cabecera `Retry-After` y reintentá. El límite es de **60 solicitudes por minuto por clave**. |
| `401` (`token_ausente`, `token_invalido`, `clave_vencida`, `clave_revocada`) | No reintentes: revisá la clave. Si venció o se revocó, pedí una nueva a un Administrador. |
| `403 alcance_insuficiente` | La clave no tiene el alcance de ese recurso. Un Administrador puede crear otra con el alcance correcto. |
| `400` | Revisá el parámetro (`cursor_invalido`, `parametro_invalido`). |
| `5xx` o corte de red | Reintentá con espera creciente (1 s, 2 s, 4 s…) y un máximo de intentos. |

Con 100 filas por página y 60 llamadas por minuto podés traer unas 6.000 filas por minuto por clave.

### Cambiar la clave sin cortar el servicio

Al **rotar** una clave, la anterior sigue funcionando **24 horas**. En ese margen cambiás la clave en tu sistema y recién después dejás que venza la vieja. Si sospechás que alguien más la tiene, **revocala**: deja de funcionar en la llamada siguiente.

## 6. Recibir avisos (webhooks)

En lugar de consultar cada tanto, podés pedir que la plataforma te **avise** cuando algo cambia. En **Administración → API → Suscripciones** cargás la URL de tu sistema (`https`, pública) y elegís los eventos:

| Evento | Cuándo |
|---|---|
| `stock.actualizado` | Cambió el stock de un producto |
| `precio.actualizado` | Cambió el precio de lista o de una escala |
| `venta.registrada` | Una factura pasó a confirmada |

Al crear la suscripción se muestra **una sola vez** el *secreto de firma*. Guardalo: lo usás para comprobar que el aviso viene de la plataforma y no de un tercero.

La plataforma hace un `POST` a tu URL con el cuerpo del evento y dos cabeceras: `X-Evento-Id` y `X-Firma` (`t=<segundos>,v1=<firma>`). La firma es el **HMAC-SHA256 en hexadecimal** de `"<t>.<cuerpo>"`, con el secreto como clave.

### Verificar la firma

Calculá la firma con el **cuerpo exacto que recibiste** (antes de convertirlo a objeto), compará en tiempo constante y rechazá avisos viejos.

=== "Node.js (Express)"

    ```javascript
    import crypto from 'node:crypto'
    import express from 'express'

    const SECRETO = process.env.SECRETO_FIRMA
    const TOLERANCIA_SEGUNDOS = 300

    const app = express()
    // El cuerpo tiene que llegar SIN parsear: la firma se calcula sobre los bytes recibidos.
    app.post('/avisos', express.raw({ type: 'application/json' }), (req, res) => {
      const partes = Object.fromEntries((req.get('X-Firma') ?? '').split(',').map((p) => p.split('=')))
      const t = Number(partes.t)
      const esperada = crypto.createHmac('sha256', SECRETO).update(`${t}.${req.body.toString('utf8')}`).digest('hex')

      const valida =
        partes.v1?.length === esperada.length &&
        crypto.timingSafeEqual(Buffer.from(partes.v1), Buffer.from(esperada))
      const reciente = Math.abs(Date.now() / 1000 - t) <= TOLERANCIA_SEGUNDOS
      if (!valida || !reciente) return res.sendStatus(401)

      const evento = JSON.parse(req.body.toString('utf8'))
      // Encolá el trabajo y respondé enseguida. Ignorá los `evento.id` que ya procesaste.
      res.sendStatus(204)
    })
    ```

=== "Python (Flask)"

    ```python
    import hashlib, hmac, os, time
    from flask import Flask, request

    SECRETO = os.environ["SECRETO_FIRMA"].encode()
    TOLERANCIA_SEGUNDOS = 300
    app = Flask(__name__)

    @app.post("/avisos")
    def avisos():
        partes = dict(p.split("=", 1) for p in request.headers.get("X-Firma", "").split(","))
        cuerpo = request.get_data()  # bytes sin tocar
        t = int(partes.get("t", "0"))
        esperada = hmac.new(SECRETO, f"{t}.".encode() + cuerpo, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(partes.get("v1", ""), esperada) or abs(time.time() - t) > TOLERANCIA_SEGUNDOS:
            return "", 401
        evento = request.get_json()
        # Encolá el trabajo y respondé enseguida. Ignorá los evento["id"] que ya procesaste.
        return "", 204
    ```

### Cómo se comportan los avisos

- **Respondé `2xx` en menos de 10 segundos.** Hacé el trabajo pesado después, en una cola.
- Si respondés otra cosa o no contestás, la plataforma **reintenta hasta 5 veces**, esperando 1, 2, 4 y 8 minutos entre intentos. Después de eso el aviso queda como *agotado* y lo ves en **Entregas recientes** con su último error. Si tu sistema estuvo caído más tiempo, ponete al día con una consulta incremental (sección 4).
- Un aviso se entrega **a lo sumo una vez por suscripción y evento**, pero por los reintentos tu sistema puede recibir el mismo `id` más de una vez: tratalo como idempotente.
- No se garantiza el orden entre eventos distintos. Si importa, usá `ocurrido_en`.
- La URL tiene que ser `https` y pública. No se siguen redirecciones y no se aceptan direcciones internas ni con credenciales.
- Podés pausar una suscripción sin perder su secreto, y eliminarla cuando ya no la uses.

## 7. Buenas prácticas

- **Ignorá los campos que no conozcas.** Podemos agregar campos sin cambiar de versión; lo que sí avisamos con tiempo (al menos 6 meses, con las cabeceras `Deprecation` y `Sunset`) es retirar o cambiar algo existente.
- Usá **una clave por sistema**, con los alcances justos. Si un sistema se compromete, revocás solo esa.
- Guardá la clave y el secreto de firma en un gestor de secretos o variables de entorno, nunca en el repositorio.
- Revisá **Llamadas recientes** y **Entregas recientes** en el panel para ver qué recibió y qué rechazó la API.
- Importá el [contrato OpenAPI](referencia.md) en Postman o Insomnia, o generá un cliente con tu herramienta favorita: se sirve sin clave en `<URL base>/v1/openapi.json`.
