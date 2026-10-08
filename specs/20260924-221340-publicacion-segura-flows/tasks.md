# Tasks: Publicación segura de flows

## Phase 1: Setup

- [x] T001 Documentar el diseño y alcance Kestra en `specs/20260924-221340-publicacion-segura-flows/plan.md`.

## Phase 2: User Story 1 - Crear flows inexistentes (P1)

- [x] T002 [US1] Añadir prueba de consulta y creación en `infra/kestra/desplegar-flow.test.mjs`.
- [x] T003 [US1] Consultar el flow antes de publicar en `infra/kestra/desplegar-flow.mjs`.
- [x] T004 [US1] Marcar la ruta de creación validada en esta tarea.

**Checkpoint**: Un flow inexistente se crea sin actualizar primero un destino ausente.

## Phase 3: User Story 2 - Actualizar flows existentes (P2)

- [x] T005 [US2] Añadir prueba de consulta y actualización en `infra/kestra/desplegar-flow.test.mjs`.
- [x] T006 [US2] Conservar actualización segura y error sanitizado en `infra/kestra/desplegar-flow.mjs`.
- [x] T007 [US2] Documentar el contrato en `docs/adoptar-tooling-typescript.md`.

## Phase 4: Validation

- [x] T008 Ejecutar pruebas, lint, build, configuración y documentación; registrar resultados en `specs/20260924-221340-publicacion-segura-flows/tasks.md`.

**Validación**: `pnpm test:kestra:deploy-flow`, `pnpm lint`, `pnpm build`,
`pnpm infra:config` y `pnpm docs:check` pasan el 2026-09-24.
