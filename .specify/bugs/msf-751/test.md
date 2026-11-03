# Test: MSF-751

- `pnpm --filter @platform/web exec vitest run src/pages/ventas-reportes/rankingClientes.contrato.test.ts` → 6/6 pasan (antes: ENOENT).
- `grep -r 20270116110500` ya no devuelve referencias.
