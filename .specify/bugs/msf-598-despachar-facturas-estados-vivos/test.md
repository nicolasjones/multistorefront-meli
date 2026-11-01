# Test MSF-598

- pgTAP `supabase/tests/database/despacho_estados.test.sql`: despacho, faltantes y envío en Cobrado, Deuda, Aceptado y En proceso; rechazo (55000) de Anulada, borrador y Pendiente.
- Vitest `apps/web/src/pages/ventas/comprobante.faltantes.test.tsx`.
- pgTAP no se pudo correr localmente (Supabase local apagado); queda al CI.
