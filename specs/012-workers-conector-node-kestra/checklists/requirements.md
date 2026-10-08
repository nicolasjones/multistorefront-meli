# Specification Quality Checklist: Convención de Workers de Integración (Node + Kestra)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-14
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Excepción deliberada a "No implementation details": FR-001, FR-006 y las Assumptions nombran explícitamente "Node.js + TypeScript", "Playwright" y "endpoint HTTP" porque esta spec, por su naturaleza, especifica una convención técnica para el propio template (qué runtime usar por defecto en `workers/`, qué es y qué no es un healthcheck ahí) — no una funcionalidad de producto para un usuario final. Nombrar estos términos es el requisito en sí, no un detalle de implementación que deba abstraerse.
- Todos los ítems pasan en la primera iteración. No se generaron [NEEDS CLARIFICATION] durante `/speckit-specify`: el alcance ya estaba acordado de antemano (dos casos reales confirmados, límites explícitos de qué queda afuera).
- `/speckit-clarify` (2026-09-14) resolvió 3 ambigüedades no cubiertas por el checklist original pero de alto impacto: manejo de credenciales de conectores (FR-010), clave compuesta de idempotencia (FR-004), y significado de "healthcheck" para un worker de ejecución puntual (FR-006). Las 16 casillas originales seguían pasando antes de esta ronda; después de integrar las 3 respuestas, se mantienen las 16/16 — las clarificaciones cerraron gaps de precisión, no fallas del checklist.
- Durante `/speckit-plan` (Fase 1, diseño de `data-model.md`) se detectó un gap real no cubierto por clarify: la clave de idempotencia `(origen, id_externo)` no aísla por organización en un template multi-tenant, y el Constitution Check había marcado el Principio I como N/A por error. Se agregó FR-011 y se corrigió FR-004/Key Entities/Assumptions en `spec.md` para exigir columna de organización + RLS en la tabla central, con clave compuesta `(organización, origen, id_externo)`. El checklist se re-validó tras el cambio: sigue en 16/16 (el nuevo FR-011 es testable y no introduce implementation details fuera de la excepción ya documentada).
- Revisión posterior detectó una segunda imprecisión: "tabla central" estaba definida de forma ambigua entre "una tabla por dominio de negocio completo" y "una tabla por tipo de registro". Se agregó FR-004b aclarando que un worker puede tener varias tablas centrales (una por cada tipo de registro distinto) y que un mismo conector puede alimentar más de una. Checklist re-validado: 16/16 sin cambios de estado.
- Revisión posterior de genericidad encontró que, a pesar de FR-007/FR-009, varios artefactos de esta spec (no `workers/README.md`, que todavía no existe, sino `research.md` y `data-model.md`) habían quedado con menciones directas a los sistemas externos de los casos motivadores, además de referencias a "conversación previa" y "producto derivado" repetidas en spec.md, plan.md, data-model.md, research.md y contracts/. Se reemplazó todo por lenguaje genérico ("implementación", "quien la implemente") y se generalizó FR-007/SC-003/pregunta 7 del contrato para excluir cualquier marca o dominio de negocio concreto, no solo los dos casos que motivaron la convención — más duradero que una lista fija de nombres. Se corrigió además un conteo desactualizado en `quickstart.md` (12 → 13 preguntas del contrato). Checklist re-validado: 16/16 sin cambios de estado.
- Revisión de consistencia contra la spec 013 (que extiende a esta) encontró una inconsistencia real de granularidad: FR-002 y las Key Entities todavía definían "conector = un sistema externo entero", la versión anterior al diseño posterior donde se acordó "worker = dedicado a un único sistema externo, conector = un tipo de dato/reporte dentro de ese sistema" — la versión que la spec 013 ya asume sin decirlo explícito. Se corrigió en spec.md (FR-002, FR-004b, Key Entities, historias 1 y 2, Edge Cases), data-model.md y contracts/workers-readme-contract.md (pregunta 2). Checklist re-validado: 16/16 sin cambios de estado.
- Implementación completada (`/speckit-implement`, Fases 1-6 de `tasks.md`): `workers/README.md` quedó ampliado con las tres historias de usuario. Validación final (T017) contra las 13 preguntas de `contracts/workers-readme-contract.md`: todas se responden sin ambigüedad. Búsqueda de términos prohibidos (marca, sistema externo concreto, Redis/BullMQ, backend síncrono) sin resultados fuera de la exclusión explícita de "Fuera de alcance" (FR-007, FR-008, SC-003). La sección nueva se lee como extensión del contrato de worker preexistente, no como fuente paralela (T018). `spec.md` actualizado a `Status: Implemented`. Checklist re-validado: 16/16 sin cambios de estado.
