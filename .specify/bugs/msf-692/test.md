# Verificación MSF-692

- Vitest `src/providers` (58 tests OK): login rechaza removido/cliente sin membresía y falla cerrado; check expulsa sin membresía, deja pasar superadmin, tolera caída de red.
- pgTAP `cortar_sesiones_miembro_removido.test.sql`: escrito; requiere `pnpm dev:supabase`, queda al CI.
- `tsc --noEmit` limpio; `pnpm lint` sin errores (solo warnings previos).
