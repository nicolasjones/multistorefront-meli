# Verificación: MSF-735

- Rama simulada que cambia solo `scripts/` y agrega `.specify/bugs/x/fix.md` (sin `specs/` ni `docs/`): `node scripts/verificar-documentacion-cambios.mjs` → `Documentación de cambios: OK (2 archivos ...)`.
- `pnpm docs:check` sobre esta rama (base HEAD~1) → OK.
- `pnpm lint`: sin errores (solo avisos previos de `set-state-in-effect` en archivos no tocados). No aplican build ni tests: el cambio es un script de tooling.
