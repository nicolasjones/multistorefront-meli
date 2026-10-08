# Contrato: conectar una organización a un proveedor OAuth

Interfaz que Refine (u otro cliente autenticado con sesión de Supabase Auth)
usa para que una persona de una organización conecte un proveedor externo.
Todo pasa por RLS + funciones `SECURITY DEFINER` de `data-model.md` — nunca
por un `insert`/`update` directo sobre `conexiones_oauth`.

## 1. Ver qué proveedores están disponibles

`select clave, nombre from integraciones_oauth where habilitada = true`

- **Quién**: cualquier persona autenticada con contexto de organización activo.

## 2. Iniciar (o reanudar) una conexión

`public.iniciar_conexion_oauth(organizacion_id, integracion_id) -> conexiones_oauth`

- **Quién**: administrador de esa organización o superadmin.
- **Qué hace**: crea la fila si no existe (`estado = 'pendiente'`) o devuelve
  la existente sin duplicar (`unique (organizacion_id, integracion_id)`).
- **Devuelve**: la fila completa. El cliente usa `id` para pedir la sesión
  del paso 2.1 — **no** es el `connectionId` de Nango (research.md R8: con
  Connect Session Token, Nango asigna su propio `connection_id`; no se puede
  pre-fijar igual al `id` de esta fila).

### 2.1 Pedir un Connect Session Token

El SDK de frontend de Nango (`@nangohq/frontend` ≥ 0.71) ya no acepta
`host` a secas para self-host: exige además un **Connect Session Token** de
corta duración (30 min), generado server-to-server con `NANGO_SECRET_KEY_*`
— un secreto que nunca debe llegar al navegador. Ese token se pide a la Edge
Function `iniciar-sesion-oauth`:

```ts
const { data } = await supabaseClient.functions.invoke('iniciar-sesion-oauth', {
  body: { conexion_id: conexionId },
});
```

- **Quién**: la misma persona que ya pasó el paso 2 (la función reautoriza
  con el JWT de quien llama contra RLS de `conexiones_oauth` — no reimplementa
  el chequeo de permiso).
- **Qué hace la función**: si la conexión todavía no tiene
  `nango_connection_id` (primera vez), llama a `POST {NANGO_URL}/connect/sessions`;
  si ya tiene uno (reautorizar una `con_error`), llama en cambio a
  `POST {NANGO_URL}/connect/sessions/reconnect` con ese mismo `connection_id`
  — así Nango actualiza la credencial de la conexión existente en vez de
  crear una nueva. Ambas variantes usan `Authorization: Bearer {NANGO_SECRET_KEY}`
  y devuelven `{ token, es_reconexion }` — nunca el secreto en sí.

### 2.2 Abrir el popup de consentimiento

```ts
import Nango from '@nangohq/frontend';

const nango = new Nango({ host: NANGO_PUBLIC_SERVER_URL, connectSessionToken: token });
const result = es_reconexion ? await nango.reconnect(clave) : await nango.auth(clave);
```

(El SDK del frontend habla directo con `nango-server`; ni el navegador ni
Refine ven ningún secreto de Nango ni del proveedor en este paso — el
`connectSessionToken` es de corta duración y de un solo uso conceptual, no
un secreto de larga vida. Nota: con Connect Session Token, ni `nango.auth`
ni `nango.reconnect` reciben un `connectionId` — Nango ya lo resolvió al
crear la sesión, y lo devuelve en `result.connectionId` al resolver con
éxito.)

- **Falla si**: la integración no está `habilitada`, o quien llama no es
  administrador de esa organización ni superadmin.

## 3. Confirmar el éxito

`public.confirmar_conexion_oauth(conexion_id, nango_connection_id)`

- **Quién**: administrador de esa organización o superadmin; solo sobre una
  fila de su propia organización (verificado dentro de la función, no
  confiado al cliente).
- **Cuándo llamarla**: únicamente cuando `nango.auth(...)`/`nango.reconnect(...)`
  resolvió con éxito (no ante error ni cancelación del usuario en el popup).
  `nango_connection_id` es `result.connectionId` — el valor real que Nango
  asignó, no el `conexion_id` del paso 2.
- **Qué hace**: guarda `nango_connection_id`, pasa el estado a `activa` y
  registra el evento correspondiente (`creada` la primera vez, `reautorizada`
  si ya existía). **Riesgo aceptado** (ver `data-model.md`): no valida contra
  la API de Nango que ese valor corresponda a una autorización real completada.

## 4. Ver el estado de las conexiones de mi organización

`select c.id, c.estado, c.updated_at, i.clave, i.nombre from conexiones_oauth c join integraciones_oauth i on i.id = c.integracion_id where c.organizacion_id = :organizacion_id`

- **Quién**: administrador de esa organización o superadmin (RLS lo aplica
  igual aunque se omita el `where` explícito).
- **Estados posibles**: `pendiente` (nunca se confirmó), `activa`,
  `con_error` (el proveedor la revocó o el refresh falló — ver
  `obtener-token-oauth.md`).

## 5. Reautorizar una conexión con error

Repetir los pasos 2 y 3 con el mismo `organizacion_id`/`integracion_id`: el
paso 2 devuelve la fila existente (mismo `id`, y ya con su
`nango_connection_id` seteado desde la vez anterior). Eso hace que el paso
2.1 pida una sesión de `/reconnect` en vez de una de creación, y el paso 2.2
llame `nango.reconnect(clave)` en vez de `nango.auth(clave)` — Nango
actualiza la credencial de ese mismo `connection_id` existente, sin crear una
fila ni un `connection_id` nuevos.

## Fuera de este contrato (a propósito)

- Cancelar o eliminar una conexión (dejar de ofrecer un proveedor ya
  conectado) — no está en el alcance de la spec; se agrega cuando exista un
  caso de uso real.
- Cualquier llamada directa del navegador a la API HTTP de Nango — el
  navegador solo usa `@nangohq/frontend` contra el flujo de consentimiento,
  nunca `Authorization: Bearer` con el secreto de Nango.
