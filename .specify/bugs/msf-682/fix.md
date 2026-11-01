# Fix: msf-682

- Causa: la regla ADD COLUMN era por línea y exigía `alter table` y `add column` en la misma línea.
- Cambio: `scripts/detectar-add-column.mjs` (nuevo) analiza la sentencia completa tras enmascarar comentarios y literales; `scripts/verificar-migraciones.mjs` lo usa y se quitó la regla por línea.
- Tests: `scripts/detectar-add-column.test.mjs` (`pnpm test:db:guard-migraciones`).
- Docs: `docs/guard-migraciones.md`.
- Nota: el detector halla 27 ADD COLUMN sin guard en 20 migraciones históricas (el reporte decía 34); no fallan porque el guard sólo revisa archivos nuevos.
