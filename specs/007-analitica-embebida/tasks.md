---

description: "Task list template for feature implementation"
---

# Tasks: Analítica embebida por organización

**Input**: Design documents from `/specs/007-analitica-embebida/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (todos presentes)

**Tests**: pgTAP es obligatorio para el esquema/RLS/RPCs nuevos (constitución,
Technology and Quality Gates — cambio sensible de aislamiento). Se agregan
además un par de tests de Vitest para la lógica propia de UI (grilla de
permisos, estado vacío/fallback) — ver research.md #8 para por qué no hay
tests de la Edge Function ni del SDK de embedding.

**Organization**: Tasks agrupadas por historia de usuario (spec.md), en
orden de prioridad P1 → P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (archivo distinto, sin dependencia
  de una tarea todavía incompleta)
- **[Story]**: a qué historia de usuario pertenece (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: dependencias y configuración compartida, sin lógica de negocio
todavía.

- [X] T001 [P] Agregar la dependencia `@superset-ui/embedded-sdk` en `apps/web/package.json`
- [X] T002 [P] Agregar a `infra/superset/superset_config.py`: `FEATURE_FLAGS = {"EMBEDDED_SUPERSET": True}`, `GUEST_TOKEN_JWT_SECRET` (desde variable de entorno), `ENABLE_CORS`/`CORS_OPTIONS` para el origen de Refine (research.md #9) — de paso hizo falta reenviar las dos variables nuevas en `infra/superset/compose.yaml` (no estaba previsto en la tarea original; sin eso el contenedor no arranca)
- [X] T003 [P] Documentar variables nuevas en `.env.example` (`SUPERSET_GUEST_TOKEN_JWT_SECRET`, `REFINE_ORIGIN`) y crear `supabase/functions/.env.example` (`SUPERSET_URL`, `SUPERSET_GUEST_TOKEN_USERNAME`, `SUPERSET_GUEST_TOKEN_PASSWORD`) — sin valores reales, solo el molde (regla de secretos de `CLAUDE.md`)

**Checkpoint**: dependencias y configuración listas, sin tocar todavía
esquema ni código de negocio.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema, RLS y RPCs de los que dependen las tres historias.

**⚠️ CRITICAL**: ninguna historia de usuario puede implementarse sin esta fase.

- [X] T004 Crear `supabase/migrations/<timestamp>_analitica_embebida.sql` con las 5 tablas de `data-model.md` (`reportes`, `reportes_roles_default`, `reportes_organizaciones`, `reportes_organizaciones_roles`, `eventos_reportes`), sus PK/FK y los `check` que excluyen `'administrador'` de las tablas de roles
- [X] T005 En el mismo archivo: agregar las funciones `private.rol_id()` y `private.puede_gestionar_reportes(p_organizacion_id uuid)` (data-model.md, sección "Funciones helper") — se sumó una tercera, `private.puede_ver_reporte(p_reporte_id uuid)`, no prevista originalmente: evita que la policy de `reportes` consulte otra tabla con RLS propia desde su `using` (riesgo de recursión), ver data-model.md actualizado
- [X] T006 En el mismo archivo: agregar `private.heredar_roles_default_reporte()` y el trigger `reportes_organizaciones_heredar_roles` (`after insert on reportes_organizaciones`) — código exacto en data-model.md
- [X] T007 En el mismo archivo: agregar las 5 RPCs (`registrar_reporte`, `establecer_roles_default_reporte`, `asignar_reporte`, `desasignar_reporte`, `establecer_roles_reporte_organizacion`) según `contracts/gestion-reportes.md`, todas `security definer`, `search_path = ''`, con `revoke execute ... from public; grant execute ... to authenticated`
- [X] T008 En el mismo archivo: activar RLS en las 5 tablas, agregar las policies de `select` de `data-model.md` (sección RLS), y los `grant select` a `authenticated` sin ningún `insert`/`update`/`delete` directo (patrón endurecido de la spec 005)
- [X] T009 Escribir `supabase/tests/database/analitica_embebida.test.sql` (pgTAP): aislamiento entre organizaciones en las 4 tablas con RLS de negocio, acceso incondicional de `administrador`, rechazo de RPCs a quien no es superadmin/admin de la organización correspondiente, idempotencia de `asignar_reporte`, que `desasignar_reporte` + reasignar arranca desde el default vigente (no conserva lo anterior), que cada RPC inserta la fila esperada en `eventos_reportes` con actor/acción/organización correctos (FR-012/SC-004), que `establecer_roles_reporte_organizacion` rechaza configurar un reporte no asignado a esa organización, y que un rol nuevo agregado a `roles_organizacion` no aparece habilitado en ningún reporte existente (FR-014) — 30 assertions, `pnpm test:db` en verde junto con las suites existentes

**Checkpoint**: esquema completo, RLS probada con pgTAP, RPCs funcionando
contra la base — recién acá arrancan las historias de usuario.

---

## Phase 3: User Story 1 - El superadmin registra y asigna reportes (Priority: P1) 🎯 MVP

**Goal**: el superadmin puede registrar un reporte de Superset en el
catálogo, definir su visibilidad por rol por defecto, y asignarlo a una o
más organizaciones — sin esto no existe nada que una organización pueda ver.

**Independent Test**: como superadmin, registrar un reporte, definir su
default, asignarlo a una organización y confirmar (por API o consultando
las tablas) que la organización queda con la visibilidad heredada
correctamente (quickstart.md, sección 1).

### Implementation for User Story 1

- [X] T010 [P] [US1] Crear `apps/web/src/components/GrillaPermisosPorRol.tsx` — componente reutilizable (filas = reportes o un solo reporte, columnas = `roles_organizacion` excepto `administrador`, que se muestra siempre tildado y deshabilitado; checkbox por intersección; `onChange(rolesSeleccionados: string[])`)
- [X] T011 [US1] Crear `apps/web/src/pages/analitica/administrar.tsx`: lista el catálogo (`reportes` + `reportes_roles_default`), formulario para `registrar_reporte` (UUID de embedding + nombre + `GrillaPermisosPorRol` para el default), acción `establecer_roles_default_reporte` para editar el default de uno ya existente, selector de organizaciones con `asignar_reporte`/`desasignar_reporte`
- [X] T012 [US1] Registrar el resource `analitica-administrar` y la ruta `/analitica/administrar` en `apps/web/src/App.tsx`; restringir su acceso a superadmin en `apps/web/src/providers/accessControlProvider.ts` (mismo criterio que ya usa el resource `organizaciones`)

**Checkpoint**: el superadmin puede registrar, definir default, asignar y
desasignar reportes de punta a punta (quickstart.md, secciones 1 y 4).

---

## Phase 4: User Story 2 - Miembros y administradores visualizan sus reportes (Priority: P2)

**Goal**: cualquier persona de una organización ve, embebidos dentro del
producto, los reportes que le fueron asignados, con datos limitados a su
propia organización.

**Independent Test**: con un reporte ya asignado y visible para el rol de
quien consulta, confirmar que lo ve embebido con sus propios datos; repetir
con otra organización y confirmar que ve datos distintos; confirmar que una
organización sin reportes ve un mensaje explícito y que un acceso no
autorizado es rechazado sin filtrar información (quickstart.md, sección 2).

### Implementation for User Story 2

- [X] T013 [P] [US2] Crear `supabase/functions/emitir-acceso-reporte/index.ts` según `contracts/acceso-reporte.md`: valida el JWT de quien llama, resuelve autorización con un cliente Supabase scoped al usuario (nunca service-role) contra `reportes_organizaciones_roles`, y si autorizado pide el guest token a Superset (login + `guest_token/` con `rls` forzada); `403` si no autorizado, `503` con `{"error":"analitica_no_disponible"}` si Superset no responde (FR-015)
- [X] T014 [P] [US2] Crear `apps/web/src/hooks/useReportesAsignados.ts` (mismo patrón que `useOrganizacionActiva.ts`): lista los reportes visibles para el usuario actual consultando `reportes` (la RLS ya filtra por organización y rol)
- [X] T015 [P] [US2] Crear `apps/web/src/components/ReporteEmbebido.tsx`: llama a `emitir-acceso-reporte`, monta `@superset-ui/embedded-sdk` con el guest token recibido, y muestra el mensaje "Analítica no disponible en este momento" tanto si la función devuelve `503` como si el propio SDK falla al montar (FR-015, sin exponer detalle técnico)
- [X] T016 [US2] Crear `apps/web/src/pages/analitica/list.tsx`: usa `useReportesAsignados`, muestra el mensaje de "no tenés reportes configurados" si la lista viene vacía (FR-011), y abre `ReporteEmbebido` al seleccionar uno
- [X] T017 [US2] Agregar `'analitica'` a `RECURSOS_DEPENDIENTES_DE_ORGANIZACION` en `apps/web/src/lib/recursosDependientesDeOrganizacion.ts`, y registrar el resource `analitica` + ruta `/analitica` en `apps/web/src/App.tsx`
- [X] T018 [P] [US2] Vitest para `apps/web/src/pages/analitica/list.tsx` (o `ReporteEmbebido.tsx`): estado vacío sin reportes asignados, y mensaje de fallback cuando la Edge Function devuelve `503`

**Checkpoint**: miembros y administradores ven sus reportes asignados con
datos aislados; estado vacío y caída de Superset verificados
(quickstart.md, secciones 2 y 5).

---

## Phase 5: User Story 3 - El administrador ajusta la visibilidad por rol de su organización (Priority: P3)

**Goal**: el administrador de una organización cambia, solo para la suya,
qué roles ven cada reporte asignado, sin afectar a otras organizaciones ni
al default global.

**Independent Test**: como administrador de una organización con un
reporte visible para dos roles, quitarle visibilidad a uno; confirmar que
ese rol deja de verlo y que otra organización con el mismo reporte no se
ve afectada (quickstart.md, sección 3).

### Implementation for User Story 3

- [X] T019 [US3] Crear `apps/web/src/pages/analitica/permisos.tsx`: para cada reporte asignado a la organización activa del usuario, reutiliza `GrillaPermisosPorRol` (T010) mostrando `reportes_organizaciones_roles` de esa organización, y llama `establecer_roles_reporte_organizacion` al guardar
- [X] T020 [US3] Registrar la ruta `/analitica/permisos` en `apps/web/src/App.tsx`, visible solo para quien `usePuedeEscribir()` resuelve en `true` (mismo hook que ya gatea escritura en Clientes)
- [X] T021 [P] [US3] Vitest para `GrillaPermisosPorRol.tsx`: togglear un checkbox dispara `onChange` con el conjunto correcto, y la columna `administrador` se renderiza siempre tildada y deshabilitada

**Checkpoint**: las tres historias de usuario funcionan de punta a punta,
de forma independiente entre sí.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T022 Correr `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test` (comandos de validación de `CLAUDE.md`) con todo lo anterior aplicado
- [X] T023 Ejecutar manualmente las 6 secciones de `quickstart.md` de punta a punta y anotar cualquier desvío en `tasks.md` con referencia al commit que lo resuelve

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — arranca de inmediato.
- **Foundational (Phase 2)**: depende de Setup — bloquea las tres historias.
- **User Stories (Phase 3-5)**: dependen todas de Foundational. US2 y US3
  además reutilizan piezas de US1 (`GrillaPermisosPorRol`, T010) y del
  esquema de Foundational — no son 100% aislables entre sí como en un
  dominio sin relación, pero cada una agrega valor demostrable por separado.
- **Polish (Phase 6)**: depende de las historias que se hayan implementado.

### User Story Dependencies

- **US1 (P1)**: solo depende de Foundational. Es el punto de partida — sin
  un reporte registrado y asignado, US2 no tiene nada que mostrar.
- **US2 (P2)**: depende de Foundational y de que exista al menos un
  reporte asignado (dato de prueba, no código) para poder probarse — no
  depende del código de US1.
- **US3 (P3)**: depende de Foundational y reutiliza el componente
  `GrillaPermisosPorRol` creado en US1 (T010) — única dependencia de código
  real entre historias.

### Parallel Opportunities

- T001, T002, T003 (Setup) — archivos distintos, en paralelo.
- T013, T014, T015 (US2) — archivos distintos, ninguno depende del código
  final de los otros dos (cada uno se programa contra el contrato
  documentado, no contra la implementación del otro).
- T018 y T021 — tests que pueden escribirse en paralelo con tareas de otra
  fase, una vez exista el componente que prueban.

---

## Parallel Example: User Story 2

```bash
# Los tres archivos nuevos de US2 no dependen entre sí para poder escribirse:
Task: "Crear supabase/functions/emitir-acceso-reporte/index.ts"
Task: "Crear apps/web/src/hooks/useReportesAsignados.ts"
Task: "Crear apps/web/src/components/ReporteEmbebido.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Setup + Foundational.
2. User Story 1 completa.
3. Validar con quickstart.md secciones 1 y 4 (registrar, asignar,
   desasignar, cambiar default sin afectar asignaciones existentes).
4. En este punto no hay nada visible para organizaciones todavía — el MVP
   de esta spec es la capacidad de gestión, no la de visualización; recién
   con US2 hay valor de cliente final.

### Incremental Delivery

1. Setup + Foundational → esquema listo.
2. US1 → el superadmin puede armar el catálogo (sin nadie más viéndolo
   todavía).
3. US2 → valor real de cliente: organizaciones ven sus reportes aislados.
4. US3 → ajuste fino, opcional para un primer release (el default heredado
   ya es un comportamiento correcto sin esta historia).

---

## Notes

- No hay tareas de contract test dedicadas (`tests/contract/`) porque el
  "contrato" de las RPCs se verifica con pgTAP (T009) y el de la Edge
  Function con quickstart manual (research.md #8) — agregar un tercer tipo
  de test para lo mismo sería redundante en este repo.
- Las notas de desvío respecto a este plan van en este archivo, cortas, con
  referencia al commit (`ver commit <hash>`) — no se repite acá la razón
  completa, esa vive en el mensaje de commit (regla de `CLAUDE.md`).

## Desvíos encontrados en T023 (quickstart de punta a punta)

- CSRF de Superset bloqueaba `/security/guest_token/` (Bearer
  server-to-server sin sesión) — fix en `infra/superset/superset_config.py`
  (`WTF_CSRF_EXEMPT_LIST`). Ver commit 3ad76a9.
- FR-006 (acceso incondicional de administrador) fallaba con cero roles
  habilitados para una organización — fix en
  `private.puede_ver_reporte()` y la policy de `reportes_organizaciones`
  (migración), más el query de `emitir-acceso-reporte/index.ts` — ambos
  pasaron de leer `reportes_organizaciones_roles` a
  `reportes_organizaciones`. Caso nuevo en pgTAP (T009,
  `analitica_embebida.test.sql`, ahora 33 assertions). Ver commit
  3ad76a9.
- La Edge Function devolvía `SUPERSET_URL` (interno, server-to-server) al
  navegador para montar el SDK — no lo puede resolver ("server IP address
  could not be found"). Fix: variable nueva `SUPERSET_PUBLIC_URL`, la
  función sigue usando `SUPERSET_URL` puertas adentro pero responde con
  `SUPERSET_PUBLIC_URL`. Ver commit 3ad76a9.
- Faltaba crear el rol `Guest` en Superset y el CORS solo permitía
  `http://localhost:3100`, no `http://127.0.0.1:3100` — ninguno de los
  dos alcanzó a explicar el error solo; la causa real de "Something went
  wrong with embedded authentication" era que el rol `Guest`, con cero
  permisos, no podía llamar `GET /api/v1/me/roles/` (403) — parte del
  bootstrap del SDK. Le di `can_read` sobre `CurrentUserRestApi` y sobre
  `Dashboard` (el siguiente 403, "SupersetApiError: Forbidden", en
  `GET /api/v1/dashboard/<id>`). Comentarios de `superset_config.py`
  actualizados (research.md #10.4).
- El fix de CSRF de `guest_token` (punto anterior) reemplazó
  `WTF_CSRF_EXEMPT_LIST` en vez de extenderla, pisando la exención
  default de Superset para `/api/v1/chart/data` — el SDK volvía a fallar
  con "The CSRF token is missing", esta vez al pedir los datos del chart.
  Fix: `superset_config.py` ahora importa la lista default de
  `superset.config` y la extiende (research.md #10.3). Verificado contra
  la API real de punta a punta: `/me/roles` → `/dashboard/1` →
  `/chart/data` devuelven 200, con los datos ya filtrados por
  organización. Ver commit 3ad76a9.
- **Bug de aislamiento multi-tenant real** (reportado por el usuario, no
  por el guion del quickstart): con un reporte asignado a dos
  organizaciones, la policy de `reportes_organizaciones` dejaba ver la
  fila de la organización ajena — la Edge Function a veces devolvía la
  cláusula `rls` equivocada y Superset mostraba datos de otra
  organización. Causa: reusar `puede_ver_reporte()` (pensada para
  `reportes`, una fila por reporte) en una tabla con una fila **por
  organización**, sin comparar el `organizacion_id` de la fila contra el
  de quien consulta. Fix: función nueva `private.puede_ver_asignacion()`.
  Caso nuevo en pgTAP (mismo reporte, dos organizaciones, cada una ve
  solo la suya — 37 assertions ahora). Ver commit 3ad76a9.
- **Segundo bug de aislamiento** (también reportado por el usuario, tras
  el anterior): con el superadmin, `emitir-acceso-reporte` mostraba datos
  de una organización distinta a la que tenía activa. Causa: la RLS de
  `reportes_organizaciones` deja ver TODAS las filas a un superadmin
  (`is_superadmin() or ...`), así que un `select ... limit 1` sin filtrar
  por organización agarraba cualquier fila, no la de la organización
  activa. Fix: RPC nueva `resolver_organizacion_reporte()`, que usa
  `private.organizacion_id()` en vez de inferir la organización de qué
  filas devuelve una tabla. Caso nuevo en pgTAP (superadmin entra a X,
  después a Y, confirma que el resultado cambia — 39 assertions ahora).
  Ver commit 3ad76a9.
- **Tercer bug, encadenado con el anterior**: el dropdown de "Analítica"
  ofrecía reportes que después se rechazaban al seleccionarlos — mismo
  patrón, `useReportesAsignados` hacía `select * from reportes`, que le
  da al superadmin el bypass de `is_superadmin()` (pensado para el
  catálogo completo de `administrar.tsx`, US1), mostrando reportes de
  organizaciones que no tenía activa. Fix: RPC nueva
  `reportes_visibles_para_mi()`, sin ese bypass — un superadmin con
  organización activa se trata igual que su administrador.
  `useReportesAsignados.ts` actualizado para usarla. Caso nuevo en pgTAP
  (41 assertions ahora). Ver commit 3ad76a9.
- Sin resolver: en local, Edge Functions de Supabase y Superset quedan en
  redes Docker separadas — requiere un `docker network connect` manual
  que no sobrevive a `supabase stop && supabase start` (detalle en
  `quickstart.md`, Prerrequisitos, y `research.md` #10). Queda pendiente
  para una spec de infra aparte, no se parchea acá.
- `dev:refine` entraba en crash-loop
  (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) al agregar
  `@superset-ui/embedded-sdk`: sin TTY, `pnpm install` no podía confirmar
  el purge de `node_modules` (volumen con estado propio) al detectarlo
  desalineado del lockfile. Fix: `CI: "true"` en el `environment` de
  `infra/refine/compose.yaml`. Ver commit 3ad76a9.

## Desvío post-cierre: cuenta de servicio real para el guest token

- El `.env` local de `emitir-acceso-reporte` había quedado reusando
  `SUPERSET_ADMIN_USERNAME` (`admin`) en vez de la cuenta de servicio
  dedicada que research.md #3 ya pedía — detectado revisando credenciales
  locales, no por el guion del quickstart. Fix:
  `infra/superset/crear_cuenta_servicio_guest_token.py`, corrido por
  `superset shell` al final del `command` de `superset-init`, crea un rol
  con el único permiso real que hace falta (`can_grant_guest_token` sobre
  `SecurityRestApi`, confirmado contra el código fuente de Superset y
  probado end-to-end contra un stack arrancado en frío — research.md
  #11). Ver commit 6c05f3e.
