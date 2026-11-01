# Bug Verification: el guard de migraciones no detecta `ADD COLUMN` en línea aparte

- **Slug**: msf-682
- **Tested**: 2026-11-01
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma original (`alter table t` + `add column x` en la línea siguiente pasaba el guard con
exit 0) **no se reproduce**: el guard ahora parte el SQL en sentencias y marca ese `ADD COLUMN`
como problema. Los casos que la devolución del Revisor marcó (sentencia sin anclaje al inicio
de línea, cuerpo dollar-quoted de SQL dinámico, guard de `CREATE INDEX` en la línea siguiente)
quedan cubiertos por tests.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `node scripts/verificar-migraciones.test.mjs` (repo git temporal con migración sintética) | pass | `alter table t` + `add column x` en la línea siguiente → exit 1 + `ADD COLUMN sin IF NOT EXISTS` en la línea 2 |
| New / updated tests | `pnpm test:db:guard-migraciones` | pass | 25/25 (18 unitarios del detector + 7 de integración del guard) |
| Guard completo | `node scripts/verificar-migraciones.mjs --solo-idempotencia` | pass | `Migraciones OK: 419 archivo(s), 0 nuevo(s) contra origin/dokploy` (exit 0) |
| Guard completo (con control de versiones) | `node scripts/verificar-migraciones.mjs` | pass | exit 0, sin versiones duplicadas ni modificadas |
| Documentación | `pnpm docs:check` | pass | `Documentación de cambios: OK` + guard |
| Lint | `pnpm lint` | pass | exit 0 (warnings de React preexistentes en `apps/web`) |
| Build | `pnpm build` | pass | exit 0 (`✓ built in 2.13s`) |
| Calidad determinista | `pnpm calidad` | partial | `oxlint`/`jscpd`/`dependency-cruiser`/`syncpack`/`knip` OK; `gitleaks` no se pudo correr (sin Docker en el entorno) |
| Contraste con el corpus histórico | script de comparación sobre `supabase/migrations` | pass | 27 `ADD COLUMN` sin guard en 20 migraciones (mismos que antes, misma línea); las otras 4 reglas: 290 hallazgos, **0 diferencias** con la versión por línea |

## Output Excerpts

```
✔ falla con ADD COLUMN sin guard en una línea aparte (MSF-682)
✔ falla cuando la sentencia no arranca al inicio de línea
✔ pasa con SQL dinámico en un cuerpo dollar-quoted
✔ no marca CREATE INDEX con if not exists en la línea siguiente
ℹ tests 25
ℹ pass 25
ℹ fail 0

Migraciones OK: 419 archivo(s), 0 nuevo(s) contra origin/dokploy.
```

## Residual Risks

- El detector **no** ve el DDL que vive dentro de un cuerpo dollar-quoted (`do $$ ... $$`,
  `execute $q$ ... $q$`): es a propósito (evita el falso positivo del SQL dinámico), pero una
  migración que agregue columnas dentro de un `DO` no es controlada por el guard.
- Las 20 migraciones históricas con `ADD COLUMN` sin guard siguen como están (versión publicada =
  inmutable; el guard sólo revisa archivos nuevos). No las corrige este PR.
- `gitleaks` (check de secretos) no se pudo correr localmente: sin binario y sin acceso al socket
  de Docker. Corre en el CI.

## Recommendation

Cerrar el bug — verificado end-to-end contra el código de salida del script, con el test del
guard incorporado al CI de validación.
