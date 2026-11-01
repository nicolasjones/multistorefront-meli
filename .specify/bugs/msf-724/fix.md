# Fix: MSF-724

Resolución: slug explícito (único candidato en disco).

## Cambios
- `supabase/migrations/20270121120000_chat_ia_ejecucion_allowlist.sql`: allowlist `(feature, rpc)` en `acciones_chat_ia`; exige EXECUTE de `authenticated` sobre la función (el definer ya no saltea revokes); valida `accion_parametros` objeto; revoca insert/update de `mensajes_chat_ia` y concede solo insert por columnas `conversacion_id, origen, contenido, estado`; nueva `public.proponer_accion_chat_ia` (anon revocado).
- `supabase/functions/chat-ia-responder/index.ts`: la propuesta se crea vía esa RPC.
- Doc: nota en `specs/20261005-chat-companion-mechanism/spec.md`.

## Desvíos
- No se cambió a `set local role authenticated` (no verificable sin base local): se usó el chequeo `has_function_privilege`, que bloquea las funciones revocadas; las RPC registradas siguen corriendo como dueño con `auth.uid()` del usuario.
- La ruta exacta hasta la clave del proveedor no se verificó; queda cerrada igual por allowlist.
