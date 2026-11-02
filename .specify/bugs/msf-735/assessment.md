# Evaluación: MSF-735 — docs:check no reconoce `.specify/bugs/`

- Causa: `scripts/verificar-documentacion-cambios.mjs` solo aceptaba `specs/`, `docs/`, `AGENTS.md`, `CLAUDE.md` y la constitución como documentación. El flujo `speckit-bug-*` escribe en `.specify/bugs/<slug>/`.
- Efecto: falsos rojos en todo PR de bug-fix (vistos en #572 y #568).
- Remediación: ampliar el regex a `.specify/`. Sin migraciones ni cambio de alcance.
