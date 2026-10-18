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
| **Admisión por carriles** | 1 carril por PR; los de más esperan | `scripts/ci-lane.mjs`, job `changes` + `liberar` |
| **Kill switch** | Frena lo pesado sin tocar el repo | variable `CI_PAUSED` |
| **Cortacircuitos por carga** | No arranca pesado si el host está saturado | variable `CI_LOAD_MAX` |
| **Draft** | Un PR en borrador no corre lo pesado | `if` de los jobs pesados |
| **Timeouts** | Ningún job queda colgado para siempre | `timeout-minutes` en cada job |
| **Límite de CPU** | Cada runner no se come la máquina | `RUNNER_CPU_LIMIT` (`infra/runner/compose.yaml`) |
| **Merge queue** | Integra contra el base actualizado | disparador `merge_group` + ruleset |
| **Janitor** | Limpia locks y stacks CI abandonados | `scripts/limpiar-ci.mjs` |
| **Estado** | Foto de carriles, carga y runners | `scripts/estado-ci.mjs` |

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

## Runbook

- **El CI “no arranca” o tarda muchísimo:** `pnpm ci:estado` muestra carriles en
  uso, carga y runners ocupados. Si hay carriles tomados sin jobs, correr
  `pnpm ci:limpiar` (dry-run) y luego `pnpm ci:limpiar --aplicar`.
- **Frenar todo:** `gh variable set CI_PAUSED --body true` y, del lado del host,
  pausar el cron de migraciones. Para reactivar, borrar la variable.
- **La máquina está al límite:** bajar `RUNNER_REPLICAS` (recrear corta jobs:
  verificar que ninguno esté `busy`), o mover Claude a otra máquina.
- **Un stack de Supabase del CI quedó colgado:** `pnpm ci:limpiar --aplicar`
  borra contenedores `supabase_*_ci-*` abandonados (nunca dev/stg/prd).

## Merge queue

`dokploy` se integra con **merge queue**: el PR se prueba sobre el base ya
actualizado (`merge_group`), así “verde en su rama” ⇒ “verde integrado”. Requiere
un ruleset de rama con `merge_queue` + checks requeridos. Ver
`docs/deployment.md` para el comando de activación.
