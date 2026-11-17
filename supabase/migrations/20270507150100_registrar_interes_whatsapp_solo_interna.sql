-- MSF-657: `publico.registrar_interes_whatsapp` quedó abierta a `anon` y `authenticated` sin límite ni
-- idempotencia (inserta directo en `dominio.intereses_whatsapp`, sin pasar por la cuota de
-- `private.registrar_envio_tienda`): un anónimo con un dominio de tienda válido podía llenar la tabla y
-- falsear la métrica «interés por WhatsApp». La app ya no la usa: la tienda registra el contacto por
-- `publico.registrar_consulta_whatsapp` (con cuota). Mismo criterio que `publico.crear_consulta_publica`
-- (`20261212120800`): deja de ser pública y solo la ejecuta `service_role` (y el propietario).
--
-- Llamadores verificados (grep en apps/web, supabase/functions, workers, infra, Kestra): ninguno.
-- Esquemas (Principio VII): no se crean ni alteran tablas. Migración aditiva (solo privilegios).
-- Reversión (migración posterior):
--   grant execute on function publico.registrar_interes_whatsapp(text, uuid) to anon, authenticated;

revoke execute on function publico.registrar_interes_whatsapp(text, uuid) from public, anon, authenticated;
grant execute on function publico.registrar_interes_whatsapp(text, uuid) to service_role;

grant usage on schema publico to service_role;

comment on function publico.registrar_interes_whatsapp(text, uuid) is
  'F-CON-02: suma un interés por WhatsApp a un producto de la tienda del host. SOLO service_role (sin cuota anti-spam: no es pública desde MSF-657; la tienda usa registrar_consulta_whatsapp). Empresa solo por dominio; sin datos personales; P0002 genérico; 22023 producto inválido.';
