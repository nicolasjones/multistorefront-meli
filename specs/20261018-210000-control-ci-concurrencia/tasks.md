# Tareas · Control de concurrencia del CI

**Spec**: `specs/20261018-210000-control-ci-concurrencia/spec.md`
**Plan**: `specs/20261018-210000-control-ci-concurrencia/plan.md`
**Rama**: `infra/control-ci-concurrencia` → PR contra `dokploy`
**Estado**: todas las tareas cerradas con evidencia.

## Fase 1 · Admisión (carriles)

- [x] **T001** `scripts/ci-lane.mjs`: reserva atómica de carriles (`mkdir` + TTL),
  `reclamar`/`liberar`/`estado`, cortacircuitos por carga (`CI_LOAD_MAX`).
  **Evidencia:** `scripts/ci-lane.test.mjs`.
- [x] **T002** `scripts/ci-lane.test.mjs`: toma hasta N, recicla vencidos, no
  recicla vivos, admisión apagada con 0, cortacircuitos.
  **Evidencia:** `node --test scripts/ci-lane.test.mjs`.

**Checkpoint 1**: la admisión reserva/libera carriles y frena por carga. ✅

## Fase 2 · Workflow

- [x] **T003** `.github/workflows/validate.yml`: disparador `merge_group`,
  `timeout-minutes` en todos los jobs, draft, kill switch (`CI_PAUSED`), carril en
  `changes` + job `liberar`, `pnpm test:ci` en `infrastructure`.
  **Evidencia:** YAML válido; corrida real del PR.

**Checkpoint 2**: el CI admite, corta por carga y corre en la cola de merge. ✅

## Fase 3 · Recursos y limpieza

- [x] **T004** `infra/runner/compose.yaml` (`cpus: RUNNER_CPU_LIMIT`) y
  `.env.example` (`RUNNER_CPU_LIMIT=2`).
  **Evidencia:** `pnpm infra:config`.
- [x] **T005** `scripts/estado-ci.mjs` y `scripts/limpiar-ci.mjs` (+ tests).
  **Evidencia:** `scripts/estado-ci.test.mjs`, `scripts/limpiar-ci.test.mjs`.

**Checkpoint 3**: hay tope de CPU, foto de estado y limpieza segura. ✅

## Fase 4 · Documentación y cierre

- [x] **T006** `docs/control-ci.md` (activación + runbook), `docs/deployment.md`,
  `package.json` (`ci:estado`, `ci:limpiar`, `test:ci`).
  **Evidencia:** `pnpm docs:check`.
- [x] **T007** Gates y PR contra `dokploy`.
  **Evidencia:** PR #159 (https://github.com/nicolasjones/multistorefront-meli/pull/159).
- [x] **T008** Job `validacion` (agregador único requerido) + ruleset
  `dokploy-integracion-protegida` (rama al día, bypass admin). El merge queue no
  está disponible por API para el repo; el workflow queda con `merge_group` listo.
  **Evidencia:** PR #160 (https://github.com/nicolasjones/multistorefront-meli/pull/160);
  ruleset `25358247`.

## Verificaciones (salida resumida)

| Comando | Resultado |
|---|---|
| `node --test scripts/ci-lane.test.mjs scripts/estado-ci.test.mjs scripts/limpiar-ci.test.mjs` | OK |
| YAML de `validate.yml` | válido |
| `pnpm infra:config` | OK |
| `pnpm docs:check` | OK |
