# Bug Verification: toma de inventario con categorías grandes — la URL del `in (…)` se pasa del límite

- **Slug**: msf-716
- **Tested**: 2026-11-01
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma (la pantalla con «No pudimos cargar los productos de esta categoría» en categorías grandes) ya no
se reproduce: el stock del depósito se pide en lotes de 100 ids (4.089 bytes de URL) en vez de uno de hasta
1000 (39.189 bytes). El filtro por categoría, que viaja por la misma URL, también está repartido. Verificado por
test automatizado del camino real de carga (categoría de 1000 productos → 1000 filas con su stock) y por el largo
de URL medido en cada lote. La reproducción contra el gateway real no se ejecutó (no hay stack local en este
entorno): el umbral exacto de rotura depende del proxy.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `apps/web/src/lib/tomaInventario.carga.test.ts` (categoría de 1000 productos) | pass | 1000 filas con su stock en el sistema; el `in.(…)` se pide en 10 lotes de 100 |
| Filtro por categoría repartido | `apps/web/src/lib/tomaInventario.carga.test.ts` (250 categorías) | pass | 3 lotes de 100; cada URL ≤ 8000 bytes; los productos de los lotes se unen sin repetir y quedan ordenados por nombre |
| New / updated tests | `pnpm --filter @platform/web exec vitest run src/lib/depositos.stockLotes.test.ts src/lib/tomaInventario.carga.test.ts src/pages/stock/toma-inventario.test.tsx src/pages/stock/list.test.tsx src/pages/stock/depositos.test.tsx src/lib/categorias.test.ts` | pass | 6 archivos, 92 tests OK |
| Regression suite (área tocada) | mismos 6 archivos | pass | sin regresiones en la pantalla, el listado de Stock, sus depósitos y las categorías |
| Lint / type-check | `pnpm lint` · `pnpm build` (`tsc -b && vite build`) | pass | lint exit 0 (warnings preexistentes en otros archivos); build exit 0 |
| E2E de pantalla | `apps/web/e2e/stock-toma-inventario-categorias.e2e.ts` | not-run | Requiere el stack local (`pnpm dev:supabase`): no hay Docker en este entorno. Se omite solo (sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) y aparece en `playwright test --list` |
| Documentación | `GITHUB_BASE_REF=dokploy pnpm docs:check` | pass | `docs/stock-toma-inventario.md` y `docs/e2e-app.md` actualizados en el mismo cambio (10 archivos comparados contra `origin/dokploy`) |
| Calidad determinista | `pnpm calidad` | partial | oxlint (SAST), knip, jscpd, dependency-cruiser y syncpack OK; **gitleaks no se pudo correr** (sin acceso al daemon de Docker). El diff se revisó a mano: no agrega secretos |

## Output Excerpts

```
Test Files  6 passed (6)
     Tests  92 passed (92)
```

```
== oxlint (SAST): ok
== knip (código muerto): ok
== jscpd (duplicación): ok
== dependency-cruiser (arquitectura): ok
== syncpack (versiones): ok
---- RESUMEN ----
  hallazgos  gitleaks (secretos)   ← sin daemon de Docker en este entorno
```

Largo de la URL del filtro `in.(…)` medido con `URLSearchParams` (ids con forma de uuid, 36 caracteres):

| ids | sin repartir | con el arreglo (lotes de 100) |
|-----|--------------|-------------------------------|
| 100 | 4.089 B | 4.089 B |
| 200 | 7.989 B | 4.089 B |
| 250 | 9.939 B | 4.089 B |
| 1000 | 39.189 B | 4.089 B |

El filtro por categoría usa el mismo tope: 250 ids de categoría son 3 lotes (100, 100 y 50), así que ninguna
petición lleva más de 100 ids — la misma cota de URL que la tabla de arriba.

## Residual Risks

- **No se reprodujo contra el gateway real**: el umbral exacto depende del proxy delante de PostgREST. El arreglo lo evita por margen (4 KB por petición contra un límite típico de 8 KB), pero conviene ver la pantalla con una categoría grande en el entorno de staging.
- **El E2E no se ejecutó** en este entorno (sin stack local): la siembra de 250 productos y la navegación quedan sin validar de punta a punta.
- **gitleaks no corrió** (sin daemon de Docker): la revisión de secretos del diff fue manual.
- El `count: 'exact'` agrega un conteo sobre la categoría: con el tope de 1000 filas de la API es barato, pero en una categoría con decenas de miles de productos el conteo agrega trabajo a la consulta de la toma.
- Con el filtro por categoría repartido, el orden de la tabla se arma en el navegador (nombre y, a igual nombre, id) en vez de venir del `order` de Postgres; con una sola categoría —el caso habitual— el orden sigue siendo el de la base.

## Recommendation

Cerrar el bug — verificado por test automatizado del camino de carga y por el largo de URL medido en cada
petición. Antes de mergear, correr el E2E con `pnpm dev:supabase` y confirmar la pantalla con una categoría
grande en staging.
