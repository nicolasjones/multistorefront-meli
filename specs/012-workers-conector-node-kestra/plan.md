# Implementation Plan: Convención de Workers de Integración (Node + Kestra)

**Branch**: `012-workers-conector-node-kestra` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-workers-conector-node-kestra/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Ampliar `workers/README.md` con la convención para workers técnicos de integración: Node.js + TypeScript como runtime por defecto, un worker dedicado a un único sistema externo con un conector por cada tipo de dato o reporte que ese sistema expone, Kestra como orquestador (programa/reintenta/alerta) sin reemplazar al worker (que ejecuta el trabajo técnico), el patrón de "tabla central" para normalizar datos de múltiples fuentes que representan el mismo tipo de registro de negocio (columna de organización + `origen` + `id_externo` como clave compuesta de idempotencia + columna `jsonb` para lo particular de cada fuente), remisión al manejo de secretos ya existente en el proyecto para las credenciales de cada conector, y la aclaración de qué es un healthcheck para un worker de ejecución puntual disparado por Kestra. No hay código de producto: el entregable es exclusivamente una edición de documentación, sin dependencias, servicios ni migraciones nuevas.

## Technical Context

**Language/Version**: N/A — no se escribe código de producto en esta feature; el entregable es Markdown (`workers/README.md`).

**Primary Dependencies**: Ninguna nueva. Se referencia Node.js + TypeScript, Kestra y Playwright como decisiones ya vigentes en el template (no se instala ni configura nada).

**Storage**: N/A — no hay tablas ni migraciones; el patrón de "tabla central" se documenta como técnica de diseño para que cada implementación la adapte a su propio esquema.

**Testing**: Revisión manual del documento contra `checklists/requirements.md` (ya validado en `/speckit-clarify`) y contra el `quickstart.md` de esta fase — no aplica testing automatizado de código porque no hay código.

**Target Platform**: El propio repositorio del template, como contenido de `workers/README.md`.

**Project Type**: Documentación / convención técnica (edición de un único archivo existente).

**Performance Goals**: N/A.

**Constraints**: Debe extender el contrato de worker ya existente en `workers/README.md` sin duplicarlo ni contradecirlo (FR-006); no debe introducir ningún concepto de dominio de negocio de los casos que la motivaron (FR-007); debe dejar explícitamente fuera de alcance Redis/BullMQ y backend síncrono (FR-008).

**Scale/Scope**: Un archivo (`workers/README.md`), ampliado con una sección nueva de convención de integración. Sin impacto en `apps/web`, `supabase/`, `infra/` ni CI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio / Gate | Evaluación |
|---|---|
| I. Aislamiento multi-tenant por diseño | Cumplido — corregido durante el diseño de Fase 1: la tabla central que esta convención documenta **sí** es una tabla de datos, y por lo tanto hereda este principio sin excepción. FR-011 exige columna de organización + RLS; la clave de idempotencia pasó de `(origen, id_externo)` a `(organización, origen, id_externo)` (ver `research.md` R4). |
| II. Especificar antes de implementar | Cumplido — esta es la spec (`spec.md`, clarificada) que precede a cualquier cambio en `workers/README.md`. |
| III. Automatizaciones idempotentes y auditables | Cumplido y reforzado — la convención documentada es, precisamente, la forma concreta de cumplir este principio para workers futuros (idempotencia vía organización + origen + id_externo, registro de estado vía Kestra). |
| IV. Un monorepo, despliegues independientes | N/A — no se agrega ningún servicio ni Compose nuevo. |
| V. Simplicidad operativa | Cumplido — es el caso más simple posible: una edición de documentación, sin infraestructura nueva, justificada por dos casos reales de dominios independientes (FR-009). |
| Technology and Quality Gates (stack base, migraciones aditivas) | N/A — no hay migraciones ni cambio de stack; no se agrega Redis/BullMQ/backend síncrono (excluido a propósito, FR-008). |
| Delivery Workflow (PR al crear rama, merge `--no-ff`) | Cumplido — rama `012-workers-conector-node-kestra` y PR #18 abiertos contra `main` desde la creación de la spec. |

**Resultado**: PASS sin excepciones. No aplica Complexity Tracking.

**Re-chequeo post-diseño (tras Fase 1)**: al diseñar `data-model.md` se detectó que la fila del Principio I de la tabla de arriba estaba mal evaluada como N/A — la tabla central sí es una tabla de datos real (aunque el esquema de cada columna de dominio lo defina cada implementación), así que el aislamiento multi-tenant le aplica igual que a cualquier tabla expuesta del template. Se corrigió esa fila y se agregó FR-011 a la spec antes de continuar. Con esa corrección aplicada, `data-model.md`, `contracts/workers-readme-contract.md` y `quickstart.md` no introducen ningún otro servicio, dependencia o migración nueva. Resultado final: PASS sin excepciones.

## Project Structure

### Documentation (this feature)

```text
specs/012-workers-conector-node-kestra/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── workers-readme-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
workers/
└── README.md             # Único archivo que esta feature modifica (edición, no creación)
```

**Structure Decision**: No aplica ninguna de las estructuras de proyecto de código (single project / web app / mobile). Esta feature es una edición acotada a un archivo de documentación ya existente (`workers/README.md`); no se crea ningún directorio de código, servicio ni test suite nuevos.

## Complexity Tracking

*No aplica — el Constitution Check no registró violaciones que requieran justificación.*
