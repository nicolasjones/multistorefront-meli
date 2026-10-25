-- MSF-437 · F-TDA-16 (devolución del Revisor, PR #360): `publico.crear_consulta_publica` deja de ser pública.
--
-- Hasta ahora `anon` y `authenticated` podían llamarla directo por PostgREST y saltearse el anti-spam
-- (5 envíos por hora, FR-TDA-16-5) que aplica `publico.enviar_consulta_contacto`. Desde acá solo la ejecutan
-- `service_role` y el propietario (la RPC `enviar_consulta_contacto` es SECURITY DEFINER y la invoca vía
-- `private.entregar_a_bandeja`). Invocadores verificados: `enviar_consulta_contacto` (formulario) y los
-- pgTAP / E2E de MSF-186, que pasan a `service_role`. Origen `whatsapp` (F-TDA-14) no la llama desde la app.
--
-- Esquema: sin tablas nuevas. Migración aditiva (solo privilegios). Reversión (migración posterior):
--   grant execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) to anon, authenticated;

revoke execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function publico.crear_consulta_publica(text, text, text, text, text, uuid) to service_role;
