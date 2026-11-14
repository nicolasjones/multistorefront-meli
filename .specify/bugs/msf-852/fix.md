# Bug Fix: E2E nocturno de MSF-852 — guarda del contrato y aterrizaje en `main`

- **Slug**: msf-852
- **Fixed**: 2026-11-14
- **Assessment**: ./assessment.md
- **Status**: partial — la implementación del job ya está mergeada en `dokploy` (PR #925); el cron sólo puede correr
  cuando el workflow esté en `main` (PR #928 / MSF-858). Esta rama entrega la guarda y la corrección de la
  documentación; no duplica el aterrizaje en `main`.

## Summary

El gate MSF-852 decidió un E2E nocturno sobre `dokploy` sin bloquear PRs. El job existe y está completo en `dokploy`
(PR #925), pero GitHub sólo dispara `schedule` y resuelve `workflow_dispatch`/la API en la rama por defecto (`main`),
donde el archivo no está: el cron nunca arrancó y un disparo manual contra `dokploy` responde 404. Esta rama no puede
llevar el archivo a `main` (su base es `dokploy` y ya hay un carve-out abierto, PR #928), así que entrega lo que sí
puede: una guarda barata que impide que el contrato del nocturno desaparezca en silencio y la documentación que
explica el requisito de `main`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/verificar-e2e-nocturno.mjs` | added | Guarda determinista: cron 05:00 UTC, `workflow_dispatch`, permisos de solo lectura, checkout de `dokploy`, Playwright en serie, stack Supabase + migraciones, sin `pull_request`, y docs con la sección y la ruta. |
| `scripts/verificar-e2e-nocturno.test.mjs` | added | 10 tests; cada invariante se muta y se exige que la guarda falle. |
| `package.json` | modified | `e2e:nocturno:check` y `test:e2e:nocturno`. |
| `.github/workflows/validate.yml` | modified | El job `application` corre la guarda y su test en cada PR (sin base). |
| `.github/workflows/e2e-nocturno.yml` | modified | Comentarios al día: TTL de 75 min (no 50), y que `schedule`/`workflow_dispatch`/API requieren el archivo en `main`. Sin cambios de comportamiento. |
| `docs/e2e-app.md` | modified | La sección «E2E nocturno» dice que el cron depende de `main`, cómo se dispara una vez ahí, y suma la guarda a la tabla del CI; se quitaron las referencias a #923 «todavía no mergeado». |
| `.specify/bugs/msf-852/` | added | assessment, fix y test de este bug. |

## Diff Highlights

La guarda verifica el contrato, no la prosa del workflow: `cron: '0 5 * * *'`, `workflow_dispatch`, `contents: read`,
`ref: ... 'dokploy'`, `playwright test ... --workers=1`, `supabase start` y `supabase migration up`, ausencia de
`pull_request`, y la sección + ruta en `docs/e2e-app.md`. Cada una de esas marcas tiene su test de mutación.

## Tests Added or Updated

- `scripts/verificar-e2e-nocturno.test.mjs` — el repo cumple; falla con cron cambiado, sin disparo manual, con
  `pull_request`, con permisos de escritura, sin `dokploy`, sin `--workers=1`, sin stack/migraciones, sin sección o
  ruta en docs, y si faltan los archivos.

## Local Verification

- `pnpm e2e:nocturno:check` → `E2E nocturno: contrato completo (...)`.
- `pnpm test:e2e:nocturno` → 10/10 en verde.
- `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` → OK (sin migraciones nuevas).
- Reproducción del defecto: `git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml` vacío; `gh run list
  --workflow=e2e-nocturno.yml` y `gh api .../dispatches` → 404.

## Deviations from Assessment

- No se duplicó PR #928 ni se creó un segundo workflow en `main`: el aterrizaje en `main` ya está preparado y verde
  ahí. El estado de este fix es `partial` hasta que #928 (o MSF-858) se mergee.
- La guarda no consulta la rama por defecto: en cada PR de `dokploy` `origin/main` todavía no tiene el archivo, así
  que esa comprobación pondría rojo todo el CI hasta el merge de #928. La guarda protege el contrato en la rama.

## Follow-ups

- Mergear PR #928 (workflow-only a `main`) o completar MSF-858; recién ahí el cron de las 05:00 UTC y
  `gh workflow run e2e-nocturno.yml` empiezan a funcionar.
- Primer disparo manual con un spec corto (`-f spec=acceso-publico`) antes de dejar correr el cron.
