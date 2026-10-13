# Feature Specification: Nota de validación del flujo con deploy real a DEV

**Feature Branch**: `epic/MSF-14-test-e2e-3-flujo-con-deploy-real-a-dev`

**Jira Epic**: MSF-14 — `[TEST-E2E-3] Flujo con deploy real a DEV`

**Created**: 2026-10-12

**Status**: Ready for implementation — la especificación viene completa desde Jira; sin preguntas abiertas

**Delivery scope**: (ninguno de refine | supabase | kestra | superset | workers — solo documentación en `docs/`)

**Input**: Epic MSF-14: "Como equipo, quiero validar el flujo con deploy real a DEV y review funcional." Historia: "Como mantenedor, quiero `docs/validacion-e2e3.md` con un título y fecha." Criterios: existe `docs/validacion-e2e3.md` con título y fecha; no cambia funcionalidad ni datos; `validate.yml` verde. Fuera de alcance: app, migraciones, infra, dependencias.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar la validación del flujo con deploy real a DEV (Priority: P1)

Como mantenedor, quiero un archivo `docs/validacion-e2e3.md` con un título y una fecha, para dejar constancia de que el flujo con deploy real a DEV y review funcional fue validado.

**Why this priority**: Es la única historia de la épica y su entregable único.

**Independent Test**: Abrir `docs/validacion-e2e3.md` y comprobar que tiene un título y una fecha; comprobar que el diff de la rama solo agrega ese archivo (más los artefactos de la spec) y que `validate.yml` termina en verde.

**Acceptance Scenarios**:

1. **Given** la rama de la épica, **When** se lista `docs/`, **Then** existe `docs/validacion-e2e3.md`.
2. **Given** ese archivo, **When** se lee, **Then** contiene un título (encabezado de nivel 1) y una fecha.
3. **Given** el diff contra `main`, **When** se revisa, **Then** no hay cambios en app, migraciones, infra ni dependencias, ni en funcionalidad o datos.
4. **Given** el pull request de la épica, **When** corre `validate.yml`, **Then** termina en verde.

### Edge Cases

- El cambio es solo documental: no debe tocar `apps/`, `workers/`, `supabase/`, `infra/`, `scripts/`, `packages/` ni `.github/`, para no activar requisitos adicionales de `pnpm docs:check`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DEBE existir el archivo `docs/validacion-e2e3.md`.
- **FR-002**: El archivo DEBE tener un título y una fecha.
- **FR-003**: El cambio NO DEBE modificar funcionalidad ni datos.
- **FR-004**: El cambio NO DEBE tocar app, migraciones, infra ni dependencias (fuera de alcance).
- **FR-005**: El workflow `validate.yml` DEBE terminar en verde sobre el PR.

### Key Entities

- **Nota de validación** (`docs/validacion-e2e3.md`): documento Markdown con título y fecha.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `docs/validacion-e2e3.md` existe en la rama con título y fecha.
- **SC-002**: El diff contra `main` no contiene archivos fuera de `docs/` y `specs/`.
- **SC-003**: `validate.yml` verde en el PR.

## Assumptions

- Mismo formato que las notas previas (MSF-11, MSF-12): título de nivel 1 y línea `Fecha: AAAA-MM-DD`.
- La clave de la historia Jira todavía no existe; se usa el marcador `STORY-1` hasta que se cree.

## Trazabilidad Jira ↔ Historias de usuario ↔ Tareas

| Jira | US | Rel. Jira→US | Tareas | Rel. US→tareas |
|---|---|---|---|---|
| MSF-14 (epic) | US1 | 1:N | — | — |
| STORY-1 (por crear) | US1 — `docs/validacion-e2e3.md` (P1) | 1:1 | T001–T003 | 1:N |

Cobertura: FR-001/002 → T001; FR-003/004 → T002; FR-005 → T003.
