# Bug Verification: credencial local de Kestra reproducible

- **Slug**: credencial-kestra-local
- **Tested**: 2026-09-25
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

La variable faltante se rechaza sin filtración y el rol reconciliado permite
la conexión JDBC que usa Kestra en el recorrido real.

## Checks Performed

| Check | Command / Action | Result | Notes |
|------|------------------|--------|-------|
| Reproduction (post-fix) | `pnpm kestra:sincronizar-rol-local` y E2E | pass | El JDBC del escenario de éxito llegó a `SUCCESS`. |
| New / updated tests | `pnpm test:kestra:deploy-flow` | pass | 4 pruebas aprobadas, incluida variable faltante. |
| Regression suite | `pnpm test` | pass | 22 archivos web, 103 tests y 406 pruebas de base. |
| Lint / type-check | `pnpm lint` y `pnpm build` | pass | Solo advertencias existentes de frontend. |

## Output Excerpts

- `Rol local de Kestra sincronizado.`
- `OK: recorrido completo sin apariciones del centinela en ninguna ejecución real.`

## Residual Risks

- El comando está limitado al entorno local y requiere Supabase local activo.

## Recommendation

Cerrar el bug: el rol local se reconcilia explícitamente y el recorrido JDBC
real de Kestra quedó verificado sin exponer la credencial.
