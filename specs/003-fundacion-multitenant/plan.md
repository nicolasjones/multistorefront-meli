# Implementation Plan: Fundación multi-tenant

**Branch**: `003-fundacion-multitenant` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-fundacion-multitenant/spec.md`

## Summary

Construir el esquema y las pantallas base de multi-tenancy sobre
`automation-platform-template`: tablas `organizaciones`,
`usuarios_organizacion` (membresía única por usuario), `clientes` (primera
entidad de negocio), y las tablas de soporte del superadmin
(`superadmins`, `superadmin_organizacion_activa`, `superadmin_entradas`).
El aislamiento se resuelve con **una sola función de RLS reutilizable**
(`private.organizacion_id()`) que unifica dos casos: un usuario normal
(admin/miembro, resuelto desde su única fila en `usuarios_organizacion`) y
un superadmin que entró explícitamente a una organización (resuelto desde
`superadmin_organizacion_activa`). El alta de organización con invitación
por email requiere una Edge Function (necesita la Auth Admin API con
service-role, algo que RLS/RPC de Postgres no puede hacer solo).

## Technical Context

**Language/Version**: SQL (migraciones Postgres/pgTAP), TypeScript/React
(Refine, ya en `apps/web`), Deno/TypeScript (Edge Function).

**Primary Dependencies**: Supabase (Postgres, Auth Admin API, RLS),
`@refinedev/core` + `@refinedev/mui` + `@refinedev/supabase` (ya en el
repo), pgTAP.

**Storage**: Postgres vía Supabase — 6 tablas nuevas (ver data-model.md).

**Testing**: pgTAP (`supabase/tests/database/`) para el aislamiento y los
permisos de escritura; Vitest para cualquier componente de Refine con
lógica propia (probablemente ninguno nuevo, son recursos estándar de
`@refinedev/supabase`).

**Target Platform**: el mismo stack ya operativo — Refine local/Vercel,
Supabase local/Cloud.

**Project Type**: extensión del monorepo existente, sin estructura nueva.

**Performance Goals**: N/A — sin metas de carga específicas para esta
fundación.

**Constraints**: la restricción de escritura de `miembro` (FR-011) DEBE
aplicarse en RLS, no solo ocultando controles en la UI (ya está en la
spec, se repite acá porque condiciona el diseño de policies).

**Scale/Scope**: 6 tablas, 1 Edge Function, 2 funciones RLS helper, ~3
pantallas de Refine (organizaciones, clientes, y el botón/acción de
"Ingresar").

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I (Aislamiento multi-tenant por diseño)**: es el objetivo
  central de esta spec — PASS, con el matiz de que el superadmin es una
  excepción explícita, acotada a una organización a la vez y auditada
  (no un bypass abierto).
- **Principio II (Especificar antes de implementar)**: cumplido — spec
  clarificada antes de este plan.
- **Principio III (Automatizaciones idempotentes y auditables)**: FR-013
  (registro de cada entrada de superadmin) implementa esto directamente.
- **Principio IV (Un monorepo, despliegues independientes)**: no aplica
  cambio — todo entra en `supabase/` y `apps/web/`, sin infraestructura
  nueva.
- **Principio V (Simplicidad operativa)**: cumplido — no se agrega ningún
  producto/servicio nuevo, solo migraciones y código de aplicación.

**Resultado**: PASS. Sin violaciones que requieran justificación.

## Project Structure

### Documentation (this feature)

```text
specs/003-fundacion-multitenant/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── contracts/           # Fase 1 (RPC + Edge Function)
├── quickstart.md        # Fase 1
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── <timestamp>_fundacion_multitenant.sql   # las 6 tablas + RLS + helpers + RPC
├── functions/
│   └── crear-organizacion/                     # Edge Function (invita por email)
│       └── index.ts
└── tests/database/
    └── aislamiento_organizaciones.test.sql      # pgTAP real (reemplaza/extiende el smoke test)

apps/web/src/
├── pages/organizaciones/    # Historia 2 y 4 (solo superadmin)
│   ├── list.tsx             # listado + botón "Crear" + acción "Ingresar" por fila
│   └── create.tsx           # formulario (nombre, email del fundador)
└── pages/clientes/          # Historia 3
    ├── list.tsx              # visible admin + miembro
    ├── create.tsx             # solo admin (oculto para miembro, y rechazado por RLS igual)
    └── edit.tsx               # solo admin
```

**Structure Decision**: se reutiliza la estructura ya establecida de
`apps/web/src` (Refine) y `supabase/` (migraciones/functions/tests) — no
hace falta ninguna carpeta nueva a nivel de repo, solo contenido nuevo
dentro de las ya existentes.

## Complexity Tracking

*Sin violaciones — sección no aplica.*
