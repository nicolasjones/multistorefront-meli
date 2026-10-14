# Feature Specification: Endpoint /ping (BORRAR)

**Feature Branch**: `epic/MSF-495-e2e-flow-endpoint-ping-borrar`

**Jira Epic**: MSF-495 — [E2E flow] Endpoint /ping (borrar)

**Created**: 2026-10-14

**Status**: Ready — la épica trae su especificación completa.

**Delivery scope**: `refine` (el endpoint se sirve desde el nginx de `apps/web`, igual que `/health`). `supabase`, `kestra`, `superset` y `workers` quedan fuera. No hay migraciones, tablas ni variables nuevas.

**Input** (literal de Jira): "Agregar un endpoint GET /ping que responda 200 con {ok:true}, siguiendo el patron de /health. Objetivo: cambio minimo real para validar el flujo (spec -> implementacion -> review -> PR). No tocar datos ni migraciones."

## Propósito

Cambio mínimo real para validar el flujo spec → implementación → review → PR. La épica es de prueba ("borrar").

## User Story 1 — Responder a GET /ping (MSF-495)

Como operador, quiero hacer `GET /ping` y recibir `200` con `{ok:true}`, para comprobar que el servicio responde.

## Requisitos

- **FR-001**: `GET /ping` responde HTTP `200` con el cuerpo JSON `{"ok":true}`.
- **FR-002**: Se implementa siguiendo el patrón de `/health` (`location` dedicada en `apps/web/nginx.conf`, junto a la de `/health`).
- **FR-003**: No se tocan datos ni migraciones.

## Datos y esquemas (Constitución, Principio VII)

No crea ni altera tablas: no aplica esquema `public`/`dominio` ni RLS nuevo.

## Criterios de éxito

- **SC-001**: `GET /ping` devuelve `200` y `{"ok":true}`.
- **SC-002**: `/health` sigue respondiendo igual que antes.
- **SC-003**: El cambio no incluye migraciones ni cambios de datos.

## Fuera de alcance

Todo lo que no sea el endpoint `GET /ping`: datos, migraciones, otros endpoints, cambios a `/health`.
