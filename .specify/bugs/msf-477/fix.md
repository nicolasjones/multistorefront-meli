# Bug Fix: Bloqueo de acceso server-side (Auth Hook de verificación de contraseña)

- **Slug**: msf-477
- **Jira**: MSF-477 (origen MSF-470, tarea T022 de `specs/20261012-140000-acceso-y-organizacion`)
- **Base**: `dokploy` (rama `fix/bug-MSF-477`, sin depender de ramas de épica)

## Qué se cambió

Se reaplicó sobre la línea integrada el trabajo de `feat/story-MSF-470` (PR #26 cerrado: su base, la rama de épica, se borró). Esa rama está obsoleta; se verificó que el diff aplica limpio y que la migración es compatible con las vigentes (`registrar_fallo_acceso` de `20261013190000`, `bloqueo_acceso_hasta` de `20261013200000`).

- `supabase/migrations/20261014100000_bloqueo_acceso_en_servidor.sql` (aditiva): hook `public.verificar_intento_acceso` (`password_verification_attempt`), HMAC-SHA256 del correo con secreto en Vault (`acceso_hmac`, generado en la migración, nunca en Git), conteo compartido `private.contar_fallo_acceso`, purga `private.purgar_intentos_acceso` invocada desde el hook, columna `ultimo_fallo_servidor` para no contar doble con el cliente. Grants: solo `supabase_auth_admin` ejecuta el hook; `revoke` a `public, anon, authenticated`.
- `supabase/config.toml`: `[auth.hook.password_verification_attempt]` habilitado (solo stack local).
- `apps/web/src/providers/authProvider.ts`: si Auth rechaza durante el intento (hook), consulta `bloqueo_acceso_hasta` para mostrar el mensaje de bloqueo.
- `supabase/tests/database/bloqueo_servidor.test.sql` (pgTAP), `authProvider.test.ts`, `scripts/verificar-hook-bloqueo.{test,e2e}.mjs`, `package.json` (`test:auth:hook-bloqueo[:e2e]`).
- Docs: `docs/acceso-ingreso.md`, `docs/deployment.md`, `tasks.md` (T022 con subtareas T022a/b/c).

## Decisiones

- El hook solo rechaza con mensaje propio cuando la contraseña es válida; con inválida continúa, para que `/token` no enumere usuarios (MSF-471/473).
- `registrar_fallo_acceso` sigue abierta a `anon` (cubre correos inexistentes); el DoS dirigido por correo persiste y queda documentado.
- Fuera de alcance: activación en Supabase Cloud STG/PROD (T022a/T022b, manual) y paso de CI (T022c, requiere scope `workflow`).

## Riesgos

- Migración de hash: contadores sha256 vigentes se pierden al pasar a HMAC (expiran en 15 min). Falla cerrada si falta el secreto de Vault.
- Un hook lento o con error bloquea todos los ingresos; usa lock advisory por correo y search_path vacío.
- Reversión: documentada en el encabezado de la migración.
