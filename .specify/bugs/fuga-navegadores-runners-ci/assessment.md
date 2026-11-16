# Bug Assessment: fuga de Chromium y zombies en los runners del CI

- **Slug**: fuga-navegadores-runners-ci
- **Created**: 2026-10-26
- **Source**: pasted text (AGE-1311, triaje CTO de AGE-1179)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> Los 5 runners self-hosted de `multistorefront-meli` tenían 2.260 procesos
> `chrome-headless` huérfanos (551/534/345/418/412) y el nodo 4.453 zombies,
> con load 11 sobre 12 vCPU. `ai-dev-gateway` respondía 200 en loopback pero el
> watchdog lo vio con timeout. Un `docker restart` de los 5 runners (sin jobs
> en curso) bajó chrome a 0 y zombies a 3. El job de Playwright (`validate.yml`,
> `test:e2e`) deja Chromium vivo cuando termina, falla o se cancela, y no hay
> limpieza: el janitor limpia locks/carriles y stacks Supabase, no browsers.

## Symptom

Los runners acumulan procesos de Chromium (y zombies) entre corridas. Con los
runners ociosos el nodo queda saturado: load muy por encima de los núcleos,
timeouts del watchdog del gateway y checks de CI rojos sin un test rojo real.
Lo esperado es que, terminado (o cancelado) un job, queden como máximo unos
pocos navegadores vivos y que el nodo no acumule zombies.

## Reproduction

1. En un runner con el compose actual, correr el job `application` de
   `validate.yml` con e2e (`pnpm test:e2e -- acceso-publico.e2e.ts`).
2. Cancelar el run o dejar que el job agote `timeout-minutes` mientras
   Playwright tiene el browser abierto. GitHub mata el proceso del step, pero
   los nietos (`chrome-linux/chrome`) quedan dentro del contenedor con PPID 1.
3. `docker exec <runner> cat /proc/*/cmdline` (o `ps -ef`) muestra los
   `chrome` huérfanos; `ps -eo stat= | grep -c '^Z'` los zombies. Repetir
   durante una semana y comparar contra los umbrales.

Evidencia del host en AGE-1311: 2.260 chrome / 4.453 zombies el 26/10 00:20Z;
la mitigación con `docker restart` los dejó en 0 / 3.

## Suspected Code Paths

- `.github/workflows/validate.yml` (jobs `application` y `web`) — no hay
  ningún paso de limpieza de navegadores; el job termina y los hijos del step
  quedan en el contenedor.
- `infra/runner/entrypoint.mjs` — el contenedor corre `node` como PID 1; no
  cosecha procesos que no son hijos directos, así que los huérfanos y zombies
  se acumulan hasta reiniciar el contenedor.
- `infra/runner/compose.yaml` — no declara `init`, por lo que no hay un init
  que haga `waitpid` de los reparentados.
- `scripts/limpiar-ci.mjs` — sólo limpia locks/carriles y stacks Supabase;
  nunca inspecciona procesos dentro de los runners.
- `.github/workflows/ci-janitor.yml` — el schedule existe, pero el workflow
  sólo está en `dokploy`, no en la rama por defecto (`main`); el cron de
  GitHub no se dispara desde una rama que no es la default.

## Root Cause Hypothesis

Confianza alta. Un job cancelado o que agota el timeout deja el browser de
Playwright huérfano con PPID 1. El PID 1 del runner es el `node` del
entrypoint, que no reaped a los reparentados: los vivos siguen consumiendo
CPU/PIDs y los muertos quedan como zombies. No hay ninguna limpieza de
navegadores ni al final del job ni en el janitor, así que la fuga crece entre
corridas. El janitor además no corre por schedule desde `main`, con lo que la
red de seguridad que sí existía para locks/stacks tampoco estaba activa.

## Proposed Remediation

**Preferred** (tres capas, de menor a mayor costo):

1. Paso `if: always()` al final de los jobs que usan Playwright
   (`application` y `web`) que mate los navegadores del propio runner y deje
   el conteo antes/después en el log. Es barato y cubre fallo y cancelación.
2. `init: true` en `infra/runner/compose.yaml` para que tini sea PID 1 y
   coseche los zombies; agregar `procps` a la imagen para dejar `ps`, `pgrep`
   y `pkill` disponibles de forma explícita.
3. Extender `scripts/limpiar-ci.mjs` (y `ci-janitor.yml`) para inspeccionar
   por Docker las réplicas del mismo proyecto Compose y matar sólo navegadores
   con más de 45 min (por encima del timeout de 30 min de los jobs), con
   conteo de navegadores y zombies antes/después. Un modo `--verificar` falla
   si un runner supera 5 huérfanos y se ejecuta en el job `infrastructure`.

No se reinician los runners por schedule: corta jobs en curso y puede perder
runs en cola (AGE-1027). El reinicio queda como operación manual de emergencia.

**Alternatives**:
- Reinicio programado de los contenedores: resuelve todo de golpe pero corta
  jobs y pierde runs en cola; descartado.
- `globalTeardown` de Playwright: no se ejecuta si el proceso es SIGKILL por
  cancelación/timeout; no cubre el caso real.

**Files likely to change**:
- `.github/workflows/validate.yml`
- `.github/workflows/ci-janitor.yml`
- `scripts/limpiar-ci.mjs`, `scripts/limpiar-ci.test.mjs`
- `infra/runner/compose.yaml`, `infra/runner/Dockerfile`
- `docs/control-ci.md`, `template-capabilities.json`

**Tests to add or update**:
- `scripts/limpiar-ci.test.mjs`: parseo de procesos, detección de navegadores,
  TTL (no tocar un job de 30 min), zombies, umbral y nombres de contenedores.
- `pnpm test:ci` en el job `infrastructure`.
- `node scripts/limpiar-ci.mjs --verificar` en el job `infrastructure` como
  verificación viva contra los runners reales.

## Risks & Considerations

- `pkill` dentro del contenedor del job mataría navegadores de otro job si el
  runner ejecutara dos a la vez; el runner de GitHub corre un job por réplica.
- Un TTL demasiado bajo podría matar un e2e legítimo; 45 min supera el timeout
  de 30 min de los jobs.
- `init: true` requiere recrear los runners para tomar efecto; hacerlo sólo
  sin jobs en curso.
- El janitor sigue dependiendo de estar en la rama por defecto para el cron;
  documentado y con la limpieza de fin de job como cobertura principal.

## Open Questions

- Ninguna bloqueante. La verificación en el host (conteo real después de una
  semana) queda para el seguimiento, porque los criterios son de 7 días.
