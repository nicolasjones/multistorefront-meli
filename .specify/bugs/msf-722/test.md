# Test MSF-722

Vitest: `productosListado.test.ts`, `stock.test.ts`, `pages/productos/list.test.tsx`, `pages/stock/list.test.tsx`
(tildes, 13 dígitos por código de barras o SKU) y `ImprimirComprobanteDialog.test.tsx` (pestaña en el clic,
cierre al fallar, sin registro con pestaña bloqueada/cerrada, registro al abrir el enlace).
Resultado: ver el reporte de la corrida.

## Devolución del Revisor (PR #644)
Tests nuevos: `useOpcionesDimension.test.tsx` (búsqueda sin tildes), `ImprimirComprobanteDialog.test.tsx` (pestaña cerrada durante el registro; fallo de registro en el enlace). 28 tests pasan.
