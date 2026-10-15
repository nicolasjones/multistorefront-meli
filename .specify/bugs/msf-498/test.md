# Test: MSF-498

- `pnpm test:auth:hook-bloqueo` (chequeo estático del hook, 2026-10-15): 2 tests, 2 pass, 0 fail («el hook password_verification_attempt está activo y apunta a una función existente», «el mensaje de rechazo del hook es el mismo que muestra el cliente»).
- `pnpm docs:check` (2026-10-15): «Documentación de cambios: OK».
- Pendiente fuera del repo (T022a/b, abiertas `[ ]` en `tasks.md`): checklist de `docs/acceso-ingreso.md` en STG y PROD (6.º intento con la contraseña correcta debe responder el rechazo, no un token). Sin evidencia hasta que lo corra el operador.
