# Test: MSF-768

- pgTAP `contactos.test.sql` (línea de "la venta sigue intacta" y el nuevo assert de privilegio) y `envio_transporte.test.sql` ("toda columna de la factura que no es del envío se puede leer") cubren el fix.
- Se corren en el job `database` del CI (requiere `pnpm dev:supabase`).
