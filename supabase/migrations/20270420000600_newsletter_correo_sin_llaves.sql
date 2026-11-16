-- MSF-468, endurecimiento de la revisión de #1057: el correo del suscriptor no admite llaves (`{`, `}`).
-- El correo se muestra en el campo `to` del flow, que pasa por el motor de plantillas de Kestra: una parte local como `{{envs.x}}@dominio.com`
-- cumplía la forma estricta de la Fase 1 (el átomo admitía `{}`) y llegaría a ese motor. Se quitan `{` y `}` del átomo permitido, en el validador
-- público y en un CHECK de la tabla. El reclamo del lote además omite («Correo inválido») cualquier destinatario, de clientes o de suscriptores,
-- cuyo correo tenga `{`, `}` o `%` (cubre filas anteriores y clientes sin tocar sus fichas).
--
-- Esquemas (Principio VII): solo `private` (validador) y una restricción de `dominio.newsletter_suscriptores`.
-- Aditiva e idempotente. El CHECK nace `not valid`: exige la regla en altas y cambios nuevos sin escanear ni romper filas existentes (no puede haber
-- suscriptores válidos con llaves: la bandera nace apagada). Reversión (migración posterior): `alter table dominio.newsletter_suscriptores drop constraint
-- newsletter_suscriptores_correo_llaves_ck;` y restaurar `private.validar_suscripcion_newsletter(text, boolean)` de `20270342000100`.

alter table dominio.newsletter_suscriptores drop constraint if exists newsletter_suscriptores_correo_llaves_ck;
alter table dominio.newsletter_suscriptores
  add constraint newsletter_suscriptores_correo_llaves_ck check (correo !~ '[{}]') not valid;

create or replace function private.validar_suscripcion_newsletter(p_correo text, p_consentimiento boolean)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_correo text := lower(btrim(coalesce(p_correo, '')));
  v_campos text[] := '{}';
begin
  if v_correo = '' or char_length(v_correo) > 254 or v_correo !~ '^[a-z0-9''+_=&*#$?^~-]+(\.[a-z0-9''+_=&*#$?^~-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
     or char_length(split_part(v_correo, '@', 1)) > 64 then
    v_campos := array_append(v_campos, 'correo');
  end if;
  if p_consentimiento is distinct from true then
    v_campos := array_append(v_campos, 'consentimiento');
  end if;
  return v_campos;
end;
$$;

revoke execute on function private.validar_suscripcion_newsletter(text, boolean) from public, anon, authenticated;
