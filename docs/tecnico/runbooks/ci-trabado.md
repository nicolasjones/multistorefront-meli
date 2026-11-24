---
owner: operacion
sources:
  - .github/workflows/validate.yml
  - .github/workflows/ci-janitor.yml
  - scripts/estado-ci.mjs
  - scripts/limpiar-ci.mjs
  - scripts/ci-lane.mjs
  - infra/runner/compose.yaml
---

# CI trabado

**Trigger:** un job queda en cola, un check no aparece, el merge no avanza o el runner está saturado.
**Impacto:** el PR no mergea; el flujo queda esperando.
**Dueño:** operación/SDLC.

## Pasos

1. `gh pr checks <PR>`: distinguir **pendiente**, **rojo** y **no disparado**.
2. Si está pendiente: `pnpm ci:estado` (`scripts/estado-ci.mjs`) muestra carriles en uso, carga del host y runners ocupados; revisar también
   los runners online en GitHub Actions y la cola del gateway (`/api/salud` del orquestador: sin verificar en este repositorio).
   Si hay carriles o stacks de Supabase del CI tomados sin jobs: `pnpm ci:limpiar` (simulación) y luego `pnpm ci:limpiar --aplicar`; el workflow
   `ci-janitor.yml` hace lo mismo cada 6 horas.
3. Si el runner está saturado: bajar `RUNNER_REPLICAS` (recrear los runners corta jobs: verificar antes que ninguno esté `busy`) o esperar; para frenar lo pesado,
   `gh variable set CI_PAUSED --body true` (se reactiva borrando la variable). Bajar `MAX_RUNNING` (runtime del orquestador) no se pudo verificar aquí. No cancelar jobs sanos. Detalle en [Control del CI](../../control-ci.md).
4. Si el check no se dispara: verificar el workflow, permisos y el evento (push/PR).
5. Si el merge falla por “rama atrás”: **no resincronices la rama a ciegas** (eso reinicia el CI y vuelve a dejarla atrás). Primero mirá el gate de la base con `pnpm ci:gate -- --pr <n>`: si «rama al día» NO está exigida (el estado actual de `dokploy`), ese rechazo no viene del gate, así que buscá la causa real y no re-despachar al Dev; si «rama al día» SÍ está exigida, el merge va a fallar mientras la base avance más rápido que el CI: escalá (paso 6). Ver [Control del CI](../../control-ci.md).
6. Reintentar **una** vez el job; si vuelve a fallar por lo mismo, escalar con el log.

## Verificación

- El check requerido está verde y el PR `MERGED` (si correspondía).
- No quedan runs huérfanos ni labels `ci-pendiente` stale.

## Escalado

Si el runner no vuelve o el gate no responde: escalar a orquestación; no mergear “a mano” sin checks.

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).

> **CI (2026-10-27):** los `.md` de raíz (`CLAUDE.md`, `AGENTS.md`) ya no cuentan como cambio de la app web. Antes, un PR sólo de docs encendía el e2e sin `build` y moría con *"Falta apps/web/dist"*; ahora, si el e2e corre, el `build` corre antes.

> **CI (2026-11-12):** el paso «avisar el link del visor en el PR» de `validate.yml` ya no falla si el runner no trae `gh` (la imagen de `infra/runner/Dockerfile` no lo instala): avisa en el log y sigue. Antes salía con 127 y dejaba rojo el job `application` aunque sus tests pasaran. Hoy los chequeos estáticos y las suites de Node puro viven en el job `chequeos`, que corre en paralelo con `application`.

> **CI (2026-11-16, actualizado 2026-11-18):** el job `chequeos` de Validate (antes `application`) corre `pnpm test:correo:verificar-salida` (MSF-532): la suite del guion de verificación de salida del correo. Es Node puro (sin base ni red): vigila que el contrato `{resultado, nuevo, enviado}` de la Edge Function `solicitar-acceso` y el guion sigan de acuerdo, para que el guion no pueda dar un verde falso.

> **CI (2026-11-20, MSF-755):** el gate de `dokploy` es un *ruleset*, no «branch protection»: `/branches/dokploy/protection` devuelve 404 «Branch not protected» aunque el ruleset esté activo, así que ese 404 no significa «sin protección». El estado real se lee con `pnpm ci:gate` (o `gh api repos/<owner>/<repo>/rulesets`): es el único dato que dice si «rama al día» está exigida, y por lo tanto si el merge va a ser rechazado por desfasaje.
