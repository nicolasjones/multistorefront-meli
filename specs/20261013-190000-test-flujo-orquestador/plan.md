# Implementation Plan: Test del flujo del orquestador (BORRAR)

**Spec**: `specs/20261013-190000-test-flujo-orquestador/spec.md` | **Jira**: MSF-480 | **Branch**: `epic/MSF-480-test-flujo-orquestador-borrar`

## Summary

Tres historias (F-TST-01, F-TST-02, F-TST-03) en dos fases: documento de una línea, test `node:test` que lo verifique y script registrado en `package.json`. Sin lógica de negocio, sin migraciones, sin datos.

## Technical Context

- **Delivery scope**: solo documentación + test de tooling (`scripts/`).
- **Datos**: ninguna tabla creada ni alterada; RLS y esquemas (Principio VII) no aplican.
- **Testing**: `node --test scripts/test-flujo-orquestador.test.mjs`, mismo patrón que `scripts/*.test.mjs`.
- **Dependencias**: ninguna nueva.

## Constitution Check

- II (especificar antes de implementar): cumplido con esta spec.
- VIII (documentación): el cambio incluye `docs/` y `specs/`, por lo que `pnpm docs:check` pasa aunque toque `scripts/`.
- Migraciones: ninguna (aditivo trivial, sin reversión necesaria).
- Delivery Workflow: PR contra `main` al crear la rama; cierre con merge commit `--no-ff`. Al cerrar, actualizar `docs/roadmap-template.md` si corresponde (paso manual).

## Design (por fase)

**Fase 1 — F-TST-01**: `docs/test-flujo-orquestador.md` con una única línea (texto de la Assumption de la spec).

**Fase 2 — en PARALELO (archivos disjuntos)**:
- F-TST-02: `scripts/test-flujo-orquestador.test.mjs`: lee el archivo, verifica que exista y tenga la línea; falla si falta o está vacío.
- F-TST-03: `package.json`: script `test:flujo-orquestador` encadenado; validar `pnpm docs:check` y `pnpm lint`.

## Risks / Verificación

- Riesgo bajo. Evidencia local: `node --test scripts/test-flujo-orquestador.test.mjs`, `pnpm docs:check`, `pnpm lint`; el resto (CI completo) queda para `validate.yml`.
