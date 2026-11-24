# Bug Fix: tope de ramas con CI en vuelo (`CI_RANAS_MAXIMAS`)

- **Slug**: msf-903
- **Fixed**: 2026-11-20
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se corrigió el procedimiento de `docs/control-ci.md` sobre `CI_RANAS_MAXIMAS` con las cifras reales del repo
(`CI_LANES=15`, **5** runners self-hosted online, 2026-11-20), se separó el ámbito de cada variable (repo del producto
vs `.env` del orquestador) y se explicitó el criterio del 4 (deja un runner de holgura para `liberar`). Se regeneró
`docs/manifest.json`, que había quedado viejo tras editar la página.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `docs/control-ci.md` | modified | Cifras 15/5, ámbito de `CI_LANES`/`CI_LOAD_MAX` (variable de repo, `scripts/ci-lane.mjs`) vs `CI_RANAS_MAXIMAS` (`.env` del orquestador, `packages/core/ci.js`), criterio `min(4,5)=4`, nota del `.env.example` del orquestador y deuda del modelo de capacidad. |
| `docs/manifest.json` | modified | `pageHash`/`sourceAt`/`commit` regenerados con `pnpm docs:manifest`. |
| `.specify/bugs/msf-903/assessment.md`, `fix.md`, `test.md` | added | Trazabilidad del bug y verificación. |

## Tests Added or Updated

- No aplica test de código: el cambio es documental y de configuración del servidor. La verificación es
  `pnpm docs:check` + la comprobación del CI de que `docs:manifest` no deja diff
  (`.github/workflows/docs.yml:30-34`).

## Local Verification

- `pnpm docs:check` → OK (documentación, migraciones y trampas conocidas).
- `pnpm docs:manifest` → regenerado; el diff queda sólo en `docs/control-ci.md` y `docs/manifest.json`.

## Deviations from Assessment

- El cambio de la variable en `/opt/ai-dev-orchestrator/.env` es una acción en el servidor (Nicolás). Este PR documenta el
  procedimiento y deja anotado que `CI_RANAS_MAXIMAS` falta en el `.env.example` de ese repo; no se edita un repo fuera
  de este PR.

## Follow-ups

- Ejecutar en VPS2: `CI_RANAS_MAXIMAS=4` en `/opt/ai-dev-orchestrator/.env` + `systemctl restart ai-dev-gateway`.
- Agregar `CI_RANAS_MAXIMAS` al `.env.example` del repo `ai-dev-orchestrator` (cambio en ese repo).
- Revisar el modelo de capacidad del orquestador: hoy sólo cuenta runners self-hosted, pero los jobs pesados corren en
  `ubuntu-latest` (`CI_RUNS_ON_PESADO`).
