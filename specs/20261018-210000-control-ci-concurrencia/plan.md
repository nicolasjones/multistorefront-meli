# Plan de implementación · Control de concurrencia del CI

**Spec**: `specs/20261018-210000-control-ci-concurrencia/spec.md`
**Alcance**: workers (infra de CI)
**Rama**: `infra/control-ci-concurrencia` → PR contra `dokploy`

## Contexto técnico

- Pool **fijo** de runners (`infra/runner/compose.yaml`, `RUNNER_REPLICAS`); sin
  autoscaling. Host compartido con Claude y otros productos.
- `scripts/supabase-ci.mjs` ya resuelve “N ranuras con `mkdir` atómico + TTL” →
  se reutiliza el patrón para carriles.
- `validate.yml`: `concurrency` por ref con `cancel-in-progress`; job `changes`
  clasifica el diff; jobs pesados `application`/`web`/`database`.

## Principios aplicados

- **I (aislamiento)**: el janitor sólo toca artefactos del CI (`ci-`), nunca
  dev/stg/prd.
- **III (auditable)**: todo versionado; las variables de GitHub quedan
  documentadas con su valor recomendado.
- **VI (panel operable)**: `estado-ci.mjs` da la foto operativa.

## Fases

### Fase 1 · Admisión (carriles)

1. `scripts/ci-lane.mjs` (`reclamar`/`liberar`/`estado`) con `intentarCarriles`
   puro, TTL y cortacircuitos por carga.
2. `scripts/ci-lane.test.mjs`.

### Fase 2 · Workflow

3. `validate.yml`: `merge_group`, `timeout-minutes`, draft, kill switch, carril
   en `changes` + job `liberar`, `pnpm test:ci` en `infrastructure`.

### Fase 3 · Recursos y limpieza

4. `infra/runner/compose.yaml` (`RUNNER_CPU_LIMIT`) y `.env.example`.
5. `scripts/estado-ci.mjs` y `scripts/limpiar-ci.mjs` (+ tests).

### Fase 4 · Documentación y cierre

6. `docs/control-ci.md`, `docs/deployment.md`, `package.json` (`ci:estado`,
   `ci:limpiar`, `test:ci`), spec y tasks.
7. Gates y PR.

## Verificación

- `node --test scripts/ci-lane.test.mjs scripts/estado-ci.test.mjs scripts/limpiar-ci.test.mjs`
- YAML válido + `pnpm infra:config`
- Corrida real del PR.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El carril traba el CI si no se libera | TTL (50 min) + job `liberar` con `if: always()` |
| Un YAML roto bloquea los merges | YAML validado; admisión apagada por defecto (`CI_LANES` vacío) |
| El límite de CPU alarga los jobs | `RUNNER_CPU_LIMIT` configurable; se ajusta con datos de `estado-ci` |
| El janitor borra algo que no debe | dry-run por defecto + prefijo `ci-` estricto |
