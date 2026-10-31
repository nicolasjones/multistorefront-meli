# Bug Test: MSF-641

- **Status**: pendiente de CI en la rama de MSF-232
- Test que lo cubre (ya existente): `supabase/tests/database/ventas_precios_especiales.test.sql` — 23 tests; los números 6, 7, 9, 10 y 13 son los que fallan por las migraciones `20270121120200` y `20270121120500` de MSF-232.
- Verificación esperada tras el fix en MSF-232: los 23 en verde con `pnpm test` (requiere `pnpm dev:supabase`).
- En `dokploy` no se pudo ejecutar localmente (sin Postgres/Docker); la lectura estática confirma que la última definición de ambas funciones incluye el descuento.
