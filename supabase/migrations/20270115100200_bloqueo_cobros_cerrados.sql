-- F-VTA-33 (MSF-349, spec 20261027-100000-ventas-mejoras, FR-022): una caja cerrada no admite
-- registrar ni modificar cobros de ese día.
--
-- Esquema (Principio VII): solo un disparador sobre `dominio.cobros_comprobante` (MSF-195, existente).
-- No altera columnas ni políticas de esa tabla. Bloquea toda escritura, venga de la RPC que venga
-- (registrar_cobro, conciliación, contrarreembolsos).
--
-- Migración aditiva. Reversión:
--   drop trigger cobros_comprobante_caja_cerrada on dominio.cobros_comprobante;
--   drop function private.bloquear_cobro_caja_cerrada();

create or replace function private.bloquear_cobro_caja_cerrada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Mismo candado que cerrar_caja: un cobro no se cuela entre el resumen y el cierre.
  perform private.candado_caja(new.empresa_id, new.registrado_en::date);
  if private.caja_cerrada(new.empresa_id, new.registrado_en::date) then
    raise exception 'La caja de ese día está cerrada; reabrila para registrar o modificar cobros'
      using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.registrado_en::date <> new.registrado_en::date then
    perform private.candado_caja(old.empresa_id, old.registrado_en::date);
    if private.caja_cerrada(old.empresa_id, old.registrado_en::date) then
      raise exception 'La caja de ese día está cerrada; reabrila para registrar o modificar cobros'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.bloquear_cobro_caja_cerrada() from public, anon, authenticated;

create trigger cobros_comprobante_caja_cerrada
  before insert or update on dominio.cobros_comprobante
  for each row execute function private.bloquear_cobro_caja_cerrada();
