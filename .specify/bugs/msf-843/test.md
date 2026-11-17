# Bug Verification: CI `quality`/`application`/`validacion` rojo en el PR #882 (MSF-843)

- **Slug**: msf-843
- **Tested**: 2026-11-17
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified — los dos rojos del reporte no se reproducen sobre `dokploy` actual (knip: 0
  hallazgos; `docs:check`: OK) y las dos reglas que hacían el rojo indiagnosticable quedan fijadas
  por test, con mutación comprobada.

## Summary

El hallazgo real del `quality` (knip) y el del `application` (`docs:check`) están resueltos en la base:
knip da 0 hallazgos y `docs:check` pasa. Lo que este PR agrega es la cobertura que faltaba para que
un rojo de calidad vuelva a decir **qué** encontró: dos tests que corren `scripts/calidad.mjs` con un
`pnpm` falso y exigen (a) que la salida del check que falló esté en `reports/calidad.md` y en
`reports/calidad.log` y (b) que las herramientas no hereden `GITHUB_ACTIONS` (que las volaba a su
modo de anotaciones y dejaba el log sin texto).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) — knip | `pnpm dlx knip@6.44.1 --no-progress` sobre `dokploy` actual (`0d75df2c`) | pass | 0 hallazgos, exit 0. El hallazgo del CI (`pg` sin declarar en `apps/web/e2e/ventas-impresion.e2e.ts:88:130`) ya no está en la base. |
| Reproducción (post-fix) — `docs:check` | `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` | pass | `Documentación de cambios: OK`; `Migraciones OK`; `Trampas conocidas: OK`. |
| Reproducción (post-fix) — guardián | `pnpm e2e:escritura:check` | pass | `ningún spec escribe directo en tablas de solo lectura para service_role`. |
| Tests nuevos | `node --test scripts/calidad.test.mjs` | pass | 3/3 (1 previo de MSF-683 + 2 de MSF-843). |
| Test que detecta la regla (FEAT-236) | se quitó `delete childEnv.GITHUB_ACTIONS;` de `scripts/calidad.mjs` y se re-corrió el test | pass (detecta) | `ℹ fail 1`: falla «las herramientas no heredan GITHUB_ACTIONS». Se revirtió la mutación. |
| Test que detecta la regla (FEAT-236) | se quitó el `fallos.flatMap(...)` (la sección `## <check>`) de la plantilla del informe y se re-corrió el test | pass (detecta) | `ℹ fail 1`: falla «el informe de calidad dice qué encontró el check que falló». Se revirtió la mutación. |
| Test que detecta la regla (FEAT-236) | se inyectó `export const __prueba_muerta_msf843 = 1` en `apps/web/src/pages/conexiones/list.tsx` y se corrió knip | pass (detecta) | knip lo reporta (`apps/web/src/pages/conexiones/list.tsx:73:14`): la herramienta knip está viva y ve ese archivo. Se revirtió la inyección. |
| Suite de CI | `pnpm test:ci` | pass | Verde (incluye `scripts/calidad.test.mjs`). |
| Lint | `pnpm lint` | pass | exit 0 (sólo warnings preexistentes de `apps/web/src`, fuera de este cambio). |
| Build / type-check | `pnpm build` | pass | exit 0. |
| Calidad | `pnpm calidad` | pass (con salvedad) | `knip`, `oxlint`, `jscpd`, `dependency-cruiser` y `syncpack` en **ok**; `gitleaks` no corrió porque necesita el daemon de Docker (no disponible en este entorno) y este diff no agrega secretos. |
| Guardián de e2e | `pnpm test:e2e:escritura` | pass | 16/16. |

## Output Excerpts

```text
$ node --test scripts/calidad.test.mjs
✔ [MSF-683] calidad llega al RESUMEN y deja reports/calidad.log aunque no corra ninguna herramienta
✔ [MSF-843] el informe de calidad dice qué encontró el check que falló
✔ [MSF-843] las herramientas no heredan GITHUB_ACTIONS (si lo heredan, el log del CI no dice qué encontraron)
ℹ tests 3  ℹ pass 3  ℹ fail 0
```

```text
# con `delete childEnv.GITHUB_ACTIONS;` quitado de scripts/calidad.mjs:
ℹ tests 3  ℹ pass 2  ℹ fail 1
✖ [MSF-843] las herramientas no heredan GITHUB_ACTIONS (si lo heredan, el log del CI no dice qué encontraron)

# con el `fallos.flatMap(...)` quitado de la plantilla de reports/calidad.md:
ℹ tests 3  ℹ pass 2  ℹ fail 1
✖ [MSF-843] el informe de calidad dice qué encontró el check que falló
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
# el log del job quality que falló (run 43324206071, job 131552415859) — la última línea del paso:
2026-11-12T22:58:50.9539306Z ##[warning]apps/web/src/pages/conexiones/list.tsx:44:1[ELIFECYCLE] Command failed with exit code 1.
# (no aparecen ni el encabezado "== knip (código muerto)" ni el bloque "---- RESUMEN ----")
```

## Residual Risks

- El `HEAD` de `dokploy` (`0d75df2c`) no tiene ninguna corrida de CI registrada: la evidencia verde de
  `quality`/`application`/`validacion` sobre la base actual llega con el PR de esta historia, no con
  una corrida previa.
- `gitleaks` no se pudo correr localmente (sin daemon de Docker). En el CI corre el binario nativo; el
  diff de este PR no agrega secretos.
- El test usa un `pnpm` falso en el `PATH`: depende de que `scripts/calidad.mjs` invoque `pnpm` por
  nombre. Si mañana el script deja de usar `pnpm` (o cambia cómo invoca las herramientas), el test
  debe cambiarse con él.
- La suite completa de `pnpm test` (pgTAP y E2E) no se corrió localmente: necesita el stack de
  Supabase; corre en el CI.
- El hallazgo original del log del CI (`apps/web/src/pages/conexiones/list.tsx:44:1`) no se pudo
  reconstruir como hallazgo de knip: el archivo es idéntico byte a byte en la base del CI, en el head
  del CI y en `dokploy` actual, y su línea 44 nunca fue una declaración exportada. La hipótesis
  sostenida (el runner consumió la salida de knip en modo anotaciones y el log conserva sólo el
  último texto renderizado) queda anotada en el assessment; con este PR, `reports/calidad.log` la
  vuelve innecesaria como fuente de verdad.

## Recommendation

Cerrar el bug — verificado sobre `dokploy` actual: los dos rojos del reporte no se reproducen y la
causa por la que el `quality` era indiagnosticable queda fijada por test (con mutación comprobada).
Esperar el CI del PR (`quality`, `application` y `validacion` en verde sobre la base actual) antes de
mergear, porque el `HEAD` de `dokploy` no tiene todavía ninguna corrida registrada.
