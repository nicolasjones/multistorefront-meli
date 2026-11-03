# Fix: MSF-768

- Causa: `20270112140500` dejó la lectura de `dominio.comprobantes_venta` por columna y `20270201100100` agregó `contacto_id` sin concederla.
- `supabase/migrations/20270202200500_comprobantes_venta_contacto_lectura.sql`: `grant select (contacto_id)` a `authenticated` (aditiva; reversión documentada en el archivo).
- `supabase/tests/database/contactos.test.sql`: assert explícito `has_column_privilege` (plan 54 → 55).
