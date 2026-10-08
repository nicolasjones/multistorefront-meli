---

description: "Tareas: runners locales que no saturan la red ni la memoria"
---

# Tasks: Runners locales que no saturan la red ni la memoria

**Input**: `specs/20260925-221701-optimizar-runners-locales/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: no hay tests automatizados nuevos (es configuración Compose); la
validación es `pnpm infra:config`, los checks del catálogo y dos corridas
reales del CI del PR.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Registrar la línea base: log de `pnpm install` (reused/downloaded, duración) de la primera corrida de Validate del PR con los runners viejos y pico de memoria por réplica en `specs/20260925-221701-optimizar-runners-locales/research.md` (R5)

  - Línea base (corrida 36207983612, runners viejos): application y database con `reused 0, downloaded 316`, 4 min 12 s y 4 min 14 s; `@supabase/cli-linux-x64` falló por timeout en ambos; database cayó por red bajando la CLI de Supabase de GitHub (fuera de alcance). Pico de memoria 1502 MiB (research R5).

**Checkpoint**: línea base registrada.

---

## Phase 2: User Story 1 - Una dependencia se descarga una sola vez por máquina (P1) 🎯 MVP

**Goal**: todas las réplicas (y otros productos) usan un único store persistente.

**Independent Test**: dos corridas del CI con el mismo lockfile; la segunda muestra `downloaded 0`.

- [X] T002 [US1] Declarar el volumen `${RUNNER_PNPM_STORE_VOLUME:-platform-runner-pnpm-store}` montado en `/pnpm` con `pnpm_config_store_dir=/pnpm/store` en `infra/runner/compose.yaml`, con comentario sobre por qué gana a `PNPM_HOME` y por qué es seguro compartirlo
- [X] T003 [P] [US1] Agregar `RUNNER_PNPM_STORE_VOLUME` a `.env.example` junto a `GH_RUNNER_PAT`
- [X] T004 [P] [US1] Documentar el store compartido (ubicación, seguridad concurrente, límites: volumen local, `prune` solo sin jobs; tamaño y limpieza) en `docs/deployment.md` y actualizar `docs/ci-self-hosted-storage.md`

  - Desvío: además del store se comparte el cache dir (`/pnpm/cache`) y se sube `fetch-timeout` a 10 min; hallado en la prueba de concurrencia (research R2b, R2c, R4b; FR-012).

**Checkpoint**: `pnpm infra:config` pasa; US1 lista para validar en T013.

---

## Phase 3: User Story 2 - Réplicas configurables (P2)

**Goal**: `RUNNER_REPLICAS` con default 3.

**Independent Test**: `RUNNER_REPLICAS=1 docker compose -f infra/runner/compose.yaml config` muestra `replicas: 1`; sin variable, 3.

- [X] T005 [US2] Interpolar `deploy.replicas: ${RUNNER_REPLICAS:-3}` en `infra/runner/compose.yaml`
- [X] T006 [P] [US2] Agregar `RUNNER_REPLICAS` a `.env.example` y documentar en `docs/deployment.md` cuándo bajarla (agentes activos, memoria, red), el efecto (jobs en cola, en serie) y el uso de `0`
- [X] T007 [P] [US2] Pasar `--env-file .env` también en `dev:down:runner` de `package.json`

**Checkpoint**: interpolación verificada con 0, 1, sin valor y valor inválido.

---

## Phase 4: User Story 3 - Contener red y memoria por runner (P3)

**Goal**: tope de memoria medido y descargas limitadas con reintentos.

**Independent Test**: `docker inspect` muestra el tope; `env` del contenedor muestra `pnpm_config_network_concurrency` y `pnpm_config_fetch_retries`; el CI completo pasa.

- [X] T008 [US3] Fijar el default de `RUNNER_MEMORY_LIMIT` a partir de la medición de T001 (pico + ~50 %, redondeado a GiB) en `infra/runner/compose.yaml` (`deploy.resources.limits.memory`) y completar la tabla de R5 en `research.md`
- [X] T009 [US3] Agregar `pnpm_config_network_concurrency: ${RUNNER_PNPM_NETWORK_CONCURRENCY:-16}` y `pnpm_config_fetch_retries: 5` al entorno en `infra/runner/compose.yaml`
- [X] T010 [P] [US3] Agregar `RUNNER_MEMORY_LIMIT` y `RUNNER_PNPM_NETWORK_CONCURRENCY` a `.env.example` y documentar topes y concurrencia en `docs/deployment.md`

**Checkpoint**: `pnpm infra:config` pasa.

---

## Phase 5: User Story 4 - Adopción en productos derivados (P3)

**Goal**: capacidad versionada con guía de adopción.

**Independent Test**: `pnpm template:capabilities:check` y `pnpm test:template:adoption` pasan; la guía cubre verificación de runners ocupados y reversión.

- [X] T011 [US4] Publicar `local-ci-runners` 1.0.0 (ruta `infra/runner/compose.yaml`) en `template-capabilities.json` y declararla `adopted` en `template-adoption.json`
- [X] T012 [P] [US4] Escribir `docs/adoptar-runners-locales.md` (qué cambia, merge del compose conservando `name`/`RUNNER_REPO`/`RUNNER_NAME` del producto, verificación de `busy` con `gh api`, recreación, validación y reversión) y enlazarla desde `docs/adoptar-capacidades-template.md` y `docs/crear-producto-derivado.md`

**Checkpoint**: catálogo válido.

---

## Phase 6: Validación real y cierre de rama

- [X] T013 Verificar con `gh api repos/Agenmatica/automation-platform-template/actions/runners` que ningún runner del template esté `busy`, recrear solo los del template con `pnpm dev:runner` y comprobar entorno, tope y volumen (quickstart §2–3)
- [X] T014 Correr el CI del PR dos veces (push + `gh run rerun`) y registrar en este archivo reused/downloaded, duración del install y tamaño del store de ambas corridas (SC-001, SC-002, SC-005)
- [X] T015 Correr `pnpm infra:config`, `pnpm docs:check`, `pnpm template:capabilities:check --base origin/main` y `pnpm test:template:adoption`

### Evidencia (2026-09-25)

- T013: ningún runner `busy` antes de recrear; recreados solo los tres del
  template (los de `estudio-contable-automation` siguieron "Up 14 hours").
  Cada réplica: `HostConfig.Memory=3221225472`, las cinco `pnpm_config_*`
  del contrato y el volumen `platform-runner-pnpm-store` montado en `/pnpm`.
- T014, Validate 36212025312 del commit d8e364f:

| Corrida | Job | Resultado de `pnpm install` | Duración |
|---------|-----|-------------------------------|----------|
| Base (runners viejos, 36207983612) | application | `reused 0, downloaded 316`, binario de Supabase falló por timeout | 4 min 12 s |
| Base | database | `reused 0, downloaded 316`, ídem | 4 min 14 s |
| 1 (store vacío) | application | `reused 0, downloaded 317` | 6 min 28 s |
| 1 | database | `reused 45, downloaded 272` (en paralelo con application) | 9 min 30 s |
| 2 (re-run) | application | `reused 317, downloaded 0`, lockfile "verified 11m ago" | 12,8 s |
| 2 | database | `reused 317, downloaded 0`, ídem | 10,6 s |

  La red de esa noche iba a 10–50 KiB/s (pnpm avisó velocidades bajas), de ahí
  los tiempos en frío mayores que la base. Volumen tras la corrida 1: store
  452,7 MB + caché 102 MB; tras la corrida 2: igual (0 bytes nuevos). Las dos
  corridas pasaron completas con el tope de 3 GiB (SC-001, SC-002, SC-005).
- T015: todos OK.

### Seguimiento fuera de alcance

- `actions/setup-node` baja Node a `_work/_tool` de cada réplica; tras recrear,
  la primera vez tarda ~5 min por réplica con esta red. Compartir el tool
  cache necesita analizar su concurrencia aparte.
- El job `database` baja la CLI de Supabase de GitHub en cada corrida; la
  corrida base falló ahí por red (`SSL_ERROR_SYSCALL`).

## Dependencies

- T001 antes de T008 (el default sale de la medición).
- T002, T005, T008, T009 tocan el mismo archivo: en serie.
- T013 después de todas las fases de implementación; T014 después de T013.
- US1, US2 y US3 son independientes entre sí salvo por el archivo compartido; US4 depende de que exista el compose final.

## Parallel Example

```text
T003, T004 (US1) en paralelo con T006, T007 (US2) y T010 (US3): archivos distintos.
```

## Implementation Strategy

MVP = US1 (store compartido): elimina las descargas repetidas, que son la
causa de los CI caídos. US2/US3 agregan palancas de operación; US4 publica.
Como todo converge en un único `compose.yaml`, los runners se recrean una sola
vez (T013) con todos los cambios, para cortar jobs lo menos posible.
