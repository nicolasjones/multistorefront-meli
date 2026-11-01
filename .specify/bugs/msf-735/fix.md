# Fix: MSF-735

- `scripts/verificar-documentacion-cambios.mjs`: el regex de `documented` pasa a `/^(specs|docs|\.specify)\//` y el mensaje de error nombra `.specify/`.
- `docs/documentacion-cambios.md`: aclara que `.specify/bugs/<slug>/` cuenta como documentación de un bug-fix.
