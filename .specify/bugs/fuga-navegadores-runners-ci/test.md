# Bug Verification: fuga de Chromium y zombies en los runners del CI

- **Slug**: fuga-navegadores-runners-ci
- **Tested**: 2026-10-26
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

La lógica de selección y los umbrales están cubiertos por tests y la
verificación viva corre en el job `infrastructure` del PR contra los runners
reales. La reproducción en el host y la observación de una semana no se
pueden cerrar en este heartbeat: requieren desplegar el compose nuevo y dejar
pasar los 7 días de los criterios de aceptación.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Tests del janitor | `pnpm test:ci` | pass | 27/27; incluye 9 casos nuevos |
| Parseo de procesos real | `node --test scripts/limpiar-ci.test.mjs` | pass | 9/9 |
| Sintaxis | `node --check scripts/limpiar-ci.mjs` | pass | — |
| Docs del cambio | `node scripts/verificar-documentacion-cambios.mjs` | pass | — |
| `infra:config` | `pnpm infra:config` | not-run | no hay `docker` en el entorno local; lo corre el CI |
| Verificación viva | `node scripts/limpiar-ci.mjs --verificar` | not-run | corre en `infrastructure` del PR; necesita los runners |
| Reproducción en host | `docker exec … /proc` tras cancelar e2e | not-run | sin acceso SSH desde este agente; evidencia en AGE-1311 |
| Criterio de 7 días | conteo con runners ociosos | not-run | requiere el compose desplegado y una semana |

## Output Excerpts

```text
ℹ tests 27
ℹ pass 27
ℹ fail 0
```

## Residual Risks

- El janitor sólo se programa desde la rama por defecto; si `ci-janitor.yml`
  no llega a `main`, el cron no corre (la limpieza de fin de job sí).
- Los zombies no se pueden matar; necesitan que los runners se reciclen con
  `init: true`. Mientras no se reciclen, el janitor sólo avisa.
- `--verificar` mira huérfanos de más de 45 min; una fuga recién creada se ve
  cuando envejece o en el conteo del propio job.

## Recommendation

No cerrar todavía: mergear el PR, recrear los runners sin jobs en curso y
volver a medir a la semana. Si la verificación del PR o el conteo a la semana
fallan, reabrir y volver a evaluar con `speckit-bug-assess`.
