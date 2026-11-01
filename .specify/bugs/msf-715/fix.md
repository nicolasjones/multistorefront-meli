# Bug Fix: msf-715

- **Slug**: msf-715
- **Assessment**: .specify/bugs/msf-715/assessment.md

## Cambio aplicado

`apps/web/src/pages/ventas/comprobante.tsx`: el `onRecargar` de `CobrosComprobante` ahora llama a `cargar()` además de `recargarCobros()`. Así el comprobante (estado y `updated_at`) se relee tras el cobro; las transiciones permitidas, el detalle de acciones, `HistorialComprobante` y `ResponsablesDespacho` (cuya `claveRecarga` depende de `updated_at`) se refrescan solos. No cambia la RPC ni hay migración.

## Tests

`comprobante.cobros.test.tsx`: caso nuevo «tras registrar el cobro relee el comprobante… (MSF-715)». Verificado: falla sin el cambio y pasa con él.

## Riesgos

`cargar()` hace `setFormulario(aFormulario(existente))`; en una factura confirmada el formulario es de solo lectura, así que no pisa ediciones.
