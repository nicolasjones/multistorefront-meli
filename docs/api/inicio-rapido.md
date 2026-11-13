---
owner: tecnico
sources: []
---

# Empezar con la API

Esta guía te lleva de cero a una integración que **trae el catálogo, se mantiene al día y recibe avisos**. Para el detalle de cada campo y de cada error, mirá la [referencia](referencia.md).

La API es de **solo lectura**: consulta catálogo, stock, precios y ventas de **tu organización**. La organización sale siempre de la clave, no se puede cambiar por parámetro.

## 1. Conseguí una clave

1. En el panel: **Administración → API → Crear clave**. Solo la ve y la crea un Administrador.
2. Elegí los **alcances** que necesita tu integración (`productos`, `stock`, `precios`, `ventas`). Dale a cada sistema solo lo que necesita.
3. Copiá la clave **en ese momento**: se muestra una sola vez. Tiene la forma `msf_<prefijo>_<secreto>`. Si la perdés, **rotala** y usá la nueva: la anterior sigue funcionando hasta 24 horas. Si sospechás que alguien más la tiene, en cambio, **revocala**: deja de funcionar en la llamada siguiente.

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

Si tu servidor valida el JWT en el gateway, esa llamada responde `401` antes de llegar a la API. En ese caso mandá la clave anónima de Supabase (te la da quien administra la plataforma) en `apikey` y en `Authorization: Bearer <anónima>`, y tu clave de API en `X-API-Key: msf_…`. La clave anónima solo sirve para pasar el gateway: no autoriza ningún dato.

Si no, el error trae un `codigo` estable (por ejemplo `token_invalido` o `alcance_insuficiente`): decidí por el código, no por el mensaje.

## 3. Recorrer todas las páginas

Cada respuesta trae `siguiente_cursor`. Mientras no sea `null`, pedí la página siguiente con `?cursor=`. Las páginas no repiten filas, salvo que una fila cambie mientras recorrés: pasa al final del orden y puede llegarte otra vez. Por eso conviene guardar con *upsert* (ver el punto siguiente).

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

No vuelvas a bajar todo cada vez. Guardá el instante de tu última sincronización y la próxima vez pedí solo lo que cambió:

```bash
curl -s "$BASE/v1/stock?actualizado_desde=2027-03-01T00:00:00-03:00" \
  -H "Authorization: Bearer $CLAVE_API"
```

- **Dejá un solape.** Guardá el instante del **inicio** de la corrida y restale unos minutos (por ejemplo 5) la próxima vez. Así no perdés lo que cambió mientras corría, ni lo que se confirmó con unos segundos de atraso, ni el desfase entre tu reloj y el del servidor.
- `actualizado_desde` es **inclusive** y, con el solape, una fila puede llegarte más de una vez: guardá con *upsert* por su clave, no con *insert*. La clave es `id` en productos y ventas, `producto_id` en precios y `producto_id` + `deposito_id` en stock.
- La fecha lleva zona horaria. Si la zona es un offset con `+` (por ejemplo `+03:00`), codificalo como `%2B03:00` en la URL.
- En precios, un cambio solo de una escala (`x5`, `x10`, `x50`) también cuenta como cambio del producto.
- **En ventas, la consulta incremental tiene un límite:** `actualizado_desde` filtra por la fecha de **confirmación**. Trae las facturas confirmadas nuevas, pero **no** te avisa si una factura que ya tenés pasó a cobrado o a deuda, ni si se anuló (las anuladas simplemente dejan de aparecer). Para mantener los estados al día, volvé a leer cada tanto una ventana reciente (por ejemplo los últimos 30 días).
- En stock, renombrar un producto o un depósito no cuenta como cambio de la fila. Además de la consulta incremental, hacé una **lectura completa cada tanto** (por ejemplo una vez por noche) para reconciliar.

## 5. Límites y errores

| Situación | Qué hacer |
|---|---|
| `429 limite_excedido` | Esperá los segundos de la cabecera `Retry-After` y reintentá. El límite es de **60 solicitudes por minuto por clave**. |
| `401` (`token_ausente`, `token_invalido`, `clave_vencida`, `clave_revocada`) | No reintentes: revisá la clave. Si venció, un Administrador puede **rotarla** para renovarla; si se revocó, necesitás una nueva. Pasados unos 90 días (valor por defecto) de vencida o revocada la clave se borra y la respuesta pasa a ser `token_invalido`. |
| `403 alcance_insuficiente` | La clave no tiene el alcance de ese recurso. Un Administrador puede crear otra con el alcance correcto. |
| `400` | Revisá el parámetro (`cursor_invalido`, `parametro_invalido`). |
| `404 no_encontrado` | La ruta no existe: revisá la URL base y el recurso. |
| `405 metodo_no_soportado` | La API es de solo lectura: usá `GET`. |
| `5xx` o corte de red | Reintentá con espera creciente (1 s, 2 s, 4 s…) y un máximo de intentos. |

Con 100 filas por página y 60 llamadas por minuto podés traer, como máximo, unas 6.000 filas por minuto por clave.

### Cambiar la clave sin cortar el servicio

Al **rotar** una clave, la anterior sigue funcionando **hasta 24 horas** (menos, si ya iba a vencer antes). En ese margen cambiás la clave en tu sistema y recién después dejás que venza la vieja. La clave nueva conserva el nombre, los alcances, el límite y el vencimiento de la original (si la original ya había vencido, la nueva no vence). Rotar de nuevo la misma clave **no** renueva las 24 horas, y una clave revocada no se puede rotar.

## 6. Recibir avisos (webhooks)

En lugar de consultar cada tanto, podés pedir que la plataforma te **avise** cuando algo cambia. En **Administración → API → Suscripciones a avisos → Nueva suscripción** cargás la URL de tu sistema (`https`, pública) y elegís los eventos:

| Evento | Cuándo |
|---|---|
| `stock.actualizado` | Cambió el stock de un producto por un movimiento, una reserva o una liberación. **No** se emite por movimientos de variantes ni por traslados entre depósitos. |
| `precio.actualizado` | Cambió el precio de lista o de una escala |
| `venta.registrada` | Una factura pasó a confirmada |

Los avisos **no reemplazan** a la consulta: si tu sistema estuvo caído, o querés ver también lo que el aviso de stock no cubre, ponete al día con una consulta incremental (punto 4).

Al crear la suscripción se muestra **una sola vez** el *secreto de firma*. Guardalo: lo usás para comprobar que el aviso viene de la plataforma y no de un tercero.

La plataforma hace un `POST` a tu URL con el cuerpo del evento y dos cabeceras: `X-Evento-Id` y `X-Firma` (`t=<segundos>,v1=<firma>`). La firma es el **HMAC-SHA256 en hexadecimal** de `"<t>.<cuerpo>"`, con el secreto como clave. Mientras se rota un secreto (ver abajo), la cabecera trae **dos** `v1`, `t=<segundos>,v1=<nueva>,v1=<anterior>`: el aviso es válido si alguna coincide.

### Verificar la firma

Calculá la firma con el **cuerpo exacto que recibiste** (antes de convertirlo a objeto), compará en tiempo constante y rechazá avisos viejos. Una cabecera ausente o malformada tiene que dar `401`, nunca un error del servidor.

=== "Node.js (Express)"

    ```javascript
    import crypto from 'node:crypto'
    import express from 'express'

    const SECRETO = process.env.SECRETO_FIRMA
    const TOLERANCIA_SEGUNDOS = 300

    function firmaValida(cabecera, cuerpo, secreto = SECRETO, ahora = Date.now() / 1000) {
      // Durante la rotación de un secreto el aviso trae dos `v1`: alcanza con que una coincida.
      // Se parte en el PRIMER `=`: una parte sin `=` queda como clave sin valor y no rompe nada.
      const partes = String(cabecera ?? '').split(',').map((p) => {
        const i = p.indexOf('=')
        return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]
      })
      const t = Number(partes.find(([clave]) => clave === 't')?.[1])
      const recibidas = partes.filter(([clave]) => clave === 'v1').map(([, valor]) => valor)
      if (!Number.isFinite(t) || recibidas.length === 0) return false
      const esperada = Buffer.from(crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex'), 'utf8')
      const coincide = recibidas.some((v1) => {
        const recibida = Buffer.from(String(v1), 'utf8')
        return recibida.length === esperada.length && crypto.timingSafeEqual(recibida, esperada)
      })
      return coincide && Math.abs(ahora - t) <= TOLERANCIA_SEGUNDOS
    }

    const app = express()
    // El cuerpo tiene que llegar SIN parsear: la firma se calcula sobre los bytes recibidos.
    app.post('/avisos', express.raw({ type: 'application/json' }), (req, res) => {
      const cuerpo = req.body.toString('utf8')
      if (!firmaValida(req.get('X-Firma'), cuerpo)) return res.sendStatus(401)

      const evento = JSON.parse(cuerpo)
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

    def firma_valida(cabecera, cuerpo, secreto=SECRETO, ahora=None):
        # Durante la rotación de un secreto el aviso trae dos `v1`: alcanza con que una coincida.
        try:
            # `partition` siempre devuelve (clave, "=", valor): una parte sin `=` queda como clave sin valor y no rompe nada.
            partes = [p.partition("=")[::2] for p in (cabecera or "").split(",")]
            t = int(next(valor for clave, valor in partes if clave == "t"))
        except (ValueError, StopIteration):
            return False
        recibidas = [valor.encode() for clave, valor in partes if clave == "v1" and valor]
        esperada = hmac.new(secreto, f"{t}.".encode() + cuerpo, hashlib.sha256).hexdigest().encode()
        coincide = any(hmac.compare_digest(recibida, esperada) for recibida in recibidas)
        return coincide and abs((ahora or time.time()) - t) <= TOLERANCIA_SEGUNDOS

    app = Flask(__name__)

    @app.post("/avisos")
    def avisos():
        cuerpo = request.get_data()  # bytes sin tocar
        if not firma_valida(request.headers.get("X-Firma"), cuerpo):
            return "", 401
        evento = request.get_json()
        # Encolá el trabajo y respondé enseguida. Ignorá los evento["id"] que ya procesaste.
        return "", 204
    ```

### Cómo se comportan los avisos

- **Respondé `2xx` en menos de 10 segundos.** Hacé el trabajo pesado después, en una cola.
- Si respondés otra cosa o no contestás, la plataforma reintenta: son **5 intentos en total** (el original y 4 reintentos), con una espera mínima de 1, 2, 4 y 8 minutos entre ellos. Después el aviso queda como *agotado* y lo ves en **Entregas recientes** con su último error. Un aviso agotado no se reintenta solo: un Administrador puede devolverlo a la cola con **Reintentar** (en esa misma pantalla), y lo que ya no se reintenta se recupera con una consulta incremental.
- La entrega es **al menos una vez**: por los reintentos, tu sistema puede recibir el mismo `id` más de una vez. Tratalo como idempotente.
- No se garantiza el orden entre eventos distintos. Si importa, usá `ocurrido_en`.
- La URL tiene que ser `https` y pública. No se siguen redirecciones y no se aceptan direcciones internas ni con credenciales.
- El secreto de firma **no se puede volver a ver**, pero se puede **rotar**: en Administración → API → Suscripciones a avisos, **Rotar secreto** muestra el secreto nuevo una sola vez y el anterior **sigue valiendo 24 horas**. Durante ese tiempo cada aviso lleva las dos firmas (ver arriba), así cambiás el secreto en tu sistema sin cortar el servicio. Si rotás otra vez antes de que termine la gracia, el anterior deja de valer ya.
- Podés **pausar** una suscripción sin perder su secreto, y eliminarla cuando ya no la uses. Mientras está pausada **no recibe los eventos que ocurren**: los avisos que ya estaban pendientes se entregan al reanudar, pero los demás no se recuperan, así que al reanudar ponete al día con una consulta incremental.

## 7. Buenas prácticas

- **Ignorá los campos que no conozcas.** Podemos agregar campos sin cambiar de versión; lo que sí avisamos con tiempo (al menos 6 meses, con las cabeceras `Deprecation` y `Sunset`) es retirar o cambiar algo existente.
- Usá **una clave por sistema**, con los alcances justos. Si un sistema se compromete, revocás solo esa.
- Guardá la clave y el secreto de firma en un gestor de secretos o variables de entorno, nunca en el repositorio.
- Revisá **Llamadas recientes** y **Entregas recientes** en el panel para ver qué recibió y qué rechazó la API.
- El contrato OpenAPI se sirve **sin clave** en `<URL base>/v1/openapi.json`: importalo en Postman o Insomnia, o generá un cliente con tu herramienta favorita. La [referencia](referencia.md) es la misma información en formato legible.
