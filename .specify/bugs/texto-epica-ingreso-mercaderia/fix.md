# Bug Fix: el formulario de ingreso muestra texto con la palabra «épica» (MSF-601)

- **Slug**: texto-epica-ingreso-mercaderia
- **Status**: applied

## Summary

La nota bajo el formulario de Ingreso de mercadería decía «El stock suma al depósito único de la organización; los depósitos llegan con la épica de Stock de depósitos». Ahora dice «El stock ingresado suma al depósito principal.» (coincide con el «Destino» de `docs/ingreso-de-mercaderia.md`).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/components/stock/IngresoMercaderiaForm.tsx` | modified | Solo el texto de la nota. |
| `apps/web/src/components/stock/IngresoMercaderiaForm.test.tsx` | modified | Test `[MSF-601]`. |
