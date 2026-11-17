# Bug Fix: CI `quality`/`application`/`validacion` rojo en el PR #882 (MSF-843)

- **Slug**: msf-843
- **Fixed**: 2026-11-17
- **Assessment**: ./assessment.md
- **Status**: applied — sobre `dokploy` actual (`0d75df2c`), en una rama nueva.

## Summary

Los dos rojos del reporte (`quality` por knip y `application` por `docs:check`) **no se reproducen en
`dokploy` actual**: knip da 0 hallazgos y `docs:check` pasa, porque el hallazgo real de knip (la
dependencia `pg` sin declarar en `apps/web/e2e/ventas-impresion.e2e.ts`) ya no está en la base y el
guardián `scripts/verificar-e2e-sin-escritura-directa.mjs` llegó a `dokploy` con su documentación
(`docs/e2e-app.md`) en el mismo commit (`611957f3`). Lo que **sí** quedaba sin cubrir era la causa por
la que ese rojo fue indiagnosticable: `scripts/calidad.mjs` dejaba pasar `GITHUB_ACTIONS` a las
herramientas (knip y oxlint pasaban a su modo de anotaciones, que el runner consume y borra del log) y
no escribía la salida del check que falló. Esta rama fija las dos reglas con tests y las documenta.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/calidad.test.mjs` | modified | Dos tests que corren `scripts/calidad.mjs` con un `pnpm` falso en el `PATH`: uno exige que la salida del check que falló esté en `reports/calidad.md` (sección `## <check>`) y en `reports/calidad.log`; el otro exige que los hijos **no** hereden `GITHUB_ACTIONS`. |
| `docs/calidad.md` | modified | Sección «Un rojo de calidad tiene que poder diagnosticarse»: las dos garantías, quién las fija por test y por qué MSF-843 quedó sin diagnóstico. |
| `.specify/bugs/msf-843/` | added | assessment, fix y test de este bug. |

Sin tocar: `scripts/calidad.mjs` (las dos reglas ya están implementadas en `dokploy`; lo que faltaba
era el test que las vigila), `scripts/verificar-e2e-sin-escritura-directa.mjs`,
`.github/workflows/validate.yml`, `knip.json` y los ~40 specs `.e2e.ts` del PR #882 (ya evolucionaron
en `dokploy` con MSF-515 y son la causa del conflicto de merge).

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
process.exit(1);
`);
```

El hallazgo simulado es el que knip reportó en el CI del 2026-11-12 (`pg` sin declarar en
`apps/web/e2e/ventas-impresion.e2e.ts:88:130`), para que el test se lea contra el caso real.

## Tests Added or Updated

- `scripts/calidad.test.mjs::[MSF-843] el informe de calidad dice qué encontró el check que falló` —
  exige que `reports/calidad.md` tenga la sección `## knip (código muerto)` con el hallazgo y que
  `reports/calidad.log` lo tenga también. Mutación comprobada: quitando el `fallos.flatMap(...)` de la
  plantilla del informe, el test falla.
- `scripts/calidad.test.mjs::[MSF-843] las herramientas no heredan GITHUB_ACTIONS` — exige que el hijo
  de `scripts/calidad.mjs` corra sin `GITHUB_ACTIONS` (el shim lo imprime como `GHA=<unset>`; el
  entorno del padre se pone con `GITHUB_ACTIONS=1` para que la aserción valga también fuera del CI).
  Mutación comprobada: quitando el `delete childEnv.GITHUB_ACTIONS;`, el test falla.

## Local Verification

- `node --test scripts/calidad.test.mjs` → 3/3 en verde (1 previo de MSF-683 + 2 nuevos).
- `pnpm test:ci` → verde (incluye `scripts/calidad.test.mjs`).
- `pnpm dlx knip@6.44.1 --no-progress` sobre `dokploy` actual → **0 hallazgos**, exit 0.
- `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` → OK.
- `pnpm lint` → exit 0. `pnpm build` → exit 0.
- `pnpm calidad` → `knip`, `oxlint`, `jscpd`, `dependency-cruiser` y `syncpack` en **ok**; `gitleaks`
  no corrió porque necesita el daemon de Docker (no disponible en este entorno) y este diff no agrega
  secretos.
- CI del PR #1127: `quality` (run `44148206192`) **success**, con `knip (código muerto): ok`;
  `Validate` (run `44148206054`) **success** en `application`, `infrastructure` y `validacion`. En el
  job `infrastructure` corrieron los dos tests nuevos (35/35).

## Deviations from Assessment

- El assessment proponía «tests que fijen la diagnosticabilidad» sin decidir dónde; se eligieron
  `scripts/calidad.test.mjs` (el archivo que ya existía para `scripts/calidad.mjs`, y que el CI ya
  corre en `pnpm test:ci`) en vez de un archivo nuevo, para no sumar otro paso al CI.
- No se corrigió la deriva de `docs/calidad.md` que dice «SAST | semgrep (docker…)» cuando el script
  corre oxlint: es previa a este bug y ajena a su alcance; queda como seguimiento.

## Follow-ups

- `docs/calidad.md`: la fila del check de SAST dice `semgrep (docker…)` y el script corre `oxlint`
  1.79.0 sin docker. Deriva previa a MSF-843; corregirla en otra historia.
- El `HEAD` de `dokploy` (`0d75df2c`) no tiene ninguna corrida de CI registrada. La evidencia verde
  disponible hasta ahora era de `a3461e56` (ancestro del HEAD). El PR de esta historia produce la
  corrida sobre la base actual.
- Si el log de un `quality` vuelve a mostrar un path sin texto, el primer paso es mirar
  `reports/calidad.log` (artifact `calidad-reporte`): con la garantía de este PR, ahí está la salida
  completa de cada herramienta.
