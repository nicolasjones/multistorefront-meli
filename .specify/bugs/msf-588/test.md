# Verificación: MSF-588

- No se pudo reproducir ni ejecutar el stack (sin acceso al daemon de Docker en el entorno del Desarrollador). Queda para quien corra `pnpm dev:supabase` sobre un volumen con migraciones pendientes: debe terminar con `supabase migration list --local` sin pendientes.
- Corrido localmente: `pnpm docs:check`, `pnpm lint` (ver reporte).
