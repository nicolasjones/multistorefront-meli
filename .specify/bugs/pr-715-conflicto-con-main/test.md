# Bug Test: PR #715 en conflicto con `main`

- **Slug**: pr-715-conflicto-con-main
- **Verdict**: conflicto resuelto; `application` pendiente de bloqueo externo

## Verificación

- `gh pr view 715 --json mergeable,mergeStateStatus` → `MERGEABLE` / `BLOCKED` (checks).
- `docs/manifest.json` parsea como JSON sin marcadores de conflicto.
- `node scripts/docs-check.mjs` → Documentación OK.
- E2E: no aplica (sin cambios de pantalla ni de código).
