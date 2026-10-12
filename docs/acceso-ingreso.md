# Ingreso con correo y contraseña (F-ACC-01)

Spec: `specs/20261012-140000-acceso-y-organizacion/`.

- **Pantalla**: `apps/web/src/pages/login.tsx` (correo, contraseña, «Mantener la sesión iniciada», «¿La olvidaste?»). La lógica vive en `providers/authProvider.ts`.
- **Mensaje genérico**: correo inexistente y contraseña incorrecta devuelven el mismo texto; un suspendido recibe ese mismo texto y su sesión se cierra. Si la consulta de membresía falla, el ingreso también se rechaza (falla cerrado) y se cierra la sesión.
- **Bloqueo**: 5 fallos por correo bloquean 15 minutos (`public.intentos_acceso`, correo en hash sha256, RLS sin policies; acceso solo por `bloqueo_acceso_hasta`, `registrar_fallo_acceso` y `limpiar_intentos_acceso`). El límite nativo de Supabase Auth es por IP y no sirve para esto. Limitación: lo aplica el cliente; un llamado directo a la API de Auth lo evita.
- **Estado de membresía**: `usuarios_organizacion.estado` (`activo` | `suspendido`). `private.organizacion_id()` y `private.puede_escribir()` excluyen a los suspendidos, así que pierden acceso a datos aunque conserven un token. Reversión: restaurar ambas funciones a su definición de `20260908172920_fundacion_multitenant.sql` y eliminar la columna en un PR posterior.
- **Mantener la sesión iniciada**: con la casilla, la sesión se guarda en `localStorage`; sin ella, en `sessionStorage` (`lib/supabase.ts`). El vencimiento en servidor (12 h / 30 días) es F-ACC-03.
