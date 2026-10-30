# Bug Fix: fuga de Chromium y zombies en los runners del CI

- **Slug**: fuga-navegadores-runners-ci
- **Fixed**: 2026-10-26
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Los jobs de Playwright ahora matan sus navegadores al terminar (también en
fallo o cancelación), el runner tiene un init que cosecha zombies y el janitor
mata navegadores huérfanos con más de 45 min dentro de las réplicas del mismo
proyecto Compose. Una verificación `--verificar` falla si la fuga reaparece.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `.github/workflows/validate.yml` | modified | paso `if: always()` que mata navegadores al final de `application` y `web`; `--verificar` en `infrastructure` |
| `.github/workflows/ci-janitor.yml` | modified | env de TTL/umbrales y comentario del alcance |
| `scripts/limpiar-ci.mjs` | modified | inspección por `/proc` de las réplicas, selección por edad, kill, conteo antes/después, modo `--verificar` |
| `scripts/limpiar-ci.test.mjs` | modified | casos puros para parseo, patrones, TTL, zombies, umbral y contenedores |
| `infra/runner/compose.yaml` | modified | `init: true` (tini como PID 1) |
| `infra/runner/Dockerfile` | modified | `procps` explícito (ps/pgrep/pkill) |
| `docs/control-ci.md` | modified | sección de navegadores huérfanos, comandos y límite del schedule |
| `template-capabilities.json` | modified | versiones de `vps-deploy-gate` y `local-ci-runners` |

## Diff Highlights

El janitor identifica su propio proyecto Compose por las labels del contenedor
y sólo inspecciona el servicio `runner` de ese proyecto:

```js
docker ps --filter label=com.docker.compose.project=<propio> \
          --filter label=com.docker.compose.service=runner --format '{{.Names}}'
```

Dentro de cada réplica lee `/proc` (sin depender de `ps`) y selecciona sólo
procesos vivos con `edad >= 45 min` cuyo cmdline es Chromium/Playwright. Los
zombies se cuentan pero no se matan: los cosecha tini.

## Tests Added or Updated

- `scripts/limpiar-ci.test.mjs` — `parsearProcesos`, `esNavegador`,
  `navegadoresHuerfanos` (incluye que un job de 30 min no se toca),
  `contarZombis`, `excedeUmbral`, `nombresDeContenedores`.

## Local Verification

- `node --test scripts/limpiar-ci.test.mjs` → 9/9 OK.
- `pnpm test:ci` → 27 tests OK (incluye los 9 nuevos).
- `node --check scripts/limpiar-ci.mjs` → OK.
- `node scripts/verificar-documentacion-cambios.mjs` → OK.
- `pnpm infra:config` no se pudo correr localmente (`docker` no está
  instalado en este entorno); lo valida el job `infrastructure` del PR.
- `pnpm docs:check` se cortó por timeout local en `verificar-migraciones.mjs`
  (recorre migraciones); el job `application` del PR lo valida.

## Deviations from Assessment

- No se pudo reproducir en vivo por SSH desde este agente (sin clave de host).
  La evidencia de la fuga es la medición del CTO en AGE-1311 y el chequeo
  `--verificar` que corre contra los runners reales en el PR.
- El assessment mencionaba `scripts/limpiar-ci.mjs` sólo para locks/stacks;
  además se detectó que `ci-janitor.yml` no está en la rama por defecto, por lo
  que el cron no corre. Se documenta y la limpieza de fin de job no depende de
  el cron; promover el workflow a `main` queda como follow-up operativo.

## Follow-ups

- Recrear los runners con `pnpm dev:runner` (sin jobs en curso) para que tome
  `init: true` y `procps`.
- Promover `ci-janitor.yml` a la rama por defecto (o cambiar la default) para
  que el cron de 6 h se dispare.
- A la semana, con los runners ociosos, verificar ≤5 navegadores por runner,
  <20 zombies y load <4 (criterios de AGE-1311).
