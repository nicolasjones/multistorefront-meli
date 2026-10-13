# Implementation Plan: Test del flujo del orquestador (BORRAR)

**Spec**: `specs/20261013-190000-test-flujo-orquestador/spec.md` | **Jira**: MSF-480 | **Branch**: `epic/MSF-480-test-flujo-orquestador-borrar`

## Summary

Agregar `docs/test-flujo-orquestador.md` (una línea) y un test `node:test` que lo verifique, registrado en `pnpm test`. Sin lógica de negocio, sin migraciones, sin datos.

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

## Design

1. `docs/test-flujo-orquestador.md`: una línea con el texto de la Assumption de la spec.
2. `scripts/test-flujo-orquestador.test.mjs`: lee el archivo, verifica que exista, que tenga una sola línea no vacía y que sea la esperada.
3. `package.json`: script `test:flujo-orquestador` y encadenarlo en `test`.

## Risks / Verificación

- Riesgo bajo. Evidencia local: `node --test scripts/test-flujo-orquestador.test.mjs`, `pnpm docs:check`, `pnpm lint`; el resto (CI completo) queda para `validate.yml`.
