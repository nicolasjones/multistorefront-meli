# Research: Analítica embebida por organización

## 1. Mecanismo de embedding de Superset

**Decisión**: usar el flujo oficial de "Embedded Dashboards" de Superset —
SDK `@superset-ui/embedded-sdk` del lado del cliente, feature flag
`EMBEDDED_SUPERSET = True` del lado del servidor, y un guest token de vida
corta emitido por `/api/v1/security/guest_token/`.

**Rationale**: es el único mecanismo de Superset pensado para mostrar un
dashboard dentro de otra aplicación sin que quien lo mira tenga sesión
propia en Superset — encaja exacto con FR-008/FR-013 (sin acceso directo a
Superset, sin exponer su URL/credenciales).

**Alternativas consideradas**: iframe directo a la URL pública de un
dashboard (rechazado — expondría la URL de Superset y no permite filtrar
por organización sin que el usuario pueda alterar el filtro); replicar los
charts con una librería de gráficos propia consultando la base directo
(rechazado — duplica todo el trabajo de Superset, contradice la razón de
tenerlo en el stack).

## 2. Quién habilita un dashboard para embedding

**Decisión**: es un paso manual que el superadmin hace en la propia UI de
Superset (Dashboard → Embed dashboard), que genera el UUID de embedding.
Ese UUID es el que se registra en el catálogo interno vía `registrar_reporte`.

**Rationale**: coherente con la Assumption de la spec de que la autoría
(crear/editar/preparar un reporte) ocurre en Superset, fuera de este
producto — este código no necesita llamar a la API de Superset para
habilitar el embedding, solo para pedir el guest token de un dashboard ya
habilitado.

## 3. Emisión del guest token

**Decisión**: la Edge Function `emitir-acceso-reporte` hace dos llamadas
server-to-server a la API de Superset: `POST /api/v1/security/login` con
una cuenta de servicio dedicada (no la cuenta interactiva del superadmin)
para obtener un `access_token`, y `POST /api/v1/security/guest_token/` con
ese token, pidiendo el `resource` (el dashboard) y una cláusula `rls` que
fuerza `organizacion_id = '<uuid>'`.

**Rationale**: separar la cuenta de servicio de la cuenta interactiva del
superadmin es menor privilegio — si se filtran las credenciales de esta
Edge Function, lo único que permiten es pedir guest tokens de solo lectura,
no editar nada en Superset.

**Alternativas consideradas**: reusar `SUPERSET_ADMIN_USERNAME/PASSWORD`
(rechazado — innecesariamente amplio para lo que hace falta acá).

## 4. Convención de columna para el filtro `rls`

**Decisión**: todo dataset de Superset usado en un reporte de esta
funcionalidad DEBE exponer una columna `organizacion_id` con los mismos
valores que `organizaciones.id`. La Edge Function siempre arma la cláusula
como `organizacion_id = '<uuid>'`, sin parametrizar el nombre de columna.

**Rationale**: mantenerlo fijo evita que el catálogo interno (`reportes`)
necesite guardar metadata adicional sobre el dataset de cada reporte; el
costo es una convención que el superadmin debe seguir al armar datasets en
Superset — documentado acá porque es un requisito técnico real, aunque la
autoría en sí quede fuera del alcance de esta spec.

## 5. Duración y refresco del guest token

**Decisión**: se usa el valor por defecto de Superset
(`GUEST_TOKEN_JWT_EXP_SECONDS`) sin overridearlo, y se confía en el
refresco automático que ya trae `@superset-ui/embedded-sdk` (vuelve a
invocar el callback `fetchGuestToken` antes de que expire).

**Rationale**: la spec no fija ninguna duración de sesión como requisito de
negocio (Assumptions) — no hay motivo para una configuración custom.

## 6. Cómo se resuelve la autorización (FR-010) sin duplicar lógica

**Decisión**: la Edge Function arma un cliente de Supabase con el JWT de
quien llama (no con la service-role) y hace un `select` simple contra
`reportes_organizaciones_roles` filtrando por `reporte_id`. La propia RLS
de esa tabla (organización activa + rol del que llama) decide si aparece
alguna fila. Cero filas → no autorizado; una fila → autorizado.

**Rationale**: evita mantener la misma regla de autorización escrita dos
veces (una en SQL para la UI, otra en TypeScript para la Edge Function) —
si mañana cambia la regla de RLS, la Edge Function la hereda gratis. Es el
mismo principio que ya usa el resto del producto (autorización real en
RLS, el resto es UI).

**Alternativas consideradas**: una función `private.puede_ver_reporte(...)`
expuesta como RPC aparte (rechazado — es estrictamente más código para el
mismo resultado que ya da un `select` respetando RLS).

## 7. Helper `puede_gestionar_reportes` vs. reusar el de la spec 005

**Decisión**: definir `private.puede_gestionar_reportes(organizacion_id)`
como una función nueva y autocontenida dentro de la migración de esta
spec, con la misma lógica que `private.puede_gestionar_membresias` de la
spec 005 (administrador de esa organización, o superadmin con esa
organización activa).

**Rationale**: esta spec parte de la rama `main`, que todavía no tiene
mergeado el PR de la spec 005 (#4, abierto). Depender de una función que
puede no existir todavía en el momento de implementar sería frágil. Queda
documentada acá la duplicación deliberada — una futura consolidación en un
único helper genérico (`private.es_admin_de(organizacion_id)`) es una
mejora posible, no parte de esta spec.

## 8. Alcance de testing

**Decisión**: pgTAP nuevo y obligatorio para las tablas/RLS/RPCs (aislamiento
multi-tenant, exige la constitución). Sin test de la Edge Function ni del
SDK de embedding — mismo criterio que las specs 003/004 (no hay tests de
función ya en el repo, y mockear un SDK de terceros completo no da señal
real). Se agregan tests de Vitest puntuales para el componente de la
grilla de permisos (checkboxes) y el estado de "sin reportes asignados" /
"analítica no disponible", que sí son lógica propia y determinística.

**Rationale**: consistente con dónde ya está el aislamiento (Postgres) y
con el patrón de testing que este repo ya sostiene en specs anteriores.

## 9. Configuración de Superset a tocar

**Decisión**: en `infra/superset/superset_config.py` agregar
`FEATURE_FLAGS = {"EMBEDDED_SUPERSET": True}`, `GUEST_TOKEN_JWT_SECRET`
(nuevo secreto, distinto de `SUPERSET_SECRET_KEY`), y habilitar CORS
(`ENABLE_CORS`, `CORS_OPTIONS`) para el origen de Refine. `TALISMAN_ENABLED`
ya está en `False` (TLS lo termina el reverse proxy del VPS) — no hace
falta tocar cabeceras de framing adicionales; se verifica empíricamente en
el quickstart que el iframe del SDK carga sin bloqueos, en vez de
sobre-especificar acá una configuración de CSP que Superset podría no
necesitar.

**Rationale**: son los únicos cambios documentados como requisito del SDK
oficial; cualquier ajuste adicional de cabeceras se resuelve si el
quickstart lo detecta, no de antemano.

## 10. Hallazgos de correr el quickstart de punta a punta (T023)

Corriendo las 6 secciones contra Postgres/Superset/Edge Function reales
(no mockeados) aparecieron dos problemas que ninguno de los tests
automatizados (pgTAP, Vitest) podía haber detectado por su propio alcance
documentado (#8):

1. **CSRF bloqueaba `/security/guest_token/`**: `WTF_CSRF_ENABLED = True`
   sin excepción hace que Superset exija sesión CSRF también en ese
   endpoint, incompatible con el login Bearer server-to-server que este
   mismo research.md (#3) diseñó. Fix: `WTF_CSRF_EXEMPT_LIST =
   ["superset.security.api.guest_token"]` en `superset_config.py` — el
   valor es `<módulo>.<nombre de función>` de la vista real (lo que
   `flask_wtf.csrf.CSRFProtect.exempt()` compara), no una ruta ni una
   regex; `/security/login` ya viene exento por Flask-AppBuilder.
2. **`superset_url` en la response era la URL interna, no la pública**:
   la Edge Function devolvía el mismo `SUPERSET_URL` que usa para hablarle
   a Superset server-to-server (en local, el nombre del contenedor
   Docker) — el navegador que monta el SDK no puede resolver ese nombre
   ("server IP address could not be found"). Fix: variable nueva
   `SUPERSET_PUBLIC_URL` (browser-reachable, en local
   `http://localhost:8088`), la función sigue usando `SUPERSET_URL` para
   sus propias llamadas pero devuelve `SUPERSET_PUBLIC_URL` en la
   response — ver `contracts/acceso-reporte.md` y
   `supabase/functions/.env.example`.
3. **Sobreescribir `WTF_CSRF_EXEMPT_LIST` en vez de extenderla rompió
   `/api/v1/chart/data`**: el fix del punto 1 (arriba) asignó
   `WTF_CSRF_EXEMPT_LIST = ["superset.security.api.guest_token"]`
   directo, pisando la lista default de Superset
   (`superset.config.WTF_CSRF_EXEMPT_LIST`), que ya trae de fábrica
   `superset.charts.data.api.data` — el POST que efectivamente pinta un
   chart. Sin esa exención, cualquier request de datos del SDK embebido
   fallaba con el mismo "The CSRF token is missing" que el punto 1 ya
   había arreglado para `guest_token`. Fix: `superset_config.py` importa
   `WTF_CSRF_EXEMPT_LIST` de `superset.config` y lo extiende con `+`, en
   vez de reemplazarlo — evita que un futuro cambio a esa lista default
   (con una versión nueva de Superset) se pierda silenciosamente acá.
4. **El rol `Guest` necesita un permiso propio, no cero permisos**: el
   comentario original de `superset_config.py` decía "sin permisos
   propios" — cierto para Dashboard/Chart/Dataset (eso lo resuelve el
   guest token vía `resources`/`rls`, no el RBAC del rol), pero el
   bootstrap del SDK llama a `GET /api/v1/me/roles/` apenas monta el
   iframe (`superset/views/users/api.py`, `CurrentUserRestApi.get_my_roles`,
   protegido con `@protect()` + `permission_name("read")`) — sin
   `can_read` sobre `CurrentUserRestApi` esa llamada da `403` y el
   navegador solo muestra el genérico "Something went wrong with embedded
   authentication". Es un paso manual en Superset (Settings > List Roles,
   o `POST /api/v1/security/roles/{id}/permissions` con
   `permission_view_menu_ids` apuntando a ese permiso) — comentario
   actualizado en `superset_config.py`.
5. **CORS solo permitía un origen**: `CORS_OPTIONS.origins` tomaba
   únicamente `REFINE_ORIGIN` — entrar por `http://127.0.0.1:3100` en vez
   de `http://localhost:3100` (mismo servidor, origen distinto para CORS)
   rompía el embedding. Fix: `superset_config.py` agrega siempre las dos
   variantes de loopback además de `REFINE_ORIGIN`.
6. **Bug real de aislamiento: una organización podía ver los datos de
   otra** (el más serio de los seis — reportado directamente por el
   usuario probando la app, no por una sección puntual del guion del
   quickstart). La policy de `reportes_organizaciones` reusaba
   `private.puede_ver_reporte(reporte_id)` (pensada para `reportes`, una
   fila por reporte) — esa función solo responde "¿mi organización tiene
   ALGUNA fila para este reporte?", sin comparar el `organizacion_id` de
   la fila que la RLS está evaluando contra el de quien consulta. Con el
   mismo reporte asignado a dos organizaciones, eso hacía visibles las
   filas de **ambas** para cualquiera de las dos. La Edge Function
   `emitir-acceso-reporte` confía en que RLS ya filtró
   (`select ... limit 1` sin `where organizacion_id = ...`, research.md
   #6 original) — con la policy rota, a veces devolvía la cláusula `rls`
   de la organización ajena, y Superset terminaba mostrando datos de la
   organización equivocada. Fix: función nueva
   `private.puede_ver_asignacion(reporte_id, organizacion_id)` que sí
   compara ambos — ver data-model.md. Caso nuevo en pgTAP (mismo reporte
   asignado a dos organizaciones, cada una ve solo su propia fila) — el
   suite anterior no lo detectaba porque ningún test previo asignaba el
   mismo reporte a dos organizaciones a la vez.
7. **El superadmin veía datos de la organización equivocada según cuál
   tenía activa** (segundo bug de aislamiento, distinto del anterior —
   también reportado directamente por el usuario). La policy de
   `reportes_organizaciones` tiene un `is_superadmin() or ...`: un
   superadmin ve TODAS las filas de esa tabla, de cualquier organización,
   sin importar cuál entró. El `select ... limit 1` que hacía
   `emitir-acceso-reporte` confiaba en que RLS ya había dejado una sola
   fila visible — cierto para un miembro/administrador normal (con el fix
   del punto 6), pero no para un superadmin: el `limit 1` agarraba
   cualquier fila (en la práctica, siempre la primera insertada),
   ignorando la organización activa. Fix: RPC nueva
   `resolver_organizacion_reporte(reporte_id)` que usa
   `private.organizacion_id()` (ya resuelve bien el caso superadmin,
   desde la spec 003/004) en vez de que la Edge Function intente
   inferirlo de qué filas devuelve una tabla — ver `data-model.md` y
   `contracts/acceso-reporte.md`. Caso nuevo en pgTAP: superadmin entra a
   X, confirma que resuelve X; entra a Y, confirma que cambia a Y.
8. **El dropdown ofrecía reportes que después se rechazaban** (tercer bug,
   reportado por el usuario justo después del anterior — "si no tengo
   acceso no debería ni poder seleccionarlo"). `useReportesAsignados`
   hacía `select * from reportes`, apoyado en la RLS de esa tabla
   (`is_superadmin() or puede_ver_reporte()`). Ese bypass de
   `is_superadmin()` es necesario para que `administrar.tsx` (US1) vea el
   catálogo completo — pero el mismo bypass hacía que el superadmin, en
   "Analítica" (US2), viera reportes de organizaciones que no tenía
   activa: el dropdown los ofrecía, y `resolver_organizacion_reporte` (el
   punto anterior) los rechazaba correctamente al seleccionarlos — dos
   fuentes de verdad desalineadas. Fix: RPC nueva
   `reportes_visibles_para_mi()`, sin el bypass de superadmin — un
   superadmin con organización activa se trata igual que su
   administrador, ni más ni menos (mismo criterio que
   `private.puede_escribir()`). `useReportesAsignados.ts` la usa en vez
   del `select` directo. Caso nuevo en pgTAP: organización sin nada
   asignado → lista vacía; con el reporte asignado → aparece.
9. **FR-006 se rompía con cero roles habilitados**: ver data-model.md,
   sección de `private.puede_ver_reporte()` ("Corrección post-quickstart")
   — el diseño original chequeaba `reportes_organizaciones_roles`
   directo, tabla que queda vacía para una organización sin ningún rol
   no-administrador habilitado, y `administrador` nunca tiene fila propia
   ahí. Fix: apoyarse en `reportes_organizaciones` (la asignación, que
   siempre tiene una fila mientras el reporte esté asignado) en vez de en
   la tabla de roles.

Un hallazgo más quedó **sin resolver dentro de esta spec** (ver
quickstart.md, Prerrequisitos): en local, el contenedor de Edge Functions
de Supabase y el de Superset viven en redes Docker separadas (dos
`compose.yaml` independientes, regla de `CLAUDE.md`) — hace falta un
`docker network connect` manual, que no sobrevive a `supabase stop &&
supabase start`. No se resuelve acá porque toca la topología de red de dos
productos a la vez y merece su propia decisión (¿red externa compartida
declarada en ambos compose?, ¿depender de `host.docker.internal`?), no un
parche apurado dentro de una spec de analítica.

## 11. Cuenta de servicio dedicada para el guest token (post-cierre)

El diseño original (#3) ya decía "cuenta de servicio dedicada, no la
interactiva del superadmin" — pero en la práctica el `.env` local había
quedado con `SUPERSET_GUEST_TOKEN_USERNAME=admin`, reusando exactamente lo
que #3 decía rechazar (funcionaba porque `admin` tiene todos los permisos,
no porque fuera la cuenta correcta).

**Decisión**: `infra/superset/crear_cuenta_servicio_guest_token.py`, corrido
vía `superset shell` al final del `command` de `superset-init` en
`compose.yaml` (después de `superset init`, que es quien registra las
vistas/permisos de Superset en la base — antes de eso no existen filas que
asignarle a un rol). Crea, si no existen, un rol `Guest Token Service` con
un único permiso y una cuenta con ese rol, usando
`SUPERSET_GUEST_TOKEN_USERNAME`/`PASSWORD` (mismos nombres que ya
documentaba `supabase/functions/.env.example`, ahora también en el
`.env.example` raíz porque hacen falta en dos mecanismos de despliegue
distintos: Compose acá, secrets de Edge Functions allá).

**El permiso exacto** — `can_grant_guest_token` sobre el view-menu
`SecurityRestApi` — se confirmó contra el código fuente real de Superset
6.1.0 (`superset/security/api.py`, el endpoint `POST /guest_token/` está
decorado `@permission_name("grant_guest_token")`) y **probando end-to-end**
contra un Superset real, no solo leyendo el código:

- Usar `"grant_guest_token"` a secas (sin el prefijo) crea un permiso
  *distinto* del que Flask-AppBuilder realmente registra y chequea —
  `flask_appbuilder/api/__init__.py` antepone siempre `PERMISSION_PREFIX`
  ("can_") al registrar los permisos de cada método de una API. Con el
  nombre sin prefijo, la cuenta quedaba con un permiso que nadie
  consultaba: `POST /guest_token/` seguía devolviendo `403 Forbidden`
  aunque el rol "tuviera" el permiso en la tabla.
- `security_manager.find_permission_view_menu(...)` devuelve `None` para
  un par permiso/view-menu que todavía no se usó nunca — Superset no
  pre-crea la fila de `ab_permission_view` para un `@permission_name` a
  medida como este durante el arranque normal. Hace falta
  `add_permission_view_menu(...)`, que crea el par si falta (a diferencia
  de `find_...`, que solo busca).
- Verificado con `curl` real contra el stack local, arrancado en frío
  (`docker compose down -v && up`): login con la cuenta nueva +
  `POST /guest_token/` contra un dashboard inexistente responde
  `400 "EmbeddedDashboard not found"` — el mismo error que da `admin`, es
  decir, pasa el chequeo de permiso y llega al código de negocio — y
  `GET /api/v1/dashboard/` (fuera del único permiso que tiene) responde
  `403`, confirmando que no hay privilegio de más.

**Alternativas consideradas**: automatizarlo por API REST en vez de
`superset shell` — descartada porque `superset-init` corre *antes* de que
el servicio `superset` esté sirviendo tráfico (`depends_on:
service_completed_successfully`), no hay a qué URL pegarle todavía dentro
del mismo contenedor que hace el init.
