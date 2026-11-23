# Bug Verification: [Lote L36] Higiene de código y referencias internas (MSF-895)

- **Slug**: msf-895
- **Tested**: 2026-11-23
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma (guard de arquitectura con «0 módulos, 0 dependencias» y veredicto `ok`) **no se reproduce**: el
check ahora cruza 1674 módulos y 6220 dependencias sobre `apps/web/src` y falla si no revisó nada. Los 3
ciclos de imports que el guard destapó se corrigieron y el cruce vuelve a dar 0 violaciones. La tercera regla
(`not-to-dev-dep`) también evalúa de verdad: encontró 1 `devDependency` usada en runtime (`fflate`), que se
corrigió moviéndola a `dependencies`. El segundo defecto vivo que dejó la revisión (el `commit` del manifest
en `null` con `sourceAt` puesto, que rompía la invariante de las páginas con fuentes y hacía que
`docs-drift.mjs` imprimiera «última: ?») también quedó corregido y verificado. No se encontraron
regresiones: los tests del front afectados, el build, el lint, knip y `docs:check` están en verde.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `node scripts/calidad.mjs --only=arch` | pass | `ok · módulos: 1674 · dependencias: 6220 · errores: 0 · avisos: 0` (antes: `ok` sobre 0 módulos) |
| Los 3 ciclos que aparecieron | volver a los archivos previos con `git stash` y cruzar de nuevo | pass | antes: 3 violaciones `no-circular`; después del arreglo: 0 |
| Regla `not-to-dev-dep` | bajar `fflate` a `devDependencies` y volver a cruzar | pass | la regla marca `apps/web/src/lib/importacion-productos.ts` (error); con `fflate` en `dependencies`: 0 violaciones |
| Tests nuevos | `node --test scripts/calidad.test.mjs` | pass | 5 pasan (1 salteado: gitleaks no está instalado) |
| El test vigila la regla | romper el `.dependency-cruiser.cjs` a propósito | pass | con `node_modules` de vuelta en `exclude` el test falla (0 violaciones); sin la excepción de los tests también falla (2 violaciones). Se revirtió cada cambio |
| Cobertura real del guard | `node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type json apps/web/src packages` | pass | `summary.totalCruised = 1674`, `summary.totalDependenciesCruised = 6220`, `summary.violations = []` |
| `commit` del manifest (defecto de la revisión) | `node --test scripts/docs-manifest.test.mjs` | pass | 4 pasan; el nuevo («una página sin cambios no queda con `commit` en null») **falla** con el código anterior (`commit` queda en `null`) |
| Manifest reproducible | `node scripts/docs-manifest.mjs` dos veces seguidas | pass | 344 páginas · 311 con fuentes · 33 estáticas; el diff son 7 líneas y la segunda corrida no cambia nada |
| El manifest commiteado es el que ve el CI | clon shallow (`--depth 1`) + `node scripts/docs-manifest.mjs` + `git diff --exit-code docs/manifest.json` | pass | sin diff: el manifest commiteado está en sync con las páginas y el script reusa sus valores |
| Invariante del manifest | leer `docs/manifest.json` | pass | 0 páginas con fuentes donde `sourceAt != commit` y 0 con `commit: null` (antes: 3 y 3) |
| Drift | `node scripts/docs-drift.mjs --json` | pass | 25 páginas con la fuente cambiada (antes 26): la de `docs/documentacion-cambios.md` deja de estar vieja porque la página se actualizó con el cambio del script |
| Links e inventario de docs | `node scripts/docs-check.mjs` y `node scripts/docs-inventario.mjs` | pass | «Documentación OK» (2003 links) y «Inventario: 276 rutas · 207 tablas · 111 vars · 158 specs · 345 páginas» sin diff |
| Tests de documentación | `pnpm test:docs:check` | pass | 171 tests OK |
| Regresión (front) | `pnpm --filter @platform/web exec vitest run src/pages/ventas/configuracion src/lib/tiendaInicio src/lib/categorias src/higieneReferenciasInternas.test.ts` | pass | 5 archivos, 97 tests OK |
| Build / type-check | `pnpm --filter @platform/web build` (`tsc -b` + `vite build`) | pass | sin errores de tipos ni de build |
| Lint | `pnpm --filter @platform/web lint` (oxlint) | pass | exit 0 (los warnings de `react-hooks`/`react` son preexistentes y no los introduce este cambio) |
| Calidad determinista | `pnpm calidad` | pass | oxlint, knip, jscpd, dependency-cruiser y syncpack en «ok»; gitleaks no corre en esta máquina (sin permiso del socket de Docker), así que lo deja el CI |
| Código muerto | `pnpm dlx knip@6.44.1 --no-progress` | pass | exit 0, 0 hallazgos |
| Duplicación / versiones | `pnpm dlx jscpd@5.4.2 --config .jscpd.json` y `pnpm dlx syncpack@13 list-mismatches` | pass | dentro del umbral de siempre; sin versiones divergentes |
| Documentación | `pnpm docs:check` | pass | «Documentación de cambios: OK», «Migraciones OK», «Trampas conocidas: OK» |
| Lockfile | `pnpm install --frozen-lockfile --offline` | pass | «Already up to date»: el lockfile está consistente con `package.json` |
| Alcance del lote (539/580/777) | `git ls-tree origin/dokploy` + lectura de los archivos citados | pass | MSF-539 y MSF-580 resueltos en la base (con pgTAP y Vitest); MSF-777 cerrado en su parte de títulos por el Lote 2, con los comentarios con código de ticket como seguimiento con dueño (ver `fix.md`) |
| Base de datos | — | not-run | la historia no toca migraciones ni datos |
| E2E | — | not-run | la historia no cambia ninguna pantalla ni flujo visible (sin criterios de pantalla) |

## Output Excerpts

```
== dependency-cruiser (arquitectura): ok
módulos: 1674 · dependencias: 6220 · errores: 0 · avisos: 0
```

```
✔ [MSF-895] el guard de arquitectura falla si dependency-cruiser no cruzó ningún módulo
✔ [MSF-895] el guard de arquitectura falla si falta el binario local (no se revisó nada)
✔ [MSF-895] el guard de arquitectura da ok sólo si cruzó módulos y no encontró violaciones
✔ [MSF-895] la regla not-to-dev-dep marca un devDependency usado por código de runtime y lo deja pasar en los tests
```

```
 Test Files  5 passed (5)
      Tests  97 passed (97)
```

```
✔ sourceAt es el último commit propio de la página y no HEAD (con commits posteriores ajenos)
✔ un archivo agregado a la fuente después de sourceAt no cambia sourceHash (D-4)
✔ dos HEAD distintos con el mismo contenido de la página dan el mismo sourceAt y sourceHash
✔ una página sin cambios no queda con `commit` en null (MSF-895)
```

## Residual Risks

- **La regla `not-to-dev-dep` ahora tiene alcance**: mira el código de `apps/web/src` **fuera** de los tests
  y de `apps/web/src/test/`. Si mañana un archivo de runtime importa una `devDependency`, el job `quality`
  queda rojo: es el comportamiento pedido (guardar el «ok»), pero convierte un error de código en un rojo del
  PR. La excepción de los tests está escrita en la regla y verificada por un test.
- **Las cifras de módulos dependen del tamaño del front**: 1674 módulos y 6220 dependencias son la medición
  del 2026-11-23; con archivos nuevos cambian (el guard lo dice en su salida, no es un número fijo).
- **Conflictos con otro PR abierto**: el PR #1127 (MSF-843) también toca `scripts/calidad.mjs`,
  `scripts/calidad.test.mjs` y `docs/calidad.md`. Al integrar los dos hay que resolver ese texto (el
  checklist de MSF-843 no se ve afectado: no cambia `add()` ni la plantilla del informe).
- **El guard ahora es más estricto**: si `dependency-cruiser` no encuentra el compilador o el binario, el
  job `quality` falla en vez de dar verde. Es el comportamiento pedido (falso verde), pero convierte un
  problema de entorno local en un rojo del PR: `pnpm install` en el root es obligatorio.
- **La abreviatura de los commits del manifest depende del tamaño del repo**: `git log --format=%h` acorta
  más dígitos cuando hay más objetos (aquí 9 o 10 en vez de 7). Por eso el respaldo de `commit` usa
  `sourceAt` (el valor ya calculado y commiteado) y no un `git log` nuevo: así el manifest no se rescribe
  entero según la máquina donde se regenera.

## Recommendation

Cerrar el bug — verificado end-to-end: el guard de arquitectura revisa el front de verdad, falla cuando no
revisa nada, los 3 ciclos que destapó están corregidos y la regla `not-to-dev-dep` ya evalúa (su único
hallazgo, `fflate` en runtime, está corregido); el `commit` del manifest ya no queda vacío en las páginas
con fuentes y el drift muestra el commit real. Queda como seguimiento con dueño el MSF-777 de los
comentarios con código de ticket (decisión del Lote 2).
