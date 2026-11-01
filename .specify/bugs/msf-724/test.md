# Test: MSF-724

- pgTAP `supabase/tests/database/chat_ia_ejecucion_allowlist.test.sql` (23 aserciones): rpc no registrada → fallida; registrada pero revocada → rechazada; sin rpc → fallida; ejecución registrada con auditoría; parámetros no declarados rechazados; insert de `accion_*` y update denegados; proponer en conversación ajena denegado; anon sin EXECUTE.
- NO ejecutado localmente: sin Docker/Supabase en este entorno. Queda al CI (`pnpm test:db`).
- Local: `pnpm docs:check` y `verificar-migraciones` OK.
