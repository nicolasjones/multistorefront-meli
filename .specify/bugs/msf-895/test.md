# Bug Verification: [Lote L36] Higiene de código y referencias internas (MSF-895)

- **Slug**: msf-895
- **Tested**: 2026-11-21
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma (guard de arquitectura con «0 módulos, 0 dependencias» y veredicto `ok`) **no se reproduce**: el
check ahora cruza 1575 módulos y 5066 dependencias sobre `apps/web/src` y falla si no revisó nada. Los 3
ciclos de imports que el guard destapó se corrigieron y el cruce vuelve a dar 0 violaciones. No se
encontraron regresiones: los tests del front afectados, el build, el lint, knip y `docs:check` están en verde.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `node scripts/calidad.mjs --only=arch` | pass | `ok · módulos: 1575 · dependencias: 5066 · errores: 0 · avisos: 0` (antes: `ok` sobre 0 módulos) |
| Los 3 ciclos que aparecieron | volver a los archivos previos con `git stash` y cruzar de nuevo | pass | antes: 3 violaciones `no-circular`; después del arreglo: 0 |
| Tests nuevos | `node --test scripts/calidad.test.mjs` | pass | 4 pasan (1 salteado: gitleaks no está instalado) |
| Cobertura real del guard | `node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type json apps/web/src packages` | pass | `summary.totalCruised = 1575`, `summary.totalDependenciesCruised = 5066`, `summary.violations = []` |
| Regla `not-to-dev-dep` | archivo de prueba en `apps/web/src` que importa `vite` (devDependency) | pass (documentado como excepción) | la dependencia queda `unknown`/`couldNotResolve`: la regla no puede dispararse con el layout de pnpm; queda anotado en `docs/calidad.md` con seguimiento |
| Regresión (front) | `pnpm --filter @platform/web exec vitest run src/pages/ventas/configuracion src/pages/tienda-publica` | pass | 78 archivos, 938 tests OK |
| Build / type-check | `pnpm --filter @platform/web build` (`tsc -b` + `vite build`) | pass | sin errores de tipos (el `tsc -b` detectó y se corrigió un import faltante de `EmpresaOpcion`) |
| Lint | `pnpm --filter @platform/web lint` (oxlint) | pass | 0 errores; los warnings de `react-hooks`/`react` son preexistentes y no los introduce este cambio |
| Código muerto | `pnpm dlx knip@6.44.1 --no-progress` | pass | exit 0, 0 hallazgos (con el `devDependency` nuevo sin declarar, knip marcaba 1) |
| Duplicación / versiones | `pnpm dlx jscpd@5.4.2 --config .jscpd.json` y `pnpm dlx syncpack@13 list-mismatches` | pass | dentro del umbral de siempre; sin versiones divergentes |
| Documentación | `pnpm docs:check` | pass | «Documentación de cambios: OK», «Migraciones OK», «Trampas conocidas: OK» |
| Lockfile | `pnpm install --frozen-lockfile --offline` | pass | «Already up to date»: el lockfile está consistente con `package.json` |
| Base de datos | — | not-run | la historia no toca migraciones ni datos |
| E2E | — | not-run | la historia no cambia ninguna pantalla ni flujo visible (sin criterios de pantalla) |

## Output Excerpts

```
== dependency-cruiser (arquitectura): ok
módulos: 1575 · dependencias: 5066 · errores: 0 · avisos: 0
```

```
✔ [MSF-895] el guard de arquitectura falla si dependency-cruiser no cruzó ningún módulo
✔ [MSF-895] el guard de arquitectura falla si falta el binario local (no se revisó nada)
✔ [MSF-895] el guard de arquitectura da ok sólo si cruzó módulos y no encontró violaciones
```

```
 Test Files  78 passed (78)
      Tests  938 passed (938)
```

## Residual Risks

- **`not-to-dev-dep` queda inerte**: la herramienta no resuelve las dependencias a `node_modules` en este
  workspace pnpm, así que la regla nunca se evalúa. Está documentado como excepción (no se la da por
  cumplida) y con seguimiento propio; si alguien la lee como «cumplida», el seguimiento lo clarifies.
- **La cifra de módulos depende del tamaño del front**: 1575 módulos y 5066 dependencias son la medición
  del 2026-11-21; con archivos nuevos cambian (el guard lo dice en su salida, no es un número fijo).
- **Conflictos con otro PR abierto**: el PR #1127 (MSF-843) también toca `scripts/calidad.mjs`,
  `scripts/calidad.test.mjs` y `docs/calidad.md`. Al integrar los dos hay que resolver ese texto (el
  checklist de MSF-843 no se ve afectado: no cambia `add()` ni la plantilla del informe).
- **El guard ahora es más estricto**: si `dependency-cruiser` no encuentra el compilador o el binario, el
  job `quality` falla en vez de dar verde. Es el comportamiento pedido (falso verde), pero convierte un
  problema de entorno local en un rojo del PR: `pnpm install` en el root es obligatorio.

## Recommendation

Cerrar el bug — verificado end-to-end: el guard de arquitectura revisa el front de verdad, falla cuando no
revisa nada y los 3 ciclos que destapó están corregidos. Quedan como seguimiento el `not-to-dev-dep` inerte
y los comentarios con código de ticket de MSF-777 (decisión del Lote 2).
