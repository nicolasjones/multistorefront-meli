# Bug Verification: reconciliación de MSF-834 con F-1/F-3 publicadas

- **Slug**: msf-834
- **Tested**: 2026-11-14 (reconciliación), 2026-11-16 (F-2 y F-4)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial (la parte funcional está implementada y probada; la verificación en dev y el encendido por entorno quedan para la fase de cierre)

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

## Corrida del 2026-11-16 (F-2 y F-4)

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Prototipo | `pnpm prototipo:inventario` + `pnpm prototipo:check` | pass | 120 pantallas al día; el inventario de `VentasComprobante` no cambia (los tres elementos nuevos no son tablas/campos/botones) |
| Matriz pantalla↔criterios | `pnpm matriz:check` | pass | 0 specs nuevas revisadas |
| Documentación y migraciones | `pnpm docs:check` | pass | «Documentación de cambios: OK» + «Migraciones OK: 651 archivo(s), 0 nuevo(s)» |
| OpenAPI | `pnpm test:openapi` | pass | 18/18; «Contratos OpenAPI: OK (2 contrato(s))», sin diff |
| Lint | `pnpm lint` | pass | solo warnings preexistentes de `set-state-in-effect` |
| Build | `pnpm build` | pass | «✓ built in 2.37s» |
| Vitest del área | `vitest run` (ventasLineas, LineasComprobante, ConfirmarFacturaDialog, mostrador, comprobante, ventasMostrador) | pass | 101/101 |
| Calidad determinista | `pnpm calidad` | pass con salvedad | oxlint, knip, jscpd, dependency-cruiser y syncpack en **ok**; el check de secretos (gitleaks) necesita el socket de Docker, que este nodo no tiene |
| pgTAP nuevos (T020, T021) | `pnpm test:db` (requiere `pnpm dev:supabase`) | not-run | sin Docker en el nodo; los corre el job `database` del CI |
| E2E del mostrador (T012) | `pnpm --filter @platform/web test:e2e` (requiere Supabase local) | not-run | mismo motivo; lo corre el job nocturno `e2e-nocturno.yml` |

### Qué queda sin verificar en esta corrida

- Los **pgTAP nuevos** (`ventas_precio_promocional_paridad.test.sql`, `ventas_precio_promocional_reportes.test.sql`)
  y el **E2E** `ventas-mostrador-promocion.e2e.ts` no se pudieron ejecutar: este nodo no tiene Docker ni el stack local
  de Supabase. Se escribieron siguiendo los patrones de los pgTAP ya publicados de la épica (`ventas_precio_promocional.test.sql`,
  `ventas_precio_promocional_ciclo.test.sql`) y con **instantes fijos** (no dependen del reloj).
- La **verificación en dev** (T025) y el **encendido por entorno** (dev → stg → prd) requieren los entornos: quedan
  para la fase de cierre, con el gate documentado en `docs/deployment.md`.

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
