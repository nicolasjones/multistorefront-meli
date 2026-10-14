# Feature Specification: E2E flujo (BORRAR)

**Feature Branch**: `epic/MSF-487-e2e-flujo-borrar`

**Jira Epic**: MSF-487 — E2E flujo (BORRAR)

**Created**: 2026-10-14

**Status**: Ready — la épica trae su especificación completa y no define alcance funcional.

**Delivery scope**: ninguno (`refine`, `supabase`, `kestra`, `superset` y `workers` quedan fuera). No hay código, migraciones, tablas ni variables nuevas.

**Input** (literal de Jira): "Épica DESCARTABLE para el E2E real del flujo. BORRAR al terminar."

## Propósito

Épica descartable que existe solo para ejercitar el flujo de punta a punta (Jira → Especificador → rama/PR → cierre). No entrega funcionalidad de negocio. Al terminar se borra.

## Requisitos

- **FR-001**: La épica no introduce funcionalidad, datos ni cambios de plataforma. Los únicos artefactos versionados son esta spec, `plan.md` y `tasks.md`.
- **FR-002**: Al terminar el E2E, la épica se BORRA: se cierra/elimina la épica en Jira y se descartan la rama `epic/MSF-487-e2e-flujo-borrar`, su PR y este directorio de spec.

## Datos y esquemas (Constitución, Principio VII)

No crea ni altera tablas: no aplica esquema `public`/`dominio` ni RLS nuevo.

## Criterios de éxito

- **SC-001**: El flujo completo corre sobre esta épica sin necesitar cambios de código.
- **SC-002**: Tras el borrado no queda rastro funcional en `main`.

## Fuera de alcance

Todo lo que no sea el recorrido del flujo y su borrado.
