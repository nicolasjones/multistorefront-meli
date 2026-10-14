# Feature Specification: [E2E super] Health endpoint /ping (BORRAR)

**Feature Branch**: `epic/MSF-491-e2e-super-health-endpoint-ping-borrar`

**Jira Epic**: MSF-491 — [E2E super] Health endpoint /ping (borrar)

**Created**: 2026-10-14

**Status**: Descartada — Nicolás instruyó (2026-10-14 13:51 -0300) descartar la épica y no retomarla con el Desarrollador. No se implementa.

**Delivery scope**: ninguno (`refine`, `supabase`, `kestra`, `superset` y `workers` quedan fuera). No hay código, migraciones, tablas ni variables nuevas.

**Input** (literal de Jira): "Agregar endpoint GET /ping -> {ok:true}. Spec minima (E2E descartable)."

## Propósito

Épica de prueba E2E (smoke test, ya con label descartada). El endpoint `GET /ping -> {ok:true}` descrito en Jira NO se construye: la decisión de Nicolás es descartar la épica. El run anterior (spec-architect-mv8b9680) murió sin worktree ni `result.json` y no había trabajo real que recuperar.

## Requisitos

- **FR-001**: No se implementa el endpoint `GET /ping`. La épica no introduce funcionalidad, datos ni cambios de plataforma; los únicos artefactos versionados son esta spec, `plan.md` y `tasks.md`.
- **FR-002**: La épica se cierra sin generar nuevo worker: el poller transiciona MSF-491 a Cancelada/Descartada y no se relanza al Especificador ni al Desarrollador.

## Datos y esquemas (Constitución, Principio VII)

No crea ni altera tablas: no aplica esquema `public`/`dominio` ni RLS nuevo.

## Criterios de éxito

- **SC-001**: MSF-491 queda en Cancelada/Descartada sin ningún worker adicional.
- **SC-002**: No queda código de `/ping` en `main`.

## Fuera de alcance

El endpoint `GET /ping` y cualquier otro cambio de código.
