---
owner: tecnico
sources:
  - release-please-config.json
  - .release-please-manifest.json
  - .github/workflows/release-please.yml
  - .github/workflows/quality.yml
  - .specify/bugs/msf-784/fix.md
---

# Release automático (F4)

A partir de los **commits conventional** en `main`, **release-please** mantiene un **PR de release** que:
- sube la versión en `package.json` (SemVer),
- actualiza `CHANGELOG.md`,
- al mergearlo, crea el **tag** y el **GitHub Release**.

Config: `release-please-config.json` + `.release-please-manifest.json` · workflow `.github/workflows/release-please.yml`.

## Requisito
Los commits deben ser **conventional** (`feat:`, `fix:`, `perf:`, …) — lo valida **commitlint** en el job
`quality` (ver `docs/calidad.md`). Sin eso, no hay changelog ni versión automática.

## Qué queda afuera (a definir)
- **Preview envs por PR** (Dokploy).
- **Feature flags** (Unleash) para desacoplar deploy de release.

## Detección de deploy a DEV (MSF-784)

La fuente de verdad de «desplegado en DEV» es el **merge commit presente en la rama base** (`dokploy`), no la existencia de la rama head ni de un PR abierto. GitHub borra la rama head al mergear, así que `git merge-base --is-ancestor origin/<head> origin/<base>` falla siempre en un PR ya MERGED y producía un falso «no se pudo crear/encontrar el PR» (`Deploy Failed`) sobre cambios ya en DEV (caso MSF-588, PR #623). El detector debe leer `mergeCommit.oid` del PR MERGED y comprobar que es ancestro de la base. La implementación vive en `ai-dev-orchestrator`; detalle en `.specify/bugs/msf-784/fix.md`.

> Lote 99 (MSF-703/704): los workflows eligen su pool de runners por variable de repo (`CI_RUNS_ON_PR`, `CI_RUNS_ON_PESADO`, `CI_RUNS_ON_DEPLOY`), los binarios descargados (gitleaks, Supabase CLI) se instalan en `$RUNNER_TEMP/bin` con SHA256 verificado y release-please y el gate de staging abren un issue `alerta-ci` si fallan. Detalle y runbook: [endurecimiento-infra.md](endurecimiento-infra.md).
