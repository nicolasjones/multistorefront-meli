---

description: "Task list template for feature implementation"
---

# Tasks: Plantilla genérica de producto de automatización

**Input**: Documentos de diseño de `specs/002-plantilla-generica/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md (N/A — sin entidades), quickstart.md

**Tests**: No se piden tests nuevos — la validación son los gates ya
existentes del repo (`pnpm lint/build/test/infra:config`) más los bloques
de `quickstart.md`.

**Organización**: Las tareas están agrupadas por historia de usuario para
poder implementar y verificar cada una de forma independiente. Cada
checkpoint de fase es también el punto de commit (según la clarificación de
la spec: commits incrementales por grupo lógico, corrección hacia adelante
sin rollback formal).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias)
- **[Story]**: a qué historia de usuario pertenece (US1, US2, US3)

## Phase 1: Setup

**Purpose**: Confirmar que el entorno está listo antes de tocar archivos

- [X] T001 Confirmar Docker Desktop corriendo, `gh auth status` autenticado, y `git status` limpio en la raíz del repo

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: El nombre del paquete del frontend (`@platform/web`) lo
referencian varios archivos de infra en la Fase 3 — cambiarlo primero evita
inconsistencia a mitad de camino.

**⚠️ CRITICAL**: Ninguna tarea de la Fase 3 en adelante empieza hasta cerrar esta fase.

- [X] T002 [P] Renombrar `"name"` en `package.json` de `estudio-automation` a `automation-platform-template`, y todos los `--filter @estudio/web` de sus scripts a `--filter @platform/web`
- [X] T003 [P] Renombrar `"name"` en `apps/web/package.json` de `@estudio/web` a `@platform/web`
- [X] T004 Correr `pnpm install` en la raíz para regenerar `pnpm-lock.yaml` con el nombre de paquete nuevo (depende de T002, T003)

**Checkpoint**: `pnpm --filter @platform/web <script>` debe resolver correctamente antes de seguir.

---

## Phase 3: User Story 1 - Repo sin lenguaje de un solo dominio (Priority: P1) 🎯 MVP

**Goal**: Ninguna referencia a `estudio-automation`/`estudio contable` queda
en infraestructura Docker, scripts ni documentación.

**Independent Test**: `git grep -i "estudio"` sobre los archivos de esta
fase (excluyendo constitución/CLAUDE.md/AGENTS.md, que son de US2) no
devuelve nada.

### Implementation for User Story 1

- [X] T005 [P] [US1] Renombrar `name:` en `infra/refine/compose.yaml` y el `--filter @estudio/web` de su `command`
- [X] T006 [P] [US1] Renombrar `--filter @estudio/web` en el `CMD` de `infra/refine/Dockerfile`
- [X] T007 [P] [US1] Renombrar `name:` en `infra/kestra/compose.yaml`
- [X] T008 [P] [US1] Renombrar `name:` y las 2 ocurrencias del tag de imagen (`estudio-automation/superset:6.1.0` → `automation-platform-template/superset:6.1.0`) en `infra/superset/compose.yaml`
- [X] T009 [P] [US1] Renombrar `name:` en `infra/playwright/compose.yaml`
- [X] T010 [P] [US1] Renombrar `name:`, `RUNNER_REPO` (a `Agenmatica/automation-platform-template`) y `RUNNER_NAME` en `infra/runner/compose.yaml`
- [X] T011 [P] [US1] Renombrar el default de `RUNNER_NAME` y el label `estudio-local`→`platform-local` en `infra/runner/entrypoint.sh`
- [X] T012 [P] [US1] Renombrar `project_id` en `supabase/config.toml`
- [X] T013 [P] [US1] Renombrar el prefijo corto `estudio-`→`platform-` en `scripts/deploy-vps.sh`
- [X] T014 [P] [US1] Actualizar la tabla de proyectos Docker y las menciones de nombre en `docs/architecture.md`
- [X] T015 [P] [US1] Actualizar las menciones de `estudio-<entorno>-*`→`platform-<entorno>-*` en `docs/deployment.md`
- [X] T016 [P] [US1] Reescribir el título ("# Estudio Automation" → nombre nuevo) y el primer párrafo (sin "estudios contables") de `README.md`
- [X] T017 [P] [US1] Reescribir el texto de la landing (`eyebrow`, `h1`, bajada) en `apps/web/src/App.tsx`, sin lenguaje contable (+ ajuste de `App.test.tsx` para que siga pasando, no estaba en el plan original pero es consecuencia directa)
- [X] T018 [P] [US1] Actualizar el comentario que menciona "estudios" en `supabase/tests/database/extensions.test.sql`
- [X] T019 [P] [US1] Renombrar el label `estudio-local`→`platform-local` en los 3 jobs de `.github/workflows/validate.yml`
- [X] T020 [US1] Correr `pnpm lint && pnpm build && pnpm test && pnpm infra:config` en la raíz y confirmar que los 4 pasan (depende de T005–T019) — requirió bajar/levantar Supabase local para que tomara el `project_id` nuevo, no estaba anticipado en el plan
- [X] T021 [US1] Correr el bloque 1 de `quickstart.md` excluyendo `.specify/memory/constitution.md`, `CLAUDE.md`, `AGENTS.md` (esos son de US2) y confirmar cero resultados — encontró y corrigió 2 casos que el sed inicial no cubrió (`package.json` línea `dev:down:supabase`, `RUNNER_LABELS` en `infra/runner/compose.yaml`)
- [X] T022 [US1] Commit: "chore: renombrar estudio-automation a automation-platform-template en infra y docs"

**Checkpoint**: Toda la infraestructura y documentación de producto usa el nombre nuevo. La constitución todavía no — eso es US2.

---

## Phase 4: User Story 2 - Gobierno del proyecto en términos genéricos (Priority: P2)

**Goal**: La constitución y `CLAUDE.md`/`AGENTS.md` describen principios
genéricos de multi-tenancy, e incorporan las 4 reglas nuevas acordadas en la
sesión.

**Independent Test**: `git grep -i "contable" .specify/memory/constitution.md` no devuelve nada; `CLAUDE.md` y `AGENTS.md` tienen las mismas reglas de proyecto.

### Implementation for User Story 2

- [X] T023 [US2] Ejecutar `/speckit-constitution` con la actualización: título nuevo ("Automation Platform Template Constitution"), Principio I reescrito en términos de aislamiento multi-tenant genérico ("organización" en vez de "estudio", sin lenguaje contable), lista de proyectos Docker del Principio IV con los nombres nuevos, bump de versión 1.2.1 → 1.3.0 (depende de T005–T012 para conocer los nombres finales de los proyectos Docker)
- [X] T024 [P] [US2] Agregar las 4 reglas nuevas (commits en castellano; criterio capacidad-vs-spec; código entregable con licencias permisivas y Superset exportado a YAML; CI en runners self-hosted) a "Reglas del proyecto" en `CLAUDE.md`
- [X] T025 [P] [US2] Agregar las mismas 4 reglas, de forma idéntica, a `AGENTS.md`
- [X] T026 [US2] Correr el bloque 5 de `quickstart.md` (grep "contable" + diff `CLAUDE.md`/`AGENTS.md`) y confirmar que pasa (depende de T023–T025) — "contable" solo aparece dentro del Sync Impact Report de la constitución (documenta el cambio, no es una regla viva); el cuerpo real está limpio
- [X] T027 [US2] Commit: "docs: reescribir constitución, CLAUDE.md y AGENTS.md en términos genéricos"

**Checkpoint**: Cualquier agente/persona que lea la constitución o `CLAUDE.md`/`AGENTS.md` ve reglas genéricas, sin rastro de "estudio contable".

---

## Phase 5: User Story 3 - Infraestructura de CI/runner alineada (Priority: P3)

**Goal**: El runner self-hosted queda registrado contra el repo renombrado
y el CI corre exitosamente.

**Independent Test**: los 3 runners aparecen `online` en GitHub bajo
`Agenmatica/automation-platform-template`, y un push dispara un CI en verde.

### Implementation for User Story 3

- [X] T028 [US3] Bajar y reconstruir `infra/runner` (`docker compose -f infra/runner/compose.yaml down` + `pnpm dev:runner`) para que las 3 réplicas se registren contra el repo nuevo (depende de T010, T011) — el `down` con el compose nuevo no encontró los contenedores viejos (proyecto Docker con nombre distinto); hubo que bajarlos explícitamente con `--project-name estudio-automation-runner-dev`
- [X] T029 [US3] Confirmar vía `gh api repos/Agenmatica/automation-platform-template/actions/runners` que las 3 réplicas están `online`, sin registros huérfanos del nombre viejo — el cleanup automático del entrypoint no llegó a desregistrar a tiempo del `down`; se borraron los 3 registros huérfanos a mano vía API antes de levantar los nuevos
- [X] T030 [US3] Push de todos los commits a `main`, `gh run watch` para confirmar que los 3 jobs terminan en éxito, y verificar con `gh run view <id> --json jobs` que la duración total es menor a 5 minutos (SC-003) (depende de T022, T027, T029) — encontró 4 problemas reales no anticipados en el plan (ver nota abajo)

**Checkpoint**: El CI real, corriendo en GitHub, confirma que todo el rename funciona de punta a punta.

**Desvíos encontrados en T030** (no anticipados en plan.md/research.md, corregidos en el momento):
1. `infra:config:runner` con `--env-file .env` explícito falla duro en CI (el archivo no existe ahí, a propósito) — se sacó esa bandera de `infra:config:runner` (no de `dev:runner`, que sí necesita el secreto real).
2. `test:db:ci` fallaba con error de TLS contra el Postgres local — faltaba `sslmode=disable` explícito en la URL.
3. `supabase test db --db-url` no autodescubría `supabase/tests/` como sí hace `--local` — necesitaba el path explícito.
4. El fix anterior tampoco alcanzó: `supabase test db` arma su propio contenedor `pg_prove` internamente, y con Docker-fuera-de-Docker ese contenedor anidado no puede montar los `.sql` del checkout (esa ruta solo existe dentro del contenedor del runner). Se resolvió instalando `pg_prove` directo en la imagen del runner y corriéndolo sin pasar por ese wrapper — lo que a su vez destapó que `pgtap` no estaba habilitada como extensión explícita (`supabase test db` la habilitaba sola, como efecto secundario oculto). Se agregó la migración `enable_pgtap`, mismo criterio que `enable_pgvector`.

---

## Phase Final: Polish & Cross-Cutting Concerns

**Purpose**: Verificación integral de que no quedó nada suelto

- [X] T031 [P] Correr los bloques 2 y 3 de `quickstart.md` (gates de validación completos, proyectos Docker locales) como cierre — 4 de los 6 productos locales (kestra, superset, playwright, refine) seguían corriendo con contenedores del nombre viejo (nunca se habían reiniciado tras el rename de sus compose.yaml); se bajaron con `--project-name` explícito y se relevantaron, ahora los 6 muestran el prefijo nuevo
- [X] T032 Barrido final: `git grep -i "estudio-automation\|estudio contable\|estudio/web"` sobre todo el repo (sin exclusiones esta vez) y confirmar cero resultados — es el checkpoint real de SC-001. Único resultado: dentro de `specs/002-plantilla-generica/` (spec, plan, research, tasks — documentan el rename en sí, igual que el Sync Impact Report de la constitución). Código, infra, docs de producto y constitución: cero coincidencias.
- [X] T033 Marcar todas las tareas de este archivo como completas y anotar cualquier desvío respecto al plan — desvíos documentados en la nota de T030 (4 problemas reales de CI no anticipados, todos corregidos) y en T028/T029/T032 (detalles puntuales de ejecución)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de Setup — bloquea a US1.
- **US1 (Fase 3)**: depende de Foundational.
- **US2 (Fase 4)**: depende de Foundational; T023 específicamente depende de que US1 ya haya fijado los nombres de proyectos Docker.
- **US3 (Fase 5)**: depende de que US1 (archivos de `infra/runner`) y US2 (commit) estén cerrados — es la verificación operativa final, no tiene sentido antes.
- **Polish (Final)**: depende de que US1, US2 y US3 estén completas.

### Paralelismo

- T002–T003 (Foundational) en paralelo.
- T005–T019 (US1) todas en paralelo entre sí — son 15 archivos distintos sin dependencias cruzadas.
- T024–T025 (US2) en paralelo — mismo contenido, archivos distintos.
- US3 es inherentemente secuencial (reconstruir → confirmar → push+verificar).

## Implementation Strategy

### MVP primero (User Story 1)

1. Fase 1 + Fase 2 (Setup + Foundational).
2. Fase 3 (US1) completa, con su commit propio.
3. **Parar y validar**: ya con esto, ningún producto Docker ni documento de usuario menciona el nombre viejo — es la parte de mayor impacto visible.

### Entrega incremental

1. Foundational → base lista.
2. US1 → commit 1 (infra + docs).
3. US2 → commit 2 (gobierno).
4. US3 → verificación operativa final (sin diff de archivos propio necesariamente, salvo ajustes).
5. Polish → barrido de cierre.
