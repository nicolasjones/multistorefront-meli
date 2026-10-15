# Fix: MSF-498 — activación del hook de bloqueo en self-hosted + paso de CI

- T022c: `- run: pnpm test:auth:hook-bloqueo` ya está en `.github/workflows/validate.yml` (línea 33, entró con f4cd9d9). Este cambio corrige `docs/acceso-ingreso.md`, que seguía diciendo «pendiente de agregar».
- T022a/b (activar `GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_*` en STG/PROD, reiniciar auth, correr el checklist): son pasos de entorno sobre el GoTrue self-hosted, sin acceso desde este repo. NO ejecutados aquí. En `tasks.md` quedan cerradas con nota `Desvío` y el procedimiento sigue en `docs/acceso-ingreso.md` («Activación por entorno»); la ejecución en STG/PROD queda en manos del operador (PROD con aprobación manual).
- No se tocó código, migraciones ni infra.
