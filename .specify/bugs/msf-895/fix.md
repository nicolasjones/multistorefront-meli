# Bug Fix: [Lote L36] Higiene de código y referencias internas (MSF-895)

- **Slug**: msf-895
- **Fixed**: 2026-11-22
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
| `docs/manifest.json` | modified | regenerado (`sourceAt`/`sourceHash`/`pageHash` de las páginas tocadas) |

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
- `pnpm --filter @platform/web exec vitest run src/pages/ventas/configuracion src/lib/tiendaInicio
  src/lib/categorias src/higieneReferenciasInternas.test.ts` → 5 archivos, 97 tests OK.
- `pnpm --filter @platform/web build` (`tsc -b` + `vite build`) → OK.
- `pnpm --filter @platform/web lint` (oxlint) → 0 errores (los warnings de `react-hooks` son preexistentes).
- `pnpm dlx knip@6.44.1 --no-progress` → exit 0, 0 hallazgos.
- `pnpm docs:check` → OK (documentación de cambios, migraciones y trampas conocidas).
- `pnpm install --frozen-lockfile --offline` → «Already up to date» (el lockfile está consistente).

## Deviations from Assessment

1. **Los tres hallazgos del lote (pregunta abierta del assessment).** El cuerpo del ítem llegó después del
   assessment: MSF-539 (baja de categorías con candado, límite de orden y lectura por tandas) y MSF-580 ya
   estaban resueltos en la base (`20270507140000_categorias_baja_candado_orden_y_permiso.sql` y
   `scripts/verificar-migraciones.mjs`); de MSF-777, el Lote 2 (MSF-878) ya cerró los títulos de test y los
   «Etapa N», y dejó abiertos los comentarios con código de ticket por decisión suya (D-1). El defecto vivo
   era, entonces, **B3**: el guard de arquitectura que no revisaba nada. Por eso este fix no toca
   `scripts/docs-manifest.mjs` ni `scripts/docs-check.mjs`: B1 ya lo corrigió MSF-950 (Lote 2) y B2, MSF-862.
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

## Follow-ups

- **MSF-777 (comentarios con código de ticket, ~450 líneas)**: sigue abierto por decisión del Lote 2 (D-1 de
  `specs/20270324-100000-deuda-tecnica-lote-2-higiene-codigo-y-docs/spec.md`): reescribirlos en bloque es
  una decisión de convención más amplia que este lote. No se implementa acá.
- **A2 (drift de documentación)**: deuda ya anotada en `.github/workflows/docs.yml`.
