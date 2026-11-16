# Bug Fix: PR #715 (MSF-789) en conflicto con `main`

- **Slug**: pr-715-conflicto-con-main
- **Fixed**: 2026-11-06
- **Status**: applied (conflicto) / partial (CI `application`: bloqueo externo)

## Summary

Se trajo `origin/main` a `docs/msf-789-mw2sucd6` (commit `11179f95`). El único conflicto era `docs/manifest.json` (archivo generado); se resolvió regenerándolo con `node scripts/docs-manifest.mjs`. No se tocó el contenido de documentación aprobado, ni tests, ni workflows.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `docs/manifest.json` (rama de #715) | regenerado | 4 `pageHash` en conflicto; 170 páginas |

## Local Verification

- `git merge-tree` previo: un solo conflicto (`docs/manifest.json`).
- `node scripts/docs-check.mjs` → Documentación OK.
- `gh pr view 715` → `mergeable: MERGEABLE` (antes `CONFLICTING/DIRTY`); `mergeStateStatus: BLOCKED` por checks pendientes.

## Deviations from Assessment

`application` en rojo NO se arregla acá: los fixes MSF-799 (#735) y MSF-687 (#736) mergearon contra `dokploy`; en `origin/main` no hay commits de MSF-799/687/801 y MSF-801 (#738) sigue abierto contra `main`. Es bloqueo externo.

## Follow-ups

- Cuando lleguen a `main` el fix de MSF-799/687 y MSF-801, re-ejecutar `application` en #715.
