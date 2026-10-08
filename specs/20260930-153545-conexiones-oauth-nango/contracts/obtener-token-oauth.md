# Contrato: obtener un access token vigente para un backend/worker

Este es el contrato que consume un producto derivado (backend o worker,
**nunca el navegador**) para operar la API de un proveedor externo (p. ej.
Google Sheets) en nombre de una organización, sin implementar refresh propio
ni tocar un secreto de Nango o del proveedor fuera de su propio entorno.

No requiere leer el código de esta spec: alcanza con este documento.

## Paso 1 — Resolver el `conexion_id` y el `nango_connection_id` (Supabase, sin secretos)

**Importante (confirmado en vivo, research.md R8): son dos valores distintos.**
Con Connect Session Token, Nango asigna su propio `connection_id` — no se
puede pre-fijar igual al `id` de `conexiones_oauth`. El Paso 2 de abajo
necesita el `nango_connection_id`; el Paso 3 (`marcar_conexion_oauth_invalida`)
sigue necesitando el `id` de `conexiones_oauth`. No son intercambiables.

```sql
select c.id, c.nango_connection_id, c.estado
from conexiones_oauth c
join integraciones_oauth i on i.id = c.integracion_id
where c.organizacion_id = :organizacion_id
  and i.clave = :clave -- p. ej. 'google'
```

- Se ejecuta con cualquier credencial que ya use el backend/worker contra
  Supabase (RLS aplica igual; `service_role` la bypassea si el proceso corre
  fuera de una sesión de usuario, como cualquier worker de este template).
- Si no hay fila, o `estado <> 'activa'`, el backend NO debe pedir un token:
  debe tratarlo como "conexión no disponible" (mostrar/loguear ese estado, no
  reintentar contra Nango).

### Variante: un flow de Kestra (JDBC directo, sin PostgREST)

Un flow que corre como `kestra_orquestacion` (mismo patrón que
`plantilla-generico.yml`/`plantilla-dedicado.yml`, spec 013) no tiene `select`
directo sobre `conexiones_oauth`/`integraciones_oauth` — igual que no lo tiene
sobre `conexiones`/`servidores_organizacion`. Para ese caso, el Paso 1 es:

```sql
select private.datos_despacho_conexion_oauth(:organizacion_id, :clave);
```

Devuelve el `nango_connection_id` real (no el `id` de `conexiones_oauth`) de
la conexión activa, o falla con `P0002` si la organización no tiene una
conexión activa a esa integración (el flow trata ese error igual que
"conexión no disponible": no pasa a pedir un token). Un flow de Kestra no
necesita el `id` de `conexiones_oauth` — no reporta errores de credencial él
mismo, eso lo hace el worker en el Paso 3. Ningún token ni dato de Nango sale
de esta función — eso lo sigue haciendo el worker en el Paso 2, con su propio
`NANGO_SECRET_KEY_*`, nunca el flow.

## Paso 2 — Pedir el token a Nango (fuera de Supabase, servidor a servidor)

```
GET {NANGO_SERVER_URL}/connection/{nango_connection_id}?provider_config_key={clave}&refresh_token=true
Authorization: Bearer {NANGO_SECRET_KEY}
```

**Confirmado en vivo (T016)**: la respuesta 200 real trae, además de
`credentials.access_token`, `connection_id` (coincide con el
`nango_connection_id` pedido), `provider_config_key`, `provider`, `end_user`,
`metadata`, `connection_config`, y `credentials.type`/`refresh_token`/
`expires_at`/`raw` (con los campos crudos del proveedor, incluido `scope`) —
todo consistente con lo ya documentado abajo, sin campos inesperados.

- `{NANGO_SERVER_URL}`: URL del propio `nango-server` que opera el producto
  derivado (mismo valor configurado en `infra/nango/.env`).
- `{NANGO_SECRET_KEY}`: secreto de plataforma (uno por entorno —
  `NANGO_SECRET_KEY_DEV`/`NANGO_SECRET_KEY_PROD` en el self-host, o la llave
  "Default - Full access" del dashboard de Nango). Vive únicamente en el
  entorno del backend/worker, igual que la SSH key de Kestra
  (`contracts/ejecucion-segura.md`, spec 014) — nunca en Supabase, nunca en el
  navegador, nunca en Git.
- **Respuesta 200**: JSON con `credentials.access_token` ya vigente — Nango
  lo refresca automáticamente si había vencido. El backend lo usa
  inmediatamente y lo descarta al terminar el intento; no lo persiste.
- **Respuesta de error** (credencial revocada o refresh fallido): el backend
  pasa al paso 3. Formas confirmadas en vivo (T016/T020):
  - `connection_id` inexistente: `{"error":{"code":"not_found","message":"..."}}`,
    HTTP 404.
  - Credencial revocada por el usuario en el proveedor (T020, revocación
    real contra Google): `{"error":{"code":"invalid_credentials","message":"The
    external API returned an error when trying to refresh the access
    token. Please try again later.","payload":{"connection":{...,"errors":[{"type":"auth","log_id":"..."}]}}}}`,
    HTTP 400. **Importante**: Nango no revalida contra el proveedor en cada
    pedido — mientras el `access_token` cacheado no llegó a su
    `expires_at` nominal, `GET /connection` devuelve ese token igual,
    aunque el proveedor ya lo haya invalidado (confirmado: Google devolvió
    401 al usar ese mismo token directo, mientras Nango lo seguía dando
    por bueno). El error real solo aparece cuando Nango intenta refrescar
    de verdad — al pasar el `expires_at` cacheado, o forzando el botón
    "Refresh" del dashboard de Nango. Un backend que solo llama
    `GET /connection` puede tardar hasta la duración del access token
    (normalmente 1h) en enterarse de una revocación.
  - Todo error de Nango en este endpoint sigue la forma
    `{error:{code,message}}` (con `payload` adicional en algunos casos).

### Alternativa: proxy de Nango (sin manejar el token en absoluto)

Para llamadas simples a la API del proveedor, Nango también permite invocarla
sin recibir nunca el `access_token`:

```
{METHOD} {NANGO_SERVER_URL}/proxy/{ruta-de-la-api-externa}
Authorization: Bearer {NANGO_SECRET_KEY}
Connection-Id: {nango_connection_id}
Provider-Config-Key: {clave}
```

Usar esta variante cuando el backend no necesita un cliente SDK propio del
proveedor (por ejemplo, llamadas REST puntuales). El worker de Google Sheets
que use la librería oficial `googleapis` normalmente preferirá el Paso 2
(necesita el `access_token` para inicializar su propio cliente OAuth2).

## Paso 3 — Reportar una conexión inválida

Si Nango responde que la credencial no pudo refrescarse (revocada o
inválida):

```sql
select marcar_conexion_oauth_invalida(:conexion_id, :motivo_sanitizado);
```

`:conexion_id` acá es el `id` de `conexiones_oauth` del Paso 1 (no el
`nango_connection_id`) — es la fila de Supabase la que cambia de estado, no
nada del lado de Nango.

- `:motivo_sanitizado` es un texto corto y sin datos sensibles (nunca el
  token, nunca la respuesta cruda de Nango o del proveedor) — mismo criterio
  de saneamiento que `contracts/ejecucion-segura.md` (spec 014).
- Después de esta llamada, `conexiones_oauth.estado` pasa a `con_error` y
  queda visible para quien administra la organización (Historia 3 de
  `spec.md`), que puede reautorizar repitiendo `contracts/conectar-oauth.md`.

## Errores esperados y qué hacer

| Situación | Cómo se manifiesta | Qué hace el backend/worker |
|---|---|---|
| La organización nunca conectó ese proveedor | Paso 1 no devuelve fila | Tratar como "no conectado"; no llamar a Nango. |
| Conexión `pendiente` (nunca confirmada) | Paso 1 devuelve `estado = 'pendiente'` | Tratar como "no conectado". |
| Token revocado por el usuario en Google | Paso 2 responde error de refresh | Ejecutar Paso 3 y devolver el error al llamador de negocio. |
| `nango-server` inaccesible | Paso 2 falla por red/timeout | Falla técnica transitoria: reintentar con backoff, igual que cualquier dependencia externa; NO es un `marcar_conexion_oauth_invalida` (esa función es solo para credenciales inválidas, no para caídas de infraestructura). |

## Fuera de este contrato (a propósito)

- Este documento no cubre cómo un backend se autentica contra Supabase (eso
  ya lo define el mecanismo de despacho de cada producto — Kestra, cola
  propia, etc.); solo cubre qué hacer una vez que el backend ya sabe qué
  organización está operando.
- No define el formato de la tabla de dominio que consuma el resultado (por
  ejemplo, filas de una hoja de cálculo) — eso es enteramente del producto
  derivado.
