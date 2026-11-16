# Test: msf-642

Cobertura existente: `supabase/tests/database/ventas_precios_especiales.test.sql` (tests 6, 7, 9, 10 y 13 de 23), que
fallaban por la regresión. No se agregan tests nuevos: ya cubren el criterio.

Verificación local: no hay Postgres/Supabase local disponible en este entorno; la corrida 23/23 queda al CI `database` del PR #519.
Los cambios se contrastaron línea a línea con `20270115090100_lineas_descuento.sql` (:87, :184, :199-205, :294).
