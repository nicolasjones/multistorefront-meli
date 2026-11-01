# Test — MSF-656

- pgTAP nuevo `supabase/tests/database/rls_empresas_rma_comprobantes.test.sql` (14 aserciones): persona de una sola tienda no ve RMA, ítems, líneas ni comprobantes de otra tienda; ve los propios y los sin empresa; administrador ve todo; otra organización nada.
- Ejecución local: NO posible (sin acceso a Docker/Postgres en este entorno); queda para el CI (`pnpm test` con Supabase).
