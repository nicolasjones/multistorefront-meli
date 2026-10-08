# Implementation Plan: Runners locales que no saturan la red ni la memoria

**Branch**: `nicolasjones/optimizar-runners-locales` | **Date**: 2026-09-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/20260925-221701-optimizar-runners-locales/spec.md`

## Summary

Las réplicas del runner self-hosted comparten un store de pnpm en un volumen
Docker con nombre (`platform-runner-pnpm-store` por defecto, compartible entre
productos de la misma máquina), apuntado con `pnpm_config_store_dir` en el
entorno del contenedor para ganarle al `PNPM_HOME` que fija
`pnpm/action-setup`. El mismo entorno baja la concurrencia de descarga a 16 y
sube los reintentos a 5. `RUNNER_REPLICAS` y `RUNNER_MEMORY_LIMIT` se
interpolan en `infra/runner/compose.yaml`. Nada cambia en `validate.yml`. Se
publica como capacidad `local-ci-runners` 1.0.0 con guía de adopción. Detalle
y evidencia en [research.md](research.md).

## Technical Context

**Language/Version**: Docker Compose (spec Compose), pnpm 11.19.0, Node 24 en la imagen del runner (sin cambios de imagen)

**Primary Dependencies**: `actions/runner` 2.337.0, `pnpm/action-setup@v4`

**Storage**: volumen Docker local con nombre para el store de pnpm (índice SQLite WAL + archivos direccionados por contenido)

**Testing**: `pnpm infra:config`, `pnpm template:capabilities:check`, `pnpm test:template:adoption`, `pnpm docs:check`; validación real con dos corridas del CI del PR (log de pnpm `reused`/`downloaded`, duración del step, tamaño del volumen)

**Target Platform**: Docker Desktop (WSL2) en Windows y Docker en Linux nativo, un único host

**Project Type**: infraestructura de CI de plataforma

**Performance Goals**: 0 paquetes descargados con el store caliente y el mismo lockfile; instalación más rápida que en frío

**Constraints**: sin cachés remotas de GitHub Actions; no recrear runners con jobs en curso; no tocar los runners del producto derivado

**Scale/Scope**: 3 réplicas por repo por defecto, 2 repos en la máquina hoy

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Nota |
|-----------|--------|------|
| I. Aislamiento multi-tenant | N/A | No toca datos ni RLS. Sin secretos nuevos: las variables nuevas no son sensibles y van a `.env.example`. |
| II. Especificar antes de implementar | OK | Esta spec, con aclaraciones y research. |
| III. Idempotencia y auditoría | OK | Un store direccionado por contenido es idempotente; reinstalar no duplica nada. |
| IV. Despliegues independientes | OK | Sigue siendo el proyecto Compose `automation-platform-template-runner-dev`; el volumen compartido es un recurso externo al proyecto, no un Compose raíz. |
| V. Simplicidad operativa | OK | Solo configuración Compose y variables; sin servicios nuevos (se descartó un proxy/registro local tipo Verdaccio). |
| VI. Panel operable | N/A | Sin UI. |
| VII. Documentación | OK | `docs/deployment.md`, `docs/ci-self-hosted-storage.md`, guía de adopción nueva, esta spec. |
| Quality gates | OK | `pnpm infra:config` + checks del catálogo; sin migraciones. |

Re-check post-diseño: sin cambios; no hay excepciones que registrar.

## Project Structure

### Documentation (this feature)

```text
specs/20260925-221701-optimizar-runners-locales/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── variables-runner.md
└── tasks.md
```

### Source Code (repository root)

```text
infra/runner/compose.yaml          # réplicas, tope de memoria, volumen del store, entorno de pnpm
.env.example                       # RUNNER_REPLICAS, RUNNER_MEMORY_LIMIT, RUNNER_PNPM_*
template-capabilities.json         # capacidad local-ci-runners 1.0.0
template-adoption.json             # el template la declara adoptada
docs/deployment.md                 # operación del runner: store, réplicas, topes, mantenimiento
docs/ci-self-hosted-storage.md     # dónde vive el store ahora
docs/adoptar-runners-locales.md    # pasos de adopción para productos derivados
docs/roadmap-template.md           # al cierre (merge), no en esta rama
```

**Structure Decision**: todo el cambio vive en `infra/runner/compose.yaml`; la
imagen (`Dockerfile`) y el `entrypoint.mjs` no cambian, así que los productos
derivados adoptan con un merge de un solo archivo de infraestructura.

`pnpm dev:down:runner` no pasa `--env-file .env`; con las nuevas
interpolaciones con default sigue funcionando (el `down` no necesita los
valores), pero se agrega `--env-file .env` por consistencia.

## Complexity Tracking

Sin violaciones de la constitución que justificar.
