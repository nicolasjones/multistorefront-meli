# Bug Assessment: Bloqueo de acceso por correo no se aplica en el servidor (Auth Hook de verificación de contraseña)

- **Slug**: msf-477
- **Created**: 2026-10-13
- **Source**: pasted text (Jira MSF-477, historia MSF-470 / seguimiento T022 de MSF-150)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

"[MSF-470] Bloqueo de acceso server-side (Auth Hook de verificación de contraseña)" (Jira MSF-477). Corresponde a la tarea T022 de `specs/20261012-140000-acceso-y-organizacion/tasks.md:99`: endurecer el bloqueo de intentos en el servidor (Auth Hook o Edge Function) para cerrar el llamado directo a `/auth/v1/token`, con HMAC con secreto para el hash del correo y purga periódica de `intentos_acceso`. No se proporcionó URL; no se hizo ningún fetch.

## Symptom

El bloqueo de 5 fallos / 15 min (FR-003) lo aplica solo el cliente (`authProvider.login`). Quien llame directo a `POST /auth/v1/token?grant_type=password` evita el bloqueo y puede probar contraseñas sin límite por correo (el rate limit nativo de Auth es por IP). Esperado: el servidor rechaza el ingreso de un correo bloqueado y cuenta los fallos sin depender del cliente.

## Reproduction

1. Llamar `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` con un correo válido y contraseñas incorrectas más de 5 veces.
2. Verificar que `intentos_acceso` no registra los fallos (solo los registra el cliente vía RPC) y que el 6.º intento sigue evaluando la contraseña (con la correcta, devuelve sesión) pese al "bloqueo".
3. [NEEDS CLARIFICATION: confirmar contra el stack local `pnpm dev:supabase`; no se ejecutó en esta fase de solo diagnóstico.]

## Suspected Code Paths

- `apps/web/src/providers/authProvider.ts:31-80` — `login` consulta `bloqueo_acceso_hasta` y registra con `registrar_fallo_acceso` desde el navegador; el control es evitable.
- `supabase/migrations/20261012140200_intentos_acceso.sql` — tabla `intentos_acceso`, `bloqueo_acceso_hasta`, `registrar_fallo_acceso` (abierta a `anon`; DoS dirigido aceptado, hash sha256 sin sal).
- `supabase/migrations/20261013200000_bloqueo_acceso_corta_antes_de_hashear.sql` y `20261013170000/180000/190000` — versiones vigentes de las RPC y de la purga (solo purga cuando alguien falla).
- `supabase/config.toml:315-317` — solo está habilitado el hook `custom_access_token` (`public.registrar_inicio_sesion`); no existe `[auth.hook.password_verification_attempt]`.
- `docs/acceso-ingreso.md` (sección Bloqueo) — documenta la limitación y la remite a T022.

## Root Cause Hypothesis

El bloqueo se diseñó en el cliente (MSF-150) porque Supabase Auth no ofrece límite por correo; falta el control del lado del servidor. No hay ningún Auth Hook `password_verification_attempt` que consulte/actualice `intentos_acceso` en cada verificación de contraseña, de modo que el endpoint `/auth/v1/token` queda sin protección. Confianza: alta.

## Proposed Remediation

**Preferred**: Hook de Postgres `password_verification_attempt` (`pg-functions://postgres/public/hook_verificacion_contrasena`, habilitado en `config.toml`). Recibe `{user_id, valid}`: si el correo del usuario (se resuelve por `auth.users`) está bloqueado devuelve `{"decision":"reject","message":...}` (también con contraseña correcta); si `valid=false` registra el fallo (misma lógica atómica que `registrar_fallo_acceso`); si `valid=true` y no bloqueado limpia el contador y devuelve `continue`. Migración nueva y aditiva: la función con `security definer`, `grant execute ... to supabase_auth_admin` y `revoke ... from public, anon, authenticated`, más acceso a `intentos_acceso` para `supabase_auth_admin`. Incluir en la misma migración: HMAC con secreto (p. ej. en `vault`/ajuste de BD) para `hash_correo_acceso` (con migración de filas existentes o ventana de convivencia), y purga periódica con `pg_cron` (si la extensión está disponible) o job de Kestra, independiente de los fallos. El cliente conserva el chequeo previo solo como UX; `registrar_fallo_acceso` pasa a no ser necesaria desde `anon` (se puede revocar para cerrar el DoS dirigido, actualizando `authProvider.ts`, el test pgTAP de superficie anon y `docs/acceso-ingreso.md`). Ojo: el hook solo corre en planes que lo soporten (Pro/self-hosted); verificar en el entorno desplegado.

**Alternatives**:
- Edge Function proxy delante de `/auth/v1/token`: más control, pero no cierra el endpoint directo salvo bloqueando la ruta en el gateway; mayor complejidad.
- Mantener el diseño actual y documentar el riesgo: no cierra el bug.

**Files likely to change**:
- `supabase/migrations/<nueva>_hook_verificacion_contrasena.sql`
- `supabase/config.toml`
- `apps/web/src/providers/authProvider.ts` (y `authProvider.test.ts`)
- `supabase/tests/database/` (nuevo pgTAP del hook; ajustar test de superficie `anon`)
- `docs/acceso-ingreso.md`, `specs/20261012-140000-acceso-y-organizacion/tasks.md` (T022)

**Tests to add or update**:
- pgTAP: con correo bloqueado el hook rechaza aunque `valid=true`; 5 fallos con `valid=false` bloquean; `valid=true` limpia el contador; `anon`/`authenticated` no pueden ejecutar el hook.
- pgTAP: la purga periódica elimina filas vencidas sin intervención de un fallo; el HMAC no coincide con sha256 simple.
- Vitest: `authProvider` sigue mostrando los mensajes bloqueado/genérico/servicio con el nuevo flujo.

## Risks & Considerations

- Migración con cambio de hash: las filas existentes se invalidan (aceptable, expiran en 15 min) o requieren doble lectura temporal. Debe ser aditiva o con reversión documentada (regla del repo).
- Un hook que falla o es lento rompe todos los ingresos: debe ser mínimo, sin excepciones no controladas.
- Sigue existiendo DoS dirigido por correo (inherente al bloqueo por correo); mitigarlo solo si se revoca `registrar_fallo_acceso` a `anon`.
- El secreto del HMAC no puede ir a Git (solo `.env.example`/vault).
- Disponibilidad del hook por plan/entorno; revisar `pnpm infra:config` y `pnpm docs:check`.

## Open Questions

- [NEEDS CLARIFICATION: ¿el entorno desplegado soporta el hook `password_verification_attempt`?]
- [NEEDS CLARIFICATION: ¿`pg_cron` disponible o la purga va por Kestra?]
- [NEEDS CLARIFICATION: ¿se revoca `registrar_fallo_acceso` a `anon` en esta misma historia?]
