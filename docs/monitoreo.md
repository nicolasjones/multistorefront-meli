# Monitoreo y registro de errores

Spec: `specs/20261102-220000-importaciones-y-monitoreo` (MSF-369, F-OPS-03). Esta guía dice **qué se mira, dónde, qué significa cada alerta, cómo ajustar los umbrales y qué variables hay**. No hay pantalla de monitoreo: los errores se consultan en GlitchTip y las alertas llegan por el webhook existente.

## Qué se mira y dónde

| Fuente | Qué mide | Cómo se mide | Dónde se ve |
|---|---|---|---|
| `aplicacion` | Errores no manejados y de render del panel (`apps/web`) y de los workers | SDK mínimo compatible con Sentry (`apps/web/src/lib/erroresWeb.ts`, `workers/_comun/errores.mjs`) → GlitchTip; el flow `monitoreo-errores-aplicacion` cuenta los eventos | GlitchTip (errores agrupados) y `alertas_monitoreo` |
| `tienda` | Que la tienda con dominio responda | Flow `monitoreo-salud-tiendas` cada 2 min (`GET https://<dominio>/`, sin seguir redirecciones) | `eventos_monitoreo` |
| `sincronizacion` | Ejecuciones `fallida`/`timeout` de una capacidad | `evaluar_monitoreo` las lee de `ejecuciones_worker` (clave `<organizacion_id>:<capacidad>`) | `/ejecuciones` y `alertas_monitoreo` |
| `cola` | Una orden de `despachos_ejecucion` sin avanzar | `evaluar_monitoreo` (estado `pendiente`/`reclamada` sin cambios) | `alertas_monitoreo` |

`eventos_monitoreo` y `alertas_monitoreo` (esquema `public`, plataforma) las lee **solo el operador de plataforma (superadmin)**; las escribe solo `kestra_orquestacion` por `registrar_evento_monitoreo` y `evaluar_monitoreo`. La cola de Mercado Libre se agrega como otra fuente cuando exista (MSF-175).
Las tres funciones (`registrar_evento_monitoreo`, `evaluar_monitoreo` y `tiendas_a_sondear`) además admiten por nombre a `postgres` y `supabase_admin` (en Supabase no son superusuarios reales): es lo que usa el pgTAP en CI. `authenticated` y `anon` siguen sin `execute`.

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
| `GLITCHTIP_PORT`, `GLITCHTIP_DB_PASSWORD`, `GLITCHTIP_SECRET_KEY` | `infra/glitchtip/.env` | GlitchTip local; cambiar los valores de ejemplo en cualquier entorno compartido |

## GlitchTip (D-1)

Producto propio `infra/glitchtip/compose.yaml` (proyecto `multistorefront-meli-glitchtip-dev`): `pnpm dev:glitchtip` / `pnpm dev:down:glitchtip`. Es bajo demanda (Principio V). Las alertas operativas (tienda, sincronización, cola) **no dependen** de GlitchTip: salen de Kestra y la base.

**Decisión sobre el SDK:** en vez de sumar `@sentry/*` (dependencia nueva con muchas transitivas), se usa un cliente mínimo del endpoint `store` de la API compatible, sin dependencias; así no hay cambio de lockfile ni superficie de supply chain, y el filtrado de datos personales está en nuestro código y probado. Si se quisiera el SDK oficial, `filtrarEvento` es el equivalente directo de `beforeSend`.

**Spike de la API de conteo (pendiente de verificación contra una instancia):** el flow `monitoreo-errores-aplicacion` usa el listado de eventos del proyecto (`/api/0/projects/{organizacion}/{proyecto}/events/` con `start`/`end`) y cuenta los elementos devueltos. La ruta es el input `ruta_eventos` para ajustarla sin cambiar código. Esto no se pudo comprobar en esta entrega (sin Docker en el entorno de desarrollo); verificarlo en el paso manual de abajo. Si la API no sirve para contar, se vuelve a D-1 y se pregunta.

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
- **Observación aceptada (convención del repo)**: GlitchTip trae contraseña y `SECRET_KEY` de desarrollo por defecto
  (`glitchtip-local`, `change-me-local-only`), igual que Kestra y Superset. En cualquier entorno compartido hay que fijarlos por variables fuera
  de Git; olvidarlo deja un secreto débil sin aviso. Queda como seguimiento: fallar al arrancar si falta el valor fuera de desarrollo.
- **Observación aceptada**: `valkey/valkey:8-alpine` usa un tag de versión mayor flotante; las demás imágenes tienen tag fijo.

