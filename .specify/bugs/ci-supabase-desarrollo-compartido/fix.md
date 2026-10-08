# Bug Fix: el job `database` del CI resetea el Supabase de desarrollo

- **Slug**: ci-supabase-desarrollo-compartido
- **Fixed**: 2026-09-25
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El CI levanta un stack de Supabase propio (`ci-<repo>`, puertos `20000 + p %
10000`) en un workdir generado. El reset y los pgTAP pasan por una guarda que
aborta si el destino no es ese stack. Ya no queda ningún default a 5434.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/supabase-ci.mjs` | added | `preparar` (workdir `.supabase-ci/` + `$GITHUB_ENV`) y `verificar` (guarda por project_id, puerto y contenedor que publica el puerto) |
| `scripts/supabase-ci.test.mjs` | added test | derivación, reescritura de config y guarda |
| `scripts/reset-db-ci.mjs` | modified | guarda antes del `drop`; sin default de puerto; también dropea `dominio` |
| `package.json` | modified | `db:ci:preparar`; `test:db:ci` con guarda y sin `:-5434`; `test:tooling` incluye los tests nuevos |
| `.github/workflows/validate.yml` | modified | job `database`: `concurrency` por repo, tests de la guarda, `preparar`, `start --workdir … -x …` |
| `.gitignore` | modified | `.supabase-ci/` |
| `template-capabilities.json` | modified | nueva `isolated-ci-database` 1.0.0; `portable-typescript-tooling` 1.0.1 |
| `template-adoption.json` | modified | registra ambas versiones en el propio template |
| `docs/deployment.md` | modified | sección "Stack de Supabase propio del CI" |
| `docs/adoptar-ci-base-aislada.md` | added | adopción en productos derivados (estudio-contable-automation: 6434 → CI 26434) |

## Tests Added or Updated

- `scripts/supabase-ci.test.mjs` — 10 casos: project_id `ci-automation-platform-template` / base 25434;
  el template y el producto (dev 6434) no chocan en CI ni con desarrollo;
  recorte a 40 caracteres; `configCi` reescribe puertos y desactiva
  migraciones/seed; la guarda rechaza el puerto 5434, el 6434, el project_id de
  desarrollo, un contenedor ajeno, un puerto sin publicar y la falta de variables.

## Local Verification

- `node --test scripts/supabase-ci.test.mjs` → 10/10 OK.
- `pnpm db:ci:preparar` (con `GITHUB_REPOSITORY`) → `config.toml` generado:
  sólo cambian `project_id`, los 8 puertos y los dos `enabled` de migraciones y seed.
- Guarda contra el Docker real: `SUPABASE_DB_PORT=5434 … verificar` → aborta
  ("no es el de la base del CI"); `SUPABASE_DB_PORT=25434 … node
  scripts/reset-db-ci.mjs` sin stack de CI → aborta antes de conectar.
- `pnpm test:template:adoption`, `pnpm template:capabilities:check --base
  origin/main`, `pnpm docs:check`, `pnpm template:adoption:check`, `pnpm lint`
  → OK (lint: sólo warnings preexistentes).

## Deviations from Assessment

- También se registró la capacidad en `template-adoption.json` del propio
  template: `template:adoption:check` lo exige.
- Se descartó un script `db:ci:down` con el project_id fijo, porque cada
  producto tendría que editarlo. La limpieza manual queda documentada.
- La mitigación de riesgo del assessment (desactivar migraciones y seed del
  `start`) no alcanzó. En la primera corrida real (run 36170610204),
  `supabase start` falló con `dial error (connect ECONNREFUSED
  127.0.0.1:25434)`: el CLI se conecta a la base por 127.0.0.1 igual. Se
  agregó `scripts/supabase-ci.mjs puente`, un reenvío TCP efímero de sólo ese
  puerto hacia `host.docker.internal`, activo durante el `start`.
- Durante la evaluación se abrió el PR con el CI anterior todavía activo. La
  corrida se canceló antes del reset (`db:reset:ci` = skipped, run
  36170074195), así que 5434 no se tocó.

## Follow-ups

- Adopción en estudio-contable-automation (`docs/adoptar-ci-base-aislada.md`):
  hasta entonces, su CI sigue reseteando la base de desarrollo del template.
- Si se cambia `supabase/config.toml`, bajar el stack del CI a mano
  (`supabase stop --project-id ci-<repo> --no-backup`).
