# Feature Specification: Test del flujo del orquestador (BORRAR)

**Feature Branch**: `epic/MSF-480-test-flujo-orquestador-borrar`

**Jira Epic**: MSF-480 — `[TEST] Flujo orquestador (BORRAR)`

**Created**: 2026-10-13

**Status**: Ready for implementation — la especificación viene completa desde Jira; sin preguntas abiertas

**Delivery scope**: (ninguno de refine | supabase | kestra | superset | workers — solo documentación en `docs/` y un test trivial)

**Input**: Epic MSF-480 (épica de prueba, a borrar): valida el flujo con varias historias y fases, sin tocar producción (solo documentación + un test). Historias F-TST-01, F-TST-02, F-TST-03.

## User Scenarios & Testing *(mandatory)*

Tres historias en dos fases (ver `tasks.md`): Fase 1 = F-TST-01 (base); Fase 2 = F-TST-02 y F-TST-03 en PARALELO (independientes entre sí, dependen de la Fase 1).

### User Story 1 - F-TST-01 · Documento de prueba (Priority: P1)

Crear `docs/test-flujo-orquestador.md` con una única línea de texto.

**Why this priority**: es la base; las otras dos historias dependen de este archivo.

**Independent Test**: el archivo existe y contiene una única línea de texto no vacía.

**Acceptance Scenarios**:

1. **Given** la rama de la épica, **When** se lista `docs/`, **Then** existe `docs/test-flujo-orquestador.md` con una única línea de texto.

### User Story 2 - F-TST-02 · Test del documento (Priority: P2)

Crear `scripts/test-flujo-orquestador.test.mjs` (`node:test`) que verifique que el archivo existe y tiene la línea; debe fallar si falta o está vacío.

**Why this priority**: valida el documento de F-TST-01; depende de la Fase 1 y es independiente de F-TST-03.

**Independent Test**: `node --test scripts/test-flujo-orquestador.test.mjs` pasa con el documento presente.

**Acceptance Scenarios**:

1. **Given** el documento de F-TST-01, **When** corre el test, **Then** pasa.
2. **Given** el documento ausente o vacío, **When** corre el test, **Then** falla.

### User Story 3 - F-TST-03 · Script y docs (Priority: P2)

Agregar el script `test:flujo-orquestador` en `package.json` y encadenarlo; pasar `pnpm docs:check` y `pnpm lint`.

**Why this priority**: engancha el test al CI; depende de la Fase 1 y es independiente de F-TST-02 (solo toca `package.json`).

**Independent Test**: `pnpm docs:check` y `pnpm lint` pasan con el script agregado.

**Acceptance Scenarios**:

1. **Given** `package.json`, **When** se inspecciona, **Then** existe el script `test:flujo-orquestador` y está encadenado.
2. **Given** el cambio completo, **When** corren `pnpm docs:check` y `pnpm lint`, **Then** pasan.

### Edge Cases

- El archivo no existe o está vacío: el test DEBE fallar (F-TST-02).
- Sin tablas ni datos: no se crea ni altera ninguna tabla, por lo que no aplican esquema `public`/`dominio` ni RLS.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (F-TST-01): DEBE existir `docs/test-flujo-orquestador.md` con una única línea de texto.
- **FR-002** (F-TST-02): DEBE existir `scripts/test-flujo-orquestador.test.mjs` (`node:test`) que verifique que el archivo existe y tiene la línea, y que falle si falta o está vacío.
- **FR-003** (F-TST-03): DEBE existir el script `test:flujo-orquestador` en `package.json`, encadenado, y pasar `pnpm docs:check` y `pnpm lint`.
- **FR-004**: el cambio NO DEBE tocar lógica de negocio ni migraciones.
- **FR-005**: el CI DEBE terminar en verde.

### Key Entities

- **Archivo de prueba** (`docs/test-flujo-orquestador.md`): documento Markdown con una línea.
- **Test trivial**: test de Node (`node:test`, como el resto de `scripts/*.test.mjs`) que lee el archivo y verifica su contenido.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: existen los 3 artefactos pedidos (documento, test, script en `package.json`).
- **SC-002**: el test pasa.
- **SC-003**: CI verde.
- **SC-004**: sin cambios en lógica de negocio ni migraciones (el diff no contiene `supabase/migrations`, `apps/` ni `workers/`).

## Assumptions

- Jira no fija el texto de la línea; se usa `Prueba del flujo del orquestador (MSF-480) — borrar.` como contrato entre F-TST-01 y F-TST-02.
- Épica descartable: su borrado posterior queda fuera de esta spec.
