# Implementation Plan: Backups automáticos de la base de datos

**Branch**: `011-backups-postgres` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-backups-postgres/spec.md`

## Summary

Primer flow real de Kestra del template: un mecanismo genérico (no conoce
el dominio de los datos) que respalda la base de datos completa de un
entorno todos los días sin intervención humana, o bajo demanda desde la
propia interfaz de Kestra, dejando un registro auditable (`respaldos`) de
cada intento — en progreso, completado con tamaño/ubicación, o error con
motivo. Es también la primera vez que el repo cumple, con una
automatización real, la exigencia del Principio III de la constitución
(ejecuciones idempotentes y auditables).

A diferencia de las specs 003-010, la parte que escribe en la base no es
un `authenticated` de Supabase Auth vía RPC — es Kestra, conectado
directo a Postgres con un rol dedicado de mínimo privilegio
(`kestra_backups`, ver research.md R1/R2). Solo la lectura del historial
sigue el camino habitual (`private.is_superadmin()` + RLS).

## Technical Context

**Language/Version**: SQL (migración Postgres + pgTAP), YAML de flow de
Kestra (Kestra 1.3.x, imagen ya en el repo).

**Primary Dependencies**: Supabase (Postgres, RLS, roles, funciones
`security definer`) y Kestra (ya en el repo, con Docker socket montado en
`infra/kestra/compose.yaml` — usado acá por primera vez para correr una
tarea real). Sin librerías ni servicios de terceros nuevos.

**Storage**: Postgres (tabla `respaldos`, ver data-model.md) + archivo de
cada backup en el storage interno de Kestra (volumen `kestra-data`, ya
existente).

**Testing**: pgTAP nuevo
(`supabase/tests/database/backups_postgres.test.sql`) para: el índice
único + auto-sanado de `iniciar_respaldo` (FR-003, research.md R5), la
consistencia `estado`/resto de campos, y que `respaldos_select` solo deje
ver al superadmin (FR-011) — obligatorio por tratarse de una tabla con
datos sensibles de todas las organizaciones a la vez (constitución,
Technology and Quality Gates). Validación end-to-end del flow completo
(Kestra no tiene test runner integrado a este repo) documentada como
guía manual en `quickstart.md`.

**Target Platform**: el Kestra ya operativo (`infra/kestra`, local y
`compose.vps.yaml` de staging/VPS) + Supabase local/Cloud. Sin Refine
(alcance de entrega: `kestra | supabase`, sin pantalla nueva — Assumptions
de spec.md).

**Project Type**: extensión del monorepo existente, sin producto ni
Compose nuevo — usa el Kestra que ya está.

**Performance Goals**: N/A — un backup diario más eventuales manuales, sin
volumen ni latencia crítica declarada en la spec.

**Constraints**: el flow no debe requerir ningún conocimiento del dominio
de negocio (FR-010). Debe comportarse igual en todos los entornos
(FR-009): en desarrollo, `host.docker.internal:5434` con credenciales
locales fijas (mismo patrón que `pnpm test:db:ci`); en staging/producción,
una cadena de conexión propia del entorno, guardada solo en el
`infra/kestra/.env` de ese entorno (Principio I — nunca en Git ni en el
navegador).

**Scale/Scope**: 1 migración (tabla `respaldos`, rol `kestra_backups`, 3
funciones), 1 flow de Kestra versionado en `infra/kestra/flows/`, 1
archivo pgTAP, 2 variables nuevas en `.env.example`
(`KESTRA_BACKUPS_DB_PASSWORD` y, si el destino de staging lo requiere, la
cadena de conexión). Cero cambios en `apps/web`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I (Aislamiento multi-tenant por diseño)**: PASS. `respaldos`
  tiene RLS activado, legible únicamente por superadmin
  (`private.is_superadmin()`); ningún rol de organización llega a ella ni
  al archivo del backup (FR-011). Las credenciales de conexión de Kestra
  (`kestra_backups`, cadena de conexión de staging/prod) viven solo en
  `infra/kestra/.env`, gitignored, nunca en el navegador.
- **Principio II (Especificar antes de implementar)**: cumplido — spec
  clarificada (3 preguntas: verificación estructural vs. restauración,
  acceso restringido al archivo, historial separado por entorno) antes de
  este plan.
- **Principio III (Automatizaciones idempotentes y auditables)**: primera
  automatización real del repo que lo cumple de punta a punta.
  `iniciar_respaldo` es idempotente frente a una caída del proceso
  (auto-sana filas colgadas, research.md R5) y bloquea explícitamente la
  concurrencia (FR-003, índice único + excepción). Cada ejecución queda
  con origen, momento de inicio, estado final y motivo de error legible
  (FR-004, FR-006).
- **Principio IV (Un monorepo, despliegues independientes)**: sin
  cambios — todo entra en `supabase/` e `infra/kestra/`; Kestra ya tenía
  su propio Compose (dev y VPS), esta spec no agrega ninguno.
- **Principio V (Simplicidad operativa)**: PASS. Se evaluó explícitamente
  exponer un webhook público para el disparo manual y se descartó
  (research.md R6) a favor del acceso directo ya existente del superadmin
  a Kestra — menos superficie, cero infraestructura nueva. Se usa el
  Docker socket que Kestra ya tenía montado, en vez de una imagen custom
  (research.md R3).
- **Migraciones aditivas o reversibles (Delivery Workflow, 1.4.0)**: la
  migración solo crea tabla, rol y funciones nuevas — nada existente se
  modifica. Reversión documentada en data-model.md (drop en orden
  inverso).
- **Código versionado en Git, no solo en una UI** (regla ya aplicada a
  Superset con sus dashboards YAML): el flow de Kestra se versiona como
  YAML en `infra/kestra/flows/` y se aplica vía API/CLI (research.md R7,
  documentado en quickstart.md) — nunca se crea o edita solo desde la UI
  de Kestra.

**Resultado**: PASS. Sin violaciones que requieran justificación.

**Re-chequeo post-diseño (Fase 1)**: data-model.md y contracts/ no
introdujeron ninguna tabla, rol ni producto adicional más allá de lo
previsto arriba — se mantiene PASS sin cambios. La decisión de no usar el
patrón `authenticated` + `private.is_superadmin()` para las mutaciones
(research.md R2) es una corrección respecto al patrón por defecto de
specs anteriores, no una violación — refuerza el Principio I en vez de
debilitarlo (mínimo privilegio real para un proceso que no es una sesión
de usuario).

## Project Structure

### Documentation (this feature)

```text
specs/011-backups-postgres/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md         # Fase 1
├── contracts/            # Fase 1 (funciones + contrato del flow)
├── quickstart.md         # Fase 1
└── tasks.md              # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── <timestamp>_backups_postgres.sql
│       # tabla: respaldos
│       # rol: kestra_backups (login, sin otro privilegio)
│       # funciones public (security definer): iniciar_respaldo,
│       #   finalizar_respaldo_completado, finalizar_respaldo_error
│       # RLS: solo select, solo superadmin
└── tests/database/
    └── backups_postgres.test.sql   # nuevo, pgTAP

infra/kestra/
├── flows/
│   └── respaldo-postgres.yml       # nuevo — namespace platform.backups
│       # trigger Schedule (diario) + ejecución manual desde la UI
│       # pasos: iniciar_respaldo → pg_dump (Docker runner) →
│       #   verificación estructural → finalizar_respaldo_completado
│       #   errors: → finalizar_respaldo_error
└── .env.example                     # (o el .env.example raíz)
    # + KESTRA_BACKUPS_DB_PASSWORD
    # + cadena de conexión de staging/prod, si aplica (documentado, sin valor real)
```

**Structure Decision**: se reutiliza la estructura ya establecida
(`supabase/migrations`, `supabase/tests/database`) y se agrega la primera
carpeta `infra/kestra/flows/` del repo — no existía ningún flow todavía.
Sin cambios en `apps/web` (sin pantalla en esta entrega, Assumptions de
spec.md).

## Complexity Tracking

*Sin violaciones — sección no aplica.*
