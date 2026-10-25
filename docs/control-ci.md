# Control de concurrencia del CI

Cómo evitar que, con muchos PRs en paralelo, el CI (y la máquina) se vaya al
diablo: admisión, cortacircuitos, límites de recursos, integración segura y
limpieza. Todo versionado salvo las **variables de repo** de GitHub.

## El problema

Los runners son un pool **fijo** (`infra/runner/`, `RUNNER_REPLICAS`). Si 20 PRs
disparan a la vez, GitHub encola jobs y los 5 runners se oversuscriben: el CI se
vuelve lento e inestable (timeouts, el browser del E2E sin `libglib`), los
stacks de Supabase del CI compiten por CPU/RAM, y **Claude** (que corre en la
misma máquina) se queda sin CPU. Subir runners no alcanza: el cuello es CPU, no
cantidad declarada.

## Piezas

| Pieza | Qué hace | Dónde |
|---|---|---|
| **Admisión por carriles** | 1 carril por PR; los de más esperan | `scripts/ci-lane.mjs`, job `changes` + `liberar` || **Kill switch** | Frena lo pesado sin tocar el repo | variable `CI_PAUSED` |
| **Cortacircuitos por carga** | No arranca pesado si el host está saturado | variable `CI_LOAD_MAX` |
| **Draft** | Un PR en borrador no corre lo pesado | `if` de los jobs pesados |
| **Timeouts** | Ningún job queda colgado para siempre | `timeout-minutes` en cada job |
| **Límite de CPU** | Cada runner no se come la máquina | `RUNNER_CPU_LIMIT` (`infra/runner/compose.yaml`) |
| **Integración protegida** | PR probado contra el `dokploy` actual | ruleset `dokploy-integracion-protegida` + `merge_group` |
| **Janitor** | Limpia locks y stacks CI abandonados | `scripts/limpiar-ci.mjs` |
| **Estado** | Foto de carriles, carga y runners | `scripts/estado-ci.mjs` |

## Sharding de la suite web

El job `web` es el 80 % del tiempo del CI y corre en 3 shards. El flag tiene que
llegar a vitest como **opción**, no como filtro de archivos:

```bash
pnpm --filter @platform/web exec vitest run --shard=N/3   # correcto
pnpm --filter @platform/web test -- --shard=N/3           # INCORRECTO
```

Con `--` en el medio, vitest interpreta `--shard=N/3` como un patrón posicional:
no matchea ningún archivo y **cada job corre la suite completa**. Eso triplica la
carga del pool, hace que todos los shards rocen el timeout y termina bloqueando
`validacion` en todos los PRs de épica (MSF-237, AGE-1049). Por eso el
`timeout-minutes` del job es sólo una red de seguridad: si los shards son reales,
cada uno termina muy por debajo.

## Activación

Las que son de GitHub se configuran como **variables de repo** (Settings →
Actions → Variables, o `gh variable set`):

```bash
gh variable set CI_LANES --body 5        # carriles = nº de runners (0/vacío = admisión apagada)
gh variable set CI_LOAD_MAX --body 1.2   # cortacircuitos: no arrancar si load > núcleos × factor (0 = off)
gh variable set CI_PAUSED --body true    # kill switch (borrar la variable para reactivar)
```

Las del host van en el `.env` del deploy de runners: `RUNNER_REPLICAS`,
`RUNNER_MEMORY_LIMIT`, `RUNNER_CPU_LIMIT` (ver `.env.example`). Subir
`RUNNER_REPLICAS` **sólo** después de tener CPU libre: con 12 vCPU y el load ya
alto, más réplicas reparten el mismo CPU.

### Semántica de la admisión

- **Carril normal:** el PR espera hasta `CI_LANE_WAIT_MIN` (15 min) por un carril.
- **Fail-open:** si se agota la espera (o el cortacircuitos ve el host cargado),
  el PR **sigue sin carril** y deja un aviso en el log. La admisión protege el
  caso normal sin bloquear la entrega bajo una avalancha sostenida.
- **TTL:** un carril de un job muerto se recicla a los `CI_LANE_TTL_MIN` (50 min).

## Runbook

- **El CI “no arranca” o tarda muchísimo:** `pnpm ci:estado` muestra carriles en
  uso, carga y runners ocupados. Si hay carriles tomados sin jobs, correr
  `pnpm ci:limpiar` (dry-run) y luego `pnpm ci:limpiar --aplicar`.
- **Frenar todo:** `gh variable set CI_PAUSED --body true` y, del lado del host,
  pausar el cron de migraciones. Para reactivar, borrar la variable.
- **La máquina está al límite:** bajar `RUNNER_REPLICAS` (recrear corta jobs:
  verificar que ninguno esté `busy`), o mover Claude a otra máquina.
- **Un stack de Supabase del CI quedó colgado:** el workflow **CI janitor**
  (`ci-janitor.yml`, cada 6 h o manual con `workflow_dispatch`) corre
  `pnpm ci:limpiar --aplicar` dentro de un runner: borra locks/carriles vencidos
  y stacks `supabase_*_ci-*` **detenidos** (nunca los que están `Up` ni
  dev/stg/prd). Para verlo antes de limpiar: `pnpm ci:limpiar` (dry-run).

## Integración protegida de `dokploy`

`dokploy` tiene un **ruleset activo** (`dokploy-integracion-protegida`) con:

- **Check requerido único: `validacion`** (job agregador que siempre corre y
  falla si `changes`, `application`, `web`, `infrastructure` o `database`
  fallaron o se cancelaron; los `skipped` cuentan como OK). Así un PR de docs
  (que saltea `web`/`database`) no queda bloqueado, pero un shard web rojo sí.
- **Rama al día** (`strict_required_status_checks_policy`): el PR se prueba
  contra el `dokploy` actual. Si `dokploy` avanzó, hay que actualizar la rama
  (`gh pr update-branch <n>`) y esperar la nueva corrida antes de mergear.
- **Bypass de admin** para emergencias. Con `CI_PAUSED=true`, `validacion`
  falla a propósito: mientras el CI está pausado no se mergea.

Esto reemplaza al merge queue: GitHub no expone `merge_queue` por API para este
repo (el ruleset lo rechaza), pero el workflow ya soporta `merge_group`, así que
si se habilita desde la UI/plan no hay que tocar nada.

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[] | "\(.id) \(.name) \(.enforcement)"'
gh api --method DELETE repos/<owner>/<repo>/rulesets/<id>   # desactivar
```

Consecuencia operativa: `gh pr merge --merge` puede fallar con *"head branch is
not up to date"*; en ese caso, actualizar la rama y reintentar. Es intencional:
evita el “verde en su rama, rojo al integrar”.
