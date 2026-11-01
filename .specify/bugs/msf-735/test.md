# Verificación: MSF-735

- Rama simulada que cambia solo `scripts/` y agrega `.specify/bugs/x/fix.md` (sin `specs/` ni `docs/`): `node scripts/verificar-documentacion-cambios.mjs` → `Documentación de cambios: OK (2 archivos ...)`.
- `pnpm docs:check` sobre esta rama (base HEAD~1) → OK.
- `pnpm lint`: sin errores (solo avisos previos de `set-state-in-effect` en archivos no tocados). No aplica build: el cambio es un script de tooling.
- `pnpm test:docs:check` (`scripts/verificar-documentacion-cambios.test.mjs`, corre en `pnpm test`): 4/4 pasan — acepta `.specify/bugs/<slug>/`, acepta la constitución en `.specify/memory/`, rechaza plantillas/scripts de `.specify/`, rechaza tooling sin documentación.
