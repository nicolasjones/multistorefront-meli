# Tasks: Test del flujo del orquestador (BORRAR)

**Input**: `specs/20261013-190000-test-flujo-orquestador/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`. El label `[STORY-x]` es el código exacto de la historia Jira (F-TST-01..03).

**Delivery scope**: solo documentación + test de tooling

## Phase 1: F-TST-01 — Documento de prueba (US1, base)

**Goal**: existe `docs/test-flujo-orquestador.md` con una única línea de texto.

- [x] T001 [F-TST-01][US1] Crear `docs/test-flujo-orquestador.md` con una única línea de texto (FR-001)

**Checkpoint**: documento presente; habilita la Fase 2.

---

## Phase 2: F-TST-02 y F-TST-03 (EN PARALELO; dependen de la Fase 1)

### F-TST-02 — Test del documento (US2)

- [ ] T002 [P] [F-TST-02][US2] Crear `scripts/test-flujo-orquestador.test.mjs` (`node:test`) que verifique que el archivo existe y tiene la línea; debe fallar si falta o está vacío (FR-002)
- [ ] T003 [F-TST-02][US2] Correr `node --test scripts/test-flujo-orquestador.test.mjs` y confirmar que pasa (FR-002)

### F-TST-03 — Script y docs (US3)

- [x] T004 [P] [F-TST-03][US3] Agregar el script `test:flujo-orquestador` en `package.json` y encadenarlo en `test` (FR-003)
- [ ] T005 [F-TST-03][US3] Correr `pnpm docs:check` y `pnpm lint` y confirmar que pasan (FR-003)

**Checkpoint**: 3 artefactos presentes, test verde. Verificar `git diff --stat main` sin migraciones ni lógica de negocio (FR-004) y CI verde en el PR (FR-005). Al mergear (merge commit `--no-ff`), actualizar `docs/roadmap-template.md` solo si aplica.

---

## Matriz de trazabilidad

| Jira | US | Fase | Tareas | Requisitos |
|---|---|---|---|---|
| MSF-480 (epic) | — | 1–2 | T001–T005 | FR-001 a FR-005 |
| F-TST-01 | US1 | 1 | T001 | FR-001 |
| F-TST-02 | US2 | 2 (paralelo) | T002–T003 | FR-002 |
| F-TST-03 | US3 | 2 (paralelo) | T004–T005 | FR-003 |
