# Bug Fix: El seguimiento depende de una etiqueta inexistente

- **Slug**: seguimiento-sin-etiqueta
- **Fixed**: 2026-09-25
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El workflow ahora busca y crea/cierra las issues de seguimiento por título, sin depender de que el repositorio producto tenga creada una etiqueta. Se publicó `template-capability-sync` como versión 1.0.1.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `.github/workflows/sync-template.yml` | modified | Retirada la creación, filtro y asignación obligatoria de `template-sync`. |
| `scripts/verificar-adopcion-template.test.mjs` | modified | Prueba que el workflow no depende de etiqueta y conserva búsquedas por título. |
| `template-capabilities.json` | modified | Bump de `template-capability-sync` a 1.0.1. |
| `template-adoption.json` | modified | Manifiesto del template actualizado a 1.0.1. |
| `docs/adoptar-capacidades-template.md` | modified | Documenta seguimiento sin etiqueta y el aviso ante secreto ausente. |

## Tests Added or Updated

- `scripts/verificar-adopcion-template.test.mjs` — confirma búsquedas por títulos esperados y ausencia de comandos/filtros de etiqueta.

## Local Verification

- `pnpm test:template:adoption` → 11/11 tests passed.
- `pnpm docs:check` → OK.
- `pnpm template:capabilities:check` → OK.
- `git diff --check` → OK.

## Deviations from Assessment

Ninguna.

## Follow-ups

- Adoptar selectivamente la versión 1.0.1 y el workflow en Sauger y ejecutar manualmente sin el secreto para verificar la issue.
- Configurar `TEMPLATE_READ_TOKEN` para validar también la lectura privada real.
