# Fix: MSF-784

- Sin cambio de código: el detector está en `ai-dev-orchestrator`, fuera de este repo y de este circuito. No se fuerza (ver instrucción del CEO, punto 2).
- `docs/release.md`: se deja escrita la regla (merge commit en la base = fuente de verdad) y el cambio concreto para el orquestador.
- Desvío: implementación y test de regresión pendientes en `ai-dev-orchestrator`; se escala a Nicolás con el detalle de abajo.

## Cambio propuesto para `ai-dev-orchestrator`
1. Con PR MERGED, tomar `mergeCommit.oid` (`gh pr view <n> --json state,mergeCommit`) y verificar `git merge-base --is-ancestor <oid> origin/<base>` (o `compare base...oid` → `ahead_by 0`). Si es ancestro → DEV desplegado.
2. Sin PR abierto, buscar también PRs `--state merged --head <rama>` antes de concluir «no se pudo crear/encontrar el PR».
3. No usar `origin/<head>` si la rama fue borrada (404 en `git/ref/heads/<head>`).
