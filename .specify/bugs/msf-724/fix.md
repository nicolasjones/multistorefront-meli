# Fix: MSF-724

## Cambios
- `supabase/migrations/20270122110000_chat_ia_ejecucion_allowlist.sql`: allowlist `(feature, rpc)` en `acciones_chat_ia`; exige EXECUTE de `authenticated` sobre la función; revoca insert/update de `mensajes_chat_ia` y concede solo insert por columnas `conversacion_id, origen, contenido, estado`; nueva `public.proponer_accion_chat_ia` (anon revocado).
- `supabase/migrations/20270122110100_chat_ia_ejecucion_privilegios_usuario.sql`: `public.ejecutar_accion_chat_ia` pasa a `security invoker` (la RPC de negocio corre con grants y RLS de quien confirma); auditoría y estado quedan en funciones `private` definer; los parámetros se validan contra `pg_proc.proargnames`; feature elegida de forma determinista.
- `supabase/functions/chat-ia-responder/index.ts`: la propuesta se crea vía `proponer_accion_chat_ia`.
- Doc: nota en `specs/20261005-chat-companion-mechanism/spec.md`.

## Desvíos
- No se usa `set local role authenticated`: PostgreSQL lo prohíbe dentro de `security definer`; se usa wrapper `security invoker` (ver cabecera de la 2.ª migración).
- La ruta exacta hasta la clave del proveedor no se verificó contra una base; queda cerrada por allowlist + privilegios del usuario.
