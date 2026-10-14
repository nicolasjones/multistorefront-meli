# Tasks: E2E flujo (BORRAR)

**Input**: `specs/20261014-010000-e2e-flujo-borrar/` (spec.md, plan.md) · **Épica**: MSF-487 · **Delivery scope**: ninguno

**Formato**: `- [ ] T### [STORY-x][USy] descripción`.

## Phase 1: US1 — Recorrer el flujo y borrar (MSF-487)

**Goal**: ejercitar el flujo E2E sin entregar funcionalidad y descartar la épica.

**Independent Test**: el flujo completa sin cambios de código; al final no queda rastro en `main`.

- [x] T001 [MSF-487][US1] Crear el archivo `docs/e2e-borrar.md` con una única línea de texto `E2E ok` (cambio trivial y acotado; FR-001, SC-001)
- [ ] T002 [MSF-487][US1] Borrar la épica: cerrar/eliminar MSF-487 en Jira y descartar rama, PR y este directorio de spec (FR-002, SC-002)

## Matriz de trazabilidad

| Jira | US | Tareas |
|------|----|--------|
| MSF-487 | US1 | T001, T002 |
