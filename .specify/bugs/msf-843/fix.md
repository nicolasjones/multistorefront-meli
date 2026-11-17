# Bug Fix: CI `quality`/`application`/`validacion` rojo en el PR #882 (MSF-843)

- **Slug**: msf-843
- **Fixed**: 2026-11-17
- **Assessment**: ./assessment.md
- **Status**: applied — sobre `dokploy` actual (`e26696ba7`), en una rama nueva.

## Summary

Los dos rojos del reporte (`quality` por knip y `application` por `docs:check`) **no se reproducen en
`dokploy` actual**: knip da 0 hallazgos y `docs:check` pasa, porque el hallazgo real de knip (la
dependencia `pg` sin declarar en `apps/web/e2e/ventas-impresion.e2e.ts`) ya no está en la base y el
guardián `scripts/verificar-e2e-sin-escritura-directa.mjs` llegó a `dokploy` con su documentación
(`docs/e2e-app.md`) en el mismo commit (`611957f3`). Lo que **sí** quedaba sin cubrir era la causa por
la que ese rojo fue indiagnosticable: `scripts/calidad.mjs` dejaba pasar `GITHUB_ACTIONS` a las
herramientas (knip y oxlint pasaban a su modo de anotaciones, que el runner consume y borra del log),
recortaba la salida del check que falló a las últimas 40 líneas (el hallazgo podía caerse del log
del CI) y la recortaba a las últimas 60 en la sección del check que falló de `reports/calidad.md`
(el hallazgo podía caerse también del informe). Esta rama fija con tests las reglas que hacían el rojo
indiagnosticable y las documenta.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/calidad.test.mjs` | modified | Dos tests que corren `scripts/calidad.mjs` con un `pnpm` falso en el `PATH`: uno exige que la salida del check que falló esté en `reports/calidad.md` (sección `## <check>`), en `reports/calidad.log` **y en el log del propio paso del CI** (stdout, sin recortar); el otro exige que los hijos **no** hereden `GITHUB_ACTIONS`. El shim emite 70 líneas de ruido **después** del hallazgo: tiene que superar los dos recortes que hay que vigilar (40 en la consola, 60 en el informe), si no el test pasa aunque el recorte vuelva. |
| `scripts/calidad.mjs` | modified | Un check con hallazgos imprime su salida **completa** en consola (antes: las últimas 40 líneas, que podían dejar el hallazgo fuera del log del CI) y su sección `## <check>` en `reports/calidad.md` también lleva la salida **completa** (antes: las últimas 60 líneas, que podían dejar el hallazgo fuera del informe). El encabezado del archivo pasa a describir lo que el script hace de verdad (gitleaks con binario nativo, SAST con oxlint, `pnpm calidad:code`, `--only=`). |
| `docs/calidad.md` | modified | Sección «Un rojo de calidad tiene que poder diagnosticarse»: las garantías, quién las fija por test y por qué MSF-843 quedó sin diagnóstico. Además, la tabla de «Qué corre» y el bloque de «Uso» dicen lo que el script hace de verdad (antes: semgrep/docker y `pnpm calidad --code`, que no existe). |
| `.specify/bugs/msf-843/` | added | assessment, fix y test de este bug. |

Sin tocar: `scripts/verificar-e2e-sin-escritura-directa.mjs`, `.github/workflows/validate.yml`,
`knip.json` y los ~40 specs `.e2e.ts` del PR #882 (ya evolucionaron en `dokploy` con MSF-515 y son
la causa del conflicto de merge).

### Por qué no se re-aplica el diff de la rama vieja

La rama `fix/bug-MSF-843` (`b6d4a634`) y el PR #882 (`c084da54`) quedaron ambos cerrados sin merge y
stale frente a `dokploy` actual: un merge real da conflicto en más de 20 archivos, incluidos dos
*add/add* en `scripts/verificar-e2e-sin-escritura-directa.mjs` y su test. Todo el contenido útil de
ambos (el guardián, su cableado en `validate.yml`, sus scripts en `package.json` y la documentación en
`docs/e2e-app.md`) ya está en `dokploy` por `611957f3`; los ~40 `.e2e.ts` ya evolucionaron con
MSF-515. Por eso esta historia se resuelve sobre `dokploy` actual en una rama nueva
(`fix/bug-MSF-843-dokploy`) y no arrastra ese diff.

## Diff Highlights

El test no inspecciona el código del script: corre el script de verdad. Un `pnpm` falso en el `PATH`
del proceso hijo contesta `--version` (para que la herramienta esté disponible) y, en el
`pnpm dlx knip@6.44.1 --no-progress` que dispara el check de código muerto, imprime un hallazgo y
sale con código 1:

```js
const shim = path.join(bin, "pnpm");
fs.writeFileSync(shim, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("11.19.0"); process.exit(0); }
console.log("GHA=" + (process.env.GITHUB_ACTIONS === undefined ? "<unset>" : process.env.GITHUB_ACTIONS));
console.log("Unlisted dependencies (1)");
console.log(${JSON.stringify(HALLAZGO_FALSO)});
for (const l of ${JSON.stringify(RUIDO)}) console.log(l);
process.exit(1);
`);
```

El hallazgo simulado es el que knip reportó en el CI del 2026-11-12 (`pg` sin declarar en
`apps/web/e2e/ventas-impresion.e2e.ts:88:130`), para que el test se lea contra el caso real. Las 70
líneas de ruido van **después** del hallazgo a propósito: si el script recorta la salida a las últimas
40 líneas (consola) o a las últimas 60 (informe), el hallazgo se cae y el test falla (mutaciones
comprobadas). Por eso el ruido tiene que ser **más largo que los dos recortes**: con 42 líneas
—como estaba antes— el test pasaba con el informe recortado, y la garantía no estaba vigilada.

## Tests Added or Updated

- `scripts/calidad.test.mjs::[MSF-843] el informe de calidad dice qué encontró el check que falló` —
  exige que `reports/calidad.md` tenga la sección `## knip (código muerto)` con el hallazgo, que
  `reports/calidad.log` lo tenga también y que **el log del paso del CI (stdout) lo diga**: el
  check con hallazgos imprime su salida completa, sin recortar. Mutaciones comprobadas: quitando el
  `fallos.flatMap(...)` de la plantilla del informe, el test falla; volviendo a imprimir sólo las
  últimas 40 líneas de la salida, el test falla; volviendo a recortar a las últimas 60 líneas la
  sección del check que falló del informe, el test falla.
- `scripts/calidad.test.mjs::[MSF-843] las herramientas no heredan GITHUB_ACTIONS` — exige que el hijo
  de `scripts/calidad.mjs` corra sin `GITHUB_ACTIONS` (el shim lo imprime como `GHA=<unset>`; el
  entorno del padre se pone con `GITHUB_ACTIONS=1` para que la aserción valga también fuera del CI).
  Mutación comprobada: quitando el `delete childEnv.GITHUB_ACTIONS;`, el test falla.

## Local Verification

- `node --test scripts/calidad.test.mjs` → 3/3 en verde (1 previo de MSF-683 + 2 de MSF-843).
- `pnpm test:ci` → verde (incluye `scripts/calidad.test.mjs`).
- `pnpm dlx knip@6.44.1 --no-progress` sobre `dokploy` actual → **0 hallazgos**, exit 0.
- Reproducción del hallazgo original sobre `dokploy` actual: restaurando **un solo archivo**
  (`git show 3892a22f:apps/web/e2e/ventas-impresion.e2e.ts > apps/web/e2e/ventas-impresion.e2e.ts`)
  y corriendo knip, sale `Unlisted dependencies (1)` / `pg  apps/web/e2e/ventas-impresion.e2e.ts:88:130`
  (exit 1) — el texto exacto que el reporte decía que no se podía leer. Al restaurar el archivo,
  knip vuelve a 0. Deja probado que el hallazgo existió y que knip sigue detectándolo (no está
  silenciado).
- `pnpm docs:check` → `Documentación de cambios: OK`; `Migraciones OK`; `Trampas conocidas: OK`.
- `pnpm lint` → exit 0. `pnpm build` → exit 0.
- `pnpm calidad` → `knip`, `oxlint`, `jscpd`, `dependency-cruiser` y `syncpack` en **ok**; `gitleaks`
  no corrió porque este entorno no tiene el binario nativo ni daemon de Docker (el CI instala el
  binario) y este diff no agrega secretos.
- CI del PR #1127 (commit `f904930f3`): `quality` (run `44184387889`) **success**, con
  `knip (código muerto): ok` y el bloque `---- RESUMEN ----` impreso en el log del paso; `Validate`
  (run `44184387968`) **success** en `application`, `infrastructure` y `validacion`. En el job
  `infrastructure` corrieron los tres tests de `scripts/calidad.test.mjs` (35/35).

## Deviations from Assessment

- El assessment proponía «tests que fijen la diagnosticabilidad» sin decidir dónde; se eligieron
  `scripts/calidad.test.mjs` (el archivo que ya existía para `scripts/calidad.mjs`, y que el CI ya
  corre en `pnpm test:ci`) en vez de un archivo nuevo, para no sumar otro paso al CI.
- La deriva de `docs/calidad.md` (la tabla decía «SAST | semgrep (docker…)» cuando el script corre
  oxlint, y el bloque de uso-documentaba `pnpm calidad --code`, que no existe) se corrige **en este
  cambio** y no como seguimiento: el archivo es la documentación del tooling que este bug arregla y la
  deriva queda a dos líneas de la sección que este PR agrega, así que el mismo diff la cerraba sin
  ampliar el alcance.
- En la segunda devolución del Revisor se encontró un hueco que la primera vuelta no cubría: el
  informe `reports/calidad.md` recortaba a las últimas 60 líneas la salida del check que falló, y el
  test **no lo detectaba** (el shim generaba 42 líneas, menos que el recorte, así que el hallazgo
  entraba igual). El recorte se quitó y el ruido del shim pasó a 70 líneas: ahora el test falla si
  vuelve cualquiera de los dos recortes.
- El assessment afirma que `apps/web/src/pages/conexiones/list.tsx` es «idéntico byte a byte» en el
  head del CI (`3892a22f`), en su base y en `dokploy` actual. `dokploy` avanzó desde entonces (el
  `aria-label` del `EditButton`, un ajuste de accesibilidad de MSF-585), así que hoy ese archivo
  difiere del head del CI en **una** línea: la línea 44 sigue siendo el mismo `useEffect` y el
  archivo sigue sin código muerto. El `assessment.md` no se editó —es el contrato—; la corrección
  queda acá y en `test.md`.

## Follow-ups

- El `HEAD` de `dokploy` (`0d75df2c`) no tiene ninguna corrida de CI registrada. La evidencia verde
  disponible hasta ahora era de `a3461e56` (ancestro del HEAD). El PR de esta historia produce la
  corrida sobre la base actual.
- Si el log de un `quality` vuelve a mostrar un path sin texto, el primer paso es mirar
  `reports/calidad.log` (artifact `calidad-reporte`): con la garantía de este PR, ahí está la salida
  completa de cada herramienta.
