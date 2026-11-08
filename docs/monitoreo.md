# Monitoreo y registro de errores

Spec: `specs/20261102-220000-importaciones-y-monitoreo` (MSF-369, F-OPS-03). Esta guía dice **qué se mira, dónde, qué significa cada alerta, cómo ajustar los umbrales y qué variables hay**. No hay pantalla de monitoreo: los errores se consultan en GlitchTip y las alertas llegan por el webhook existente.

## Qué se mira y dónde

| Fuente | Qué mide | Cómo se mide | Dónde se ve |
|---|---|---|---|
| `aplicacion` | Errores no manejados y de render del panel (`apps/web`) y de los workers | SDK mínimo compatible con Sentry (`apps/web/src/lib/erroresWeb.ts`, `workers/_comun/errores.mjs`) → GlitchTip; el flow `monitoreo-errores-aplicacion` cuenta los eventos | GlitchTip (errores agrupados) y `alertas_monitoreo` |
| `tienda` | Que la tienda con dominio responda | Flow `monitoreo-salud-tiendas` cada 2 min (`GET https://<dominio>/` contra la IP resuelta y validada, sin seguir redirecciones) | vista `estado_tiendas_monitoreo` (último chequeo por tienda: `operativa`, `con_fallos`, `caida`) y `eventos_monitoreo` |
| `sincronizacion` | Ejecuciones `fallida`/`timeout` de una capacidad | `evaluar_monitoreo` las lee de `ejecuciones_worker` (clave `<organizacion_id>:<capacidad>`) | `/ejecuciones` y `alertas_monitoreo` |
| `cola` | Órdenes de `despachos_ejecucion` sin avanzar (una alerta por organización) | `evaluar_monitoreo` (estado `pendiente`/`reclamada` sin cambios) | `alertas_monitoreo` |

`eventos_monitoreo` y `alertas_monitoreo` (esquema `public`, plataforma) las lee **solo el operador de plataforma (superadmin)**; las escribe solo `kestra_orquestacion` por `registrar_evento_monitoreo` y `evaluar_monitoreo`. La vista `estado_tiendas_monitoreo` (`security_invoker`) hereda esa RLS: un administrador de organización recibe 0 filas. Reemplaza a la tabla `salud_tiendas` de la historia (RF-OPS-03-3, CA-OPS-03-4/5). La cola de Mercado Libre se agrega como otra fuente cuando exista (MSF-175).
Las tres funciones (`registrar_evento_monitoreo`, `evaluar_monitoreo` y `tiendas_a_sondear`) además admiten por nombre a `postgres` y `supabase_admin` (en Supabase no son superusuarios reales): es lo que usa el pgTAP en CI. `authenticated` y `anon` siguen sin `execute`.

## Organización en los eventos de error (RF-OPS-03-1)

Los eventos al registro central llevan el tag `organizacion_id` (solo el UUID, nunca nombre ni datos de personas). En el panel lo fija `authProvider` al verificar la membresía (`fijarOrganizacionErrores`; se limpia al cerrar sesión) y `filtrarEvento` lo conserva validando que sea un UUID. En los workers sale de `ORGANIZACION_ID` (lo entrega Kestra); si falta o no es un UUID el tag es `sin_organizacion`. Un superadmin sin organización no lleva el tag.

## SSRF del sondeo de tiendas

El sondeo ya **no delega solo en el egress de red**: hay cuatro capas, todas en código.

1. **Base** (`tiendas_a_sondear()` / `private.dominio_sondeable`): solo nombres DNS públicos (al menos dos etiquetas, TLD alfabético, sin IP en cualquier notación, puertos, corchetes ni `localhost`, `.local`, `.internal`, `.lan`, `.home`, `.corp`, `.private`, `.arpa`).
2. **Resolución previa** (script `sondeo.mjs` embebido en el flow `monitoreo-salud-tiendas`, que corre en un contenedor `node:22-alpine`): antes del GET resuelve el hostname (A **y** AAAA). Si **cualquier** IP resuelta cae en loopback, red privada RFC1918, link-local (`169.254.0.0/16`, que incluye los metadatos de nube, y `fe80::/10`), ULA `fc00::/7`, CGNAT `100.64.0.0/10`, multicast, `0.0.0.0`, rangos reservados o de documentación (también por IPv4 mapeada o NAT64), **no se pide nada**.
3. **IP fijada**: si todas son públicas, el GET se hace contra esa IP ya validada (`lookup` fijo de `https.request`, con el SNI y el certificado del dominio): no hay segunda resolución, así que el DNS rebinding no sirve.
4. **Sin redirecciones**: no se siguen 3xx (un 3xx cuenta como «responde»), así que una tienda no puede hacernos pedir otro host.

Un sondeo bloqueado registra un evento `no_sondeable` (motivo `NO_SONDEABLE_<RED>`): **no es un fallo de la tienda**, no suma al umbral ni abre alertas, y la vista `estado_tiendas_monitoreo` lo muestra como `no_sondeable`. Un dominio que no resuelve (DNS) sí es fallo (`SIN_RESPUESTA`). La clasificación de IP y el pinning se prueban con `node:test` (`infra/kestra/sondeo-tiendas.test.mjs`, que extrae el script del propio flow). Restringir el egress del contenedor sigue siendo una defensa adicional recomendable, ya no la única.

## Retención de datos

`eventos_monitoreo` crece rápido (un evento cada 2 minutos por tienda: ~72.000 filas por día con 100 tiendas). El flow `depuracion-monitoreo` (diario, 04:30) llama a `private.depurar_monitoreo_y_procesos()`, que borra: eventos con más de **30 días**, alertas **resueltas** con más de **90 días** y procesos masivos **terminados** con más de **180 días** (con sus errores y claves de idempotencia). Nunca toca alertas abiertas ni procesos abiertos; es idempotente. Solo la ejecutan `kestra_orquestacion` / `workers_orquestacion`. Hay un índice por `ocurrido_en` (evaluación y purga) y la vista `estado_tiendas_monitoreo` salta de tienda en tienda por el índice `(fuente, clave, ocurrido_en desc)`, así que su costo no crece con la cantidad de eventos.

## Tormenta de alertas

- La fuente `cola` se agrupa **por organización**: una sola alerta (clave = id de la organización) con la cantidad de órdenes que no avanzan, aunque sean cientos. Mientras esa alerta siga abierta, nuevas órdenes trabadas de la misma organización no abren otra.
- Cada corrida de `evaluar_monitoreo` devuelve **como máximo 20** notificaciones: 19 alertas y una fila de resumen («y N alertas más abiertas (ver `alertas_monitoreo`)», con `alerta_id` nulo, que el flow notifica sin marcar). Las alertas cubiertas por el resumen quedan marcadas notificadas y siguen visibles en `alertas_monitoreo`. Así, si Kestra pierde la red y caen N tiendas a la vez, el webhook no recibe N envíos.
- Cancelar un proceso masivo pendiente cierra su ejecución `fallida` con motivo `CANCELADA`; `evaluar_monitoreo` **no** la cuenta como fallo de sincronización.
- Además, `evaluar_monitoreo` cierra por tiempo máximo (`timeout`) las ejecuciones de procesos masivos abiertos que lo superaron, para que la pantalla de importaciones no quede sondeando para siempre.

## Umbrales

| Regla | Valor por defecto | Dónde se ajusta |
|---|---|---|
| Fallos para alertar (tienda, sincronización) | 5 en 10 minutos, por fuente y clave | inputs `fallos` y `ventana_min` del flow `monitoreo-evaluar` |
| Cola sin avanzar | 15 minutos | input `cola_min` de `monitoreo-evaluar` |
| Errores de la aplicación | 5 eventos en 10 minutos en el proyecto | inputs `umbral` y `ventana_min` de `monitoreo-errores-aplicacion` |
| Errores repetidos del panel | Un mismo error se envía una vez por minuto y por sesión; máximo 10 envíos por minuto | `erroresWeb.ts` (evita que una sesión rota dispare la alerta) |
| Frecuencia de sondeo y evaluación | cada 2 minutos | `cron` del trigger de cada flow |

Con el sondeo cada 2 minutos, 5 fallos consecutivos se alcanzan justo a los 10 minutos. Cambiar un umbral no requiere cambiar código.

## Qué significa cada alerta

- **Una sola alerta abierta por fuente y clave**, notificada una vez; mientras siga abierta no se repite aunque sigan los fallos.
- **Pendiente de notificar**: la alerta nace sin `notificada_en`. `evaluar_monitoreo` devuelve las abiertas sin notificar (nuevas y las que quedaron de corridas anteriores) y el flow llama a `marcar_alerta_notificada(id)` solo **después** de que el subflow `alertas` envió bien. Si el webhook falla, la alerta sigue pendiente y se reintenta en la próxima corrida (cada 2 minutos), así soporte no se queda sin enterar.
- **Fallo del propio monitor**: si `monitoreo-errores-aplicacion` no puede contar los errores (GlitchTip caído, token inválido), registra un fallo de fuente `aplicacion` con clave `monitor:<proyecto>`; tras 5 seguidos en la ventana se abre una alerta. Una alerta `aplicacion` abierta **no se resuelve sola** mientras no haya un `ok` real posterior (que el conteo falle no cuenta como normalidad).
- Se **resuelve** cuando la fuente vuelve a la normalidad (tienda/aplicación: un `ok` posterior; sincronización y cola: ya no se cumple la condición). Una nueva caída abre **otra** alerta.
- La notificación sale por el subflow `alertas` (tipo `tecnica`) hacia `KESTRA_ALERTAS_WEBHOOK_URL`. Ese subflow solo admite el motivo fijo `FALLA_TECNICA_SANITIZADA`, por eso el webhook trae la organización pero no el detalle; el detalle (fuente, clave, motivo sanitizado) está en `alertas_monitoreo`.
- Los motivos se sanitizan en la base: sin correos, teléfonos ni tokens.

## Destino de las alertas (D-2)

El subflow `alertas` **no se modifica**: publica al webhook `KESTRA_ALERTAS_WEBHOOK_URL` y el receptor decide destinatarios (el operador de plataforma para `tecnica`). El proveedor y la casilla de destino son configuración del receptor; falta que se nombren (decisión abierta D-2 de la spec) y la implementación no depende de eso.

## Variables

| Variable | Dónde | Efecto |
|---|---|---|
| `VITE_ERRORES_DSN`, `VITE_ERRORES_AMBIENTE`, `VITE_APP_VERSION` | `apps/web/.env` | DSN del proyecto web. **Vacío = no se envía nada** (desarrollo local y CI) |
| `ERRORES_DSN`, `ERRORES_AMBIENTE`, `ERRORES_VERSION` | entorno de cada worker | Igual para workers; el evento lleva `EJECUCION_ID` |
| `ERRORES_APP_URL`, `ERRORES_APP_ORGANIZACION`, `ERRORES_APP_PROYECTO` | `infra/kestra/.env` | Dónde cuenta Kestra los errores. Sin URL el flow no hace nada |
| `SECRET_ERRORES_APP_TOKEN` | `infra/kestra/.env` (base64) | Token de **lectura** de GlitchTip, secreto de Kestra; nunca en Git |
| `KESTRA_ALERTAS_WEBHOOK_URL` | `.env` / `infra/kestra/.env` | Destino de las alertas |
| `GLITCHTIP_DB_PASSWORD`, `GLITCHTIP_SECRET_KEY` (obligatorias), `GLITCHTIP_PORT` | `infra/glitchtip/.env` (copiar de `.env.example`) | GlitchTip: el Compose **no arranca** sin la contraseña y la clave; el puerto se publica solo en `127.0.0.1` |

## GlitchTip (D-1)

Producto propio `infra/glitchtip/compose.yaml` (proyecto `multistorefront-meli-glitchtip-dev`): `pnpm dev:glitchtip` / `pnpm dev:down:glitchtip`. Es bajo demanda (Principio V). Las alertas operativas (tienda, sincronización, cola) **no dependen** de GlitchTip: salen de Kestra y la base.

**Decisión sobre el SDK:** en vez de sumar `@sentry/*` (dependencia nueva con muchas transitivas), se usa un cliente mínimo del endpoint `store` de la API compatible, sin dependencias; así no hay cambio de lockfile ni superficie de supply chain, y el filtrado de datos personales está en nuestro código y probado. Si se quisiera el SDK oficial, `filtrarEvento` es el equivalente directo de `beforeSend`.

**Spike de la API de conteo (pendiente de verificación contra una instancia):** el flow `monitoreo-errores-aplicacion` usa el listado de eventos del proyecto (`/api/0/projects/{organizacion}/{proyecto}/events/` con `start`/`end`) y usa el total real del listado (encabezado `X-Hits`) o, si la herramienta no lo envía, una página de al menos `umbral` eventos (input `limite_pagina`, parámetro `limit`), no la primera página por defecto. La ruta es el input `ruta_eventos` para ajustarla sin cambiar código. Esto no se pudo comprobar en esta entrega (sin Docker en el entorno de desarrollo); verificarlo en el paso manual de abajo. Si la API no sirve para contar, se vuelve a D-1 y se pregunta.

## Verificación manual de SC-006 (error inducido)

1. `pnpm dev:glitchtip`, crear organización y dos proyectos (web y workers) y copiar sus DSN a `VITE_ERRORES_DSN` y `ERRORES_DSN`.
2. Web: en la consola del navegador del panel, `setTimeout(() => { throw new Error('prueba de monitoreo ana@example.com') })`. En GlitchTip aparece agrupado con ambiente y versión y con `[correo]` en lugar del correo.
3. Worker: correr uno con `EJECUCION_ID=prueba` y un error inducido; el evento trae el tag `EJECUCION_ID`.
4. Alerta de aplicación: generar 5 errores en 10 minutos y comprobar en `alertas_monitoreo` la alerta de fuente `aplicacion`.
5. Adjuntar la evidencia al PR.

Los workers corren con egress restringido: agregar el host de GlitchTip a la allowlist del worker en `workers/egress-allowlists.json` al activar `ERRORES_DSN` en un entorno.

## Revisión de seguridad de la épica MSF-206 (T025)

Revisión de las migraciones `20270211100001`…`05` (procesos masivos) y `20270211100011`/`12` (monitoreo), del Compose de GlitchTip, de los
flows de Kestra y del cliente de errores (authz-security, crypto-secrets, infra-security, supply-chain-security):

- **Autorización**: RLS en `procesos_masivos`, `procesos_masivos_errores`, `eventos_monitoreo` y `alertas_monitoreo`; `select` por columnas en
  los procesos; sin `insert/update/delete` para la app (escriben funciones `security definer` con `search_path` vacío). `anon` sin ejecución
  en ninguna función. Las del worker solo las ejecuta `workers_orquestacion` (con `autorizar_worker_proceso`) y las de monitoreo,
  `kestra_orquestacion`. Cancelar o iniciar un proceso ajeno devuelve `42501`. Los datos de monitoreo solo los lee un superadmin: no hay fuga
  entre organizaciones.
- **Datos sensibles**: los motivos de error se sanitizan antes de guardarse (`private.sanitizar_motivo_*`) y el cliente de errores limpia
  correos, teléfonos, tokens y credenciales en URL antes de enviar un evento (`workers/_comun/errores.mjs`).
- **Secretos**: DSN vacío por defecto (no se envía nada); el token de lectura de GlitchTip es un secreto de Kestra y solo vive en
  `infra/kestra/.env` (ignorado en git); el valor de `.env.example` es un placeholder.
- **Cadena de suministro**: ninguna dependencia nueva y el lockfile no cambia; el cliente de errores es propio.
- **Hallazgo corregido en el cierre**: el Compose de GlitchTip publicaba el puerto en todas las interfaces (`8100:8000`), a diferencia de
  todos los demás Compose del repo, que lo atan a `127.0.0.1`. Ahora es `127.0.0.1:${GLITCHTIP_PORT:-8100}:8000`.
- **Hallazgo corregido (revisión retroactiva)**: la contraseña de la base y la `SECRET_KEY` de GlitchTip ya no tienen valor por defecto: son obligatorias (`${VAR:?mensaje}`) y se definen en `infra/glitchtip/.env`. `pnpm infra:config:glitchtip` pasa valores ficticios solo para validar el Compose.
- **Observación aceptada**: `valkey/valkey:8-alpine` usa un tag de versión mayor flotante; las demás imágenes tienen tag fijo.

