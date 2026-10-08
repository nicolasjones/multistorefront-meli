# Tasks: Orquestación de Workers Multi-Organización

**Input**: Design documents from `/specs/013-orquestacion-multi-organizacion/`

**Prerequisites**: plan.md, spec.md (clarificada), research.md, data-model.md, contracts/ (3 archivos), quickstart.md — todos presentes.

**Tests**: pgTAP es obligatorio para el esquema/RLS/roles nuevos (constitución, Technology and Quality Gates — cambio sensible de aislamiento multi-tenant). No se agregan tests automatizados de los flows de Kestra (mismo criterio que la spec 011: se validan manualmente contra `quickstart.md`).

**Organization**: Tareas agrupadas por historia de usuario (spec.md), en orden de prioridad P1 → P2 → P2 → P3 → P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (archivo distinto, sin dependencia de una tarea todavía incompleta)
- **[Story]**: a qué historia de usuario pertenece (US1-US5)

## Path Conventions

Una sola migración (`supabase/migrations/<timestamp>_orquestacion_multi_organizacion.sql`) acumula todo el esquema — se edita de forma incremental en la Fase 2 (Foundational), igual que hizo la spec 009. Las fases de historia de usuario agregan flows de Kestra, pantallas de Refine y documentación sobre ese esquema ya existente.

---

## Phase 1: Setup

**Purpose**: preparar los puntos de edición sin lógica todavía.

- [X] T001 [P] Crear `supabase/migrations/<timestamp>_orquestacion_multi_organizacion.sql` con el comentario de alcance/reversión (aditiva, sin destruir nada) y `create extension if not exists supabase_vault;` — sin tablas todavía.
- [X] T002 [P] Crear el esqueleto de `supabase/tests/database/orquestacion_multi_organizacion.test.sql` con el fixture multi-tenant (dos organizaciones, un administrador por cada una, un miembro sin rol admin) — mismo patrón que `panel_de_funcionalidades.test.sql`.

**Checkpoint**: archivos listos para completar en la fase siguiente.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: todo el esquema, roles, RLS y funciones `SECURITY DEFINER` de los que dependen las cinco historias (`data-model.md`).

**⚠️ CRITICAL**: ninguna historia de usuario puede implementarse sin esta fase.

- [X] T003 En la migración de T001: crear las 4 tablas de `data-model.md` (`servidores_organizacion`, `conexiones`, `excepciones_flow_generico`, `alertas`) con sus PK/FK, el `check` de `conexiones.estado` (`activa`/`error`/`credencial_invalida`) y el `check` de `alertas.tipo` (`tecnica`/`credencial`) — sin índice único en `conexiones` sobre `(organizacion_id, sistema_externo)` (R10, FR-021).
- [X] T004 En el mismo archivo: crear el rol `kestra_orquestacion` (`LOGIN`, sin privilegios generales) — mismo patrón que `kestra_backups` (spec 011, `20260913140000_backups_postgres.sql`).
- [X] T005 En el mismo archivo: agregar `private.es_administrador_de(p_organizacion_id uuid)` (rol `administrador` en esa organización, o superadmin) — mismo esqueleto que `private.puede_gestionar_membresias` (`20260909043625_gestion_miembros.sql`).
- [X] T006 En el mismo archivo: agregar `private.aprovisionar_servidor_organizacion(organizacion_id, host, puerto, usuario, credencial_ssh)` — `security definer`, solo superadmin: crea dinámicamente el rol `worker_<organizacion_id sin guiones>` (`execute format('create role %I login password %L', ...)`), genera su contraseña, guarda credencial SSH y credencial de rol en Vault (`vault.create_secret`), inserta la fila en `servidores_organizacion` con ambos `*_vault_id`, y devuelve la contraseña del rol **una sola vez** en el resultado (R5, FR-014).
- [X] T007 En el mismo archivo: agregar `private.organizacion_del_rol_actual()` — resuelve `servidores_organizacion.organizacion_id` a partir de `current_user = servidores_organizacion.rol_db` (R5); es la función que las políticas RLS de las tablas de dominio de una implementación futura deberán usar, documentada con un comentario que remite a `research.md` R5. Desvío: usa `session_user`, no `current_user` — dentro de una función `security definer`, `current_user` pasa a ser el dueño de la función, no quien llamó (verificado empíricamente); motivo completo en el comentario de la función en la migración.
- [X] T008 En el mismo archivo: agregar `private.crear_conexion(organizacion_id, sistema_externo, credencial)` y `private.actualizar_credencial_conexion(conexion_id, nueva_credencial)` — `security definer`, chequean `private.es_administrador_de` internamente, guardan/rotan el secreto en Vault (`vault.create_secret`/`vault.update_secret`) sin que la app inserte nunca un valor plano directo en `conexiones`.
- [X] T009 En el mismo archivo: agregar `private.obtener_credencial_conexion(conexion_id)` y `private.obtener_credencial_servidor(organizacion_id)` — `security definer`, permiten `authenticated` (chequeando `es_administrador_de` internamente) y `kestra_orquestacion` explícito; `revoke execute ... from public`; nunca exponen `vault.decrypted_secrets` directo (R4, FR-006/FR-007).
- [X] T010 En el mismo archivo: agregar `private.marcar_conexion_activa(conexion_id)`, `private.marcar_conexion_credencial_invalida(conexion_id, motivo)` y `private.registrar_alerta(tipo, organizacion_id, conexion_id, motivo)` — `security definer`, `grant execute` únicamente a `kestra_orquestacion` (R8, R9). Desvío: `marcar_conexion_credencial_invalida` solo cambia el estado, no inserta en `alertas` — `contracts/alertas.md` deja esa inserción exclusivamente al subflow (`registrar_alerta`), a diferencia de la redacción resumida de `data-model.md`.
- [X] T011 En el mismo archivo: activar RLS en las 4 tablas — `servidores_organizacion` (select: superadmin o `es_administrador_de`; insert/update: solo vía T006, sin política de escritura directa para `authenticated`), `conexiones` (select/insert/update/delete: `es_administrador_de`, sin exponer `credencial_vault_id` — usar una vista o `security invoker` que la excluya si hace falta), `excepciones_flow_generico` (select/insert/delete: solo superadmin), `alertas` (select: superadmin ve todas, administrador de organización solo `tipo = 'credencial'` de la suya). Desvío: en vez de vista/security invoker, `credencial_vault_id`/`credencial_ssh_vault_id`/`credencial_db_vault_id` se excluyen con `grant select (columnas...)` (grant a nivel de columna) — más simple, mismo efecto.
- [X] T012 Completar `supabase/tests/database/orquestacion_multi_organizacion.test.sql` (pgTAP): permisos de las 4 tablas por rol (superadmin, administrador de su propia organización, administrador de otra organización, miembro sin rol admin), aislamiento entre organizaciones, que `credencial_vault_id`/`credencial_ssh_vault_id`/`credencial_db_vault_id` nunca sean legibles directo por `authenticated`, que `obtener_credencial_conexion`/`obtener_credencial_servidor` fallen para quien no tiene permiso, y que `organizacion_del_rol_actual()` resuelva correctamente para un rol `worker_*` de prueba. `pnpm test:db` en verde junto con las suites existentes. Desvío: la resolución de `organizacion_del_rol_actual()` vía `session_user` no es simulable con `set local role` dentro de una única conexión pgTAP (no cambia `session_user`) — se prueba el grant puntual al rol `worker_*` creado y el caso sin match (`session_user` = `postgres`); la resolución real de punta a punta queda para `quickstart.md` (mismo límite ya aceptado en `backups_postgres.test.sql` para `kestra_backups`).

**Checkpoint**: esquema completo, RLS probada con pgTAP — recién acá arrancan las historias de usuario.

---

## Phase 3: User Story 1 - Ejecutar el worker de una organización en su propio servidor (Priority: P1) 🎯 MVP

**Goal**: que el trabajo de integración de una organización corra físicamente en su propio servidor, no en el central.

**Independent Test**: con un único servidor de organización de prueba dado de alta (`quickstart.md`, pasos 1-2), disparar la ejecución de un conector para esa organización y confirmar que el contenedor corre ahí, no en el servidor central (Independent Test de US1 en `spec.md`).

### Implementation for User Story 1

- [X] T013 [P] [US1] Agregar `KESTRA_ORQUESTACION_DB_URL`/`KESTRA_ORQUESTACION_DB_PASSWORD` a `.env.example` — mismo patrón que `KESTRA_BACKUPS_DB_URL`/`PASSWORD`. Desvío: también se cableó `infra/kestra/compose.yaml` (`ENV_KESTRA_ORQUESTACION_DB_*`, mismo patrón que `kestra_backups`) — necesario para que el flow de T015 pueda leer estas variables, tasks.md no lo listaba como paso aparte.
- [X] T014 [P] [US1] Agregar un job al workflow de CI (`.github/workflows/validate.yml` o uno nuevo bajo `infra/runner/`) que construya la imagen de un worker (cuando exista `workers/<carpeta>/Dockerfile`, spec 012) y la publique en `ghcr.io/<owner>/<repo>-worker-<nombre>` usando el `GITHUB_TOKEN` ya disponible en el runner self-hosted, sin credencial nueva (R11) — corre en cada push a `main` que toque `workers/`. Implementado como workflow nuevo (`.github/workflows/worker-images.yml`) en vez de un job dentro de `validate.yml`, para poder filtrar por `paths: workers/**` sin afectar los demás jobs.
- [X] T015 [US1] Crear `infra/kestra/flows/plantilla-generico.yml` con la tarea de despacho por organización: SSH (`io.kestra.plugin.fs.ssh.Command` o el plugin SSH disponible en la imagen `kestra/kestra` ya pinneada) que llama `obtener_credencial_servidor`/`obtener_credencial_conexion` (vía tarea JDBC previa, mismo patrón que `iniciar_respaldo` en `respaldo-postgres.yml`), hace `docker pull` (de la imagen publicada en T014) + `docker run` en el servidor de la organización, y en éxito llama `private.marcar_conexion_activa` (R1, R9) — por ahora para una sola organización pasada como input, sin el recorrido paralelo todavía (eso es US2). Desvío: se agregó `private.datos_despacho_conexion(organizacion_id, sistema_externo)` a la migración de Foundational — `kestra_orquestacion` no tenía (ni debía tener, mismo criterio que `kestra_backups`) select directo sobre `servidores_organizacion`/`conexiones` para resolver host/puerto/usuario/conexion_id; ver comentario de la función en la migración y pgTAP nuevo. Ver también la nota de desvío de Foundational, abajo.
- [X] T016 [P] [US1] Crear `apps/web/src/pages/servidores/list.tsx` y `apps/web/src/pages/servidores/create.tsx` — lista de servidores (host, organización, fecha de alta) y formulario de alta que llama `private.aprovisionar_servidor_organizacion`, mostrando la contraseña del rol devuelta una única vez con aviso explícito de que no se puede recuperar después (mismo criterio de UX que cualquier secret manager).
- [X] T017 [US1] Registrar el resource `servidores` (`list: '/servidores'`, `create: '/servidores/create'`) y sus rutas en `apps/web/src/App.tsx`; restringirlo a superadmin en `apps/web/src/providers/accessControlProvider.ts` (mismo bloque que `organizaciones`/`features-administrar`) y sumarlo a `RECURSOS_EXCLUSIVOS_SUPERADMIN` en `apps/web/src/components/SiderConSeccionesSuperadmin.tsx`.

**Desvío de Foundational (T006/T008/T009, descubierto al implementar T016)**: las 5 funciones que Refine llama directo desde el navegador (`aprovisionar_servidor_organizacion`, `crear_conexion`, `actualizar_credencial_conexion`, `obtener_credencial_conexion`, `obtener_credencial_servidor`) habían quedado en el schema `private`, inalcanzable por `supabaseClient.rpc(...)` — PostgREST solo expone `public`/`graphql_public` (`supabase/config.toml`, `api.schemas`). Se movieron a `public`, mismo patrón que el resto del repo (`public.agregar_miembro`, `public.habilitar_feature`, etc.); `private` queda solo para helpers que ninguna sesión de PostgREST necesita invocar directo. Sin cambio de lógica, solo de schema — ver comentario al inicio de la migración.

**Checkpoint**: User Story 1 completa y verificable de forma independiente — ya es un incremento entregable (MVP): un servidor de organización puede darse de alta y recibir una ejecución despachada por SSH con una imagen real publicada por CI.

---

## Phase 4: User Story 2 - Un solo flow atendiendo a todas las organizaciones, en paralelo (Priority: P2)

**Goal**: agregar una organización nueva a un conector no requiere un flow nuevo, y varias organizaciones se procesan al mismo tiempo.

**Independent Test**: con un flow de ejemplo y organizaciones ficticias, confirmar que las ejecuciones se solapan en el tiempo y que una organización con flow dedicado queda excluida del genérico (Independent Test de US2 en `spec.md`).

### Implementation for User Story 2

- [X] T018 [US2] Extender `infra/kestra/flows/plantilla-generico.yml` (T015): reemplazar el input de una sola organización por una consulta previa (tarea JDBC) que trae todas las `conexiones.organizacion_id` con `estado = 'activa'` para este conector, **excluyendo** las que tengan fila en `excepciones_flow_generico` (FR-005), y recorrerlas con una tarea paralela (`EachParallel`/`ForEach` con `concurrent`, según la sintaxis vigente de la imagen pinneada) con tope tomado de `KESTRA_ORQUESTACION_CONCURRENCIA` (default documentado `10`, R6).
- [X] T019 [P] [US2] Agregar `KESTRA_ORQUESTACION_CONCURRENCIA` a `.env.example` con el default `10` y un comentario que remite a `research.md` R6.
- [X] T020 [P] [US2] Crear `infra/kestra/flows/plantilla-dedicado.yml` — mismo contrato de despacho que el genérico (reusa la lógica de T015 para una sola organización) pero fijo a una organización, con la convención de nombre `<producto>.<conector>.<organizacion-slug>` (`contracts/orquestacion-kestra.md`).
- [X] T021 [US2] Documentar en `contracts/orquestacion-kestra.md` que el alta/baja de una fila en `excepciones_flow_generico` se gestiona directo en Supabase Studio (sin pantalla de Refine dedicada en esta spec) hasta que exista un caso de uso que la justifique (Principio V) — sin RLS de escritura para `authenticated` (T011), es una operación exclusiva de superadmin vía SQL directo.

**Checkpoint**: User Stories 1 y 2 funcionan juntas — el flow genérico atiende a todas las organizaciones activas en paralelo, con tope de concurrencia, sin duplicar a las que tienen flow dedicado.

---

## Phase 5: User Story 3 - Gestionar credenciales de forma segura, sin que crezcan sin control (Priority: P2)

**Goal**: un administrador conecta un sistema externo sin que su credencial quede expuesta, y un miembro sin ese rol no puede verla ni tocarla.

**Independent Test**: revisar que ninguna credencial aparece en texto plano fuera de Vault, y que un miembro sin rol administrador no puede ver ni modificar una conexión pero sí los datos ya importados (Independent Test de US3 en `spec.md`).

### Implementation for User Story 3

- [X] T022 [P] [US3] Crear `apps/web/src/pages/conexiones/list.tsx` — lista de conexiones de la organización activa (sistema externo, estado, fecha), visible solo si `es_administrador_de` (RLS ya lo garantiza; la UI además oculta el link si no corresponde).
- [X] T023 [P] [US3] Crear `apps/web/src/pages/conexiones/create.tsx` — formulario que llama `public.crear_conexion`, sin guardar nunca la credencial en el estado de React más tiempo del necesario para el envío. Desvío: la RPC vive en `public`, no `private`, porque PostgREST solo expone `public`/`graphql_public` (ver nota de Fase 3).
- [X] T024 [P] [US3] Crear `apps/web/src/pages/conexiones/edit.tsx` — permite rotar la credencial vía `public.actualizar_credencial_conexion`; no muestra la credencial actual (Vault no la devuelve para edición, solo para ejecución vía R4). Desvío: misma ubicación `public` de la RPC que T023.
- [X] T025 [US3] Registrar el resource `conexiones` en `apps/web/src/App.tsx` y sumarlo a `RECURSOS_DEPENDIENTES_DE_ORGANIZACION` (`apps/web/src/lib/recursosDependientesDeOrganizacion.ts`); en `accessControlProvider.ts`, agregar la misma rama que ya existe para `miembros` (chequeo `rol_id === 'administrador'` cuando no es superadmin).

**Checkpoint**: Users Stories 1, 2 y 3 funcionan juntas de forma independiente — gestión de conexiones segura y restringida por rol.

---

## Phase 6: User Story 4 - Enterarse cuando algo falla, y saber a quién le toca actuar (Priority: P3)

**Goal**: una falla se notifica a la audiencia correcta, distinguiendo técnica de credencial.

**Independent Test**: provocar una falla de cada tipo y confirmar que cada una llega a la audiencia correcta (Independent Test de US4 en `spec.md`).

### Implementation for User Story 4

- [X] T026 [US4] Crear `infra/kestra/flows/alertas.yml` (namespace `platform.alertas`, mismo patrón de namespace que `respaldo-postgres.yml`) según `contracts/alertas.md`: inputs `tipo`/`organizacion_id`/`conexion_id`/`motivo`, llama `private.registrar_alerta` y despacha la notificación al canal configurado (variable de entorno nueva, `KESTRA_ALERTAS_WEBHOOK_URL` o equivalente — a definir en implementación según el mecanismo de notificación elegido).
- [X] T027 [US4] Extender `infra/kestra/flows/plantilla-generico.yml` y `plantilla-dedicado.yml` (T015/T020): agregar `retry` (`maxAttempt: 3`, backoff — R7) a la tarea de despacho SSH, y un bloque `errors:` que distingue falla de credencial (llama `private.marcar_conexion_credencial_invalida` + invoca `alertas.yml` con `tipo: credencial`) de falla técnica genérica (invoca `alertas.yml` con `tipo: tecnica`, sin tocar `conexiones.estado`) — mismo criterio de distinción que ya usa el worker (código de salida/mensaje, contrato de worker spec 012).
- [X] T028 [P] [US4] Agregar la variable de notificación (`KESTRA_ALERTAS_WEBHOOK_URL` o la elegida en T026) a `.env.example`.

**Checkpoint**: las cuatro historias funcionan juntas — fallas técnicas y de credencial se distinguen y notifican a la audiencia correcta, con reintentos antes de alertar.

---

## Phase 7: User Story 5 - Dar de alta el servidor de una organización nueva (Priority: P3)

**Goal**: un procedimiento claro y manual para dejar operativo el servidor de una organización nueva.

**Independent Test**: seguir el procedimiento documentado paso a paso contra un servidor de prueba y confirmar que queda listo para recibir ejecuciones (Independent Test de US5 en `spec.md`).

### Implementation for User Story 5

- [X] T029 [US5] Agregar la sección "Servidores de organización" a `docs/deployment.md`: procedimiento manual de alta (levantar Docker + `sshd` en el VPS de la organización, generar sus credenciales acotadas, llamar `private.aprovisionar_servidor_organizacion` desde `apps/web/src/pages/servidores/create.tsx`, copiar la contraseña del rol en el momento — FR-014), explícito en que no requiere ni justifica una herramienta propia todavía (US5 AC2).
- [X] T030 [US5] En la misma sección de `docs/deployment.md`: documentar la nota de continuidad ante restauración de backup en un proyecto distinto (FR-019, R13) — las credenciales cifradas no son recuperables, la respuesta aceptada es reconectar cada sistema externo y regenerar las credenciales de infraestructura de cada organización.

**Checkpoint**: las cinco historias de usuario funcionan, de forma independiente y en conjunto.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Propósito**: validación final de punta a punta y las convenciones que no son específicas de ninguna historia (FR-010, FR-017/FR-018).

- [X] T031 [P] Agregar a `workers/README.md` una subsección de testing bajo la sección de convención de integración: fixtures grabados (JSON) del dato crudo del sistema externo para verificar la normalización en CI sin acceso en vivo al sistema real, y la aclaración de que la automatización de navegador no persigue cobertura realista contra el sistema externo real (R12, extiende — no duplica — el contrato de worker ya existente).
- [X] T032 [P] Agregar a `workers/README.md`, en la sección "Tabla central", una aclaración sobre lectura: cualquier miembro de la organización puede leer las filas ya importadas, sin el rol de administrador que sí aplica a gestionar la conexión que las trajo (FR-010) — distinto de la conexión en sí (`conexiones`, gestión restringida a administrador/superadmin, spec 013).
- [X] T033 Correr `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test` (comandos de validación de `CLAUDE.md`) con todo lo anterior aplicado.
- [X] T034 Ejecutar manualmente los 9 pasos de `quickstart.md` de punta a punta y anotar cualquier desvío en este archivo, con referencia al commit que lo resuelve.
- [X] T035 Actualizar el campo `**Status**` de `spec.md` de `Draft` a `Implemented`.
- [X] T036 [P] Actualizar `checklists/requirements.md` (sección Feature Readiness) dejando registrado que la implementación se completó y validó contra `quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — arranca de inmediato.
- **Foundational (Phase 2)**: depende de Setup — bloquea a las cinco historias.
- **User Story 1 (Phase 3)**: depende de Foundational. Es el MVP — sin dependencia de otras historias.
- **User Story 2 (Phase 4)**: depende de Foundational y edita el mismo flow que crea US1 (T015) — secuencial con US1 en la práctica, aunque conceptualmente independiente (el genérico de una sola organización ya es válido antes de agregar el paralelismo).
- **User Story 3 (Phase 5)**: depende de Foundational únicamente — no toca los flows de Kestra, puede implementarse en paralelo con US1/US2 si hay más de una persona trabajando.
- **User Story 4 (Phase 6)**: depende de Foundational y edita los flows de US1/US2 (T015/T020) para agregar retry/errors — secuencial después de US2.
- **User Story 5 (Phase 7)**: depende de Foundational (la función de aprovisionamiento) y de que exista la pantalla de US1 (T016) a la que el procedimiento remite — secuencial después de US1.
- **Polish (Phase 8)**: depende de que las cinco historias estén completas.

### Notas sobre paralelismo

T013/T014/T016 (US1), T019/T020 (US2) y T022/T023/T024 (US3) están marcadas `[P]` por tocar archivos distintos sin depender del contenido de las demás. US3 en conjunto puede avanzar en paralelo con US1/US2 (no comparte archivos de Kestra). T031/T032/T036 (Polish) también son `[P]` — archivos distintos entre sí (T031 y T032 tocan `workers/README.md` en secciones distintas, sin conflicto real) y sin depender del contenido específico de las tareas de Polish anteriores.

---

## Implementation Strategy

### MVP primero (User Story 1 únicamente)

1. Completar Fase 1: Setup.
2. Completar Fase 2: Foundational — todo el esquema, RLS y funciones.
3. Completar Fase 3: User Story 1.
4. **Parar y validar**: pasos 1-2 de `quickstart.md` — un servidor de organización se aprovisiona y recibe una ejecución despachada por SSH.
5. Esto ya es un incremento entregable — el mecanismo base de aislamiento por organización queda operativo aunque el resto de las historias no estén.

### Entrega incremental

1. Setup + Foundational → esquema completo y probado.
2. User Story 1 → validar → MVP (dispatch por SSH a un servidor, con imagen real publicada por CI).
3. User Story 2 → validar → un solo flow, en paralelo, sin duplicar organizaciones con excepción.
4. User Story 3 → validar → gestión de conexiones segura y restringida por rol.
5. User Story 4 → validar → alertas centralizadas con la audiencia correcta.
6. User Story 5 → validar → procedimiento de alta documentado.
7. Polish → validación final de punta a punta con `quickstart.md`.

Dado que varias historias comparten los mismos archivos de Kestra (`plantilla-generico.yml`, `plantilla-dedicado.yml`), "entrega incremental" acá significa commits separados por historia dentro de la misma rama/PR, no despliegues independientes — mismo criterio ya usado en la spec 012.

## Phase 9: Convergence

- [X] T037 Hacer que `infra/kestra/flows/plantilla-generico.yml` delegue sus fallas agotadas al subflow centralizado `platform.alertas.alertas`, manteniendo la clasificación credencial/técnica, la actualización de estado y el webhook para ambas audiencias, y validar ambos recorridos (FR-011, FR-012, US4/AC1-3) (partial)
- [X] T038 Cambiar `public.crear_conexion` para que su respuesta RPC no exponga `credencial_vault_id` y agregar cobertura pgTAP que pruebe esa garantía sin afectar la creación autorizada de conexiones (T011, FR-006) (partial)
