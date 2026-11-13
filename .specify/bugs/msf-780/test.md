# Test MSF-780

- `grep -rn "MSF-232:" apps/web/e2e` → 1 resultado (service-cobro-avisos.e2e.ts:107).
- `tsc --noEmit` (app y node) sin errores nuevos; `pnpm lint` solo warnings previos; `pnpm docs:check` OK.
- La corrida real del recorrido NO se ejecutó: el nodo no tiene acceso al daemon de Docker ni CLI de Supabase. Pendiente en MSF-499 (`pnpm dev:supabase` + Mailpit, `E2E_CORREO_KESTRA=1`).
