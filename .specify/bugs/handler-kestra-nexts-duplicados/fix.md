# Bug Fix: handler dedicado sin siguientes duplicados

- **Slug**: handler-kestra-nexts-duplicados
- **Fixed**: 2026-09-25
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

La secuencia del flow dedicado se encapsuló en un `Sequential` y el handler
de errores se adjuntó a esa unidad. Se conserva la clasificación y las alertas
sanitizadas, sin transportar credenciales ni logs crudos.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `infra/kestra/flows/plantilla-dedicado.yml` | modified | Encapsula resolver, SSH y marcado junto al handler. |
| `infra/kestra/validar-secretos-e2e.mjs` | modified | Aísla nombres de secretos por corrida y recorre credencial antes de la falla técnica. |

## Tests Added or Updated

- `pnpm infra:config:kestra` — valida la forma del flow.
- `pnpm test:kestra:secretos:e2e` — ejecuta éxito y ambos caminos de error.

## Local Verification

- Commands run: `pnpm infra:config:kestra` → configuración válida.
- Commands run: `pnpm test:kestra:secretos:e2e` → éxito, credencial con
  reintentos, falla técnica y búsqueda de centinela aprobados.

## Deviations from Assessment

`plantilla-generico.yml` ya usaba un `Sequential`; solo el flow dedicado
presentaba la condición reproducida. El harness también reutilizaba nombres
fijos de secretos, por lo que se volvieron únicos por corrida para eliminar
interferencia entre validaciones.

## Follow-ups

- Mantener la validación E2E cuando se actualice la versión de Kestra.
