# Bug Assessment: CI `quality`/`application`/`validacion` rojo en el PR #882 (fix e2e tests envejecidos)

- **Slug**: msf-843
- **Created**: 2026-11-17
- **Source**: pasted text (tracker MSF-843, «[Bug] PR #882 (fix e2e tests envejecidos): CI `quality`/`application`/`validacion` rojo — knip (código muerto) en conexiones/list.tsx y docs:check sin actualizar documentación (modo bug)»); sin URL
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim)

> ## Diagnóstico (verificado con `gh api .../actions/jobs/{id}/logs`, run 43324205940/43324206071, 2026-11-12)
>
> PR #882 (`fix/e2e-tests-envejecidos` → main) tiene tres checks en rojo. Son DOS causas independientes (no una cascada completa):
>
> ### 1) `quality` rojo — knip (código muerto)
> `reports/calidad.md` de la corrida marca `knip (código muerto): hallazgos`. El log señala:
> ```
> apps/web/src/pages/conexiones/list.tsx:44:1
> ```
> El texto descriptivo de knip no se pudo leer completo del log de GitHub Actions (se corta por el redraw de su spinner), así que el hallazgo exacto (export/símbolo sin uso) hay que verlo corriendo la herramienta, no asumirlo.
>
> ### 2) `application` rojo — `pnpm docs:check`
> El paso `node scripts/verificar-documentacion-cambios.mjs` falla con:
> ```
> Fallo de documentación: el cambio toca plataforma/tooling pero no actualiza specs/, docs/, .specify/bugs/, .specify/memory/, AGENTS.md, CLAUDE.md ni la constitución.
> ```
> El PR agrega `scripts/verificar-e2e-sin-escritura-directa.mjs` (+ su test) y modifica `.github/workflows/validate.yml`, además de actualizar ~40 specs `.e2e.ts`. Toca tooling/CI sin la documentación equivalente — exactamente la regla "Documentación obligatoria" de `CLAUDE.md`.
>
> ### 3) `validacion` rojo
> Es consecuencia: su único paso agrega `application=failure` al resumen y sale 1. No es una tercera causa.

## Symptom

El job `quality` del PR #882 terminó rojo con `knip (código muerto): hallazgos` y el job `application` con el fallo de `docs:check`; `validacion` heredó el rojo de `application`. Lo esperado: los tres checks en verde, porque el PR no tocaba código de producto — sólo specs E2E envejecidos y un guardián de CI.

## Reproduction

1. **Estado del rojo (histórico, ya resuelto en la base)**: el PR #882 nunca se mergeó (cerrado sin merge, `mergedAt: null`; su único commit es `c084da54`), y el PR #888 que lo replicaba (`fix/bug-MSF-843` → `dokploy`, commit `b6d4a634`) tampoco. La rama quedó stale frente a los lotes de la épica MSF-515: un merge real contra `dokploy` actual da conflicto en más de 20 archivos, incluidos dos *add/add* en `scripts/verificar-e2e-sin-escritura-directa.mjs` y su test.
2. **El `quality` rojo, reproducido**: el CI del 2026-11-12 corrió sobre el head `3892a22f` (no sobre `c084da54`, que fue el head final del PR). Con ese head, `pnpm dlx knip@6.44.1 --no-progress` devuelve:
   ```
   Unlisted dependencies (1)
   pg  apps/web/e2e/ventas-impresion.e2e.ts:88:130
   ```
   El import venía de `apps/web/e2e/ventas-impresion.e2e.ts:88`: `createRequire(resolve(process.cwd(), '../../workers/comprobantes-pdf/package.json'))('pg')` — `pg` se cargaba desde el `package.json` del worker, así que `apps/web` nunca lo declaraba y knip lo marcó como dependencia no declarada.
3. **El `docs:check` rojo, reproducido**: `scripts/verificar-documentacion-cambios.mjs` marca como *relevantes* los paths bajo `scripts/` y `.github/` y exige que el mismo diff toque `specs/`, `docs/`, `.specify/bugs/`, `.specify/memory/`, `AGENTS.md` o `CLAUDE.md`. El diff del PR #882 tocaba `scripts/` y `.github/workflows/validate.yml` sin ninguna de esas rutas ⇒ rojo.
4. **El hallazgo que el log no mostraba**: el log del job `quality` (job `131552415859`, run `43324206071`) termina en `##[warning]apps/web/src/pages/conexiones/list.tsx:44:1` sin texto. Ese archivo —`apps/web/src/pages/conexiones/list.tsx`— es **idéntico byte a byte** en el head del CI (`3892a22f`), en su base (`e3e0f66e`) y en `dokploy` actual (`git diff` vacío); su línea 44 siempre fue `useEffect(() => cargarConexiones(), [cargarConexiones])`, que no es una declaración exportada. La línea del log es, además, la **última** línea del log del paso: no aparecen ni el encabezado `== knip (código muerto): …` ni el bloque `---- RESUMEN ----`, y el artifact `calidad-reporte` de esa corrida (334 bytes) tiene la tabla de estado pero **sin la salida de la sección que falló**.
5. **En `dokploy` actual (2026-11-17)**: `pnpm dlx knip@6.44.1 --no-progress` → **0 hallazgos** (exit 0) y `pnpm docs:check` → **OK**. Los dos rojos del reporte ya no se reproducen.

## Suspected Code Paths

- `scripts/calidad.mjs:34` — `delete childEnv.GITHUB_ACTIONS;`: en el head del CI (`3892a22f`) esta línea **no existía**, así que knip corría con su reporter de GitHub Actions y escribía anotaciones `::warning`/`::error` en vez de texto; el runner las consumía como anotaciones y el texto del hallazgo desaparecía del log.
- `scripts/calidad.mjs:62` — `log(...)` escribe la salida de cada herramienta en `reports/calidad.log`: en el head del CI ese archivo no se escribía, y la plantilla de `reports/calidad.md` no incluía la salida de los checks con hallazgos.
- `scripts/calidad.mjs:131` — `...fallos.flatMap((r) => ['## ' + r.name, …])`: la sección con la salida del check que falló (la que hace diagnosticable el artifact).
- `scripts/verificar-documentacion-cambios.mjs:28-37` — la regla que exige documentación equivalente cuando el diff toca `scripts/` o `.github/`.
- `scripts/verificar-e2e-sin-escritura-directa.mjs` + `.github/workflows/validate.yml:164-166` — el guardián que el PR #882 agregó sin documentación equivalente (causa del rojo de `application`).
- `apps/web/e2e/ventas-impresion.e2e.ts:88` — el `require` dinámico de `pg` que knip marcó como dependencia no declarada (causa real del rojo de `quality`).
- `apps/web/src/pages/conexiones/list.tsx:44` — el path que el log señalaba, sin relación con el hallazgo real (archivo idéntico en base, PR y `dokploy` actual).

## Root Cause Hypothesis

Confianza **alta**. Son dos causas independientes y ninguna era un defecto del código de producto: (1) el `quality` rojo fue un hallazgo real de knip —`pg` importada en un spec E2E sin declararse en `apps/web`— que ya está resuelto en `dokploy` (el helper que cargaba `pg` por `createRequire` desde el `package.json` del worker ya no está) y que, además, el propio tooling del CI no sabía mostrar: en el head del CI, `scripts/calidad.mjs` dejaba pasar `GITHUB_ACTIONS` a los hijos (knip pasaba a su reporter de anotaciones, que el runner consume y borra del log) y no escribía `reports/calidad.log` ni la salida del check que falló en `reports/calidad.md`. De ahí que el log terminara en una ruta sin texto (`apps/web/src/pages/conexiones/list.tsx:44:1`) en vez del hallazgo de `pg`: la ruta del log no era el hallazgo, era el último texto que el runner alcanzó a renderizar. (2) el `application` rojo fue la regla de documentación obligatoria: el PR tocaba `scripts/` y `.github/` sin tocar `docs/`, `specs/` ni `.specify/bugs/`. En `dokploy` actual el guardián y su cableado en `validate.yml` llegaron con su documentación (`docs/e2e-app.md`, sección «Requisitos de algunos specs y guardián de escritura directa») en el mismo commit (`611957f3`), así que `docs:check` pasa.

## Proposed Remediation

**Preferred**: no rehacer el fix sobre la rama vieja — resolver sobre `dokploy` actual en una rama nueva, con dos cambios acotados:

1. **Tests que fijen la diagnosticabilidad del informe de calidad** (el hueco real que dejó MSF-843): en `scripts/calidad.test.mjs`, correr `scripts/calidad.mjs` con un `pnpm` falso en el `PATH` que simula el `pnpm dlx knip@…`, y exigir (a) que la salida del check que falló esté en `reports/calidad.md` (sección `## <check>`) y en `reports/calidad.log`, y (b) que los hijos **no** hereden `GITHUB_ACTIONS` (con esa variable, knip y oxlint escriben anotaciones en vez de texto y el rojo del CI queda sin diagnóstico). Así, si alguien vuelve a romper cualquiera de las dos reglas, el `quality` lo dice en el PR y no en una futura devolución.
2. **Documentar esa garantía** en `docs/calidad.md`, para que el contrato escrito y el código protegido por el test no se separen.

**Alternatives**:
- *Sólo evidencia, sin PR*: el rojo ya no se reproduce en `dokploy` y el epílogo podría cerrarse con el log de `pnpm calidad` y `pnpm docs:check` en verde. Se descarta: el `HEAD` de `dokploy` no tiene ninguna corrida de CI registrada (0 runs para `0d75df2c`), así que sin PR no hay evidencia de `quality`/`application`/`validacion` en verde sobre la base actual.
- *Reaplicar el diff de la rama vieja*: descartado — no mergea (conflicto en más de 20 archivos) y el contenido de los ~40 `.e2e.ts` ya evolucionó en `dokploy` con MSF-515.

**Files likely to change**:
- `scripts/calidad.test.mjs`
- `docs/calidad.md`
- `.specify/bugs/msf-843/{assessment,fix,test}.md`

**Tests to add or update**:
- `scripts/calidad.test.mjs` — «el informe de calidad dice qué encontró el check que falló» y «las herramientas no heredan GITHUB_ACTIONS», ambos con mutación comprobada (FEAT-236).

## Risks & Considerations

- El test usa un `pnpm` falso en el `PATH`: no toca la red ni el repo real (corre en un `tmpdir`), pero depende de que `scripts/calidad.mjs` invoque `pnpm` por nombre (así lo hace hoy). Si mañana el script deja de usar `pnpm`, el test debe cambiarse con él.
- Pisar el `PATH` en el test es seguro: el proceso hijo es el propio `scripts/calidad.mjs`, que no necesita `pnpm` real para el check simulado.
- `reports/calidad.md` está versionado en el repo: correr `pnpm calidad` localmente lo modifica y hay que restaurarlo antes de commitear (si no, el diff lleva un reporte generado).
- No se toca `scripts/calidad.mjs`: las dos reglas que se fijan ya están implementadas en `dokploy` (`delete childEnv.GITHUB_ACTIONS` y la sección `## <check>` del informe); lo que faltaba era el test que las vigila.
- La documentación de `docs/calidad.md` dice «SAST | semgrep (docker…)» mientras el script corre oxlint: es una deriva previa, ajena a este bug; queda anotada como seguimiento y no se toca acá.

## Open Questions

- [NEEDS CLARIFICATION: el path que el log del CI señalaba (`apps/web/src/pages/conexiones/list.tsx:44:1`) no se pudo reconstruir como hallazgo de knip: el archivo es idéntico en la base, en el head del CI y en `dokploy` actual, y su línea 44 nunca fue una declaración exportada. La hipótesis sostenida es que era el último texto que el runner alcanzó a renderizar de la salida de knip en modo anotaciones; la línea 44:1 no se pudo confirmar con el log (que no conserva el texto) ni con el artifact (que no incluye la salida del check que falló).]
- [NEEDS CLARIFICATION: el `HEAD` de `dokploy` (`0d75df2c`) no tiene ninguna corrida de CI registrada; la evidencia verde disponible es de `a3461e56` (ancestro del HEAD, run `44015101592`: `application` y `validacion` en verde) y de corridas `quality` recientes sobre ramas otras. El PR de esta historia sirve para obtener esa evidencia sobre la base actual.]
