# Verificación: msf-716

- `vitest run depositos.stockLotes.test.ts toma-inventario.test.tsx list.test.tsx`: 3 archivos, 41 tests OK.
- `pnpm lint`: sin errores (solo warnings preexistentes). `tsc --noEmit` sin errores. `pnpm docs:check` OK.
- Resultado: **resuelto** (no reproducido contra el gateway real; verificado por lotes acotados en test).
