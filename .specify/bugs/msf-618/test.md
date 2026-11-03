# Test MSF-618
`pnpm --filter @platform/web exec vitest run src/lib/actividad.test.ts` → 9 passed (etiquetas y formato de importes).
tsc --noEmit sin errores; lint solo con warnings previos.
E2E=no aplica (cambio de formato cubierto por unitarios).
