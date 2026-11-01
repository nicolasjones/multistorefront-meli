# Fix: msf-716

- **Causa**: `listarStockPorDepositoDe` serializaba hasta 1000 ids en un único `in.(…)` GET (~39 KB).
- **Cambio**: `apps/web/src/lib/depositos.ts` parte los ids (sin repetidos) en lotes de `LOTE_IDS_STOCK = 100`, los pide en paralelo y une; un lote con error propaga el error (sin stock parcial).
- **Tests**: `apps/web/src/lib/depositos.stockLotes.test.ts` (1000 ids → 10 peticiones ≤100, unión completa; vacío → `{}`; duplicados; error de lote).
- **Docs**: `docs/stock-toma-inventario.md` (sección «Categorías grandes»).
- **BD**: sin migraciones. Reversión: revert del commit.
