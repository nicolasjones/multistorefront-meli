-- F-STK-04 (MSF-249, épica MSF-231, FR-003, FR-006): emisión de `stock.actualizado`.
-- Esquema: sin tablas nuevas (escribe en public.cola_eventos; lee dominio.movimientos_stock).
--
-- Disparador AFTER INSERT sobre el libro de movimientos: cada cambio de cantidad es un
-- movimiento, y corre en la misma transacción que la RPC, de modo que una salida rechazada
-- o una transacción revertida no deja evento. Idempotente por movimiento
-- (`on conflict do nothing`). Definir el mínimo no inserta movimiento → no emite.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger movimientos_stock_emitir_evento on dominio.movimientos_stock;
--   drop function private.emitir_stock_actualizado();

create or replace function private.emitir_stock_actualizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
  values (
    new.organizacion_id,
    'stock.actualizado',
    new.id::text,
    jsonb_build_object(
      'organizacion_id', new.organizacion_id,
      'producto_id', new.producto_id,
      'movimiento_id', new.id,
      'tipo_movimiento', new.tipo,
      'cantidad', new.saldo,
      'diferencia', new.diferencia,
      'ocurrido_en', new.creado_en
    )
  )
  on conflict (organizacion_id, tipo, clave_idempotencia) do nothing;
  return new;
end;
$$;

revoke execute on function private.emitir_stock_actualizado() from public, anon, authenticated;

comment on function private.emitir_stock_actualizado() is
  'F-STK-04: encola stock.actualizado por cada movimiento de stock, en la misma transacción.';

create trigger movimientos_stock_emitir_evento
  after insert on dominio.movimientos_stock
  for each row execute function private.emitir_stock_actualizado();
