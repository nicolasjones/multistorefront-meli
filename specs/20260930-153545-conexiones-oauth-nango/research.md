# Investigación: Conexiones OAuth de plataforma vía Nango

## R1. Footprint mínimo de Nango self-hosted

**Decisión**: 3 servicios — `nango-db` (`postgres:16.0-alpine`), `nango-redis`
(`redis:7.2.4`), `nango-server` (`nangohq/nango-server:hosted`, pineado por
tag/commit al implementar).

**Evidencia**: `docker-compose.yaml` oficial de `NangoHQ/nango` (rama
`master`) solo define esos tres servicios activos; Elasticsearch aparece
comentado como dependencia opcional exclusiva de `NANGO_LOGS_ENABLED=true`, y
Temporal no aparece en absoluto (es infraestructura de Nango Cloud, no del
self-host OSS).

**Variables de entorno relevantes del `nango-server` oficial**:
`NANGO_ENCRYPTION_KEY`, `NANGO_DB_USER`, `NANGO_DB_PASSWORD`, `NANGO_DB_HOST`,
`NANGO_DB_NAME`, `NANGO_DB_SSL`, `SERVER_PORT`, `NANGO_SERVER_URL`,
`NANGO_PUBLIC_SERVER_URL`, `FLAG_AUTH_ENABLED`, `NANGO_DASHBOARD_USERNAME`,
`NANGO_DASHBOARD_PASSWORD`, `NANGO_PUBLIC_CONNECT_URL`,
`FLAG_SERVE_CONNECT_UI`. Ninguna depende de Elasticsearch ni Temporal cuando
`NANGO_LOGS_ENABLED` queda en su default `false`.

**Alternativas rechazadas**: usar la imagen `nangohq/nango-server` sin sufijo
(requiere Temporal en algunas versiones para el motor de syncs) — rechazada
porque este template no necesita syncs, solo auth + proxy; la etiqueta
`:hosted` es la variante pensada para self-host sin Temporal.

## R2. Cómo se obtiene un access token vigente sin tocar Postgres

**Decisión**: el backend/worker del producto derivado llama directo a
`GET {NANGO_SERVER_URL}/connection/{connection_id}?provider_config_key={clave}&refresh_token=true`
con `Authorization: Bearer {NANGO_SECRET_KEY}`. Nango refresca el token si
venció y lo devuelve dentro de `credentials.access_token`.

**Evidencia**: documentación pública de Nango (`docs/reference/api/connections/get`,
`docs/reference/backend/http-api/api-keys`, `docs/reference/api/authentication`):
toda la API de Nango se autentica con `Authorization: Bearer {nango-secret-key}`;
en self-host, ese secreto se fija con la variable `NANGO_SECRET_KEY_<entorno>`
(por ejemplo `NANGO_SECRET_KEY_DEV`) o se genera desde el dashboard de Nango
("Environment Settings → API Keys", llave "Default - Full access" por
entorno).

**Alternativas rechazadas**:
- *Una función SQL que llame a la API de Nango vía `pg_net`*: descartada
  porque el template ya evita HTTP saliente desde triggers/funciones
  transaccionales (ver spec 019, decisión 2) — mover ese límite a una excepción
  puntual para OAuth introduciría una asimetría innecesaria y un nuevo vector
  de fallas silenciosas dentro de Postgres.
- *Un webhook de Nango que notifique el token a Supabase*: los webhooks de
  auth no son estrictamente necesarios para el circuito mínimo (conectar +
  pedir token bajo demanda) y sumarían un endpoint público nuevo con su propia
  superficie de verificación de firma — se deja fuera hasta que un caso de uso
  real lo pida (Principio V).
- *Proxy de Nango (`/proxy/...`) como único contrato*: es una alternativa
  válida (Nango reenvía la llamada a la API externa sin exponer el token en
  absoluto), pero el primer consumidor real (worker de Google Sheets con la
  librería oficial `googleapis`) necesita el `access_token` crudo para
  inicializar su cliente OAuth2 — se documenta el proxy como alternativa en
  `contracts/obtener-token-oauth.md`, no como el camino principal.

## R3. Cómo se confirma que una conexión quedó activa

**Decisión**: el frontend usa `@nangohq/frontend` (`nango.auth(clave,
connectionId)`), que abre el popup de consentimiento y resuelve una promesa de
éxito/error solo después de que el proveedor externo confirmó el consentimiento
ante el propio Nango. Al resolver con éxito, el frontend llama a
`public.confirmar_conexion_oauth(conexion_id)` para que Supabase marque el
estado como activo.

**Alternativas rechazadas**: verificar de nuevo contra la API de Nango antes
de marcar la conexión como activa (por ejemplo desde una Edge Function) —
añadiría una llamada HTTP server-to-server extra sin reducir el riesgo real:
el mismo nivel de confianza ya lo acepta `crear_conexion` (spec 013) para una
acción reportada por quien la ejecutó del lado correcto. Se puede endurecer
más adelante si aparece evidencia de abuso.

## R4. Por qué `conexiones_oauth` es una tabla nueva y no una fila de `conexiones`

**Decisión**: tabla nueva, sin tocar `conexiones` (spec 013).

**Motivo**: `conexiones` guarda una credencial que la propia organización
aporta y que el template custodia en Vault (`credencial_vault_id`); acá no hay
ninguna credencial que custodiar — el secreto nunca sale de Nango. Mezclar
ambos conceptos en una sola tabla obligaría a columnas nulas según el tipo de
conexión y complicaría el contrato de `obtener_credencial_conexion` que ya
usan Kestra y los workers existentes. Mantenerlas separadas conserva ambos
contratos simples y explícitos (Principio IV, un monorepo con contratos
propios por mecanismo).

## R5. Callback OAuth y dominio

**Decisión**: `NANGO_SERVER_URL`/`NANGO_PUBLIC_SERVER_URL` apuntan al dominio
HTTPS que cada producto derivado ya opera para su propio entorno (reverse
proxy existente, mismo patrón que Kestra/Superset en `docs/deployment.md`).
En desarrollo local no hace falta HTTPS real: Nango soporta `http://localhost`
para el flujo de consentimiento en desarrollo, igual que Supabase Auth local.

**Alternativa rechazada**: que el template intente proveer o reservar un
dominio — contradice el límite explícito de esta spec (la plantilla no asume
ni provee el dominio de cada producto derivado).

## R6. `@nangohq/frontend` exige un Connect Session Token para el popup

**Decisión**: antes de llamar `nango.auth(...)`, el frontend pide un
Connect Session Token a la Edge Function `iniciar-sesion-oauth`, que lo
genera server-to-server (`POST {NANGO_URL}/connect/sessions` con
`Authorization: Bearer {NANGO_SECRET_KEY}`) y devuelve únicamente el token
de sesión (corta duración, 30 min).

**Evidencia**: verificado contra la instancia local real (Nango 0.71.10,
`nangohq/nango-server:hosted`): `new Nango({ host }).auth(...)` sin
`publicKey` ni `connectSessionToken` falla en el cliente con
`AuthError: "You must specify a public key OR a connect session token"`
(`node_modules/@nangohq/frontend/dist/index.js`, método `ensureCredentials`).
Encontrado probando el flujo real de punta a punta (no en la documentación
pública al momento de escribir el contrato original) — el SDK cambió este
requisito en algún punto entre la documentación consultada en R1/R2 y la
versión 0.71.10 instalada.

**Alternativas rechazadas**:
- *Usar `publicKey` en vez de `connectSessionToken`*: el self-host de esta
  versión no expone un concepto estable de "public key" equivalente al de
  Nango Cloud en el dashboard consultado; `connectSessionToken` es además la
  opción que Nango documenta como reemplazo recomendado (permite acotar
  `allowed_integrations` por sesión, algo que una public key de larga vida
  no ofrece).
- *Generar el token desde una función SQL*: mismo motivo que R2 (sin HTTP
  saliente desde Postgres) — se resuelve con una Edge Function, igual que
  `emitir-acceso-reporte` de spec 007 resuelve el guest token de Superset.

## R7. Fragilidad operativa: el stack local de Supabase es único por repo, no por worktree

**Hallazgo** (no de esta spec en particular, pero encontrado verificándola):
`supabase_edge_runtime_<project_id>` monta en modo bind el directorio
`supabase/functions` del worktree desde el que se corrió el último
`supabase start` — no hay un contenedor por worktree. Si ese worktree se
borra (una spec cerrada, una limpieza), un `docker restart` posterior de ese
contenedor falla (`mkdir ...: file exists`) y el contenedor queda detenido
para **todos** los worktrees que comparten ese proyecto Supabase local —
Edge Functions de cualquier spec en curso deja de responder hasta que
alguien corra `supabase stop && supabase start` desde un worktree que sí
existe (repuntando el mount a ese worktree).

**Mitigación aplicada, no automatizada**: un lock de archivo
(`automation-platform-template/.stack-local.lock/owner`, fuera de cualquier
worktree — en el directorio padre) que cualquier sesión toma antes de
`stop`/`start` del stack compartido y suelta al terminar, coordinado por
avisos entre sesiones. No es una capacidad de esta plantilla, es una
convención operativa manual mientras el equipo de agentes trabaje en
paralelo sobre varios worktrees del mismo repo — documentado acá porque
esta spec fue la que lo encontró en producción, no porque la resuelva.
