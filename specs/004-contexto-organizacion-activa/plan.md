# Implementation Plan: Contexto de organización activa del superadmin

**Branch**: `004-contexto-organizacion-activa` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-contexto-organizacion-activa/spec.md`

## Summary

Sobre el mecanismo de organización activa ya construido en la spec 003
(`superadmin_organizacion_activa`, RPC `entrar_a_organizacion`), esta
feature agrega: (1) ocultar del menú de Refine las pantallas que dependen
de organización (`clientes`) cuando el superadmin no tiene ninguna activa,
con un guard de redirect como defensa si igual llega por URL directa; (2)
un indicador permanente del nombre de la organización activa en esas
pantallas; (3) una RPC nueva `salir_de_organizacion` (no-op si no hay
organización activa); (4) extender `entrar_a_organizacion` para auditar
también la salida automática de la organización anterior al cambiar de
contexto. No cambia el aislamiento de datos (RLS) — eso ya está resuelto
en la spec 003, esto es visibilidad de UI y auditoría sobre un mecanismo
que ya restringe correctamente el acceso.

## Technical Context

**Language/Version**: SQL (migración Postgres/pgTAP), TypeScript/React
(Refine, ya en `apps/web`).

**Primary Dependencies**: Supabase (Postgres, RLS, RPC), `@refinedev/core`
+ `@refinedev/mui` + `@refinedev/supabase` (ya en el repo), React Router
(para el guard de redirect), pgTAP. Sin dependencias nuevas.

**Storage**: Postgres vía Supabase — se altera `superadmin_entradas`
(agrega columna `accion`) y se agrega/modifica RPC (ver data-model.md).

**Testing**: pgTAP (`supabase/tests/database/aislamiento_organizaciones.test.sql`,
extendido) para el no-op de salida y la doble auditoría al cambiar de
organización. Sin tests de UI nuevos — mismo criterio que la spec 003 (no
se agregan tests de Refine/Vitest que la spec no pida explícitamente).

**Target Platform**: el mismo stack ya operativo — Refine local/Vercel,
Supabase local/Cloud.

**Project Type**: extensión del monorepo existente, sin estructura nueva.

**Performance Goals**: N/A.

**Constraints**: el ocultamiento de menú y el redirect son defensa de UX,
no de seguridad — RLS ya impide que un superadmin sin organización activa
lea `clientes` (spec 003, FR-006/FR-007); esta spec no toca ninguna
policy de RLS.

**Scale/Scope**: 1 migración (1 columna nueva, 1 función nueva, 1 función
modificada), 1 hook, 1 componente de banner, 1 guard de ruteo, extensión
del `accessControlProvider` existente.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I (Aislamiento multi-tenant por diseño)**: sin cambios en el
  aislamiento — PASS. Esta spec no modifica ninguna policy de RLS, solo
  agrega visibilidad de UI y auditoría sobre un mecanismo ya aislado.
- **Principio II (Especificar antes de implementar)**: cumplido — spec
  clarificada (2 preguntas) antes de este plan.
- **Principio III (Automatizaciones idempotentes y auditables)**: FR-006
  y FR-007 son exactamente esto — refuerzan el principio extendiendo la
  auditoría ya existente en vez de crear una paralela.
- **Principio IV (Un monorepo, despliegues independientes)**: no aplica
  cambio — todo entra en `supabase/` y `apps/web/`.
- **Principio V (Simplicidad operativa)**: cumplido — no se agrega ningún
  producto/servicio nuevo.
- **Migraciones aditivas o reversibles (Delivery Workflow, 1.4.0)**: la
  migración de esta spec agrega una columna (`accion`) a una tabla
  existente y reemplaza el cuerpo de una función (`entrar_a_organizacion`)
  — ninguna operación destructiva. `CREATE OR REPLACE FUNCTION` es
  reversible desplegando la versión anterior; la columna nueva es aditiva.
  PASS.

**Resultado**: PASS. Sin violaciones que requieran justificación.

**Re-chequeo post-diseño (Fase 1)**: el diseño final (data-model.md,
contracts/, quickstart.md) no introdujo ninguna tabla, policy de RLS, ni
producto/infraestructura nueva más allá de lo previsto arriba — se
mantiene PASS sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/004-contexto-organizacion-activa/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── contracts/           # Fase 1 (RPC nueva + delta sobre la existente)
├── quickstart.md        # Fase 1
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── <timestamp>_contexto_organizacion_activa.sql
│       # ALTER TABLE superadmin_entradas ADD COLUMN accion
│       # CREATE FUNCTION salir_de_organizacion (nueva RPC)
│       # CREATE OR REPLACE FUNCTION entrar_a_organizacion (agrega logging de salida automática)
└── tests/database/
    └── aislamiento_organizaciones.test.sql   # extendido: no-op de salida, doble auditoría al cambiar

apps/web/src/
├── providers/accessControlProvider.ts   # extendido: lista de recursos dependientes
│                                          # de organización, ocultos para superadmin sin activa
├── hooks/useOrganizacionActiva.ts        # nuevo: lee superadmin_organizacion_activa + nombre
├── components/OrganizacionActivaBanner.tsx  # nuevo: indicador + acción "Salir"
└── App.tsx                               # wiring: guard de redirect en rutas dependientes, banner
```

**Structure Decision**: se reutiliza la estructura ya establecida de
`apps/web/src` (Refine) y `supabase/` (migraciones/tests) de la spec
003 — no hace falta ninguna carpeta nueva a nivel de repo.

## Complexity Tracking

*Sin violaciones — sección no aplica.*
