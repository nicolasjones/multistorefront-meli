# Bug Fix: [Lote L36] Higiene de código y referencias internas (MSF-895)

- **Slug**: msf-895
- **Fixed**: 2026-11-23
- **Assessment**: ./assessment.md
- **Status**: applied (sobre `origin/dokploy@bf4ee7455`, rama `fix/bug-MSF-895`)

## Summary

El guard de arquitectura del repo (`dependency-cruiser`) corría dentro del sandbox de `pnpm dlx`, sin
compilador de TypeScript: la herramienta descartaba los `.ts/.tsx` y devolvía «0 módulos, 0 dependencias».
O sea, un **verde falso** sobre `apps/web/src`: `no-circular`, `no-orphans` y `not-to-dev-dep` nunca se
evaluaron sobre el front. Ahora el check corre el **binario local** del root (`dependency-cruiser` +
`typescript` como `devDependencies`), **falla** si no cruzó ningún módulo o si falta el binario, y cruza de
verdad 1674 módulos y 6220 dependencias. Al habilitarlo aparecieron **3 ciclos de imports** que nadie veía:
se corrigieron moviendo los tipos compartidos a módulos propios (sin cambios de comportamiento ni de
textos visibles).

Además, la tercera regla (`not-to-dev-dep`) seguía **muda** aunque el guard ya cruzara el front: `node_modules`
estaba en `exclude` y excluirlo **borra la arista** hacia el paquete y con ella la clasificación
`npm`/`npm-dev` (el diagnóstico anterior atribuía la muteness al layout de pnpm; era el `exclude`). Sacando
`node_modules` de `exclude` (el paquete no se cruza: `doNotFollow` lo sigue dejando fuera) la regla evaluó de
verdad y encontró **1 hallazgo real**: `apps/web/src/lib/importacion-productos.ts` importaba `fflate`
(declarado como `devDependency`) para descomprimir los ZIP importados. `fflate` pasó a `dependencies` del
front. Los tests y sus archivos de apoyo (`*.test.*`, `apps/web/src/test/`) quedan fuera de la regla: sí
pueden usar `devDependencies` (`vitest`, `axe-core`, ...).

Y el manifest de docs dejaba el campo `commit` en `null` en 3 páginas que sí tienen `sourceAt`: la invariante
`sourceAt == commit` se rompía y `docs-drift.mjs` imprimía «última: ?» en vez del commit real. La causa era
que `commit` no tenía respaldo cuando el manifest previo no lo traía (a diferencia de `sourceAt`), así que el
hueco quedaba pegado para siempre. Ahora `commit` se completa con `sourceAt` (el mismo commit propio de la
página) y, si tampoco hay fuentes, con el último commit propio.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `package.json` | modified | `dependency-cruiser` 18.7.2 y `typescript` ~6.0.2 como `devDependencies` del root: la herramienta necesita el compilador para resolver los `.ts/.tsx` y el binario local para no depender del sandbox |
| `pnpm-lock.yaml` | modified | lockfile de esas dos dependencias y del movimiento de `fflate` (misma versión) |
| `scripts/calidad.mjs` | modified | el check de arquitectura usa el binario local, falla si no cruzó ningún módulo o falta el binario, y deja el resumen del cruce (módulos, dependencias, errores, avisos) |
| `scripts/calidad.test.mjs` | modified | 4 tests que fijan el contrato del check (falla con 0 módulos, falla sin binario, `ok` sólo si cruzó módulos y no encontró violaciones) y el de la regla `not-to-dev-dep` |
| `.dependency-cruiser.cjs` | modified | los tests dejan de excluirse del cruce (si se excluyen, sus archivos de apoyo quedan sin ninguna arista y `no-orphans` los marca como código muerto: falso positivo); `node_modules` sale de `exclude` para que las aristas a los paquetes se registren y se puedan clasificar; `not-to-dev-dep` excluye tests y `src/test/`; `no-orphans` excluye `node_modules` |
| `knip.json` | modified | `dependency-cruiser` a `ignoreDependencies` (se usa como binario, no como import) y `.dependency-cruiser.cjs` ya no necesita estar en `ignore` |
| `apps/web/package.json` | modified | `fflate` (descompresión de ZIP en runtime, `importacion-productos.ts`) pasa de `devDependencies` a `dependencies`: es una dependencia de la app, no de las pruebas |
| `apps/web/src/lib/tiendaInicioTipos.ts` | added | tipo `InicioTienda` en su propio módulo: rompe el ciclo `fuenteTienda.tsx` ↔ `tiendaInicio.ts` |
| `apps/web/src/lib/tiendaInicio.ts` | modified | usa el tipo del módulo nuevo y deja de re-exportarlo (nadie lo importaba desde acá) |
| `apps/web/src/lib/fuenteTienda.tsx` | modified | importa el tipo del módulo nuevo |
| `apps/web/src/pages/ventas/configuracion/tipos.ts` | added | `PropsPestanaCatalogo` y `PestanaCatalogo` en su propio módulo: rompe el ciclo `index.tsx` ↔ sus dos pestañas |
| `apps/web/src/pages/ventas/configuracion/index.tsx` | modified | usa los tipos del módulo nuevo |
| `apps/web/src/pages/ventas/configuracion/FormasEnvioTab.tsx` | modified | importa `PropsPestanaCatalogo` del módulo nuevo, no de `index.tsx` |
| `apps/web/src/pages/ventas/configuracion/FormasPagoTab.tsx` | modified | ídem |
| `docs/calidad.md` | modified | qué revisa el guard ahora, el hallazgo de `fflate` y la excepción de los tests |
| `docs/roadmap-template.md` | modified | fila del Lote 36 (MSF-515) en la hoja de ruta |
| `docs/documentacion-cambios.md` | modified | qué son los campos del manifest (`pageHash`, `sourceHash`, `sourceAt`, `commit`), que `commit` no queda vacío (MSF-895) y que el manifest se regenera después del commit de los archivos que toca |
| `docs/manifest.json` | modified | regenerado (`sourceAt`/`sourceHash`/`pageHash` de las páginas tocadas) |
| `scripts/docs-manifest.mjs` | modified | `commit` ya no queda en `null`: si el manifest previo no lo traía, se completa con `sourceAt` y, si la página no tiene fuentes, con el último commit propio de la página |
| `scripts/docs-manifest.test.mjs` | modified | test de regresión del `commit` vacío (el que quedaba pegado) |

Sin migraciones: la historia no cambia el esquema ni los datos (la versión que reservó el runner,
`20270507200101`, no se usa). Sin cambios de comportamiento: `fflate` sigue en la misma versión y el front
lo sigue empaquetando igual; lo que cambia es en qué sección del manifiesto de `apps/web` se declara.

## Tests Added or Updated

- `scripts/calidad.test.mjs` — «[MSF-895] el guard de arquitectura falla si dependency-cruiser no cruzó
  ningún módulo»: fija el falso verde (con el código anterior el check decía `ok`).
- `scripts/calidad.test.mjs` — «[MSF-895] el guard de arquitectura falla si falta el binario local (no se
  revisó nada)».
- `scripts/calidad.test.mjs` — «[MSF-895] el guard de arquitectura da ok sólo si cruzó módulos y no
  encontró violaciones»: con un ciclo simulado el check falla y muestra la violación.
- `scripts/calidad.test.mjs` — «[MSF-895] la regla not-to-dev-dep marca un devDependency usado por código
  de runtime y lo deja pasar en los tests»: corre el binario real sobre un fixture con la forma del front
  (`apps/web/package.json` + `apps/web/node_modules`). Se comprobó que **falla** si `node_modules` vuelve a
  `exclude` (la arista se borra y la regla queda muda) y si se saca la excepción de los tests (el test pasa a
  ser una violación).
- `scripts/docs-manifest.test.mjs` — «[MSF-895] una página sin cambios no queda con `commit` en null»:
  regenera el manifest conservando el anterior (con `commit: null`) y exige que `commit` se complete y sea
  igual a `sourceAt`. Con el código anterior el test falla (`commit` queda en `null`).

## Local Verification

- `node scripts/calidad.mjs --only=arch` → `ok · módulos: 1674 · dependencias: 6220 · errores: 0 · avisos: 0`
  (antes: `ok` sobre 0 módulos; y con `node_modules` en `exclude`: 1575 módulos / 5066 dependencias y la
  regla `not-to-dev-dep` sin clasificar ninguna dependencia).
- Ciclos antes del arreglo (archivos previos con `git stash`): 3 violaciones `no-circular`
  (`fuenteTienda.tsx → tiendaInicio.ts`, `FormasEnvioTab.tsx → index.tsx`, `FormasPagoTab.tsx → index.tsx`);
  después: 0.
- Hallazgo de `not-to-dev-dep` reproducido: con `fflate` como `devDependency` la regla marca
  `apps/web/src/lib/importacion-productos.ts` (severidad `error`); con `fflate` en `dependencies`: 0.
- `node --test scripts/calidad.test.mjs` → 5 pasan (1 salteado: gitleaks no está instalado).
- `node --test scripts/docs-manifest.test.mjs` → 4 pasan (el nuevo falla con el código anterior).
- `node scripts/docs-manifest.mjs` → 344 páginas · 311 con fuentes · 33 estáticas; el diff son 9 líneas
  (el `commit` de `docs/promociones-precio.md`, `docs/seguridad-tienda-opiniones.md` y `docs/ventas-mostrador.md`,
  y las entradas de `docs/documentacion-cambios.md` y `docs/roadmap-template.md`, cuyas fuentes o textos
  cambiaron). Correrlo de nuevo no cambia nada: el manifest es reproducible.
- Invariante del manifest: 0 páginas con fuentes donde `sourceAt != commit` y 0 páginas con `commit: null`
  (antes: 3 y 3).
- El manifest commiteado es el que reproduce el CI: en un clon **shallow** (`--depth 1`, como el checkout del
  workflow `docs`) `node scripts/docs-manifest.mjs` no deja diff (`git diff --exit-code docs/manifest.json`),
  porque el manifest commiteado ya está en sync con las páginas y el script reusa sus valores.
- Drift: 25 páginas con la fuente cambiada (antes 26): `docs/documentacion-cambios.md` deja de estar vieja
  porque la página se actualizó con el cambio del script.
- `pnpm --filter @platform/web exec vitest run src/pages/ventas/configuracion src/lib/tiendaInicio
  src/lib/categorias src/higieneReferenciasInternas.test.ts` → 5 archivos, 97 tests OK.
- `pnpm --filter @platform/web build` (`tsc -b` + `vite build`) → OK.
- `pnpm --filter @platform/web lint` (oxlint) → 0 errores (los warnings de `react-hooks` son preexistentes).
- `pnpm dlx knip@6.44.1 --no-progress` → exit 0, 0 hallazgos.
- `pnpm docs:check` → OK (documentación de cambios, migraciones y trampas conocidas).
- `pnpm install --frozen-lockfile --offline` → «Already up to date» (el lockfile está consistente).

## Alcance del lote: qué quedó resuelto de MSF-539, MSF-580 y MSF-777

Verificado contra `origin/dokploy` (la base del PR), no de memoria:

| Consolidado | Ítem | Estado | Evidencia en la base |
|---|---|---|---|
| MSF-895 | 539 | **resuelto en la base** (no en este PR) | 1) lectura por tandas con `.range()`: `apps/web/src/lib/categorias.ts` (`leerPorTandas`, `TAMANO_TANDA_CATEGORIAS`), commit `3fb2aaf1a`; 2) candado en la baja directa: `supabase/migrations/20270507140000_categorias_baja_candado_orden_y_permiso.sql` (disparador `categorias_baja_candado`), commit `b08b9e63f`; 3) límite de `p_orden` (5000) y concurrencia documentada en esa migración; 4) recálculo del conteo de la raíz al filtrar por tienda: `filtrarArbolPorTienda` en `apps/web/src/lib/categorias.ts`; 5) mensaje de permiso al asignar categoría (`asignar_categoria_producto`), en la misma migración. pgTAP: `supabase/tests/database/catalogo_categorias_hallazgos_baja.test.sql` (11 asserts, hallazgos 2, 3 y 5). Vitest: `apps/web/src/lib/categorias.test.ts` (paginación y recálculo del conteo, hallazgos 1 y 4). |
| MSF-895 | 580 | **resuelto en la base** | `scripts/verificar-migraciones.mjs` existe y `pnpm docs:check` lo corre. |
| MSF-895 | 777 | **parcial por decisión de la épica** | El Lote 2 (MSF-878) cerró los títulos de test y los «Etapa N» (`apps/web/src/higieneReferenciasInternas.test.ts` los vigila). Los **comentarios** con código de ticket (~450 líneas) quedan abiertos por D-1 de `specs/20270324-100000-deuda-tecnica-lote-2-higiene-codigo-y-docs/spec.md`: es una decisión de convención que espera a Nicolás. Ver «Follow-ups». |

## Deviations from Assessment

1. **Los tres hallazgos del lote (pregunta abierta del assessment).** El cuerpo del ítem llegó después del
   assessment: MSF-539 (baja de categorías con candado, límite de orden y lectura por tandas) y MSF-580 ya
   estaban resueltos en la base (`20270507140000_categorias_baja_candado_orden_y_permiso.sql` y
   `scripts/verificar-migraciones.mjs`); de MSF-777, el Lote 2 (MSF-878) ya cerró los títulos de test y los
   «Etapa N», y dejó abiertos los comentarios con código de ticket por decisión suya (D-1). El defecto vivo
   era, entonces, **B3**: el guard de arquitectura que no revisaba nada. Por eso este fix no toca
   `scripts/docs-check.mjs`: B2 ya lo corrigió MSF-862. Sí toca `scripts/docs-manifest.mjs`, pero por otra
   razón: B1 (`sourceAt` estable) ya lo corrigió MSF-950 y lo que quedaba vivo era el campo `commit`
   (devolución Media de la revisión: `commit: null` con `sourceAt` puesto). Ver la tabla de alcance más arriba.
2. **Base `dokploy` (pregunta abierta del assessment).** La rama contra `origin/dokploy@bf4ee7455`, que es la
   base del PR.
3. **El guard falla cuando cruza 0 módulos (pregunta abierta del assessment).** Se adoptó la alternativa
   estricta: `0 módulos` es **error**, no aviso (con el aviso el falso verde podía volver a pasar).
4. **`not-to-dev-dep`: no era el layout de pnpm, era `exclude`.** La revisión anterior del lote daba la regla
   por inerte porque un import de `vite` quedaba `unknown`/`couldNotResolve`. La causa real era que
   `node_modules` estaba en `exclude`: excluir un archivo borra la arista que llega a él, así que la
   herramienta nunca clasificaba la dependencia como `npm-dev` (el caso de `vite` además no lo resuelve ni
   el resolvedor de la herramienta, pero `fflate` y `axe-core` sí se resuelven). Sacando `node_modules` de
   `exclude` —el paquete no se cruza porque `doNotFollow` lo deja fuera— la regla evalúa y encontró el
   `devDependency` usado en runtime que se corrigió. La excepción que queda es **de alcance** (tests y
   `src/test/`), no de mecanismo.
5. **Drift de 174 páginas (A2 del assessment).** Queda fuera: es deuda ya anotada en
   `.github/workflows/docs.yml` y este cambio no la introduce.
6. **Hallazgos adyacentes A1 (nombres viejos de migraciones en `docs/`).** Quedan fuera: son referencias de
   documentación a migraciones renumeradas por otros lotes, ajenas a este guard.
7. **Vigencia del assessment (hallazgo Baja de la revisión).** Sus referencias de línea
   (`scripts/docs-manifest.mjs:67`/`:12`, `scripts/calidad.mjs:76`) y sus commits/runs (`f5d8f4a5`,
   `1ad0fd2e`, run `43625243985`) describen el árbol donde se diagnosticó, no el HEAD de la rama. El flujo
   del bug prohíbe editar `assessment.md` (guardrail de `speckit.bug.fix.md`): la fuente vigente es este
   `fix.md` y los commits de la rama. B1 y B2 ya están mergeados aguas arriba; el defecto vivo era B3.

## Follow-ups

- **MSF-777 (comentarios con código de ticket, ~450 líneas)**: sigue abierto por decisión del Lote 2 (D-1 de
  `specs/20270324-100000-deuda-tecnica-lote-2-higiene-codigo-y-docs/spec.md`): reescribirlos en bloque es
  una decisión de convención más amplia que este lote, que espera la decisión de Nicolás. **Seguimiento
  propio: MSF-777** (clave del ítem consolidado; la tarea `seguimiento` en It's a Plan la abre el flujo con
  Nicolás como dueño de la decisión de convención). No se reasigna a otra historia ni se da por hecho: el
  Lote 2 ya cerró los títulos de test y los «Etapa N», que es la parte que el seguimiento nombraba.
- **A2 (drift de documentación)**: deuda ya anotada en `.github/workflows/docs.yml`.
