# Test: MSF-724

- pgTAP `supabase/tests/database/chat_ia_ejecucion_allowlist.test.sql` (23 aserciones): rpc no registrada → fallida; registrada pero revocada → rechazada; sin rpc → fallida; ejecución registrada con auditoría; parámetros no declarados rechazados; insert de `accion_*` y update denegados; proponer en conversación ajena denegado; anon sin EXECUTE.
- NO ejecutado localmente: sin Docker/Supabase en este entorno. Queda al CI (`pnpm test:db`).
- Local: `pnpm docs:check` y `verificar-migraciones` OK.
- CI `database` (run 41288961781): "Bad plan, 23 planeadas / 9 ejecutadas". Causa: fixture del test, no la migración — la propuesta fabricada `d4` comparte rpc con la propuesta real, `t_propuestas` guardaba dos filas y la subconsulta escalar fallaba. Arreglo: `t_propuestas` solo toma `estado = 'propuesta'`. Sigue sin poder correrse localmente (sin Docker).
