# Implementation Plan: Mapeo de identificadores externos de clientes

**Branch**: `nicolasjones/mapeo-identificadores-clientes` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/20260930-135541-mapeo-identificadores-clientes/spec.md`

## Summary

Agregar una tabla de plataforma (`clientes_identificadores_externos`) que
vincula una fila de `clientes` con su identidad en un sistema externo
(sistema como texto libre + identificador dentro de ese sistema), con
unicidad global de `(sistema, identificador_externo)`. Lectura vía RLS
acotada a la organización dueña del cliente; alta y baja vía funciones
`SECURITY DEFINER` en `public` (`vincular_identificador_externo`,
`desvincular_identificador_externo`) que resuelven la organización del
cliente y validan permiso de escritura antes de tocar la tabla — mismo
patrón que `conexiones` (spec 013), no el de `clientes` (spec 003, que sí
tiene policies de insert/update directas). Migración aditiva, sin tocar
ninguna tabla existente.

## Technical Context

**Language/Version**: SQL (PL/pgSQL) sobre PostgreSQL 15 (Supabase)

**Primary Dependencies**: Supabase CLI (migraciones), PostgREST (RPC de las
funciones `SECURITY DEFINER`), pgTAP (tests de RLS/funciones)

**Storage**: PostgreSQL (Supabase) — nueva tabla `clientes_identificadores_externos` en el esquema `public`

**Testing**: `supabase/tests/database/*.test.sql` (pgTAP) vía `pnpm test`, con `pnpm dev:supabase` corriendo

**Target Platform**: Supabase (local vía Docker para desarrollo, Supabase Cloud en producción)

**Project Type**: Migración de base de datos de plataforma (sin frontend, sin worker — delivery scope `supabase` únicamente)

**Performance Goals**: N/A — volumen esperado (identificadores por cliente) es bajo; el índice por `cliente_id` y el `unique` de `(sistema, identificador_externo)` alcanzan sin necesidad de metas de throughput.

**Constraints**: Migración aditiva con reversión documentada (ver abajo); RLS obligatorio (Principio I); sin service-role key en el navegador; sin nombrar ningún sistema externo puntual en código ni comentarios.

**Scale/Scope**: Una tabla, dos funciones `SECURITY DEFINER`, sus policies de RLS y sus tests pgTAP. Sin cambios en `apps/web`, `workers/`, Kestra ni Superset.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I (Aislamiento multi-tenant por diseño)**: PASA. La tabla nueva
  lleva RLS habilitado; el aislamiento se resuelve vía `clientes.organizacion_id`
  (la tabla no tiene `organizacion_id` propio, ver `data-model.md` para el
  porqué) reutilizando `private.organizacion_id()` / `private.es_administrador_de()`
  ya existentes. Sin service-role en el navegador: las funciones `SECURITY
  DEFINER` se llaman desde `authenticated` vía PostgREST RPC.
- **Principio II (Especificar antes de implementar)**: PASA. `spec.md` ya
  aprobado antes de este plan.
- **Principio III (Automatizaciones idempotentes y auditables)**: PASA.
  `vincular_identificador_externo` es idempotente ante la re-vinculación del
  mismo par al mismo cliente (FR-004); no aplica auditoría de ejecución de
  workflow porque esta pieza no es un workflow, es una tabla de mapeo.
- **Principio IV (Un monorepo, despliegues independientes)**: PASA. Solo
  toca `supabase/migrations`; no introduce Compose ni despliegue nuevo.
- **Principio V (Simplicidad operativa)**: PASA. No se agrega infraestructura
  nueva, solo una tabla y dos funciones sobre el stack de Supabase existente.
- **Principio VI (Panel operable y extensible)**: NO APLICA. Esta spec no
  agrega, mueve ni rediseña ninguna pantalla del panel (delivery scope:
  `supabase` únicamente, sin UI).

Sin violaciones — no hace falta completar Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/20260930-135541-mapeo-identificadores-clientes/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── <timestamp>_mapeo_identificadores_clientes.sql   # tabla, RLS, funciones SECURITY DEFINER
└── tests/
    └── database/
        └── mapeo_identificadores_clientes.test.sql       # pgTAP: RLS + funciones
```

**Structure Decision**: Única migración aditiva en `supabase/migrations/` más
su test pgTAP en `supabase/tests/database/`. No hay `apps/web` (sin UI en
esta spec), no hay `workers/` (ningún proceso aislado toca esta tabla en
este alcance), no hay Kestra ni Superset — el delivery scope declarado en
`spec.md` es `supabase` únicamente.

## Complexity Tracking

*Sin violaciones de la constitución — sección no aplica.*
