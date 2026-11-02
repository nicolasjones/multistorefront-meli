# Fix MSF-692

- `supabase/migrations/20270121120000_cortar_sesiones_miembro_removido.sql`: trigger AFTER DELETE en `usuarios_organizacion` que borra `auth.sessions` del removido (aditiva; reversión en el encabezado).
- `apps/web/src/providers/authProvider.ts`: `consultarAcceso` (membresía no suspendida o superadmin) usada en `login` (falla cerrado) y `check` (cache 60 s, no expulsa ante error de red).
- Docs: `docs/acceso-ingreso.md`.
