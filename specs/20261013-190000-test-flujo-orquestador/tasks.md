# Tasks: Test del flujo del orquestador (BORRAR)

**Input**: `specs/20261013-190000-test-flujo-orquestador/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`. `STORY-1` es marcador de la historia Jira por crear; reemplazar por la clave real (MSF-N).

**Delivery scope**: solo documentación + test de tooling

## Phase 1: US1 — Archivo de prueba y su test (Priority: P1) 🎯 MVP

**Goal**: existe `docs/test-flujo-orquestador.md` con una línea y un test que lo verifica y pasa; CI verde.

**Independent Test**: `node --test scripts/test-flujo-orquestador.test.mjs` pasa; `git diff --stat main` no muestra migraciones ni código de negocio.

- [ ] T001 [STORY-1][US1] Crear `docs/test-flujo-orquestador.md` con una única línea (FR-001)
- [ ] T002 [STORY-1][US1] Crear `scripts/test-flujo-orquestador.test.mjs` (`node:test`) que verifique existencia y contenido; debe fallar si el archivo falta o está vacío (FR-002)
- [ ] T003 [STORY-1][US1] Agregar el script `test:flujo-orquestador` en `package.json` y encadenarlo en `test` (FR-002, FR-004)
- [ ] T004 [STORY-1][US1] Verificar con `git diff --stat main` que no hay cambios en lógica de negocio ni migraciones (FR-003)
- [ ] T005 [STORY-1][US1] Correr el test nuevo, `pnpm docs:check` y `pnpm lint`; dejar la evidencia en el PR y confirmar CI verde (FR-004)

**Checkpoint**: Spec completa. Al mergear el PR (merge commit `--no-ff`), actualizar `docs/roadmap-template.md` solo si aplica (épica de prueba descartable).

---

## Matriz de trazabilidad

| Jira | US | Rel. Jira→US | Tareas | Rel. US→tareas | Requisitos |
|---|---|---|---|---|---|
| MSF-480 (epic) | — | 1:N | — | — | todos |
| STORY-1 (por crear) | US1 | 1:1 | T001–T005 | 1:N | FR-001 a FR-004 |
