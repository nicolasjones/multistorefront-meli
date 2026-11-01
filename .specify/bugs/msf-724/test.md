# Test: MSF-724

- pgTAP `supabase/tests/database/chat_ia_ejecucion_allowlist.test.sql` (9 aserciones): rpc no registrada → fallida; registrada pero revocada → rechazada; sin rpc → fallida; sin ejecuciones; insert de `accion_*` y update denegados; insert común permitido; proponer en conversación ajena denegado; anon sin EXECUTE.
- NO ejecutado localmente: no hay acceso a Docker/Supabase en este entorno. Queda al CI (`pnpm test:db`).
