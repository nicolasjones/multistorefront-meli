# Tasks: Nota de validación del flujo con gate DEV

**Input**: `specs/20261012-120000-validacion-dev-gate/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`. `STORY-1` es marcador de la historia Jira por crear; reemplazar por la clave real (MSF-N).

**Delivery scope**: solo documentación

## Phase 1: US1 — Nota de validación (Priority: P1) 🎯 MVP

**Goal**: existe `docs/validacion-dev-gate.md` con título y fecha, sin otros cambios.

**Independent Test**: leer el archivo; `git diff --stat main` solo muestra `docs/` y `specs/`.

- [ ] T001 [STORY-1][US1] Crear `docs/validacion-dev-gate.md` con título de nivel 1 y línea `Fecha: AAAA-MM-DD` (FR-001, FR-002)
- [ ] T002 [STORY-1][US1] Verificar con `git diff --stat main` que no hay cambios en app, migraciones, infra ni dependencias (FR-003, FR-004)
- [ ] T003 [STORY-1][US1] Correr `pnpm docs:check` y `pnpm lint`; confirmar `validate.yml` verde en el PR (FR-005)

**Checkpoint**: Spec completa. Al mergear el PR, actualizar la fila correspondiente de `docs/roadmap-template.md` (paso manual del cierre).

---

## Matriz de trazabilidad

| Jira | US | Rel. Jira→US | Tareas | Rel. US→tareas | Requisitos |
|---|---|---|---|---|---|
| MSF-12 (epic) | — | 1:N | — | — | todos |
| STORY-1 (por crear) | US1 | 1:1 | T001–T003 | 1:N | FR-001 a FR-005 |
