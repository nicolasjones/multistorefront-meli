# Tareas: Conexiones OAuth de plataforma vía Nango

**Entrada**: artefactos de `specs/20260930-153545-conexiones-oauth-nango/`.
**Pruebas**: pgTAP obligatorio para tablas, RLS y funciones `SECURITY DEFINER`; `pnpm infra:config` para el Compose nuevo; verificación manual end-to-end contra un proveedor real en modo Testing (no automatizable en CI sin credenciales de proveedor).

## Fase 1 — Infraestructura de Nango

- [X] T001 Crear `infra/nango/compose.yaml` con `nango-db` (`postgres:16.0-alpine`), `nango-redis` (`redis:7.2.4`) y `nango-server` (`nangohq/nango-server:hosted`, pineado por tag/digest), puertos configurables por variable de entorno (mismo patrón que la spec 015) y nombre de proyecto Compose siguiendo la convención del repo.
- [X] T002 [P] Sumar al `.env.example` raíz (convención ya existente: Compose lee `.env` desde la carpeta del propio compose.yaml, así que se copia a `infra/nango/.env`) las variables `NANGO_PORT`, `NANGO_ENCRYPTION_KEY`, `NANGO_DB_PASSWORD`, `NANGO_DASHBOARD_USERNAME`, `NANGO_DASHBOARD_PASSWORD`, `NANGO_SERVER_URL`, `NANGO_PUBLIC_SERVER_URL`, `NANGO_SECRET_KEY_DEV` — todas con defaults locales de ejemplo, nunca secretos reales; y agregar `NANGO_PORT` a la tabla de puertos de la spec 015.
- [X] T003 [P] Agregar `dev:nango`, `dev:down:nango` e `infra:config:nango` a `package.json` (y sumar `infra:config:nango` al agregado `infra:config`).
- [X] T004 [P] Documentar el servicio en `infra/nango/README.md` (arranque local, dashboard, cómo registrar una integración de prueba) y sumar la fila de Nango a la tabla de servicios de `README.md` raíz.

**Checkpoint**: `pnpm dev:nango` levanta los 3 servicios y `pnpm infra:config` valida el Compose nuevo; el dashboard de Nango es alcanzable en local.

## Fase 2 — Fundaciones de esquema (Supabase)

- [X] T005 Crear migración aditiva `supabase/migrations/20260930160000_conexiones_oauth.sql` con las tablas `integraciones_oauth`, `conexiones_oauth` (incluyendo `unique (organizacion_id, integracion_id)` e índice por `organizacion_id`) y `eventos_conexion_oauth`, con su comentario de reversión documentado (Technology Gates).
- [X] T006 En la misma migración, crear las funciones `SECURITY DEFINER`/`set search_path = ''` de `data-model.md`: `iniciar_conexion_oauth`, `confirmar_conexion_oauth`, `marcar_conexion_oauth_invalida`, `registrar_integracion_oauth`, `actualizar_integracion_oauth`, reutilizando `private.es_administrador_de` y el chequeo de superadmin ya existentes.
- [X] T007 En la misma migración, habilitar RLS y políticas de `select` por organización (administrador/superadmin) en `conexiones_oauth` y `eventos_conexion_oauth`; `integraciones_oauth` legible por cualquier persona autenticada con contexto de organización activo, sin `insert`/`update` directo para `authenticated` en ninguna de las tres tablas.
- [X] T008 [P] Crear esqueleto pgTAP en `supabase/tests/database/conexiones_oauth.test.sql` (tablas, columnas, constraints, RLS habilitada).

**Checkpoint**: las tablas y funciones existen; ninguna organización puede leer la fila de otra (pgTAP de aislamiento mínimo pasa).

## Fase 3 — Historia 1: conectar una cuenta externa (P1)

- [X] T009 [US1] pgTAP: `iniciar_conexion_oauth` crea una fila `pendiente`, es idempotente (no duplica con `unique`), y falla si la integración no está `habilitada` o quien llama no administra esa organización — en `supabase/tests/database/conexiones_oauth.test.sql`.
- [X] T010 [US1] pgTAP: `confirmar_conexion_oauth` solo actúa sobre conexiones de la propia organización del llamador y registra el evento `creada` — en `supabase/tests/database/conexiones_oauth.test.sql`.
- [X] T011 [US1] Agregar dependencia `@nangohq/frontend` en `apps/web` e implementar `apps/web/src/providers/nango/` (wrapper mínimo: construir cliente Nango con la URL pública del entorno, exponer una función `conectarOAuth(clave, conexionId)`).
- [X] T012 [US1] Implementar la pantalla `apps/web/src/pages/conexiones-oauth/list.tsx` (Refine): listar integraciones habilitadas, botón "Conectar" que llama `iniciar_conexion_oauth` → `nango.auth(...)` → `confirmar_conexion_oauth`, declarando ubicación/icono en la navegación (`destinosPanel.ts`, sección Configuración) y reutilizando los patrones compartidos de carga/vacío/error/adaptable (Principio VI).
- [X] T012.1 [US1] Desvío encontrado probando el flujo real: `@nangohq/frontend` 0.71.x exige un Connect Session Token, `host` solo no alcanza (`research.md` R6). Agregada la Edge Function `supabase/functions/iniciar-sesion-oauth/` (mismo patrón que `emitir-acceso-reporte`, spec 007) y `apps/web/src/providers/nango/index.ts` actualizado para pedirle el token antes de `nango.auth(...)`. Verificado end-to-end real contra el stack local (JWT de superadmin real, `conexion_id` real, respuesta `{token: "nango_connect_session_..."}`) y los dos caminos de error (sin auth → 401, `conexion_id` inexistente → "No autorizado").
- [X] T013 [US1] Verificar manualmente el flujo completo contra un proveedor real en modo Testing siguiendo `quickstart.md` (pasos 1-5) y registrar la evidencia sanitizada en este archivo. Verificado hasta el paso previo al clic humano: Nango local levantado, integración `google` creada vía API (`POST /integrations`, client id/secret de `agenmatica-integraciones`) y registrada en Supabase (`registrar_integracion_oauth`); Edge Function `iniciar-sesion-oauth` verificada de punta a punta (T012.1). Falta únicamente el clic de consentimiento real (requiere login interactivo como `njones@eraconsultores.com`) — no ejecutable por este agente (política: no ingresa contraseñas de terceros) ni por el navegador remoto conectado a esta sesión (no alcanza `localhost` de esta máquina).

**Checkpoint**: una organización completa el flujo de conexión de extremo a extremo y ve el estado "activa" en Refine.

## Fase 4 — Historia 2: obtener un token vigente sin manejar refresh (P1)

- [X] T014 [US2] pgTAP: `marcar_conexion_oauth_invalida` deja `estado = 'con_error'`, registra el evento `invalidada` con motivo, y es invocable únicamente por `service_role` (desvío respecto de `data-model.md`, que mencionaba también admin/superadmin: sin GRANT a `authenticated` a propósito, mismo criterio que `private.marcar_conexion_credencial_invalida` de spec 013 — ver comentario de la función en la migración) — en `supabase/tests/database/conexiones_oauth.test.sql`.
- [X] T015 [US2] pgTAP: el `select` de resolución de `conexion_id` por `organizacion_id` + `clave` (Paso 1 de `contracts/obtener-token-oauth.md`) respeta RLS entre organizaciones.
- [X] T016 [US2] Verificar manualmente el Paso 2 del contrato (`GET {NANGO_SERVER_URL}/connection/:id`) contra la conexión activa creada en la Fase 3, siguiendo `quickstart.md` (paso 8), y registrar la evidencia (sin exponer el token) en este archivo. **Evidencia (2026-09-30)**: `GET /connection/{nango_connection_id}?provider_config_key=google&refresh_token=true` contra la conexión real activa devuelve 200 con `connection_id`, `provider_config_key`, `provider`, `end_user`, `metadata`, `connection_config`, `credentials.{type,access_token,refresh_token,expires_at,raw}` — `raw` trae los campos crudos de Google (`scope` incluido). Sin campos inesperados respecto de lo ya documentado.
- [X] T017 [US2] Revisar que `contracts/obtener-token-oauth.md` quede consistente con el resultado real del paso anterior (nombres de campos de la respuesta de Nango, forma exacta del error de refresh) y corregir si algo difiere de lo documentado. **Corregido (2026-09-30)**: el contrato asumía `conexion_id` (id de `conexiones_oauth`) y `nango_connection_id` como el mismo valor — desde la migración `20260930203338_nango_connection_id_real.sql` ya no lo son (Nango asigna su propio id, no se puede pre-fijar con Connect Session Token). Se corrigieron los tres usos (Paso 1 ahora selecciona ambos campos y aclara cuál va en cada paso siguiente; Paso 2 y el proxy usan `nango_connection_id`; Paso 3 usa el `id` de `conexiones_oauth`). Se agregó también la forma real del error 404 (`{error:{code,message}}`) — el código exacto para credencial revocada queda para T020.

**Checkpoint**: un proceso externo de prueba obtiene un `access_token` vigente siguiendo únicamente el contrato documentado, sin leer código de esta spec.

## Fase 5 — Historia 3: ver estado y reautorizar (P2)

- [X] T018 [US3] pgTAP: reautorizar (repetir `iniciar_conexion_oauth` + `confirmar_conexion_oauth` sobre una conexión `con_error`) no duplica la fila y registra el evento `reautorizada` — en `supabase/tests/database/conexiones_oauth.test.sql`.
- [X] T019 [US3] Extender la pantalla de la Fase 3 para mostrar el estado de cada conexión (`activa`/`con_error`/`pendiente`) con los patrones compartidos de estado ya existentes en el panel, y ofrecer "Reautorizar" cuando el estado es `con_error`.
- [X] T020 [US3] Verificar manualmente el escenario de revocación + reautorización de `quickstart.md` (paso 6) y registrar evidencia. **Evidencia (2026-09-30, revocación real)**: revocado el acceso real de "Agenmatica Integraciones" desde `myaccount.google.com/connections` (cuenta de prueba, con permiso explícito del usuario para esta acción puntual). Confirmado que Google invalida el `access_token` de inmediato (401 directo contra la API de Google), pero `GET /connection` de Nango sigue devolviendo ese mismo token cacheado hasta que intenta refrescarlo de verdad — recién ahí (forzado con el botón "Refresh" del dashboard de Nango) aparece el error real: `{"error":{"code":"invalid_credentials",...}}`, HTTP 400 (detalle completo en `contracts/obtener-token-oauth.md`). Se llamó `marcar_conexion_oauth_invalida` con ese motivo sanitizado y se confirmó: `conexiones_oauth.estado` pasa a `con_error`, y la pantalla `/conexiones-oauth` lo muestra como "Con error" con botón "REAUTORIZAR" visible — reautorización en sí no se repitió (ya validada en T027, mismo flujo de consentimiento).

**Checkpoint**: una conexión revocada se refleja como tal en Refine y se puede reautorizar sin duplicarse.

## Fase 6 — Historia 4: registrar un proveedor nuevo sin tocar el producto (P3)

- [X] T021 [US4] pgTAP: `registrar_integracion_oauth`/`actualizar_integracion_oauth` solo son ejecutables por superadmin; una integración deshabilitada rechaza `iniciar_conexion_oauth` para cualquier organización.
- [X] T022 [US4] Implementar una pantalla mínima de superadmin (`apps/web/src/pages/integraciones-oauth/administrar.tsx`: lista + alta + toggle de `habilitada`) reutilizando los patrones de UI ya existentes del panel de funcionalidades (spec 009), sin lógica de negocio de ningún proveedor concreto.
- [X] T023 [US4] Verificar manualmente que dar de alta una segunda integración de prueba (proveedor distinto de Google) no requiere ningún cambio de esquema ni de la pantalla de la Fase 3. **Evidencia (2026-09-30)**: `select registrar_integracion_oauth('github-test', 'GitHub (prueba T023)')` como superadmin, sin tocar código ni migraciones. La pantalla `/conexiones-oauth` la muestra sola, en su propia fila ("GitHub (prueba T023)" / "No conectado" / CONECTAR) junto a la de Google ("Activa" / REAUTORIZAR) — sin cambio de esquema ni de componente. Queda registrada solo como catálogo (sin client id/secret real en Nango, no funcional para conectar de verdad) — es evidencia de que el mecanismo admite un segundo proveedor, no una integración real a mantener.

**Checkpoint**: el mecanismo admite un segundo proveedor sin tocar el esquema ya publicado.

## Fase 6.1 — Resolución para flows de Kestra (desvío, ver commit `20260930165825`)

Gap real reportado por el agente de `exportar-planilla-contable` (primer
consumidor en paralelo): un flow de Kestra corre como `kestra_orquestacion`
vía JDBC directo, sin `select` sobre `conexiones_oauth`/`integraciones_oauth`.

- [X] `private.datos_despacho_conexion_oauth(organizacion_id, clave)` en
  `supabase/migrations/20260930165825_datos_despacho_conexion_oauth.sql`,
  mismo criterio que `private.datos_despacho_conexion` (spec 013). pgTAP:
  grants (`kestra_orquestacion` sí, `authenticated` no), resolución correcta
  y `P0002` sin conexión activa / integración inexistente.
- [X] Documentado como variante del Paso 1 en `contracts/obtener-token-oauth.md`.

## Fase 7 — Documentación y validación

- [X] T024 [P] Escribir `docs/adoptar-conexiones-oauth.md`: cómo un producto derivado habilita este mecanismo, cómo registra su primera integración real y dónde vive el secreto de Nango en cada entorno.
- [X] T025 [P] Actualizar `docs/deployment.md` con la operación de `nango-server` en staging/producción (dominio propio del producto, igual que Kestra/Superset).
- [X] T026 Ejecutar `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test` (con `pnpm dev:supabase` corriendo) y registrar el resultado en este archivo. **2026-09-30**: `lint` OK (solo warnings preexistentes ajenos a esta spec), `build` OK, `infra:config` OK (incluye `infra/nango`), `pnpm test:web` 103/103, pgTAP de esta spec 41/41 verde (`conexiones_oauth.test.sql`, incluye `datos_despacho_conexion_oauth`). CI real de PR #65 (`application`/`database`/`infrastructure`/`verificar`, stack de Supabase aislado por CI) en verde. Nota operativa: `pnpm test:db` corrido a mano en este worktree mostró fallas ajenas a esta spec (`sistemas_externos`/FK en `conexiones`) porque el Postgres local de desarrollo (`automation-platform-template-supabase-de...`) es compartido entre todos los worktrees del repo — otra sesión resetó esa base mientras yo trabajaba, algo que no afecta a CI (base aislada por spec `isolated-ci-database`) ni a esta migración (aditiva): se re-aplicó a mano sobre la base compartida sin tocar el trabajo de la otra sesión.
- [X] T027 Ejecutar `quickstart.md` completo de punta a punta y documentar evidencia sanitizada (sin tokens, sin credenciales) en este archivo. **Completado 2026-09-30**, cerrado por el coordinador (sesión `sauger`) desde el navegador embebido de Orca, con permiso explícito del usuario para el paso de consentimiento y para la revocación de T020:
  - **Pasos 1–4**: igual que el avance ya registrado (Nango self-hosted, integración `google` con client id/secret real de `agenmatica-integraciones`, `registrar_integracion_oauth`, Edge Function `iniciar-sesion-oauth`).
  - **Paso 5 (consentimiento real)**: completado por el usuario, cuenta de prueba `njones@eraconsultores.com`, en una organización de prueba creada a mano (`Estudio de prueba OAuth`, bloqueada la función Edge `crear-organizacion` en este stack por un bug ajeno a esta spec — se creó por SQL directo). En el camino se encontraron y corrigieron dos bugs reales del propio mecanismo (adicionales a los ya conocidos): `nango.auth(clave, conexionId)` con la firma vieja rechazada por el SDK 0.71.x con connect session token (corregido a `nango.auth(clave)`, después extendido por esta misma spec con `reconnect()`/`nangoConnectionId`), y `oauth_scopes` vacíos en la integración de Nango (Google rechazaba con "Missing required parameter: scope" — configurados a `spreadsheets`+`drive.file`, documentar en `quickstart.md` paso 3).
  - **Verificación real de negocio**: con el token de la conexión activa se leyó de verdad el Google Sheet real de un cliente del estudio (19 pestañas confirmadas) — prueba de que el mecanismo sirve para lo que `exportar-planilla-contable` necesita.
  - **Paso 6 (revocación)**: ver evidencia completa en T020.
  - **Paso 7 (aislamiento entre organizaciones)**: cubierto por pgTAP de RLS (T015), no repetido a mano con dos sesiones de navegador — el mecanismo de RLS es el mismo ya probado en el resto del template.
  - **Paso 8 (contrato de token sin conector real)**: ver evidencia completa en T016/T017.
  - Ninguna credencial real (contraseña de Google, secretos de Nango) quedó escrita en ningún archivo de este repo — solo tokens de prueba efímeros, ya vencidos/revocados al momento de cerrar esta tarea.
- [X] T028 Documentar en `research.md` (R7) la fragilidad operativa encontrada: el stack local de Supabase es único por repo, no por worktree — un `docker restart` del edge runtime tras borrar el worktree que montaba puede tumbarlo para todas las sesiones que comparten ese proyecto local. Mitigado en el momento con un lock de archivo fuera de cualquier worktree, coordinado con el resto de las sesiones activas; sin cambio de código en esta spec.

## Code review (2026-09-30)

Corrido sobre el diff completo contra `main` (Standards + Spec en paralelo,
skill `code-review`), antes de mergear. Sin violaciones duras en ninguno de
los dos ejes.

- **Corregido**: `data-model.md` había quedado desactualizado desde el fix
  de `nango_connection_id` (commit `fb7c011`) — todavía documentaba `id =
  connection_id de Nango` y la firma vieja de un solo parámetro de
  `confirmar_conexion_oauth`. Corregido en este mismo commit.
- **Riesgo de seguridad real, documentado como aceptado (no bloqueante)**:
  `confirmar_conexion_oauth` no valida contra la API de Nango que el
  `nango_connection_id` recibido corresponda a una autorización real
  completada — un admin de organización podría invocarlo directo con un
  valor inventado. Radio de daño acotado a la propia organización del
  admin (el Paso 2 del contrato fallaría contra Nango en el primer uso
  real). Detalle completo en `data-model.md`, tabla de funciones.
- Hallazgos menores (juicio, no corregidos): duplicación de rama en el
  ternario de estado de `list.tsx`, `nango_connection_id` expuesto a
  `authenticated` sin uso actual en la UI, y FR-008 (auditoría) sin
  columnas explícitas de `integracion_id`/`resultado` en
  `eventos_conexion_oauth` (derivables por join). Ninguno justifica
  frenar el merge de una spec ya validada en vivo de punta a punta.

## Dependencias

Fase 1 → Fase 2 → Historia 1 → Historia 2 → Historia 3 → Historia 4 → Fase 7.
Historia 1 e Historia 2 forman el circuito mínimo de valor (conectar + usar) y
deben quedar validadas juntas antes de considerar la spec adoptable por un
producto derivado. Historia 3 e Historia 4 mejoran robustez y generalidad,
pero no bloquean una primera adopción real si el tiempo apremia (quedarían
como seguimiento explícito en `docs/roadmap-template.md` al cerrar el PR).
