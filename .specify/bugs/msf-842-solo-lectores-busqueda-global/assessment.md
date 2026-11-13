# Bug Assessment: `SOLO_LECTORES` duplicado en `BusquedaGlobal.tsx` deja rojo el CI del PR #876

- **Slug**: msf-842-solo-lectores-busqueda-global
- **Created**: 2026-11-13
- **Source**: tracker MSF-842 (descripción del CTO sobre el PR #876)
- **Verdict**: valid
- **Severity**: medium (el job `application` del CI queda rojo y `validacion` hereda el rojo)

## Report (verbatim)

> PR #876 (`fix/ui-hallazgos-e2e` → main) tiene `application` en rojo y, en cascada, `validacion` también (su único paso es "Verificar que nada haya fallado"; depende de `application`). No son dos fallas independientes, es una sola.
>
> El propio PR agrega la regla `UNO_SUELTO` en `scripts/verificar-estilos-sueltos.mjs` (prohíbe `width|height|minWidth|minHeight|maxWidth|maxHeight: 1` en `pages` y `components`, sin comentario de supresión, exime solo al helper `apps/web/src/components/base/solo-lectores.ts`) y agrega ese helper compartido `SOLO_LECTORES` (ya con `width: '1px', height: '1px'`). Pero `apps/web/src/components/navegacion/BusquedaGlobal.tsx:22-23` sigue definiendo su propia constante local `SOLO_LECTORES` con `width: 1, height: 1` (sin comillas, la forma vieja), y el guardián nuevo la marca en su propia corrida:
>
> ```
> apps/web/src/components/navegacion/BusquedaGlobal.tsx:23: width: 1 es 100 % en sx de MUI, no 1 px: usar SOLO_LECTORES (components/base/solo-lectores.ts) o '1px'
> apps/web/src/components/navegacion/BusquedaGlobal.tsx:23: height: 1 es 100 % en sx de MUI, no 1 px: usar SOLO_LECTORES (components/base/solo-lectores.ts) o '1px'
> ```
>
> Al fallar el paso `estilos:check` del job `application`, todos los pasos siguientes (lint, build, e2e, etc.) quedan `skipped` y `validacion` hereda el rojo.

## Symptom

`pnpm estilos:check` (paso del job `application`) falla con dos hallazgos en
`apps/web/src/components/navegacion/BusquedaGlobal.tsx:23`. Con el paso rojo, el resto
del job (`lint`, `build`, `test:e2e`) queda `skipped` y el job `validacion` —que sólo
verifica que nada haya fallado— hereda el rojo. El PR #876 no se puede mergear.

Además del rojo de CI, el defecto es real: en el `sx` de MUI un `width: 1` mide **100 %**
del contenedor, no 1 px. La región viva del anuncio de la búsqueda global ocupa todo el
ancho de la barra superior; recortada con `clip`, ensancha el scroll horizontal de la
página (a 320 px sobraban 16 px).

## Reproduction

1. Sobre la rama `fix/ui-hallazgos-e2e` (o cualquier rama que contenga la regla `UNO_SUELTO`):
   `node scripts/verificar-estilos-sueltos.mjs` → exit 1 con los dos hallazgos de arriba.
2. En CI: job `application` del run 43307157812 (job 131493479894), paso `pnpm estilos:check`
   en rojo; el job `validacion` (131499640133) también en rojo.

## Suspected Code Paths

- `apps/web/src/components/navegacion/BusquedaGlobal.tsx:22-24` — constante local
  `SOLO_LECTORES` con `width: 1, height: 1` (la forma vieja, antes del helper compartido).
- `apps/web/src/components/navegacion/BusquedaGlobal.tsx:127` — `sx={SOLO_LECTORES}` (la
  región viva `role="status"`), el consumidor de esa constante.
- `apps/web/src/components/base/solo-lectores.ts` — helper compartido que el PR #876 agrega
  (`width: '1px', height: '1px'`); es la fuente de verdad que este bug debe usar.
- `scripts/verificar-estilos-sueltos.mjs` — guardián con la regla `UNO_SUELTO`. **No se
  toca**: la regla es correcta; lo que falla es el archivo que no migró al helper.

## Root Cause Hypothesis

Confianza alta. El PR #876 migró muchos componentes al helper `SOLO_LECTORES` compartido y
extendió el guardián para cubrir `components/`, pero dejó `BusquedaGlobal.tsx` con su
constante local anterior. El guardián nuevo no tiene excepción para ese archivo (la única
exención es el propio helper), así que el paso falla y el PR no puede mergear. No es un
falso positivo del guardián: el `1` sin comillas es exactamente el bug que la regla busca.

## Proposed Remediation

**Preferred**:

1. En `apps/web/src/components/navegacion/BusquedaGlobal.tsx` borrar la constante local
   `SOLO_LECTORES` y importar la del helper compartido:
   `import { SOLO_LECTORES } from '../base/solo-lectores'`. El uso `sx={SOLO_LECTORES}`
   (línea 127) queda igual.
2. Test de regresión que falle con la constante local y pase con el helper: la región viva
   del anuncio debe medir `1px` (no `100 %`).

**Alternatives**:

- Cambiar la constante local a `width: '1px', height: '1px'` (lo que hace el PR #875):
  destraba el guardián, pero deja dos definiciones del mismo estilo en el repo y duplica
  el arreglo. Descartado: el helper compartido ya es la fuente de verdad.
- Relajar la regla `UNO_SUELTO` o agregar una excepción para `BusquedaGlobal.tsx`: hides el
  defecto y deja `width: 1` (100 %) en pantalla. Descartado.

## Files likely to change

- `apps/web/src/components/navegacion/BusquedaGlobal.tsx`
- `apps/web/src/components/navegacion/busqueda-global.test.tsx` (test de regresión)

## Tests to add or update

- `apps/web/src/components/navegacion/busqueda-global.test.tsx`: la región viva
  (`role="status"`) se mide en `1px` de ancho y alto, no en `100 %`.
- `pnpm test:estilos:sueltos` y `pnpm estilos:check` (el guardián ya cubre el `1` suelto).

## Risks & Considerations

- El fix depende del helper `apps/web/src/components/base/solo-lectores.ts`, que sólo existe
  en la rama del PR #876: la rama del fix se apoya en `fix/ui-hallazgos-e2e`.
- Cambiar `width: 1` (100 %) por `1px` reduce el tamaño de la región viva. No cambia la
  lectura del anuncio por lector de pantalla (sigue siendo texto, `role="status"`,
  `aria-live="polite"`, recortado con `clip`), sólo el ancho que ocupa.
- Toca un componente de la barra superior: no hay datos, permisos ni RLS involucrados.

## Open Questions

- Ninguna bloqueante.
