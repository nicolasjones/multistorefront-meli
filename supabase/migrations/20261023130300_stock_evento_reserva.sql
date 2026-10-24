-- F-STK-16 (MSF-337, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas,
-- FR-038, D-6): reservar y liberar cambian el disponible sin tocar la cantidad, así que no pasan por el
-- libro y no disparaban `stock.actualizado`. Los canales venden contra el disponible: se emite el evento
-- con `diferencia = 0` y la carga ampliada de F-STK-14 (deposito_id, reservado, disponible).
-- Esquema: sin tablas nuevas (escribe en public.cola_eventos; lee dominio.existencias).
--
--   AFTER INSERT sobre dominio.reservas_stock                      → tipo_movimiento = 'reserva'
--   AFTER UPDATE (activa → liberada) sobre dominio.reservas_stock  → tipo_movimiento = 'liberacion'
-- Descontar NO emite desde acá: ya lo emite la salida que registra en el libro (disparador de
-- F-STK-04), así no hay dos eventos por el mismo cambio. Las RPC aplican el cambio de existencias ANTES
-- de escribir la reserva, por lo que `existencias` ya refleja el resultado al disparar.
--
-- Clave de idempotencia: `<reserva_id>:reserva` / `<reserva_id>:liberacion` (única por tipo de evento;
-- un reintento no duplica). `movimiento_id` es nulo y la carga suma `reserva_id`.
--
-- CONTRATO que cambia (alto riesgo, gate humano): `tipo_movimiento` admite dos valores nuevos
-- (`reserva`, `liberacion`) además de entrada|salida|ajuste; aditivo, ver docs/stock-eventos.md.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger reservas_stock_evento_alta on dominio.reservas_stock;
--   drop trigger reservas_stock_evento_liberacion on dominio.reservas_stock;
--   drop function private.emitir_stock_reserva();

create or replace function private.emitir_stock_reserva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cantidad integer;
  v_reservado integer;
  v_tipo text := case tg_op when 'INSERT' then 'reserva' else 'liberacion' end;
begin
  select e.cantidad, e.reservado into v_cantidad, v_reservado
    from dominio.existencias e
   where e.producto_id = new.producto_id and e.organizacion_id = new.organizacion_id;

  insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
  values (
    new.organizacion_id,
    'stock.actualizado',
    new.id::text || ':' || v_tipo,
    jsonb_build_object(
      'organizacion_id', new.organizacion_id,
      'producto_id', new.producto_id,
      'movimiento_id', null,
      'reserva_id', new.id,
      'tipo_movimiento', v_tipo,
      'cantidad', coalesce(v_cantidad, 0),
      'diferencia', 0,
      'deposito_id', new.deposito_id,
      'reservado', coalesce(v_reservado, 0),
      'disponible', coalesce(v_cantidad, 0) - coalesce(v_reservado, 0),
      'ocurrido_en', clock_timestamp()
    )
  )
  on conflict (organizacion_id, tipo, clave_idempotencia) do nothing;
  return new;
end;
$$;

revoke execute on function private.emitir_stock_reserva() from public, anon, authenticated;

comment on function private.emitir_stock_reserva() is
  'F-STK-16: encola stock.actualizado (diferencia 0, carga ampliada) al reservar o liberar, en la misma transacción. Descontar lo emite por su salida.';

create trigger reservas_stock_evento_alta
  after insert on dominio.reservas_stock
  for each row execute function private.emitir_stock_reserva();

create trigger reservas_stock_evento_liberacion
  after update of estado on dominio.reservas_stock
  for each row
  when (old.estado = 'activa' and new.estado = 'liberada')
  execute function private.emitir_stock_reserva();
