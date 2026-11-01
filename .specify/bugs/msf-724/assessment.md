# Bug Assessment: Chat IA ejecuta funciones `public` arbitrarias con privilegios del dueño (MSF-724)

- **Slug**: msf-724
- **Created**: 2026-11-01
- **Source**: pasted text (ticket MSF-724; sin URL)
- **Verdict**: valid
- **Severity**: critical

## Report (verbatim or summarized)

"[Bug] Cualquier usuario de una organización puede ejecutar funciones `public` arbitrarias con privilegios del dueño y llegar a la clave del proveedor de IA (chat IA)."

## Symptom

Un usuario autenticado puede lograr que `ejecutar_accion_chat_ia` invoque cualquier función de `public` (no solo las curadas en `acciones_chat_ia`), y esa invocación corre como el dueño de la función (security definer), no como el usuario. Esperado: solo RPC registradas por un superadmin para esa funcionalidad, ejecutadas con los privilegios del usuario.

## Reproduction

1. Usuario normal con `chat-ia` habilitado y una funcionalidad con `capacidades_chat_ia.ejecucion = true`.
2. Crear/obtener una conversación propia e insertar vía PostgREST un `mensajes_chat_ia` con `estado='propuesta'`, `accion_feature_id=<feature ejecutable>`, `accion_rpc='<cualquier función de public>'`, `accion_parametros={...}` (la policy `mensajes_chat_ia_propia` es `for all` y el grant incluye insert/update).
3. Llamar `rpc('ejecutar_accion_chat_ia', {p_mensaje_id})`.
4. La función ejecuta `select to_jsonb(r) from public.<rpc>(<args>)` como dueño y devuelve el resultado en el JSON.

[NEEDS CLARIFICATION: ruta exacta hasta la clave del proveedor de IA. `private.obtener_clave_credencial_ia` exige `session_user` miembro de `workers_orquestacion` (`20260920161734_configuracion_ia_gobernada.sql:90-110`) y vive en `private`, inalcanzable por `public.%I`. Hay que confirmar con pgTAP qué función `public` ejecutable por el dueño (p. ej. las revocadas a `authenticated` y reservadas a roles de worker/kestra, como `obtener_credencial_*`) devuelve secretos, o si el `session_user` de PostgREST cumple esa pertenencia.]

## Suspected Code Paths

- `supabase/migrations/20261005000500_chat_companion_ejecucion.sql:133-215` — `private.ejecutar_accion_chat_ia`: `security definer`, y el `accion_rpc` leído de `mensajes_chat_ia` se interpola con `format('... public.%I(%s)')` + `execute` (líneas ~188-195) SIN verificar que `(accion_feature_id, accion_rpc)` exista en `acciones_chat_ia`. El comentario "rpc viene de acciones_chat_ia, curada por un superadmin, nunca de entrada directa del usuario" es falso. El docstring dice "corre como el usuario" pero `security definer` ejecuta como dueño y se saltea los `revoke execute ... from authenticated` y la RLS.
- `supabase/migrations/20261005000000_chat_companion_mechanism.sql:111-130` — `mensajes_chat_ia_propia` (`for all`) + grant insert/update a `authenticated`: el usuario controla `estado`, `accion_rpc`, `accion_parametros` (columnas añadidas en 000500:9-12 sin restricción de escritura).
- `supabase/migrations/20261005000500_chat_companion_ejecucion.sql:93-125` — `puede_chat_ejecutar_funcionalidad` solo valida la feature, no la RPC.
- `apps/web/src/components/ia/ChatIAPanel.tsx:78` — llamador legítimo (`rpc('ejecutar_accion_chat_ia')`).
- `20260920161734_configuracion_ia_gobernada.sql:90-160` — destino sensible (clave en Vault); la defensa es el chequeo de rol, no el aislamiento por esquema.

## Root Cause Hypothesis

La RPC a ejecutar se toma de una fila que el propio usuario puede escribir, sin allowlist contra `acciones_chat_ia`, y se despacha con SQL dinámico dentro de una función `security definer` (privilegios del dueño, que ignoran revokes y RLS). Combinado, un usuario fabrica una "propuesta" arbitraria y ejecuta cualquier función de `public`, incluidas las reservadas a workers/servicio que manejan credenciales. Confianza: alta en el vector de ejecución arbitraria; media en el último salto hasta la clave (ver aclaración).

## Proposed Remediation

**Preferido** (migración nueva, aditiva, sin editar la histórica):
1. En `private.ejecutar_accion_chat_ia`, antes del `execute`, exigir `exists (select 1 from public.acciones_chat_ia where feature_id = v_mensaje.accion_feature_id and rpc = v_mensaje.accion_rpc)`; si no, marcar fallida y devolver error. Además validar que `accion_parametros` sea objeto y las claves sean parámetros reales de la función (`pg_proc`/`proargnames`).
2. Dejar de ejecutar con privilegios del dueño: o bien hacer la función `security invoker` (y que `private.*` auxiliares sigan siendo definer) o ejecutar el `execute` tras `set local role authenticated` + `request.jwt.claims` preservados, de modo que apliquen los grants/RLS del usuario. Así una RPC revocada a `authenticated` falla.
3. Cerrar la escritura: quitar insert/update de las columnas `estado`, `accion_*` a `authenticated` (grant por columna o policies separadas: el usuario solo inserta `origen='usuario'`; las propuestas las crea una RPC/server con la allowlist). Mover la creación de propuestas a una RPC que valide contra `acciones_chat_ia`.
4. Revocar a nivel de roles: confirmar que ninguna función `public` con secretos sea ejecutable por el dueño en este contexto y que `authenticator`/`authenticated` no sean miembros de `workers_orquestacion`.

**Alternativas**: solo allowlist (fix mínimo, deja la elevación latente para RPC curadas mal diseñadas); mover las acciones a registro de funciones con firma fija (más cambio).

**Files likely to change**:
- `supabase/migrations/<nueva>_chat_ia_ejecucion_allowlist.sql`
- `docs/` y/o `specs/20261005-chat-companion-mechanism/` (nota de seguridad; exigido por `pnpm docs:check`)
- `supabase/tests/` (pgTAP)

**Tests to add or update**:
- pgTAP: mensaje con `accion_rpc` no registrada → `fallida`, sin ejecución.
- pgTAP: RPC registrada en otra feature (par feature/rpc cruzado) → rechazada.
- pgTAP: usuario no puede insertar/actualizar `estado='propuesta'`/`accion_*` directamente.
- pgTAP: una función `public` revocada a `authenticated` no es invocable vía el chat.
- pgTAP: ningún camino devuelve `decrypted_secret` a `authenticated`.

## Risks & Considerations

- Migración aditiva (regla del repo); reversión: restaurar la versión previa de la función y los grants.
- Cambiar a ejecución con privilegios del usuario puede romper RPC legítimas que hoy dependen de definer; revisar las filas de `acciones_chat_ia`.
- Revisar si se ha explotado: auditar `ejecuciones_chat_ia`/`mensajes_chat_ia` con `accion_rpc` fuera de `acciones_chat_ia`; considerar rotar la clave del proveedor de IA si hay evidencia.
- Posibles flujos de UI/worker que insertan propuestas directo desde el cliente (verificar en `apps/web`).

## Open Questions

- [NEEDS CLARIFICATION: función concreta por la que se alcanza la clave del proveedor (ver Reproduction).]
- [NEEDS CLARIFICATION: ¿quién inserta hoy los mensajes `propuesta`: cliente o server?]
