# Bug Verification: `BusquedaGlobal` usa el helper `SOLO_LECTORES` compartido

- **Slug**: msf-842-solo-lectores-busqueda-global
- **Tested**: 2026-11-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma (guardián de estilos rojo en `BusquedaGlobal.tsx:23` → job `application` rojo →
`validacion` rojo) ya no se reproduce: el guardián pasa y el componente mide su región
viva en 1 px en vez de 100 %. El test de regresión falla con el archivo original y pasa
con el helper compartido; no se detectaron regresiones en la suite de navegación ni en
lint/build.

La rama base `fix/ui-hallazgos-e2e` fue reescrita por force-push (`6365a4bf` → `31deb59c`)
y ya trae el arreglo de código, así que este PR se rebasó sobre ella para no dejar el
import de `SOLO_LECTORES` duplicado (ver «Rebase sobre la base actual» en ./fix.md).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node scripts/verificar-estilos-sueltos.mjs` | pass | `estilos-sueltos: sin valores sueltos en apps/web/src (FR-015; color y dimensión en pages/, width/height: 1 en todo src).` (exit 0) |
| Reproduction (pre-fix) | mismo comando con el archivo original (constante local `width: 1, height: 1`) | fail | 2 hallazgos en `BusquedaGlobal.tsx:23` (`width` y `height`); exit 1 |
| New / updated tests | `pnpm --filter @platform/web exec vitest run src/components/navegacion/busqueda-global.test.tsx` | pass | 8 pass con el helper; con el archivo original el caso `[MSF-842]` falla (esperaba `1px`, obtuvo `100 %`) y los otros 7 pasan |
| Regression suite | `pnpm --filter @platform/web exec vitest run src/components/navegacion/` | pass | 17 archivos, 128 tests pass |
| Type-check (import único) | `pnpm --filter @platform/web exec tsc -b` | pass | exit 0; con el import duplicado: `TS2300: Duplicate identifier 'SOLO_LECTORES'` (exit 2) |
| Guardián (test del script) | `pnpm test:estilos:sueltos` | pass | 9 pass, 0 fail |
| Lint / type-check | `pnpm lint` y `pnpm build` (`tsc -b && vite build`) | pass | lint exit 0 (warnings preexistentes); build exit 0 |
| Guardas de CI | `pnpm ui:empresas:check`, `pnpm matriz:check`, `pnpm prototipo:check` | pass | OK en las tres |
| E2E de evidencia | `npx playwright test --list e2e/busqueda-global-desborde.e2e.ts` | pass | 1 test recolectado con el rótulo `[MSF-842:BUG]`; la corrida local se omite (este entorno no tiene Docker para el stack de Supabase), como los demás E2E con sesión |
| Documentación | `pnpm docs:check` | pass | con este `fix.md`/`test.md` el cambio ya tiene documentación |

## Output Excerpts

```
$ node scripts/verificar-estilos-sueltos.mjs        # antes del fix (constante local)
apps/web/src/components/navegacion/BusquedaGlobal.tsx:23: width: 1 es 100 % en sx de MUI, no 1 px: usar SOLO_LECTORES (components/base/solo-lectores.ts) o '1px'
apps/web/src/components/navegacion/BusquedaGlobal.tsx:23: height: 1 es 100 % en sx de MUI, no 1 px: usar SOLO_LECTORES (components/base/solo-lectores.ts) o '1px'
estilos-sueltos: 2 hallazgo(s). …
$ node scripts/verificar-estilos-sueltos.mjs        # después del fix
estilos-sueltos: sin valores sueltos en apps/web/src (FR-015; color y dimensión en pages/, width/height: 1 en todo src).

$ pnpm --filter @platform/web exec vitest run src/components/navegacion/busqueda-global.test.tsx   # con la constante local
 × [MSF-842] la región viva mide 1 px (no 100 %) para no desbordar la página
- Expected:  - height: 1px;  - width: 1px;
+ Received:  + height: 100%; + width: 100%;
 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)

$ pnpm --filter @platform/web exec vitest run src/components/navegacion/
 Test Files  17 passed (17)
      Tests  128 passed (128)
```

## Hallazgos de la devolución del Revisor (PR #885)

| Hallazgo | Severidad | Estado | Evidencia |
|----------|-----------|--------|-----------|
| El PR quedaba `mergeable: CONFLICTING` / `mergeStateStatus: DIRTY` y el rebase dejaba dos `import { SOLO_LECTORES }` (líneas 8 y 10) → `tsc -b` cortaba con `TS2300` | Media | resuelto | Rama rebasada sobre `31deb59c` con un único import (`apps/web/src/components/navegacion/BusquedaGlobal.tsx:9`); `pnpm --filter @platform/web exec tsc -b` → exit 0 y `pnpm build` → exit 0. Con el import duplicado reproducido a propósito: `TS2300: Duplicate identifier 'SOLO_LECTORES'`, exit 2. |
| `docs/sistema-de-diseno.md:103` describía el guardián como si sólo fallara en `apps/web/src/pages/**` y admitía el comentario `estilos-sueltos: ok` para un `height: 1` de accesibilidad | Baja | resuelto | El texto vigente está en `docs/sistema-de-diseno.md:103-126` (commit `31deb59c` de la base `fix/ui-hallazgos-e2e`): el guardián recorre `apps/web/src/**`, la regla `width\|height\|minWidth\|minHeight\|maxWidth\|maxHeight: 1` no admite el comentario de supresión y sólo exime la definición del helper y los tests; la línea 126 cierra con «No aplica a la regla de `width\|height: 1`». La rama de este PR hereda ese texto tras el rebase. |

## Residual Risks

- La verificación local no incluye el e2e de Playwright con sesión ni los jobs con base de datos
  (`database`): el fix es de estilo/CSS y no toca datos, permisos ni RLS. El E2E
  `e2e/busqueda-global-desborde.e2e.ts` está escrito y recolectado, pero su corrida necesita el
  stack local de Supabase (este entorno no tiene acceso al daemon de Docker); lo corre el job
  `application` del CI o el runner self-hosted.
- El fix depende del helper `apps/web/src/components/base/solo-lectores.ts`, que existe en
  la rama `fix/ui-hallazgos-e2e` (PR #876). Si ese PR se cerrara sin integrarse, el helper
  no estaría y este fix no compilaría.

## Recommendation

Cerrar el bug — verificado de punta a punta en local (guardián, test de regresión, suite de
navegación, `tsc -b`, lint y build). Al integrar este fix, el job `application` del PR #876
deja de fallar en `estilos:check` y `validacion` deja de heredar el rojo.
