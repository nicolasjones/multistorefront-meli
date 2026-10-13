# Tasks: Test del flujo del orquestador (BORRAR)

**Input**: `specs/20261013-190000-test-flujo-orquestador/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción`. El label `[STORY-x]` es el código exacto de la historia Jira (F-TST-01..03).

**Estado**: CANCELADA por instrucción de Nicolás (2026-10-13 15:41). No hay tareas de implementación para ejecutar y NO se reintenta el Desarrollador.

## Tareas de implementación

Ninguna. El documento de F-TST-01 ya estaba entregado (PR #38); el test `node:test` y el script `test:flujo-orquestador` (F-TST-02, F-TST-03) fueron descartados.

## Cierre (orquestación / Jira, fuera del Desarrollador)

- [ ] T001 [MSF-480][US-cancelada] Cerrar/cancelar el ticket MSF-480 y borrarlo del tablero (FR-001, FR-002)

**Checkpoint**: `git diff --stat main` solo muestra `specs/20261013-190000-test-flujo-orquestador/` y `docs/test-flujo-orquestador.md` (FR-003).

---

## Matriz de trazabilidad

| Jira | US | Estado | Tareas | Requisitos |
|---|---|---|---|---|
| MSF-480 (epic) | — | Cancelada: cerrar y borrar del tablero | T001 | FR-001, FR-002, FR-003 |
| F-TST-01 | US1 | Ya entregada (PR #38), sin más trabajo | — | — |
| F-TST-02 | US2 | Cancelada | — | — |
| F-TST-03 | US3 | Cancelada | — | — |
