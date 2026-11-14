# Bug Verification: reconciliación de MSF-834 con F-1/F-3 publicadas

- **Slug**: msf-834
- **Tested**: 2026-11-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

La rama ya no trae versiones de migración duplicadas ni modificadas y el
comportamiento esperado (cobrar el precio promocional en POS y comprobantes)
está implementado y probado en `origin/dokploy` por el PR #950. No se pudo
reproducir ni correr el pgTAP en este nodo porque Docker/Supabase no están
disponibles; queda para el CI.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Versiones de migración | `node scripts/verificar-migraciones.mjs` | pass | 651 archivos, 0 nuevos, sin MODIFICADA/duplicada |
| Documentación + migraciones | `pnpm docs:check` | pass | `Documentación de cambios: OK` |
| Guard de DDL/migraciones | `pnpm test:db:guard-migraciones` | pass | 30/30 |
| Lint | `pnpm lint` | pass | solo warnings preexistentes |
| Build | `pnpm build` | pass | `✓ built in 2.34s` |
| DER | `pnpm der:check` | fail (línea base) | 138 specs preexistentes sin DER, ninguna de este cambio |
| Reproducción / pgTAP | `pnpm test:db` (requiere `pnpm dev:supabase`) | not-run | Docker no disponible en el nodo |

## Output Excerpts

```
Migraciones OK: 651 archivo(s), 0 nuevo(s) contra origin/dokploy.
Documentación de cambios: OK (3199 archivos comparados contra 54ea7b1…)
ℹ tests 30
ℹ pass 30
ℹ fail 0
✓ built in 2.34s
```

## Residual Risks

- La verificación funcional del precio promocional en comprobantes queda
  delegada al job de pgTAP del CI (`application` + `supabase/tests/database`).
- `pnpm der:check` falla por deuda preexistente de specs sin sección DER; no es
  causado por este cambio y no se tocó ninguna de esas specs.

## Recommendation

No hay deuda de código pendiente de esta devolución: los hallazgos se resuelven
con lo publicado en `dokploy` (PR #950). Validar en CI y cerrar el PR como
reconciliación/superado por #950.
