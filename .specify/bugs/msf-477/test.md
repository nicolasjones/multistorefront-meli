# Bug Test: msf-477

## Ejecutado localmente
- `pnpm test:auth:hook-bloqueo` (chequeo estático del hook/config): 2/2 OK.
- `pnpm --filter @platform/web exec vitest run src/providers/authProvider.test.ts`: 36/36 OK (antes de la devolución).
- `pnpm --filter @platform/web exec vitest run src/providers/authProvider.test.ts`: 37/37 OK tras la segunda devolución (el caso de bloqueo ahora cubre rechazo del hook con código distinto de `invalid_credentials` y con `invalid_credentials`).
- `pnpm lint`: sin errores (solo warnings preexistentes). `pnpm docs:check`: OK.
- `pnpm build`: OK. `pnpm infra:config`: OK (solo avisos de variables sin definir, preexistentes).

## No ejecutado (queda para el CI / stack local)
- pgTAP `supabase/tests/database/bloqueo_servidor.test.sql` (`pnpm test:db`): este entorno no tiene acceso al daemon de Docker, no se pudo levantar `pnpm dev:supabase`.
- `pnpm test:auth:hook-bloqueo:e2e` (sintaxis verificada con `node --check`; imprime el `error_code` real de GoTrue al rechazar; 5 fallos + 6.º correcto contra `/auth/v1/token`): requiere el stack local; no corre en CI.

## Cobertura del criterio de aceptación
pgTAP (ahora 38 aserciones: bloqueado + inválida también rechaza, mismo mensaje que con válida, sin sumar fallos) cubre: rechazo con correo bloqueado y contraseña válida, bloqueo tras 5 fallos vía hook, limpieza con éxito, no doble conteo con el cliente, concurrencia, purga sin fallos y privilegios (`anon`/`authenticated` no ejecutan el hook).
## Requisito previo al merge (evidencia pendiente)
Correr en un stack local con Docker (`supabase stop && supabase start`, luego `pnpm test:db` y `pnpm test:auth:hook-bloqueo:e2e`) y pegar aquí la salida. Es la única prueba que ejerce el criterio central (llamado directo a `/token` bloqueado) y detectaría un cambio en el contrato del evento del hook (`user_id`/`valid`) que el pgTAP no ve. El límite local `sign_in_sign_ups` ya está en 100 para no dar falsos rojos por 429.

Veredicto: **parcial** — validación de BD pendiente de CI.
