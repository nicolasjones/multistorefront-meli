# API pública y avisos hacia otros sistemas (F-API-01)

Guía de la API de solo lectura de la organización, de las claves que la
autentican y de los avisos (webhooks) firmados que la plataforma entrega a
sistemas externos. La pantalla **API** del panel (Administración → API, ruta
`/api`) administra claves, suscripciones, entregas y llamadas recientes.

> **Para quien integra la API:** [Empezar con la API](api/inicio-rapido.md) (guía paso a paso) y
> [Referencia de la API](api/referencia.md) (generada del contrato OpenAPI: no se edita a mano, se regenera con
> `pnpm openapi:escribir` y `pnpm test:openapi` falla si queda desactualizada).

## Claves de API

- Una clave pertenece a **una organización** y la organización se deriva
  siempre de la clave: ningún parámetro de la URL puede cambiarla.
- El valor (`msf_<prefijo>_<secreto>`) se muestra **una sola vez** al crearla o
  rotarla. En la base solo queda el hash y el prefijo.
- Alcances: `productos`, `stock`, `precios`, `ventas`. Una clave puede tener uno
  o varios; si falta el alcance de la ruta responde `403 alcance_insuficiente`.
- Rotar conserva la clave anterior **24 h** (gracia) para cambiar el cliente sin
  cortar el servicio; la gracia se otorga **una sola vez** (rotar de nuevo la misma clave no renueva las 24 h), nunca alarga una clave que vencía antes, y la
  clave nueva hereda el vencimiento de la original (si la original ya había
  vencido, la nueva nace sin vencimiento). Revocar la deja inutilizable en la llamada siguiente.
- La clave se administra con `crear_clave_api`, `rotar_clave_api` y
  `revocar_clave_api` (solo Administrador de la organización). La lectura del
  panel nunca incluye el hash.

### Cómo cruza el gateway de Supabase

La clave de API **no es un JWT de Supabase**, así que el gateway no puede
validarla como tal. La Edge Function `api-v1` se despliega con
`verify_jwt = false` (`supabase/config.toml`), y el handler autentica la clave. **Verificado en dev (2026-11-12):** el camino 1 (`Authorization: Bearer msf_…` directo) funciona; el camino 2 queda para entornos cuyo gateway valide el JWT.
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
`actualizado_desde` (ISO-8601 con zona, inclusive; si la zona es un offset con `+`, como `+03:00`, hay que codificarlo como `%2B03:00` en la URL: un `+` sin codificar llega como espacio y responde `400 parametro_invalido`). Un cursor inválido responde
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
| `stock.actualizado` | cada movimiento de stock de un producto y cada reserva o liberación; **no** los movimientos de variantes ni los traslados entre depósitos (para esos, barrido periódico de `/v1/stock?actualizado_desde=`) |
| `precio.actualizado` | cambio real de precio de lista o de una escala, o de moneda |
| `venta.registrada` | factura que pasa a `confirmada` |

El cuerpo es `{ id, tipo, organizacion_id, ocurrido_en, datos }`. Hay **una entrega por
suscripción y evento** (`unique (evento_id, suscripcion_id)`), pero el envío es **al menos
una vez**: por reintentos o por un reclamo vencido el destino puede recibir el mismo `id`
más de una vez y tiene que ignorar los repetidos.

### Firma

```http
X-Evento-Id: <id del evento>
X-Firma: t=<epoch>,v1=<HMAC-SHA256 hex de "<t>.<cuerpo>">
```

El secreto se muestra una sola vez al crear la suscripción, vive en Vault y
nunca llega al navegador. Para verificar: recalcular el HMAC con el cuerpo
recibido y el mismo `t`, y comparar en tiempo constante. Rechazar un `t` viejo
según la tolerancia del receptor.

El secreto **no se puede cambiar ni volver a ver**: no existe una RPC de rotación (seguimiento MSF-839). Para
rotarlo hoy: crear una suscripción nueva con la misma URL (se muestra su secreto), cambiarlo en el sistema receptor y
eliminar la anterior. Mientras convivan, el receptor recibe cada evento dos veces, con el mismo `X-Evento-Id` y firmas
distintas: tiene que ignorar el repetido.

### Reintentos

La base gobierna los reintentos: **5 intentos en total** (el original y 4 reintentos) con espera mínima
`60 s × 2^(intentos-1)` (1, 2, 4 y 8 minutos); al quinto la entrega queda `agotada` (o `completada` si
el destino respondió 2xx). Kestra no reintenta la llamada HTTP por su cuenta:
cada reclamo de la entrega es un intento. El flow `entregar-webhooks-api` corre
cada minuto y reparte hasta `API_WEBHOOKS_LOTE` eventos (total, no por tipo) y
entregas por corrida (por defecto 20: unas 20 entregas por minuto, global; una ráfaga mayor se encola, seguimiento
MSF-840). Una entrega `agotada` **no se reintenta sola**: el Administrador la devuelve a la cola con **Reintentar** en
Administración → API → Entregas recientes (`public.reintentar_entrega_api`: solo una entrega agotada de su organización,
con los 5 intentos de nuevo y el último error conservado; si la suscripción está pausada, espera a que se reanude). Lo que
el destino se perdió y ya no se reintenta se recupera con una consulta incremental. Una suscripción pausada conserva sus entregas pendientes y las recibe al reanudar, pero **no**
recibe los eventos que ocurren mientras está pausada.

### SSRF

Al guardar la suscripción y otra vez al entregar se exige `https`, sin
credenciales en la URL y sin hosts que resuelvan a loopback, rangos privados,
link-local o metadata. La entrega se conecta a la **IP ya resuelta y validada**
(no vuelve a resolver el host), así un DNS de TTL corto no puede cambiar a una
IP interna entre la validación y la conexión. No se siguen redirecciones. El
error guardado está saneado (sin secreto ni credenciales).

## Contrato OpenAPI y runtime de funciones

`api-v1` importa `openapi.json` como módulo (`import contrato from './openapi.json' with { type: 'json' }`) y no lo lee
con `Deno.readTextFile`: el runtime de Edge Functions empaqueta solo el código que se importa, así que un archivo leído en
tiempo de ejecución no existe y la función cae al arrancar (`500 WORKER_ERROR`, «path not found ... openapi.json»). El
CI no lo detecta (el handler se prueba con `node --test`), por eso tras desplegar hay que llamar a
`GET /api-v1/v1/openapi.json`: tiene que responder 200 sin clave.

## Paginación por cursor

El cursor es opaco (base64url de `(actualizado_en en µs)|id`). Cada lectura devuelve `siguiente_cursor` solo si quedan
filas; pasarlo en `?cursor=` trae la página siguiente, sin repetir filas. Hasta la migración
`20270227100000_api_decodificar_cursor_devuelve_fila` el decodificador no devolvía fila y la API servía siempre la primera
página; la regresión está cubierta en `supabase/tests/database/api_paginacion.test.sql`. Al verificar un despliegue,
recorrer `/v1/productos?limite=2` varias páginas y comprobar que no se repiten filas.

El cursor de `stock` (clave triple, 121 caracteres) salía con un salto de línea del `base64` de Postgres y su segunda página
daba `400 cursor_invalido`; la migración `20270227120000_api_cursor_sin_saltos_de_linea` lo corrige (el decodificador también
acepta los cursores viejos con salto). Al verificar, recorrer también `/v1/stock?limite=2`, `/v1/precios` y `/v1/ventas`.

## Auditoría y retención

Toda llamada, incluidas las rechazadas, queda en `public.api_llamadas` (método,
ruta, versión, estado HTTP, duración; nunca el token ni el cuerpo). Solo el
Administrador la lee. El flow `purgar-api-llamadas` borra lo anterior a
`API_AUDITORIA_RETENCION_DIAS` (90 por defecto) y pasa a 500 las reservas de
límite (estado 102) que quedaron colgadas más de 5 minutos porque la función murió
antes de completarlas.

Las llamadas **sin clave válida** (token inventado, ruta inexistente) se siguen
auditando, pero hasta **600 por minuto y por organización** (o sin organización):
el exceso no se guarda, para que una ráfaga de un tercero no llene la tabla. Las
respuestas llevan `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.

**Retención de eventos y entregas (MSF-836):** la misma purga diaria (`purgar-api-llamadas`, con
`API_AUDITORIA_RETENCION_DIAS`, 90 por defecto) borra también las claves revocadas o vencidas y los eventos de
`public.cola_eventos` **terminados** (`completada` o `agotada`) más viejos que la retención y sin ninguna entrega
`pendiente` o `reclamada`; sus entregas terminadas se van con ellos (de a 50 000 por corrida, para que el primer
barrido de un historial grande no sea una transacción enorme). No se deja de encolar eventos de organizaciones sin
suscripción: `cola_eventos` es una outbox genérica y otro consumidor futuro los necesita.

**Alertas (MSF-837):** el flow `monitoreo-api-entregas` corre cada 15 minutos, consulta `private.api_entregas_salud` y
avisa por correo a soporte (`SOPORTE_CORREO`, subflow `aviso-fallo-api`) si hay entregas agotadas en la última hora
(desde `umbral_agotadas`, 5 por defecto), entregas pendientes atrasadas más de `atraso_min` (30) minutos o eventos de la
API sin repartir hace más de ese tiempo. Si el chequeo mismo falla, también avisa; y la purga avisa si falla.

## Versionado

La versión va en la ruta (`/v1/`). Los cambios aditivos no rompen `v1`; uno
incompatible exige `/v2/`. Una ruta o campo en retiro responde `Deprecation` y
`Sunset` con al menos 6 meses de aviso. `pnpm test:openapi` verifica que
`openapi/api-v1.json` y `openapi/entregar-webhook.json` sean copia del contrato
que viaja con cada función, que todas las rutas estén documentadas y que un
cambio incompatible traiga `BREAKING:` en el commit o el PR.

## Operación y reversión

- **Después de desplegar** `api-v1` o `entregar-webhook`: llamar a `GET /api-v1/v1/openapi.json` y a una ruta con una
  clave inválida (tiene que dar `401` en JSON). Si responde `404 Function not found`, hay que recrear el stack del runtime
  de Edge (reiniciar solo el runtime no registra funciones nuevas).
- Variables de Kestra: `ENTREGAR_WEBHOOK_URL`, `SECRET_ENTREGAR_WEBHOOK_APIKEY`,
  `API_WEBHOOKS_LOTE` y `API_AUDITORIA_RETENCION_DIAS` (ver
  `infra/kestra/.env.example`).
- Migraciones: `20270224110201_api_claves`, `20270224110202_api_llamadas_y_limite`,
  `20270224110203_api_lectura`, `20270224110204_api_suscripciones_entregas` y
  `20270224110205_api_eventos_precio_venta`, `20270224110206_exportacion_total_excluye_api`,
  `20270227100000_api_decodificar_cursor_devuelve_fila`, `20270227120000_api_cursor_sin_saltos_de_linea`,
  `20270228100000_api_menores_revision_msf233` y `20270301100000_api_decisiones_abiertas_msf233` y `20270302100000_api_seguimientos_msf233`. Son aditivas; cada encabezado
  documenta el `drop` de sus objetos para revertir.
- Pruebas: `pnpm test:edge:api-v1`, `pnpm test:edge:entregar-webhook`,
  `pnpm test:kestra:webhooks`, `pnpm test:openapi` y los pgTAP
  `api_claves`, `api_llamadas`, `api_aislamiento`, `api_suscripciones_entregas`, `api_eventos`,
  `api_paginacion` y `api_decisiones_abiertas` (`pnpm test:db`).
- **Documentación para integradores (2026-11-12):** el contrato OpenAPI trae ejemplos de cada respuesta y de cada error,
  `curl` y `fetch` por operación y los tres avisos como `webhooks` (firma, reintentos y campos de `datos`);
  `scripts/openapi-a-markdown.mjs` genera de él `docs/api/referencia.md`, y `docs/api/inicio-rapido.md` es la guía
  escrita a mano (clave, primera llamada, paginación, sincronización incremental, errores y verificación de la firma;
  el código de verificación está probado contra `firmar()` de `entregar-webhook`).
- **Decisiones cerradas (2026-11-12, migración `20270301100000_api_decisiones_abiertas_msf233`):**
  - Topes por organización: **50 claves vigentes** (revocadas y vencidas no cuentan), **20 suscripciones** y, al rotar,
    un techo duro de **100 claves vigentes** (la clave anterior sigue vigente 24 h; sin techo, rotar en bucle crearía
    claves sin límite). Al superarlos la RPC responde `54000` y la pantalla lo avisa (crear). La purga diaria borra las
    claves revocadas o vencidas hace más de 90 días. Una suscripción no puede compartir secreto de Vault con otra
    (índice único).
  - `creada_por` de claves y suscripciones es `on delete set null`: dar de baja a quien las creó no corta la integración.
    Una clave o suscripción sin creador sigue vigente hasta que alguien con permiso la revoque o elimine.
  - Borrar una suscripción por cualquier vía (también por cascada de organización) borra su secreto de Vault (trigger).
  - `GET /v1/precios` ya no agrupa todo el catálogo en cada página: los candidatos salen de dos ramas con índice (productos
    y escalas tocados desde el cursor o desde `actualizado_desde`). Medido en el stack local con 50 000 productos: lectura
    incremental ≈ 6 ms frente a ≈ 104 ms de la carga completa. La carga completa inicial sigue leyendo el catálogo entero
    (no hay columna materializada de «último cambio»).
  - El decodificado del cursor vive en `private.api_cursor_partes`; un cursor de stock con un tercer valor que no es uuid
    es `400 cursor_invalido`.
  - Pruebas: pgTAP `api_decisiones_abiertas`.

## Evidencia de cierre (2026-11-11, PR #843) · Verificación global y revisión de seguridad (T021)

Cierre de la épica MSF-233
([`specs/20270203-100000-api-e-asistente-con-ia`](../specs/20270203-100000-api-e-asistente-con-ia/spec.md)):
las historias MSF-403 (F-API-01) y MSF-411 (F-IA-01) quedaron implementadas y
esto es la verificación global de la spec (`SC-007`), junto con el estado del
roadmap (`SC-008`, filas #25, #35, #36 y #47 de `docs/roadmap-template.md`).

### Revisión de seguridad (al cierre)

Sobre el diff de la épica (migraciones `20270224110201`…`20270224110205`, Edge
Functions `api-v1` y `entregar-webhook`, flows de Kestra y la pantalla `/api`).
Sin hallazgos críticos ni altos.

- **Aislamiento**: la organización sale siempre de la sesión
  (`private.organizacion_id()`) o de la clave de API; ningún parámetro del
  llamador la cambia y el filtro se arma dentro del SQL (`private.api_leer_*`).
- **RLS**: las cuatro tablas nuevas (`api_claves`, `api_llamadas`,
  `api_suscripciones`, `api_entregas`) están en `public` —integraciones
  genéricas de plataforma, no entidades de negocio— y tienen RLS activo; la
  prueba `rls_en_toda_tabla` las recorre por catálogo y falla si alguna lo
  pierde.
- **Privilegios**: `anon` y `public` sin privilegios ni ejecución sobre las RPC
  de la API. `api_validar_clave`, `api_controlar_limite`, `api_registrar_llamada`
  y `api_leer_*` son solo `service_role`; `crear_clave_api`, `rotar_clave_api`,
  `revocar_clave_api` y las tres de suscripción son `authenticated` y exigen
  Administrador de la organización.
- **Secretos**: el hash SHA-256 de la clave no entra en el `grant select` por
  columna, así que ni el panel ni el navegador leen la credencial; el secreto de
  firma de cada suscripción vive en Vault y `secreto_vault_id` tampoco está en
  el `grant select`. La clave de servicio existe solo en las Edge Functions y en
  el flow de Kestra: en `apps/web` no hay ninguna referencia a
  `SUPABASE_SERVICE_ROLE_KEY`.
- **SSRF**: la URL del destino se valida al guardar y otra vez al entregar; la
  entrega se conecta a la IP ya resuelta y validada, sin seguir redirecciones, y
  el error que queda guardado va saneado (sin secretos ni credenciales).

### Verificación global (al cierre; los conteos de pruebas crecieron después)

Comandos de la spec (`plan.md`, «Verificación»):

| Comprobación | Resultado |
|---|---|
| `pnpm lint` | verde: 209 avisos, ninguno en los archivos de la épica |
| `pnpm build` | verde |
| `pnpm infra:config` | verde (los siete Compose) |
| `pnpm docs:check` | verde |
| `pnpm matriz:check` | verde |
| `pnpm test:openapi` | verde (8 pruebas) |
| `pnpm test:edge:api-v1` | verde (17 pruebas) |
| `pnpm test:edge:entregar-webhook` | verde (13 pruebas) |
| `pnpm test:kestra:webhooks` | verde (10 pruebas) |
| `pnpm test` (cadena completa, sin `pnpm test:db`) | verde |
| `pnpm test:db` — pgTAP: `rls_en_toda_tabla`, `api_claves`, `api_llamadas`, `api_aislamiento`, `api_suscripciones_entregas`, `api_eventos` | lo corre el job `database` del CI: la máquina de desarrollo no tiene Supabase local |

La salida de cada comando va en el Pull Request de cierre.

