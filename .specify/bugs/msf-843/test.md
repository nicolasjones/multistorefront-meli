# Bug Verification: CI `quality`/`application`/`validacion` rojo en el PR #882 (MSF-843)

- **Slug**: msf-843
- **Tested**: 2026-11-17
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified — los dos rojos del reporte no se reproducen sobre `dokploy` actual (knip: 0
  hallazgos; `docs:check`: OK) y las reglas que hacían el rojo indiagnosticable quedan fijadas por
  test, con mutación comprobada.

## Summary

El hallazgo real del `quality` (knip) y el del `application` (`docs:check`) están resueltos en la base:
knip da 0 hallazgos y `docs:check` pasa. Lo que este PR agrega es la cobertura que faltaba para que
un rojo de calidad vuelva a decir **qué** encontró: tres tests que corren `scripts/calidad.mjs` con un
`pnpm` falso y exigen (a) que la salida del check que falló esté en `reports/calidad.md`, en
`reports/calidad.log` **y en el log del propio paso del CI** (stdout, sin recortar en ninguno de los
tres), (b) que las herramientas no hereden `GITHUB_ACTIONS` (el script borra esa variable del entorno
de los hijos para que ninguna herramienta escriba anotaciones `::warning`, que el runner consume como
anotaciones y no copia al log) y (c) que el log **no pierda el final** de la salida (el script sale
con `process.exitCode = 1`: con `process.exit(1)`, en Linux se descarta la cola de `stdout` que no
entra en el buffer del pipe y el bloque del check que falló se pierde).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) — knip | `pnpm dlx knip@6.44.1 --no-progress` sobre `dokploy` actual (`0d75df2c`) | pass | 0 hallazgos, exit 0. El hallazgo del CI (`pg` sin declarar en `apps/web/e2e/ventas-impresion.e2e.ts:88:130`) ya no está en la base. |
| Reproducción del hallazgo ORIGINAL | `git show 3892a22f:apps/web/e2e/ventas-impresion.e2e.ts > apps/web/e2e/ventas-impresion.e2e.ts` + `pnpm dlx knip@6.44.1 --no-progress` (después `git checkout --` del archivo) | pass (reproduce) | Sale **idéntico** al texto que el reporte decía que no se podía leer: `Unlisted dependencies (1)` / `pg  apps/web/e2e/ventas-impresion.e2e.ts:88:130` (exit 1). Al restaurar el archivo, knip vuelve a 0. Es la prueba de que el hallazgo existió y de que knip **no** está silenciado: sigue viendo ese archivo. |
| Hallazgo del log (`conexiones/list.tsx:44:1`) | lectura del archivo completo (71 líneas) + comparación con el head del CI (`git diff 3892a22f HEAD -- apps/web/src/pages/conexiones/list.tsx`) | pass (no es código muerto) | Los 11 imports se usan todos, `columnas:15` se usa en `61`, `ConexionList:23` se usa en `apps/web/src/App.tsx:293` (la ruta `/conexiones`) y la línea 44 es el `useEffect` que dispara la carga (su retorno es la función de cleanup). Respecto del head del CI (`3892a22f`), el archivo difiere en **una** línea (el `aria-label` del `EditButton`, un ajuste de accesibilidad de MSF-585): la línea 44 sigue siendo el mismo `useEffect`, nunca fue una declaración exportada. |
| Reproducción (post-fix) — `docs:check` | `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` | pass | `Documentación de cambios: OK`; `Migraciones OK`; `Trampas conocidas: OK`. |
| Reproducción (post-fix) — guardián | `pnpm e2e:escritura:check` | pass | `ningún spec escribe directo en tablas de solo lectura para service_role`. |
| Documentación del tooling contra el código | `docs/calidad.md` vs `scripts/calidad.mjs` y `package.json` | pass | La tabla «Qué corre» dice lo que el script corre de verdad (gitleaks con binario nativo, docker sólo de respaldo; SAST con oxlint 1.79.0) y el bloque «Uso» cita `pnpm calidad:code` (el script que define `package.json`), no `pnpm calidad --code`, que no existe. El encabezado de `scripts/calidad.mjs` pasó a `--only=secrets,sast`, la forma que el parser acepta. |
| Tests nuevos | `node --test scripts/calidad.test.mjs` | pass | 4/4 (1 previo de MSF-683 + 3 de MSF-843) + 1 skip (gitleaks no instalado). |
| Causa real del rojo de MSF-843 | log del job `quality` (`gh api repos/{owner}/{repo}/actions/jobs/131552415859/logs`) + artifact `calidad-reporte` de esa corrida (id `13993035090`) | pass (reconstruida) | El log del paso tiene `== gitleaks (secretos): ok` y `== oxlint (SAST): ok` y después ya el fallo: **no** están el encabezado `== knip (código muerto): hallazgos`, ni la salida de knip, ni el `---- RESUMEN ----`. El artifact (334 bytes) sí tiene la tabla de los siete checks —knip `hallazgos`— pero **sin** la salida del check que falló. O sea: la salida del check que falló no llegó ni al log del paso ni al informe. |
| ¿Era `GITHUB_ACTIONS` la causa? | inspección del paquete publicado de knip 6.44.1 (`grep -rn GITHUB_ACTIONS` → 0 resultados; `grep -rn "::warning"` → 0; reporter por defecto `symbols` en `dist/cli.js`) + corrida de oxlint 1.79.0 con y sin la variable | pass (descartado) | knip no lee la variable: su salida no cambia. oxlint 1.79.0 con `--format=default` (el que fuerza el script) da la misma salida con `GITHUB_ACTIONS=true` y sin ella; su formato `github` (el que escribe anotaciones `::warning`) sólo se usa si se lo pide con `--format=github`. La atribución del texto perdido a esa variable era falsa. |
| Test que detecta la regla (FEAT-236) | se quitó `delete childEnv.GITHUB_ACTIONS;` de `scripts/calidad.mjs` y se re-corrió el test | pass (detecta) | `ℹ fail 1`: falla «las herramientas no heredan GITHUB_ACTIONS». Se revirtió la mutación. |
| Test que detecta la regla (FEAT-236) | el script volvió a salir con `process.exit(1)` en vez de `process.exitCode = 1` y se re-corrió el test | pass (detecta) | `ℹ fail 1`: falla «el log del CI no pierde el final de la salida del check que falló» (el hallazgo queda fuera del stdout: en Linux, `process.exit(1)` descarta la cola de `stdout` que no entra en el buffer del pipe, 64 KiB). Se revirtió la mutación. |
| Test que detecta la regla (FEAT-236) | se quitó el `fallos.flatMap(...)` (la sección `## <check>`) de la plantilla del informe y se re-corrió el test | pass (detecta) | `ℹ fail 1`: falla «el informe de calidad dice qué encontró el check que falló». Se revirtió la mutación. |
| Test que detecta la regla (FEAT-236) | el check con hallazgos volvió a imprimir sólo las últimas 40 líneas de su salida (`res.out.split("\n").slice(-40)`) y se re-corrió el test | pass (detecta) | `ℹ fail 1`: falla «el informe de calidad dice qué encontró el check que falló» (el hallazgo quedaba fuera del log del CI). Se revirtió la mutación. |
| Test que detecta la regla (FEAT-236) | la sección del check que falló en `reports/calidad.md` volvió a recortarse a las últimas 60 líneas y se re-corrió el test | pass (detecta) | `ℹ fail 1`: falla «el informe de calidad dice qué encontró el check que falló» (el hallazgo quedaba fuera del informe). **Con el ruido de 42 líneas que había antes, esta mutación NO la detectaba** (42 < 60): por eso el shim ahora emite 70 líneas, más que los dos recortes que hay que vigilar. Se revirtió la mutación. |
| Test que detecta la regla (FEAT-236) | se inyectó `export const __prueba_muerta_msf843 = 1` en `apps/web/src/pages/conexiones/list.tsx` y se corrió knip | pass (detecta) | knip lo reporta (`apps/web/src/pages/conexiones/list.tsx:73:14`): la herramienta knip está viva y ve ese archivo. Se revirtió la inyección. |
| Suite de CI | `pnpm test:ci` | pass | Verde (incluye `scripts/calidad.test.mjs`). |
| Lint | `pnpm lint` | pass | exit 0 (sólo warnings preexistentes de `apps/web/src`, fuera de este cambio). |
| Build / type-check | `pnpm build` | pass | exit 0. |
| Calidad | `pnpm calidad` | pass (con salvedad) | `knip`, `oxlint`, `jscpd`, `dependency-cruiser` y `syncpack` en **ok**; `gitleaks` no corrió porque necesita el daemon de Docker (no disponible en este entorno) y este diff no agrega secretos. |
| Guardián de e2e | `pnpm test:e2e:escritura` | pass | 16/16. |
| CI del PR #1127 — `quality` | run `44184387889` (job `134396877895`), commit `f904930f3` | pass | `gitleaks`, `oxlint`, **`knip (código muerto): ok`**, `jscpd`, `dependency-cruiser`, `syncpack` y `commitlint` en **ok**, con el bloque `---- RESUMEN ----` impreso en el log del paso. |
| CI del PR #1127 — `application` | run `44184387968` (job `134397057501`), commit `f904930f3` | pass | Incluye `pnpm docs:check`, `pnpm lint` y `pnpm build`. |
| CI del PR #1127 — `infrastructure` | run `44184387968` (job `134397057378`), commit `f904930f3` | pass | `pnpm test:ci` → 35/35; los tres tests de `scripts/calidad.test.mjs` corrieron y pasaron en el CI. |
| CI del PR #1127 — `validacion` | run `44184387968` (job `134398383180`), commit `f904930f3` | pass | Sin causa propia: agrega los resultados de los demás jobs. |

## Output Excerpts

```text
$ node --test scripts/calidad.test.mjs
✔ [MSF-683] calidad llega al RESUMEN y deja reports/calidad.log aunque no corra ninguna herramienta
✔ [MSF-843] el informe de calidad dice qué encontró el check que falló
✔ [MSF-843] las herramientas no heredan GITHUB_ACTIONS (oxlint puede escribir anotaciones `::warning`, que el runner consume como anotaciones)
✔ [MSF-843] el log del CI no pierde el final de la salida del check que falló
ℹ tests 5  ℹ pass 4  ℹ fail 0  ℹ skipped 1
```

```text
# con `delete childEnv.GITHUB_ACTIONS;` quitado de scripts/calidad.mjs:
ℹ fail 1
✖ [MSF-843] las herramientas no heredan GITHUB_ACTIONS (oxlint puede escribir anotaciones `::warning`, que el runner consume como anotaciones)

# con el `fallos.flatMap(...)` quitado de la plantilla de reports/calidad.md:
ℹ fail 1
✖ [MSF-843] el informe de calidad dice qué encontró el check que falló

# con el stdout del check con hallazgos recortado a las últimas 40 líneas:
ℹ fail 1
✖ [MSF-843] el informe de calidad dice qué encontró el check que falló

# con la sección del check que falló de reports/calidad.md recortada a las últimas 60 líneas:
ℹ fail 1
✖ [MSF-843] el informe de calidad dice qué encontró el check que falló

# con el script volviendo a salir con `process.exit(1)`:
ℹ fail 1
✖ [MSF-843] el log del CI no pierde el final de la salida del check que falló
```

```text
$ pnpm dlx knip@6.44.1 --no-progress          # sobre dokploy actual (0d75df2c)
(sin salida — 0 hallazgos, exit 0)

$ DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check
Documentación de cambios: OK (… archivos comparados contra …).
Migraciones OK: … archivo(s), 0 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (0 migración(es), 0 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).
```

```text
# el hallazgo ORIGINAL, reproducido sobre dokploy actual (2026-11-17):
$ git show 3892a22f:apps/web/e2e/ventas-impresion.e2e.ts > apps/web/e2e/ventas-impresion.e2e.ts
$ pnpm dlx knip@6.44.1 --no-progress
Unlisted dependencies (1)
pg  apps/web/e2e/ventas-impresion.e2e.ts:88:130
EXIT=1
$ git checkout -- apps/web/e2e/ventas-impresion.e2e.ts
$ pnpm dlx knip@6.44.1 --no-progress
EXIT=0
```

```text
# el log del job quality que falló (run 43324206071, job 131552415859) — la última línea del paso:
2026-11-12T22:58:50.9539306Z ##[warning]apps/web/src/pages/conexiones/list.tsx:44:1[ELIFECYCLE] Command failed with exit code 1.
# (no aparecen ni el encabezado "== knip (código muerto)" ni el bloque "---- RESUMEN ----")
```

```text
# el CI del PR #1127 (run 44184387889, job quality — commit f904930f3):
== gitleaks (secretos): ok
== oxlint (SAST): ok
== knip (código muerto): ok
== jscpd (duplicación): ok
== dependency-cruiser (arquitectura): ok
== syncpack (versiones): ok
== commitlint (mensajes): ok
---- RESUMEN ----
  ok         gitleaks (secretos)
  ok         oxlint (SAST)
  ok         knip (código muerto)
  ok         jscpd (duplicación)
  ok         dependency-cruiser (arquitectura)
  ok         syncpack (versiones)
  ok         commitlint (mensajes)

# el CI del PR #1127 (run 44184387968, job infrastructure — pnpm test:ci):
✔ [MSF-683] calidad llega al RESUMEN y deja reports/calidad.log aunque no corra ninguna herramienta
✔ [MSF-843] el informe de calidad dice qué encontró el check que falló
✔ [MSF-843] las herramientas no heredan GITHUB_ACTIONS (oxlint puede escribir anotaciones `::warning`, que el runner consume como anotaciones)
ℹ tests 35  ℹ pass 35  ℹ fail 0
```

## Residual Risks

- La evidencia verde de `quality`/`application`/`validacion` sobre la base actual llegó con el PR
  #1127 (`quality` run `44184387889`, `Validate` run `44184387968`, ambos sobre el commit
  `f904930f3`, que es el que lleva el código). El `HEAD` de `dokploy` por sí solo sigue sin corrida
  propia: el merge de este PR es la corrida de la base.
- `gitleaks` no se pudo correr localmente (sin daemon de Docker). En el CI corre el binario nativo y
  salió **ok** (run `44184387889`); el diff de este PR no agrega secretos.
- El test usa un `pnpm` falso en el `PATH`: depende de que `scripts/calidad.mjs` invoque `pnpm` por
  nombre. Si mañana el script deja de usar `pnpm` (o cambia cómo invoca las herramientas), el test
  debe cambiarse con él.
- La suite completa de `pnpm test` (pgTAP y E2E) no se corrió localmente: necesita el stack de
  Supabase; corre en el CI.
- El hallazgo original del log del CI (`apps/web/src/pages/conexiones/list.tsx:44:1`) no era un
  hallazgo de knip: la línea 44 es el `useEffect` que dispara la carga (igual en el head del CI
  `3892a22f` que en `dokploy` actual, donde el archivo difiere del head del CI sólo por el
  `aria-label` del `EditButton`, un ajuste de accesibilidad de MSF-585), nunca fue una declaración
  exportada y no tiene código muerto (revisado a mano). El hallazgo real —`pg` sin declarar en
  `apps/web/e2e/ventas-impresion.e2e.ts`— **quedó reproducido** el 2026-11-17 restaurando ese único
  archivo desde `3892a22f`, y el texto que knip imprime coincide byte a byte con lo que el reporte
  decía que no se podía leer. Por qué el log mostraba esa ruta (la salida del check que falló no llegó
  al log del paso ni al informe: el log del job tiene `== oxlint (SAST): ok` y después ya el fallo, sin
  el `== knip (código muerto): hallazgos` ni el `---- RESUMEN ----`, y el artifact de esa corrida tiene
  la tabla de los siete checks sin la salida del check que falló) queda anotado en el assessment; con
  este PR, `reports/calidad.log` lo vuelve innecesario como fuente de verdad.
- El mecanismo exacto por el que esa salida no llegó al log no se puede reconstruir: el log de GitHub
  Actions no conserva lo que se perdió. Lo que sí queda vigilado por test es que la salida del check
  que falló se imprima completa y que el script termine sin descartar la cola de `stdout`
  (`process.exitCode = 1`, no `process.exit(1)`).

## Re-verificación de la devolución del 2026-11-18 (revisión de QA sobre el PR #1127)

Sobre el HEAD de esta rama, después de corregir la atribución de la causa y sacar el informe generado
del control de versiones:

| Check | Resultado |
|---|---|
| `node --test scripts/calidad.test.mjs` | 4 pass, 0 fail (1 skip: gitleaks no instalado) |
| Mutación `process.exit(1)` | el test «el log del CI no pierde el final de la salida del check que falló» falla (1 fail) |
| `pnpm dlx knip@6.44.1 --no-progress` | 0 hallazgos, exit 0 |
| `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` | OK, migraciones y trampas OK |
| `pnpm e2e:escritura:check` / `pnpm test:e2e:escritura` | OK / 16/16 |

## Recommendation

Cerrar el bug — verificado sobre `dokploy` actual: los dos rojos del reporte no se reproducen, la causa
por la que el `quality` era indiagnosticable (la salida del check que falló no llegaba ni al log del
paso ni al informe) queda documentada con su evidencia y fijada por test (con mutación comprobada), y
el CI del PR #1127 deja `quality`, `application` y `validacion` en **verde** sobre la base actual.
