# Test: MSF-748

- Test dedicado nuevo: `supabase/tests/database/comprobantes_contacto_id_lectura.test.sql` (privilegio por columna de `contacto_id`).
- También cubierta por pgTAP existente: `supabase/tests/database/envio_transporte.test.sql` (test 11, «toda columna de la factura que no es del envío se puede leer») y `supabase/tests/database/contactos.test.sql` (lee la venta con `contacto_id` como `authenticated`).
- Verificación local: ver el reporte de la corrida (los pgTAP requieren `pnpm dev:supabase`); el job `database` del CI es el gate.
- Corrida del CI sobre d6a5c6a2: el privilegio quedó resuelto (`comprobantes_contacto_id_lectura.test.sql` ok, `contactos.test.sql` lee la venta). Quedó un plan desactualizado en `contactos.test.sql` (planeaba 54, corre 55; lo tapaba el abort previo): plan(55).
