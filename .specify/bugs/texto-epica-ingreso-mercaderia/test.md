# Bug Test: texto con «épica» en Ingreso de mercadería (MSF-601)

- **Slug**: texto-epica-ingreso-mercaderia
- **Result**: ver abajo

## Verification

`pnpm --filter @platform/web exec vitest run src/components/stock/IngresoMercaderiaForm.test.tsx` — el test `[MSF-601]` exige el texto nuevo y la ausencia de «épica».
