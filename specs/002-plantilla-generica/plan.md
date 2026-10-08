# Implementation Plan: Plantilla genérica de producto de automatización

**Branch**: `002-plantilla-generica` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-plantilla-generica/spec.md`

## Summary

Renombrar el proyecto de `estudio-automation` a `automation-platform-template`
en todo el repo (código, infraestructura Docker, documentación, repo de
GitHub) y eliminar el lenguaje específico de "estudios contables", para que
el repo funcione como base reutilizable de futuros productos de
automatización multi-tenant. Enfoque técnico: reemplazo de texto dirigido
por archivo (no un script genérico de find-and-replace, porque cada archivo
tiene contexto propio — p. ej. la constitución necesita reescritura de
principios, no solo un cambio de nombre), ejecutado en commits incrementales
por grupo lógico según la clarificación de la spec.

## Technical Context

**Language/Version**: N/A — el trabajo es edición de archivos de
configuración (JSON/YAML), Markdown y un componente React existente
(`App.tsx`), no desarrollo de código nuevo.

**Primary Dependencies**: pnpm (workspaces), Docker Compose, GitHub CLI
(`gh`), Supabase CLI — todas ya presentes en el repo, sin dependencias
nuevas.

**Storage**: N/A — esta feature no toca datos ni esquema.

**Testing**: Los gates de validación ya existentes del repo (`pnpm lint`,
`pnpm build`, `pnpm test`, `pnpm infra:config`) actúan como prueba de que el
rename no rompió nada; no se agregan tests nuevos porque no hay lógica
nueva que probar, solo texto/nombres.

**Target Platform**: El mismo que ya tiene el repo — desarrollo local
(Windows, Docker Desktop), CI en runner self-hosted, despliegue futuro a
Vercel/Supabase Cloud/VPS.

**Project Type**: Monorepo existente (web + infra Docker + Spec Kit) — esta
feature no cambia la estructura, solo su identidad/nombre.

**Performance Goals**: N/A.

**Constraints**: Debe completarse sin romper ninguno de los gates de
validación existentes (SC-002), y el CI debe seguir corriendo en el runner
self-hosted sin pasar a `ubuntu-latest` (documentado, no se toca).

**Scale/Scope**: 14 archivos identificados por `Grep` + la constitución +
`CLAUDE.md`/`AGENTS.md` (2 archivos adicionales) + el repo de GitHub (ya
renombrado) + 3 réplicas del runner self-hosted a reconstruir.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I (hoy "Seguridad contable por diseño")**: esta feature
  **modifica el propio principio** como parte de su alcance (FR-002) — no es
  una violación, es el objetivo. Reescribirlo en términos de aislamiento
  multi-tenant genérico es compatible con la intención original (aislar
  datos por tenant), solo generaliza el lenguaje.
- **Principio II (Especificar antes de implementar)**: cumplido — esta
  misma spec es el artefacto que exige el principio.
- **Principio III (Automatizaciones idempotentes y auditables)**: no aplica
  directamente (no hay workflows/workers nuevos en esta feature).
- **Principio IV (Un monorepo, despliegues independientes)**: se actualiza
  la lista de proyectos Docker con los nombres nuevos (ya venía
  desactualizada antes de esta spec); no se toca la independencia de
  despliegue en sí.
- **Principio V (Simplicidad operativa)**: cumplido — no se agrega
  infraestructura nueva, solo se renombra la existente.
- **Governance**: el cambio a un principio (I) requiere bump de versión y
  fecha, ya contemplado en el plan de ejecución (1.2.1 → 1.3.0).

**Resultado**: PASS. No hay violaciones que requieran justificación en
Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-plantilla-generica/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md         # Fase 1 (N/A — se documenta por qué)
├── quickstart.md         # Fase 1
├── contracts/            # Fase 1 (N/A — se documenta por qué)
└── tasks.md              # Fase 2 (/speckit-tasks, no este comando)
```

### Source Code (repository root)

No aplica ninguna de las estructuras de opción del template (no es una
librería/CLI/web-service nuevo) — esta feature edita archivos ya existentes
en su lugar, sin crear una estructura de código nueva. Los archivos
afectados (ya relevados en la spec, FR-001 a FR-006):

```text
package.json, apps/web/package.json
infra/{refine,kestra,superset,playwright,runner}/compose.yaml
infra/refine/Dockerfile, infra/runner/entrypoint.sh
supabase/config.toml, supabase/tests/database/extensions.test.sql
scripts/deploy-vps.sh
docs/architecture.md, docs/deployment.md
README.md, apps/web/src/App.tsx
.github/workflows/validate.yml
.specify/memory/constitution.md
CLAUDE.md, AGENTS.md
```

**Structure Decision**: Edición dirigida por archivo, agrupada en 4 commits
incrementales (según la clarificación de la spec):
1. Paquetes (`package.json`, `apps/web/package.json`, `pnpm-lock.yaml` si
   cambia el nombre del workspace).
2. Infraestructura Docker (`infra/**`, `supabase/config.toml`,
   `scripts/deploy-vps.sh`).
3. Documentación y gobierno (`README.md`, `docs/**`, `App.tsx`,
   `constitution.md`, `CLAUDE.md`, `AGENTS.md`, `.github/workflows/validate.yml`).
4. Runner self-hosted: reconstrucción (`docker compose down && up -d --build`)
   y verificación en GitHub.

Cada grupo se valida (`pnpm infra:config` / `pnpm lint && build && test` /
lectura visual, según corresponda) antes de pasar al siguiente.

## Complexity Tracking

*Sin violaciones — sección no aplica.*
