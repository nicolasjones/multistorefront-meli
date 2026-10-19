# Bug Fix: Varios proveedores por producto (seguimiento MSF-205)

- **Slug**: msf-530
- **Fixed**: 2026-10-19
- **Assessment**: ./assessment.md
- **Status**: not-applied

## Summary

No se modificó código. MSF-530 es el seguimiento trazado (FR-020 / T029) de una limitación de alcance, no un defecto: MSF-205 entrega un proveedor por producto (`productos.proveedor_id`) y modelar N proveedores se difirió por decisión de negocio (Jira). El assessment exige una spec nueva (tabla `dominio.productos_proveedores`, RPC, UI y cambio de prototipo) y deja tres `[NEEDS CLARIFICATION]` sin resolver; el CLAUDE.md prohíbe inventar requisitos de negocio y exige spec antes de implementar.

## Changes

| File | Change | Notes |
|------|--------|-------|
| — | ninguno | Sin cambios de código, migraciones ni tests |

## Tests Added or Updated

- Ninguno (no hay comportamiento nuevo que pinear).

## Local Verification

- Sin código modificado: lint/build/tests no aplican a este cambio (solo documentación en `.specify/bugs/msf-530/`).

## Deviations from Assessment

- La devolución del Revisor no trajo hallazgos legibles (el prompt remite a una lista de Jira que no llegó) y no existía PR previo con comentarios; no hay nada accionable que corregir.

## Follow-ups

- Abrir spec Spec Kit (castellano, alcance `supabase` + `refine`) resolviendo: principal obligatorio u opcional, atributos por relación (costo/código/plazo), y rediseño del prototipo `ProductoAlta`/`ProductoEditar` (+ matriz pantalla↔criterios).
- Esquema declarado: `dominio` (Principio VII); migración aditiva con backfill desde `productos.proveedor_id` y reversión documentada.
