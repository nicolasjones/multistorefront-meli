---
owner: producto
sources:
  - specs
---

# F5 — Profundidad (no bloqueante)

Checks que **informan** sin frenar PRs. Corren en `.github/workflows/nightly.yml` (06:00 UTC o a mano).

| Check | Herramienta | Qué mide |
|---|---|---|
| **Performance** | **Lighthouse CI** (`.lighthouserc.json`) | perf/a11y/best-practices sobre el build (`apps/web/dist`) |
| **Accesibilidad** | **axe-core CLI** | violaciones a11y sobre el preview |

Reportes en `reports/lighthouse/` (artefacto `nightly-reportes`).

## Pendiente (necesita devDependencies)
- **Mutation testing** (**Stryker**): requiere `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` como devDeps (no se agregan sin poder actualizar el lockfile). Config sugerida: mutar `apps/web/src/lib/**` y `packages/**`.
- **Cobertura del diff** (**diff-cover**): requiere un reporte de cobertura (`@vitest/coverage-v8` + `test:coverage`). Una vez habilitado, `diff-cover coverage/cobertura.xml --compare-branch=origin/main` en el PR.

## Cómo habilitarlos cuando se sumen las deps
1. `pnpm add -D @vitest/coverage-v8 @stryker-mutator/core @stryker-mutator/vitest-runner`
2. Agregar `test:coverage` (vitest --coverage) y `mutation` (stryker run) a `package.json`.
3. En `quality` (PR): `diff-cover`. En `nightly`: `stryker run`.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
