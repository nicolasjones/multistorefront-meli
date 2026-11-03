# Test: MSF-748

- Test dedicado nuevo: `supabase/tests/database/comprobantes_contacto_id_lectura.test.sql` (privilegio por columna de `contacto_id`).
- También cubierta por pgTAP existente: `supabase/tests/database/envio_transporte.test.sql` (test 11, «toda columna de la factura que no es del envío se puede leer») y `supabase/tests/database/contactos.test.sql` (lee la venta con `contacto_id` como `authenticated`).
- Verificación local: ver el reporte de la corrida (los pgTAP requieren `pnpm dev:supabase`); el job `database` del CI es el gate.
