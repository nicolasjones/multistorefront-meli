# Bug Verification: tope de ramas con CI en vuelo (`CI_RANAS_MAXIMAS`)

- **Slug**: msf-903
- **Tested**: 2026-11-20
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

La documentación y el manifest quedan consistentes con el estado real del repo (15 carriles, 5 runners self-hosted
online, jobs pesados en hosted). El cambio de la variable en el `.env` de VPS2 es una acción en el servidor: no se
puede ejecutar ni verificar desde este worktree, y queda para Nicolás. No hay test de código que agregar (cambio
documental).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (cifras) | `gh variable list` | pass | `CI_LANES=15`, `CI_LOAD_MAX=2.5`, `CI_RUNS_ON_PESADO=["ubuntu-latest"]` (2026-11-20). |
| Reproducción (runners) | `gh api repos/:owner/:repo/actions/runners --jq '.runners[]'` | pass | 5 runners `online`, ninguno `busy`. |
| Estado del `.env` | `grep -n CI_RANAS_MAXIMAS /opt/ai-dev-orchestrator/.env.example packages/core/ci.js` | pass | La variable no está en el `.env.example`; el default 2 sale de `RAMAS_CI_MAXIMAS_POR_DEFECTO` (`ci.js:24`). |
| Documentación | `pnpm docs:check` | pass | Documentación de cambios, migraciones y trampas conocidas OK. |
| Manifest | `pnpm docs:manifest` + `git diff` | pass | Sólo cambian `pageHash`/`sourceAt`/`commit` de `docs/control-ci.md`; `sourceAt` = commit del fix. |
| Cambio en VPS2 | `CI_RANAS_MAXIMAS=4` + reinicio | not-run | Acción en el servidor (Nicolás); fuera de este worktree. |

## Output Excerpts

```
$ gh variable list
CI_LANES	15	2026-11-15T13:49:08Z
CI_LOAD_MAX	2.5	2026-11-03T13:32:05Z
CI_RUNS_ON_PESADO	["ubuntu-latest"]	2026-11-15T00:45:04Z
```

```
$ pnpm docs:check
Documentación de cambios: OK
Migraciones OK: 771 archivo(s), 0 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK
```

## Residual Risks

- Hasta que se aplique `CI_RANAS_MAXIMAS=4` en `/opt/ai-dev-orchestrator/.env` y se reinicie `ai-dev-gateway`, el
  poller sigue frenando con «límite 2».
- El modelo de capacidad del orquestador sigue contando sólo runners self-hosted; con los jobs pesados en hosted, el
  valor 4 es una decisión conservadora (5 − 1 de holgura), no una medida exacta de la capacidad.

## Recommendation

Cerrar el cambio de documentación cuando el CI del PR esté verde y ejecutar en VPS2 la acción del runbook
(`CI_RANAS_MAXIMAS=4` + `systemctl restart ai-dev-gateway`); después, verificar que el poller admita 4 ramas en vuelo.
