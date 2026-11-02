# Fix: MSF-724

## Cambios
- `supabase/migrations/20270122110000_chat_ia_ejecucion_allowlist.sql`: allowlist `(feature, rpc)` en `acciones_chat_ia`; exige EXECUTE de `authenticated` sobre la función; revoca insert/update de `mensajes_chat_ia` y concede solo insert por columnas `conversacion_id, origen, contenido, estado`; nueva `public.proponer_accion_chat_ia` (anon revocado).
- `supabase/migrations/20270122110100_chat_ia_ejecucion_privilegios_usuario.sql`: `public.ejecutar_accion_chat_ia` pasa a `security invoker` (la RPC de negocio corre con grants y RLS de quien confirma); auditoría y estado quedan en funciones `private` definer; los parámetros se validan contra `pg_proc.proargnames`; feature elegida de forma determinista.
- `supabase/migrations/20270122110200_chat_ia_plataforma_solo_superadmin.sql`: retira `insert, update, delete` de `anon` y `authenticated` sobre `capacidades_chat_ia` y `acciones_chat_ia`. La escritura de la plataforma queda solo por las RPC de superadmin (`public.actualizar_capacidad_chat_lectura/ejecucion`) y, para la allowlist, por SQL de un superadmin. Antes el único freno era la RLS: el UPDATE de un usuario sobre `capacidades_chat_ia` no daba error, affectaba 0 filas.
- `supabase/functions/chat-ia-responder/index.ts`: la propuesta se crea vía `proponer_accion_chat_ia`.
- `supabase/tests/database/chat_ia_ejecucion_allowlist.test.sql`: el rechazo de la escritura de la plataforma vuelve a ser un error (42501) y no una fila filtrada; se agregan la allowlist como superficie de escritura, la propuesta escrita a mano (inerte) y el camino de gobernanza del superadmin.
- Doc: nota en `specs/20261005-chat-companion-mechanism/spec.md`.

## Devolución del PR #566 (CI `database` en rojo)
- El job `database` de la corrida 41303870696 (SHA 26a6debc) falló el test 21: "authenticated no puede habilitar la ejecucion de una funcionalidad ya registrada" — `caught: no exception`, `wanted: 42501`.
- La primera reacción fue relajar el test a "0 filas" (RLS filtrando en silencio). El gap es REAL, no del fixture: `authenticated` tenía `insert, update, delete` concedidos sobre las dos tablas de plataforma del chat y el único control era la RLS. Se corrige en el código (migración `20270122110200`) y el test vuelve a exigir el error.

## Desvíos
- No se usa `set local role authenticated`: PostgreSQL lo prohíbe dentro de `security definer`; se usa wrapper `security invoker` (ver cabecera de la 2.ª migración).
- La ruta exacta hasta la clave del proveedor no se verificó contra una base; queda cerrada por allowlist + privilegios del usuario.
- El cliente conserva `insert` de la columna `estado` en `mensajes_chat_ia` porque la Edge Function lo usa para marcar un mensaje como `fallida`. Un `propuesta` escrito a mano sin `accion_*` es inerte: la ejecución lo rechaza por "acción no registrada" (cubierto por pgTAP).
