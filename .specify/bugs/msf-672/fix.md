# Bug Fix: guard de migraciones marca «versión REUSADA» en épicas (MSF-672)

- **Slug**: msf-672
- **Fixed**: 2026-11-01
- **Status**: applied

## Cambios

| Archivo | Cambio |
|---|---|
| `scripts/verificar-migraciones.mjs` | La regla de orden («REUSADA») es error solo con base de épica, PR a `dokploy`/`main` o `--estricto`; si no, aviso. Duplicada/modificada siguen siendo error |
| `scripts/verificar-migraciones.test.mjs` | Nuevo: 7 pruebas sobre un repo git temporal |
| `package.json` | La prueba entra en `test:tooling` |
| `docs/verificar-migraciones.md` | Documenta las reglas y la razón |

## Riesgo

Se mantiene el gate estricto en el PR a `dokploy`/`main`. Reversión: revertir el commit (sin datos ni migraciones).
