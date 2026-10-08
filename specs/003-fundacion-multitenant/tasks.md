---

description: "Task list template for feature implementation"
---
# Tasks: Fundación multi-tenant

**Input**: Documentos de diseño de `specs/003-fundacion-multitenant/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: FR-006 exige explícitamente un test automatizado (pgTAP) para el
aislamiento y los permisos de escritura — esos sí se generan. No se agregan
tests de Edge Function/UI que la spec no pidió explícitamente.

**Organización**: por historia de usuario, en orden de prioridad. La Fase 2
(Foundational) incluye algo que ningún documento de diseño mencionó
explícitamente pero que es un prerrequisito real: hoy `apps/web` no tiene
cliente de Supabase, `authProvider` ni pantalla de login — sin eso, ninguna
historia es probable ni siquiera manualmente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias)
- **[Story]**: US1, US2, US3, US4

## Phase 1: Setup

- [x] T001 Confirmar `pnpm dev:supabase` corriendo y `git status` limpio en la raíz del repo

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: el esquema completo (6 tablas + helpers + RLS + RPC) y la
capacidad básica de autenticar/enrutar en Refine — sin esto, ninguna
historia es demostrable.

**⚠️ CRITICAL**: ninguna tarea de la Fase 3 en adelante empieza hasta cerrar esta fase.

### Esquema de base de datos (un solo archivo de migración, secuencial)

- [x] T002 Crear la migración (`supabase migration new fundacion_multitenant`) y escribir las tablas `roles_organizacion` (+ seed de `administrador`/`miembro`), `organizaciones`, `usuarios_organizacion` (con `user_id` como PK para unicidad), `clientes`, `superadmins`, `superadmin_organizacion_activa`, `superadmin_entradas` en `supabase/migrations/<timestamp>_fundacion_multitenant.sql`
- [x] T003 Agregar las funciones helper `private.is_superadmin()`, `private.organizacion_id()`, `private.puede_escribir()` a la misma migración (depende de T002) — en schema `private`, no `auth`: Postgres no deja crear objetos en `auth` (ver research.md)
- [x] T004 Activar RLS y agregar las policies de las 7 tablas a la misma migración: lectura por `private.organizacion_id()` en `clientes`; escritura en `clientes` solo con `private.puede_escribir()`; `organizaciones` y su listado solo legible/creable por `private.is_superadmin()`; `usuarios_organizacion`/`superadmin_*` con las policies mínimas que necesiten sus propias consultas (depende de T003)
- [x] T005 Agregar la función RPC `entrar_a_organizacion(org_id uuid)` (`security definer`) a la misma migración: valida superadmin, hace upsert en `superadmin_organizacion_activa`, inserta en `superadmin_entradas` (depende de T004)
- [x] T006 Aplicar la migración (`supabase migration up`) y confirmar que corre sin errores

### Autenticación y ruteo base en Refine (ninguna historia funciona sin esto)

- [x] T007 [P] Crear el cliente de Supabase en `apps/web/src/lib/supabase.ts` usando `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`
- [x] T008 Configurar `dataProvider` y `authProvider` de `@refinedev/supabase` en `apps/web/src/App.tsx` (depende de T007) — `authProvider` propio en `apps/web/src/providers/authProvider.ts` (el paquete no trae uno armado)
- [x] T009 [P] Crear la pantalla de login en `apps/web/src/pages/login.tsx` (email + password — la cuenta ya existe porque fue invitada, no hay registro propio)
- [x] T010 Configurar rutas de React Router en `apps/web/src/App.tsx`: pública (`/login`) vs. protegidas (depende de T008, T009) — de paso, `apps/web/vite.config.ts` necesitó `test.server.deps.inline` para `@refinedev/*`/`@mui/*`/`react-router` (si no, vitest los externaliza y carga dos copias de react-router)

**Checkpoint**: alguien invitado a mano (vía SQL, ver quickstart.md) puede loguearse en Refine. Ninguna pantalla de negocio existe todavía.

---

## Phase 3: User Story 1 - Los datos de cada organización quedan aislados (Priority: P1) 🎯 MVP

**Goal**: el aislamiento por RLS funciona y está probado, no solo revisado a mano.

**Independent Test**: correr el test pgTAP con datos de dos organizaciones.

### Tests for User Story 1

- [x] T011 [US1] Escribir `supabase/tests/database/aislamiento_organizaciones.test.sql`: crear 2 organizaciones + usuarios de prueba (admin y miembro en cada una) + clientes en cada una; verificar que ningún usuario ve/edita filas de la otra organización; verificar que un usuario sin fila en `usuarios_organizacion` no ve nada (depende de T006)
- [x] T012 [US1] Correr `pnpm test:db` y confirmar que el test pasa (depende de T011)

**Checkpoint**: el aislamiento está probado automáticamente — Principio I de la constitución, verificado.

---

## Phase 4: User Story 2 - El superadmin crea y ve organizaciones desde una pantalla propia (Priority: P2)

**Goal**: existe una forma real (no un script) de que el superadmin cree organizaciones y las vea listadas.

**Independent Test**: crear una organización desde Refine y verla en el listado; confirmar que un usuario sin perfil superadmin no encuentra la pantalla.

### Implementation for User Story 2

- [x] T013 [P] [US2] Crear la Edge Function en `supabase/functions/crear-organizacion/index.ts`: valida superadmin, crea la organización, invita por email (Auth Admin API), vincula al invitado como administrador, revierte la organización si falla la invitación (contrato: `contracts/crear-organizacion.md`)
- [x] T014 [US2] Desplegar la función localmente (`supabase functions serve` o equivalente) y probarla manualmente una vez contra el Supabase local (depende de T013) — probada de punta a punta (201, membresía `administrador` creada); de paso salió a la luz que `service_role` también necesita GRANT explícito de tabla (ver commit de fix) y que agregar una función nueva exige `supabase stop && supabase start` (el contenedor de edge runtime no tiene hot-reload de archivos nuevos, solo de los ya montados)
- [x] T015 [P] [US2] Crear `apps/web/src/pages/organizaciones/list.tsx`: listado de organizaciones, visible solo si `private.is_superadmin()` (verificar perfil vía una consulta a `superadmins` en el `authProvider` o un hook propio) — hook propio en `apps/web/src/hooks/useIsSuperadmin.ts`; tabla MUI simple, no `@mui/x-data-grid` (no es dependencia directa de `apps/web`, pnpm strict lo bloquearía)
- [x] T016 [P] [US2] Crear `apps/web/src/pages/organizaciones/create.tsx`: formulario (nombre, email del fundador) que llama a la Edge Function de T013
- [x] T017 [US2] Registrar el recurso `organizaciones` en `apps/web/src/App.tsx` (rutas `/organizaciones`, `/organizaciones/create`), visibles solo para superadmin (depende de T010, T015, T016)

**Checkpoint**: el superadmin puede crear y ver organizaciones desde Refine, de punta a punta.

---

## Phase 5: User Story 3 - Administrar los clientes de la propia organización (Priority: P3)

**Goal**: administrador lee/crea/edita clientes; miembro solo lee — ambos aislados por organización.

**Independent Test**: crear un cliente como admin, confirmar que un miembro lo ve pero no puede editarlo, y que otra organización no lo ve.

### Tests for User Story 3

- [x] T018 [US3] Extender `supabase/tests/database/aislamiento_organizaciones.test.sql` (o un archivo nuevo `permisos_clientes.test.sql`) con casos de escritura: administrador puede insertar/editar, miembro no puede (falla, no solo se oculta en UI) (depende de T006)
- [x] T019 [US3] Correr `pnpm test:db` y confirmar que pasa (depende de T018)

### Implementation for User Story 3

- [x] T020 [P] [US3] Crear `apps/web/src/pages/clientes/list.tsx`: listado visible para administrador y miembro, acciones de crear/editar visibles solo si el rol es administrador — gate con `apps/web/src/hooks/usePuedeEscribir.ts` (espejo cliente de `private.puede_escribir()`, solo para UI)
- [x] T021 [P] [US3] Crear `apps/web/src/pages/clientes/create.tsx` y `apps/web/src/pages/clientes/edit.tsx` (solo alcanzables desde la UI si administrador; RLS rechaza igual si alguien llega por otra vía)
- [x] T022 [US3] Registrar el recurso `clientes` en `apps/web/src/App.tsx` (rutas `/clientes`, `/clientes/create`, `/clientes/edit/:id`) (depende de T010, T020, T021)

**Checkpoint**: la primera entidad de negocio real funciona, aislada y con permisos de escritura correctos.

---

## Phase 6: User Story 4 - El superadmin entra a una organización y la administra (Priority: P4)

**Goal**: el superadmin puede operar una organización puntual como su administrador, una a la vez, con cada entrada registrada.

**Independent Test**: entrar a la organización X, operar sus clientes, volver, entrar a la Y, confirmar que los datos no se mezclan y que `superadmin_entradas` registró ambas entradas.

### Tests for User Story 4

- [x] T023 [US4] Extender el test pgTAP con el caso superadmin: sin haber entrado a ninguna organización no ve `clientes`; tras llamar `entrar_a_organizacion`, ve/edita solo la organización activa; entrar a otra organización cambia el contexto sin mezclar datos (depende de T005, T006) — incluye también el chequeo de auditoría (FR-013): 2 entradas en `superadmin_entradas`
- [x] T024 [US4] Correr `pnpm test:db` y confirmar que pasa (depende de T023)

### Implementation for User Story 4

- [x] T025 [US4] Agregar la acción "Ingresar" a cada fila de `apps/web/src/pages/organizaciones/list.tsx`: llama al RPC `entrar_a_organizacion` (contrato: `contracts/entrar-a-organizacion.md`) y redirige a `/clientes` (depende de T015, T005)

**Checkpoint**: el conjunto completo es operable de punta a punta para el superadmin, no solo un listado sin acción.

---

## Phase Final: Polish &amp; Cross-Cutting Concerns

- [x] T026 [P] Correr los 5 bloques de `quickstart.md` completos, con dos organizaciones reales — validado de punta a punta contra los mismos endpoints que usa la UI (Edge Function, RPC, PostgREST bajo RLS): 2 organizaciones, invitaciones confirmadas en Mailpit, admin crea cliente, miembro lee pero no puede crear (403), superadmin entra a la organización 1 y opera, entra a la 2 y no ve nada de la 1, `superadmin_entradas` con 2 filas. No se hizo clickeando la UI en un navegador (no se usó Playwright en esta sesión) — script de validación descartado tras la corrida, no forma parte del repo.
- [x] T027 Correr `pnpm lint && pnpm build && pnpm test && pnpm infra:config` y confirmar que los 4 pasan — los 4 en verde
- [x] T028 Marcar todas las tareas de este archivo como completas y anotar cualquier desvío respecto al plan — ver notas en T003/T014 (schema `private` en vez de `auth`; hace falta `supabase stop && supabase start` al agregar una función nueva) y T015 (sin `@mui/x-data-grid`, tabla MUI simple)

---

## Dependencies &amp; Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de Setup — bloquea todo lo demás. Es la fase más grande porque incluye tanto el esquema completo como la autenticación base de Refine, que ningún documento de diseño anterior había cubierto explícitamente.
- **US1 (Fase 3)**: depende de Foundational. No depende de ninguna otra historia — es pura verificación del esquema.
- **US2 (Fase 4)**: depende de Foundational.
- **US3 (Fase 5)**: depende de Foundational. Independiente de US2 (no necesita que existan pantallas de organizaciones para poder probarse con una organización creada a mano).
- **US4 (Fase 6)**: depende de US2 (T015, el listado) y de la migración (T005, el RPC) — es la única historia con dependencia real de otra historia, ya evaluada en la spec.
- **Polish (Final)**: depende de que US1–US4 estén completas.

### Paralelismo

- T007 y T009 (Foundational) en paralelo — archivos distintos.
- T013, T015, T016 (US2) en paralelo entre sí.
- T020, T021 (US3) en paralelo entre sí.
- US2 y US3 se pueden trabajar en paralelo una vez cerrada Foundational (no se pisan archivos).

## Implementation Strategy

### MVP primero (User Story 1)

1. Fase 1 + Fase 2 (Setup + Foundational) — esto ya es la parte más grande del trabajo.
2. Fase 3 (US1): el aislamiento probado automáticamente.
3. **Parar y validar**: en este punto, el Principio I de la constitución está verificado con un test real, aunque todavía no haya ninguna pantalla usable.

### Entrega incremental

1. Foundational → esquema + login funcionando.
2. US1 → aislamiento probado (commit propio).
3. US2 → el superadmin puede crear organizaciones de verdad (commit propio).
4. US3 → primera entidad de negocio usable, con permisos correctos (commit propio).
5. US4 → el superadmin puede operar cualquier organización (commit propio).
6. Polish → validación integral de cierre.

## Phase 7: Convergence

- [x] T029 Agregar `default private.organizacion_id()` a `clientes.organizacion_id` (migración nueva) para que crear un cliente no requiera indicar la organización explícitamente, verificado contra el payload real que envía `apps/web/src/pages/clientes/create.tsx` per US3/AC1 (missing) — verificado en vivo: el mismo payload que antes devolvía 403 ahora devuelve 201
- [x] T030 Agregar un `accessControlProvider` a `<Refine>` en `apps/web/src/App.tsx` que oculte el recurso `organizaciones` del menú para quien no sea superadmin per US2/AC2 (partial) — lógica compartida con `useIsSuperadmin` vía `apps/web/src/lib/superadmin.ts`

