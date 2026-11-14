# Test: msf-683

- `node --check scripts/calidad.mjs`: OK.
- `node scripts/calidad.mjs --only=deps`: termina con `---- RESUMEN ----`, «Todo OK»; genera `reports/calidad.log` y `reports/calidad.md`.
- `node scripts/calidad.mjs --only=deadcode` (entorno local sin dependencias completas): knip falla y el script igual imprime `RESUMEN` con `hallazgos` (antes del fix ya lo hacía; el cambio cubre excepciones/timeouts).
- `pnpm docs:check`: OK.
- Pendiente de CI: un run de `quality` que cierre con `RESUMEN` y el artefacto `calidad-reporte` con `calidad.log`.
