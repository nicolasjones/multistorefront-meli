# Bug Verification: PR #889 dejó `database` y `web (1)` en rojo (MSF-844)

- **Slug**: msf-844
- **Tested**: 2026-11-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial (la parte web quedó verificada localmente; el pgTAP de la baja lo valida el job `database` del CI, no hay Docker/psql en este entorno)

## Summary

La migración quedó acotada a las claves de la baja con ingresos de mercadería (7 pares / 8 claves)
con una guarda pgTAP que impide volver a la clausura completa, y la tabla con scroll del panel
volvió a ser una región con nombre, con el conteo real de 4 regiones en «Listas configurables».
Las comprobaciones web, lint, build y de tooling pasan. El pgTAP no se pudo ejecutar acá porque el
entorno no tiene Docker ni psql; la verificación definitiva de `database` es el CI del PR.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción post-fix (base) | `supabase/tests/database/baja_organizacion_con_ingresos.test.sql` | not-run | Requiere Docker + Supabase local; sin permisos en este entorno. Lo corre el job `database`. |
| Tests nuevos/actualizados (web) | `pnpm --filter @platform/web exec vitest run src/pages/configuracion/listas.test.tsx src/components/pagina/ContenidoAdaptable.test.tsx` | pass | 2 archivos, 15 pruebas. |
| Regresión de tooling de migraciones | `node scripts/verificar-migraciones.mjs` + `node scripts/validar-migraciones-aditivas.mjs` | pass | Versión nueva única y 630 migraciones sin destructivas sin reversión. |
| Lint | `pnpm lint` | pass | exit 0; los warnings son preexistentes. |
| Type-check / build | `pnpm build` | pass | `tsc -b && vite build`, exit 0. |
| Documentación | `pnpm docs:check` | pass | «Documentación de cambios: OK» + «Migraciones OK». |
| Calidad determinista | `pnpm calidad:code` | pass | oxlint/knip/jscpd/dependency-cruiser/syncpack OK; gitleaks se saltea (Docker). |

## Output Excerpts

```text
Test Files  2 passed (2)
     Tests  15 passed (15)
```

```text
Migraciones OK: 630 archivo(s), 1 nuevo(s) contra origin/dokploy.
630 migraciones verificadas en supabase/migrations: ninguna destructiva sin camino de reversión documentado.
Documentación de cambios: OK (1 archivos comparados contra HEAD~1).
```

```text
lint_exit=0
build_exit=0
docs_exit=0
```

## Residual Risks

- El pgTAP de la baja y la suite `database` completa no se ejecutaron localmente. La corrección se
  apoya en el catálogo de `pg_constraint` y en que los tests de ventas/motos/cotizaciones/stock ya no
  ven claves diferidas fuera del alcance; el CI es la verificación real.
- La baja sigue fallando con datos protegidos por claves `restrict` fuera del alcance (p. ej.
  `dominio.reparaciones → dominio.empresas`): es el comportamiento documentado, no una regresión.

## Recommendation

Mergear cuando el job `database` (con el pgTAP nuevo) y `web (1)` queden en verde sobre el commit
nuevo. Si `database` volviera a fallar, comparar el archivo que falla contra la base antes de
reabrir: la migración ya no toca las tablas de ventas, motos, cotizaciones ni stock.
