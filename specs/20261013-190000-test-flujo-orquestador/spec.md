# Feature Specification: Test del flujo del orquestador (BORRAR)

**Feature Branch**: `epic/MSF-480-test-flujo-orquestador-borrar`

**Jira Epic**: MSF-480 — `[TEST] Flujo orquestador (BORRAR)`

**Created**: 2026-10-13

**Status**: CANCELADA — por instrucción de Nicolás (2026-10-13 15:41), la épica es de prueba, quedó trabada sin run en vuelo y no requiere más trabajo. No hay implementación pendiente.

**Delivery scope**: ninguno (refine | supabase | kestra | superset | workers). No se entrega código.

**Input**: Epic MSF-480 (épica de prueba del orquestador, a borrar) con las historias F-TST-01, F-TST-02 y F-TST-03, y la instrucción posterior de Nicolás: *no reintentar el Desarrollador; cerrar/cancelar el ticket de prueba y borrarlo del tablero*.

## Decisión

- El Desarrollador NO se reintenta.
- El ticket MSF-480 se cierra/cancela y se borra del tablero (acción de orquestación/Jira, fuera del alcance de esta spec).
- No se crean `docs/test-flujo-orquestador.md`, `scripts/test-flujo-orquestador.test.mjs` ni el script `test:flujo-orquestador`.
- Esta spec se conserva solo como registro de lo que la épica pedía y de por qué no se hizo.

## User Scenarios & Testing *(mandatory)*

Las tres historias originales quedan **canceladas** (sin implementar). Su contenido, tal como lo dio Jira, se conserva únicamente como referencia.

### User Story 1 - F-TST-01 · Documento de prueba (Priority: P1) — CANCELADA

Era: crear `docs/test-flujo-orquestador.md` con una única línea de texto (Fase 1, base).

**Acceptance Scenarios**: no aplican; la historia no se implementa.

### User Story 2 - F-TST-02 · Test del documento (Priority: P2) — CANCELADA

Era: crear `scripts/test-flujo-orquestador.test.mjs` (`node:test`) que verificara que el archivo existe y tiene la línea (Fase 2, en paralelo con F-TST-03).

**Acceptance Scenarios**: no aplican; la historia no se implementa.

### User Story 3 - F-TST-03 · Script y docs (Priority: P2) — CANCELADA

Era: agregar el script `test:flujo-orquestador` en `package.json` y encadenarlo; pasar `pnpm docs:check` y `pnpm lint` (Fase 2, en paralelo con F-TST-02).

**Acceptance Scenarios**: no aplican; la historia no se implementa.

### Edge Cases

- Sin tablas ni datos: no se crea ni altera ninguna tabla, por lo que no aplican esquema `public`/`dominio` ni RLS.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: el Desarrollador NO DEBE reintentarse para MSF-480.
- **FR-002**: MSF-480 DEBE cerrarse/cancelarse y borrarse del tablero (acción de Jira/orquestación).
- **FR-003**: la rama NO DEBE introducir lógica de negocio, migraciones ni los artefactos de F-TST-01..03; el único cambio es esta spec.

### Key Entities

Ninguna.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: no hay run del Desarrollador en vuelo ni se lanza uno nuevo para MSF-480.
- **SC-002**: MSF-480 queda cerrado/cancelado y borrado del tablero.
- **SC-003**: el diff contra `main` contiene solo `specs/20261013-190000-test-flujo-orquestador/`.

## Assumptions

- Cerrar y borrar el ticket lo ejecuta la orquestación en Jira; esta spec solo deja constancia de la decisión.
- Si hay un PR abierto para la rama, se cierra sin mergear junto con el ticket.
