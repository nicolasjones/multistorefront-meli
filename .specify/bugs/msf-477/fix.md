# Bug Fix: Bloqueo de acceso server-side (Auth Hook de verificación de contraseña)

- **Slug**: msf-477
- **Jira**: MSF-477 (origen MSF-470, tarea T022 de `specs/20261012-140000-acceso-y-organizacion`)
- **Base**: `dokploy` (rama `fix/bug-MSF-477`, sin depender de ramas de épica). El PR #30 apunta a `dokploy` (5 commits propios, 14 archivos); un diff contra `main` arrastra la línea integrada, que no es el alcance de esta spec. El `git revert -m 1` del merge commit sobre `dokploy` deshace solo esta spec.

## Qué se cambió

Se reaplicó sobre la línea integrada el trabajo de `feat/story-MSF-470` (PR #26 cerrado: su base, la rama de épica, se borró). Esa rama está obsoleta; se verificó que el diff aplica limpio y que la migración es compatible con las vigentes (`registrar_fallo_acceso` de `20261013190000`, `bloqueo_acceso_hasta` de `20261013200000`).

- `supabase/migrations/20261014100000_bloqueo_acceso_en_servidor.sql` (aditiva): hook `public.verificar_intento_acceso` (`password_verification_attempt`), HMAC-SHA256 del correo con secreto en Vault (`acceso_hmac`, generado en la migración, nunca en Git), conteo compartido `private.contar_fallo_acceso`, purga `private.purgar_intentos_acceso` invocada desde el hook, columna `ultimo_fallo_servidor` para no contar doble con el cliente. Grants: solo `supabase_auth_admin` ejecuta el hook; `revoke` a `public, anon, authenticated`.
- `supabase/config.toml`: `[auth.hook.password_verification_attempt]` habilitado (solo stack local).
- `apps/web/src/providers/authProvider.ts`: si Auth rechaza durante el intento (hook), consulta `bloqueo_acceso_hasta` para mostrar el mensaje de bloqueo.
- `supabase/tests/database/bloqueo_servidor.test.sql` (pgTAP), `authProvider.test.ts`, `scripts/verificar-hook-bloqueo.{test,e2e}.mjs`, `package.json` (`test:auth:hook-bloqueo[:e2e]`).
- Docs: `docs/acceso-ingreso.md`, `docs/deployment.md`, `tasks.md` (T022 con subtareas T022a/b/c).

## Decisiones

- Devolución del Revisor (PR #30): con el correo bloqueado el hook rechaza SIEMPRE con el mismo mensaje, sea la contraseña válida o no (antes una inválida continuaba sin contar, lo que dejaba la fuerza bruta sin freno y delataba la correcta). El hash del correo se calcula una vez y se pasa a `private.contar_fallo_acceso(p_hash, p_servidor)` (un solo descifrado de Vault por fallo). Se restaura `.specify/extensions/.registry` (había quedado borrado). Comentarios de la migración y del test alineados con la limitación real de enumeración (`bloqueo_acceso_hasta`). Sin tope de inserciones para `registrar_fallo_acceso` (anon): queda para la historia de seguimiento que lo revoca a anon.
- `registrar_fallo_acceso` sigue abierta a `anon` (cubre correos inexistentes); el DoS dirigido por correo persiste y queda documentado.
- Fuera de alcance: activación en Supabase Cloud STG/PROD (T022a/T022b, manual) y paso de CI (T022c, requiere scope `workflow`).

## Riesgos

- Migración de hash: contadores sha256 vigentes se pierden al pasar a HMAC (expiran en 15 min). Falla cerrada si falta el secreto de Vault.
- Un hook lento o con error bloquea todos los ingresos; usa lock advisory por correo y search_path vacío.
- Reversión: documentada en el encabezado de la migración.

## Devolución del Revisor (PR #30)
- `authProvider.ts`: la consulta posterior a `bloqueo_acceso_hasta` tolera un rechazo de la promesa (try/catch) y cae al mensaje técnico/genérico; test con RPC rechazada.
- `docs/acceso-ingreso.md`: se quita la afirmación de que `/token` no sirve para enumerar usuarios y se documenta la limitación real (oráculo vía `bloqueo_acceso_hasta`, seguimiento en gateway/Edge Function).
- `tasks.md`: la nota de T022 cita `0ac7d13` (commit real en esta rama).
- Se revierten los cambios ajenos de `.specify/extensions*` (upgrade de la extensión `bug`, modos de scripts); `.registry` se restauró en la devolución del Revisor.
- `supabase/config.toml`: `sign_in_sign_ups` local sube de 30 a 100 para que el e2e (~29 llamados a `/token` por IP en 5 min) no falle por 429 en vez de por el hook (solo stack local).
- Docs: T022c y `docs/acceso-ingreso.md` aclaran que `pnpm test` ya incluye el chequeo estático; el paso explícito en `validate.yml` es opcional.
- No se cambia: recálculo del hash en `contar_fallo_acceso` y tope de flood anónimo (Baja, sin pgTAP ejecutable en este entorno; ver T022c/seguimiento).
