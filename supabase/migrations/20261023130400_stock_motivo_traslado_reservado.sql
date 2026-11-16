-- F-STK-15 (MSF-353, devolución del Revisor): el motivo de sistema «Traslado entre depósitos»
-- solo puede usarse desde `trasladar_stock`. Un movimiento con ese motivo y sin `traslado_id`
-- (p. ej. «Nuevo movimiento» manual) se rechaza: ensuciaría el libro y el rotulado «Traslado · …».
-- Esquema (Principio VII): sin tablas nuevas; el trigger vive sobre `dominio.movimientos_stock`.
--
-- Migración aditiva. Reversión:
--   drop trigger movimientos_stock_motivo_traslado on dominio.movimientos_stock;
--   drop function private.validar_motivo_traslado();

create or replace function private.validar_motivo_traslado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.traslado_id is null and new.motivo_id is not null and exists (
    select 1 from dominio.motivos_movimiento m
     where m.id = new.motivo_id
       and lower(btrim(m.nombre)) = 'traslado entre depósitos'
  ) then
    raise exception 'El motivo «Traslado entre depósitos» solo se usa al trasladar stock entre depósitos'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_motivo_traslado() from public, anon, authenticated;

comment on function private.validar_motivo_traslado() is
  'F-STK-15: impide registrar movimientos con el motivo de sistema «Traslado entre depósitos» fuera de trasladar_stock (sin traslado_id).';

create trigger movimientos_stock_motivo_traslado
  before insert on dominio.movimientos_stock
  for each row execute function private.validar_motivo_traslado();
