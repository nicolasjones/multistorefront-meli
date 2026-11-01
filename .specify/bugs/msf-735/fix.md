# Fix: MSF-735

- `scripts/verificar-documentacion-cambios.mjs`: el regex de `documented` acepta `.specify/bugs/` y `.specify/memory/` (no todo `.specify/`: plantillas y scripts no son documentación); se elimina la comparación redundante con la constitución y el mensaje de error nombra `.specify/`.
- `docs/documentacion-cambios.md`: aclara que `.specify/bugs/<slug>/` cuenta como documentación de un bug-fix.

- Devolución del Revisor: acotado el regex como se pidió; test `scripts/verificar-documentacion-cambios.test.mjs` (`pnpm test:docs:check`, incluido en `pnpm test`).
