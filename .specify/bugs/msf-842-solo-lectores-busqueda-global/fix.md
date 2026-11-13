# Bug Fix: `BusquedaGlobal` usa el helper `SOLO_LECTORES` compartido

- **Slug**: msf-842-solo-lectores-busqueda-global
- **Fixed**: 2026-11-13
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`BusquedaGlobal.tsx` definía su propia constante local `SOLO_LECTORES` con `width: 1,
height: 1` —en `sx` de MUI un `1` suelto mide 100 %, no 1 px—, y el guardián de estilos
(regla `UNO_SUELTO` de `scripts/verificar-estilos-sueltos.mjs`) la marcaba, dejando el job
`application` del CI en rojo y `validacion` en cascada.

El **arreglo de código** quedó en la rama base: `fix/ui-hallazgos-e2e` fue reescrita
(`6365a4bf` → `31deb59c`) y esa versión ya borra la constante local e importa `SOLO_LECTORES`
del helper compartido `apps/web/src/components/base/solo-lectores.ts`. Este PR, rebasado
sobre esa base, aporta lo que faltaba: el **test de regresión** que falla con la constante
local y los artefactos del camino de bug.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/components/navegacion/busqueda-global.test.tsx` | modified | Test de regresión: la región viva del anuncio (`role="status"`) se mide en `1px`, no en `100 %`. |
| `apps/web/src/components/navegacion/BusquedaGlobal.tsx` | sin cambios en este PR | El componente ya importa el helper compartido desde la base (`31deb59c`): ver «Rebase sobre la base actual». |
| `.specify/bugs/msf-842-solo-lectores-busqueda-global/` | added | Artefactos del camino de bug (assessment, fix, test). |

## Diff Highlights

```tsx
// apps/web/src/components/navegacion/busqueda-global.test.tsx
  // [MSF-842] La región viva del anuncio se mide con el helper compartido `SOLO_LECTORES` (1 px).
  // Con `width: 1` en el `sx` de MUI mide 100 % del contenedor y la barra superior desborda la página
  // a 320 px; el guardián de estilos (`scripts/verificar-estilos-sueltos.mjs`) rechaza el `1` suelto.
  it('[MSF-842] la región viva mide 1 px (no 100 %) para no desbordar la página', () => {
    montar()
    const anuncio = screen.getByRole('status')
    expect(anuncio).toHaveStyle({ width: '1px', height: '1px' })
  })
```

## Rebase sobre la base actual

La rama base `fix/ui-hallazgos-e2e` se reescribió por force-push de `6365a4bf` a `31deb59c`.
Esa versión **ya trae** el arreglo de código:

- `apps/web/src/components/navegacion/BusquedaGlobal.tsx:9` — un solo
  `import { SOLO_LECTORES } from '../base/solo-lectores'` y ninguna constante local.
- `scripts/verificar-estilos-sueltos.mjs:33-36` — la regla `UNO_SUELTO` recorre todo
  `apps/web/src` (no sólo `pages/` y `components/`) y no admite el comentario de supresión.

El rebase sin resolver dejaba el archivo con **dos** imports iguales (líneas 8 y 10) y
`tsc -b` cortaba con `TS2300: Duplicate identifier 'SOLO_LECTORES'` (build rojo → job
`application` rojo). Por eso este PR se rebasa sobre `31deb59c` y **no** vuelve a aplicar
el hunk de código: el archivo queda con un único import (verificado con `tsc -b`, exit 0).

## Tests Added or Updated

- `apps/web/src/components/navegacion/busqueda-global.test.tsx::[MSF-842] la región viva mide 1 px (no 100 %) para no desbordar la página` — con la constante local el `sx` resuelve `width: 100 %` (el test falla); con el helper compartido resuelve `1px`.

## Local Verification

- Commands run (sobre la rama rebasada en `31deb59c`):
  - `node scripts/verificar-estilos-sueltos.mjs` → antes (archivo con la constante local): 2
    hallazgos en `BusquedaGlobal.tsx:23` (`width` y `height`), exit 1; después:
    `estilos-sueltos: sin valores sueltos en apps/web/src (FR-015; color y dimensión en
    pages/, width/height: 1 en todo src).`, exit 0.
  - `pnpm test:estilos:sueltos` → 9 pass, 0 fail.
  - `pnpm --filter @platform/web exec vitest run src/components/navegacion/busqueda-global.test.tsx`
    → 8 pass con el helper; con el archivo original (constante local) el caso `[MSF-842]`
    falla (esperaba `1px`, obtuvo `100 %`) y los otros 7 pasan.
  - `pnpm --filter @platform/web exec vitest run src/components/navegacion/` → 17 archivos, 128 tests pass.
  - `pnpm --filter @platform/web exec tsc -b` → exit 0 (con el import duplicado: `TS2300`).
  - `pnpm lint` → exit 0 (sólo warnings preexistentes en archivos ajenos).
  - `pnpm build` (`tsc -b && vite build`) → exit 0.
  - `pnpm ui:empresas:check`, `pnpm matriz:check`, `pnpm prototipo:check` → OK en las tres.
  - `pnpm docs:check` → OK (este `fix.md` documenta el cambio).
- Manual checks: ninguno; el guardián y el test de regresión reproducen el defecto.

## Deviations from Assessment

- El hunk de código previsto en el assessment (`BusquedaGlobal.tsx`) **no lo aplica este PR**:
  la rama base fue reescrita por force-push (`6365a4bf` → `31deb59c`) y ya trae ese cambio
  (`BusquedaGlobal.tsx:9`, un solo import del helper). Reaplicarlo producía el import
  duplicado (`TS2300`) que el Revisor señaló en la devolución del PR #885. El
  assessment no se modifica: el defecto y su causa raíz siguen siendo los descritos.
- Los archivos de código quedan fuera del diff de este PR; el aporte es el test de regresión
  y los artefactos.

## Follow-ups

- El PR #876 (`fix/ui-hallazgos-e2e`) queda desbloqueado: su job `application` deja de fallar
  en `estilos:check` y `validacion` deja de heredar el rojo.
- El fix se apoya en la rama `fix/ui-hallazgos-e2e` porque el helper compartido
  (`apps/web/src/components/base/solo-lectores.ts`) y la regla `UNO_SUELTO` nacen ahí.
