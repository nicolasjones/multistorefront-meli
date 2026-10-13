# Bug Test: msf-477

## Ejecutado localmente
- `pnpm test:auth:hook-bloqueo` (chequeo estático del hook/config): 2/2 OK.
- `pnpm --filter @platform/web exec vitest run src/providers/authProvider.test.ts`: 36/36 OK (antes de la devolución).
- `pnpm --filter @platform/web exec vitest run src/providers/authProvider.test.ts`: 37/37 OK tras la devolución (nuevo caso: la RPC de bloqueo rechaza la promesa).
- `pnpm lint`: sin errores (solo warnings preexistentes). `pnpm docs:check`: OK.
- `pnpm build`: OK. `pnpm infra:config`: OK (solo avisos de variables sin definir, preexistentes).

## No ejecutado (queda para el CI / stack local)
- pgTAP `supabase/tests/database/bloqueo_servidor.test.sql` (`pnpm test:db`): este entorno no tiene acceso al daemon de Docker, no se pudo levantar `pnpm dev:supabase`.
- `pnpm test:auth:hook-bloqueo:e2e` (5 fallos + 6.º correcto contra `/auth/v1/token`): requiere el stack local; no corre en CI.

## Cobertura del criterio de aceptación
pgTAP cubre: rechazo con correo bloqueado y contraseña válida, bloqueo tras 5 fallos vía hook, limpieza con éxito, no doble conteo con el cliente, concurrencia, purga sin fallos y privilegios (`anon`/`authenticated` no ejecutan el hook).
Veredicto: **parcial** — validación de BD pendiente de CI.
