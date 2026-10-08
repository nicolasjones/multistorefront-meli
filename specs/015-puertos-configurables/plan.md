# Implementation Plan: Puertos de Desarrollo Local Configurables

**Branch**: `015-puertos-configurables` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-puertos-configurables/spec.md`

## Summary

Sacar los puertos de desarrollo local del template de donde hoy están repetidos como
literales (`infra/*/compose.yaml`, `apps/web/vite.config.ts`,
`infra/superset/superset_config.py`, `infra/refine/Dockerfile`, `.env.example` en la
raíz y en `apps/web/`) y hacerlos configurables por variable de entorno con el mismo
valor por defecto que usa el template hoy, para que un producto derivado pueda
correr en paralelo con el template en la misma máquina cambiando solo esas
variables. `supabase/config.toml` queda como única excepción documentada — el CLI
de Supabase no admite `env()` en campos enteros (puertos), confirmado en
[supabase/cli#1551](https://github.com/supabase/cli/issues/1551) — con comentarios
explícitos junto a cada puerto y URL de redirect indicando qué variable del resto
del stack debe mantenerse alineada a mano.

## Technical Context

**Language/Version**: N/A — no se agrega código de aplicación. Se editan archivos de
configuración ya existentes en sus formatos actuales: YAML (Compose), TypeScript
(`vite.config.ts`), Python (`superset_config.py`), Dockerfile, TOML
(`supabase/config.toml`, solo comentarios) y `.env`.

**Primary Dependencies**: Ninguna nueva. Usa mecanismos ya soportados por las
herramientas vigentes: interpolación de variables de Docker Compose
(`${VAR:-default}`), lectura de `process.env` en `vite.config.ts` (Vite carga
`.env`/`.env.local` de forma nativa), `os.environ.get` en `superset_config.py`
(patrón que el archivo ya usa para `REFINE_ORIGIN`), y `ARG`/`ENV` de Docker para
`infra/refine/Dockerfile`.

**Storage**: N/A

**Testing**: `pnpm infra:config` (valida los 5 `compose.yaml`), `pnpm lint`,
`pnpm build`; validación manual documentada en `quickstart.md` — levantar dos
copias del repositorio con valores de puerto distintos en su `.env` y confirmar
que ambos stacks arrancan sin conflicto.

**Target Platform**: Desarrollo local (Docker Desktop + Supabase CLI) en la
máquina de quien desarrolla. No afecta despliegues a VPS (cada producto derivado
ya tiene su propio VPS aislado — Constitución, Principio V) salvo por consistencia
en `infra/playwright/compose.vps.yaml`, que sí mapea un puerto local.

**Project Type**: Configuración de infraestructura del template — no aplica
ninguna de las estructuras de proyecto de código (single/web/mobile). No se crea
ningún directorio ni servicio nuevo.

**Performance Goals**: N/A

**Constraints**: El comportamiento sin `.env` configurado debe ser idéntico al
actual (FR-009 — cero regresión). `supabase/config.toml` no admite variables en
sus campos de puerto ni en `additional_redirect_urls` (son arrays de strings
literales, no campos individuales `env()`-ables) — excepción documentada por
FR-006.

**Scale/Scope**: 5 `compose.yaml` + 1 `compose.vps.yaml` (Playwright) +
`vite.config.ts` + `superset_config.py` + `Dockerfile` (Refine) + 3 `.env.example`
(raíz, `apps/web/`, `supabase/functions/`) + comentarios en
`supabase/config.toml`. Ninguna migración, ninguna dependencia nueva.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación |
|---|---|
| I. Aislamiento multi-tenant por diseño | N/A — no toca RLS, tablas expuestas ni claves. |
| II. Especificar antes de implementar | Cumplido — esta es la spec (`spec.md`, sin `[NEEDS CLARIFICATION]` pendientes) que precede a cualquier cambio de configuración. |
| III. Automatizaciones idempotentes y auditables | N/A — no es un workflow ni un worker; es configuración de arranque de servicios. |
| IV. Un monorepo, despliegues independientes | Cumplido — no cambia los nombres de proyecto Compose que la Constitución documenta literalmente (`automation-platform-template-<producto>-dev`); esos son de identidad del producto, no de puerto, y quedan fuera de este alcance (ver Assumptions de la spec). Cada producto sigue con su propio Compose, sin Compose raíz. |
| V. Simplicidad operativa | Cumplido — no agrega infraestructura nueva; hace configurable infraestructura que ya existe, motivado por un caso de uso concreto y ya verificado (el primer producto derivado). |

**Technology and Quality Gates**: aplica `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test` sin cambios de alcance. No hay migraciones de Supabase en esta feature. Las variables nuevas quedan documentadas en `.env.example` (FR-007), cumpliendo el requisito de documentar variables nuevas.

**Delivery Workflow**: cumplido — rama `015-puertos-configurables` y PR #28 abiertos contra `main` desde la creación de la spec.

Resultado: **PASS**, sin excepciones que justificar en Complexity Tracking.

**Re-chequeo post-diseño (tras Fase 1)**: `data-model.md` y
`contracts/variables-puerto.md` confirman que no hay entidades de datos
(sin migraciones, Principio I sigue N/A) y que la excepción de
`supabase/config.toml` queda trazable variable por variable (Principio V,
sin infraestructura oculta). `quickstart.md` agrega un paso 4 explícito para
volver a probar el bug real que motivó la spec (redirects de Auth y CORS de
Superset con puerto no-default) — no estaba en el plan original, se agregó
al diseñar el quickstart. Ningún hallazgo de Fase 1 cambia la evaluación:
**PASS**, sin excepciones.

## Project Structure

### Documentation (this feature)

```text
specs/015-puertos-configurables/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command) — contrato de variables
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
infra/
├── refine/
│   ├── compose.yaml            # puerto Refine → variable
│   └── Dockerfile              # EXPOSE consistente con la misma variable
├── kestra/
│   └── compose.yaml            # puerto Kestra + webhook alertas + URLs jdbc a Supabase DB → variables
├── superset/
│   ├── compose.yaml            # puerto Superset → variable
│   └── superset_config.py      # CORS_OPTIONS.origins → variable (mismo patrón que REFINE_ORIGIN)
└── playwright/
    ├── compose.yaml            # puerto Playwright → variable
    └── compose.vps.yaml        # mismo puerto, consistencia con compose.yaml

apps/web/
├── vite.config.ts              # server.port / preview.port → variable
└── .env.example                # VITE_SUPABASE_URL con el puerto de API variable

supabase/
├── config.toml                 # única excepción — puertos y redirect URLs literales, con comentario explícito
└── functions/.env.example      # SUPERSET_PUBLIC_URL con el puerto de Superset variable

.env.example                    # fuente de verdad: todas las variables de puerto nuevas, documentadas
package.json                    # scripts que referencian un puerto fijo (test:db:ci) → variable
scripts/reset-db-ci.sh          # puerto de conexión a Postgres → variable
```

**Structure Decision**: No se crea ningún directorio ni servicio nuevo. Es una
edición acotada a los archivos de configuración de infraestructura ya existentes
del template, listados arriba. No hay separación backend/frontend nueva ni
estructura de proyecto de aplicación involucrada.

## Complexity Tracking

*Sin violaciones de la Constitución que justificar — tabla vacía.*
