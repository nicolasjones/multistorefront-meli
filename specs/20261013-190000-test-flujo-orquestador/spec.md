# Feature Specification: Test del flujo del orquestador (BORRAR)

**Feature Branch**: `epic/MSF-480-test-flujo-orquestador-borrar`

**Jira Epic**: MSF-480 — `[TEST] Flujo orquestador (BORRAR)`

**Created**: 2026-10-13

**Status**: Ready for implementation — la especificación viene completa desde Jira; sin preguntas abiertas

**Delivery scope**: (ninguno de refine | supabase | kestra | superset | workers — solo documentación en `docs/` y un test trivial)

**Input**: Epic MSF-480 (épica de prueba, a borrar): "Validar el flujo de punta a punta (spec -> dev -> review -> merge) SIN tocar producción. Alcance mínimo: agregar UN archivo de documentación `docs/test-flujo-orquestador.md` con una línea, y un test trivial que lo verifique. NO tocar lógica de negocio ni migraciones." Criterios: (1) existe el archivo con la línea pedida; (2) hay un test que lo verifica y pasa; (3) todo verde en CI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Archivo de prueba del flujo con su test (Priority: P1)

Como mantenedor, quiero un archivo `docs/test-flujo-orquestador.md` con una línea y un test trivial que lo verifique, para validar el flujo spec -> dev -> review -> merge del orquestador sin tocar producción.

**Why this priority**: Es el único entregable de la épica.

**Independent Test**: Correr el test nuevo (`node --test`) y comprobar que pasa; comprobar que el diff contra `main` solo agrega el archivo, el test y los artefactos de la spec.

**Acceptance Scenarios**:

1. **Given** la rama de la épica, **When** se lista `docs/`, **Then** existe `docs/test-flujo-orquestador.md` con la línea pedida.
2. **Given** ese archivo, **When** corre el test nuevo, **Then** verifica su existencia y contenido, y pasa.
3. **Given** el pull request de la épica, **When** corre el CI, **Then** todo termina en verde.

### Edge Cases

- El archivo no existe o está vacío: el test DEBE fallar.
- El cambio no debe tocar lógica de negocio ni migraciones (ni datos, por lo tanto no aplica esquema `public`/`dominio` ni RLS: no se crea ni altera ninguna tabla).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DEBE existir el archivo `docs/test-flujo-orquestador.md` con una línea.
- **FR-002**: DEBE existir un test que verifique FR-001 y que pase.
- **FR-003**: El cambio NO DEBE tocar lógica de negocio ni migraciones.
- **FR-004**: El CI DEBE terminar en verde sobre el PR.

### Key Entities

- **Archivo de prueba** (`docs/test-flujo-orquestador.md`): documento Markdown con una línea.
- **Test trivial**: test de Node (`node:test`, como el resto de `scripts/*.test.mjs`) que lee el archivo y verifica su contenido.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `docs/test-flujo-orquestador.md` existe con la línea pedida.
- **SC-002**: el test nuevo pasa localmente y en CI.
- **SC-003**: CI verde en el PR; el diff no contiene `supabase/migrations` ni código de `apps/` o `workers/`.

## Assumptions

- La épica no fija el texto exacto de "la línea pedida": se usa una única línea no vacía que identifica la prueba (p. ej. `Prueba del flujo del orquestador (MSF-480) — borrar.`); el test verifica que el archivo exista y tenga exactamente esa línea.
- Épica descartable: el borrado posterior de los archivos queda fuera de esta spec.
- El test se registra en `package.json` como script propio y se encadena a `pnpm test` para que el CI lo ejecute; es el único ajuste de tooling, sin dependencias nuevas.
