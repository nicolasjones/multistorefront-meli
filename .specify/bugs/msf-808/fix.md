# Bug Fix: setState sin guarda de desmontaje en useEmpresasAccesibles (MSF-808)

- **Slug**: msf-808
- **Status**: applied

## Summary
`useEmpresasAccesibles` ahora usa un ref `montado` (false en la limpieza del efecto) y lo chequea antes de `setEmpresas`/`setHayError`/`setCargando`. Evita el `ReferenceError: window is not defined` cuando la respuesta llega tras desmontar.

## Changes
| File | Change |
|------|--------|
| `apps/web/src/hooks/useEmpresasAccesibles.ts` | guarda de desmontaje |
| `apps/web/src/hooks/useEmpresasAccesibles.desmontaje.test.tsx` | test nuevo |

## Deviations from Assessment
El reintento del job `web` de PR #737 es una acción de CI, no de código; se aplica el fix puntual indicado.
