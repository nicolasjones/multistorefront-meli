-- F-STK-14 (MSF-316, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas,
-- FR-013, D-6): `stock.actualizado` con depósito, reservado y disponible.
-- Esquema: sin tablas nuevas (escribe en public.cola_eventos; lee dominio.existencias).
--
-- Se amplía la carga con tres campos ADITIVOS; los consumidores existentes siguen válidos:
--   deposito_id  uuid     depósito sobre el que se aplicó el movimiento
--   reservado    integer  unidades reservadas en TOTAL (suma de depósitos) tras el movimiento
--   disponible   integer  cantidad − reservado en TOTAL tras el movimiento
-- `cantidad` sigue siendo el stock total único y `diferencia` el cambio del movimiento. Los
-- canales externos ven totales (D-5/D-6). Sigue emitiéndose una vez por movimiento, en la
-- misma transacción (el disparador es AFTER INSERT sobre el libro, que
-- registrar_movimiento_stock inserta DESPUÉS de aplicar el cambio, así que `existencias` ya
-- refleja el resultado).
--
-- CONTRATO que cambia (alto riesgo, gate humano): carga de `stock.actualizado`, solo aditivo.
--
-- Migración aditiva. Reversión (migración posterior):
--   restaurar `private.emitir_stock_actualizado` de 20261021161000_stock_evento_actualizado.sql.

create or replace function private.emitir_stock_actualizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservado integer;
  v_cantidad integer;
begin
  select e.reservado, e.cantidad into v_reservado, v_cantidad
    from dominio.existencias e
   where e.producto_id = new.producto_id and e.organizacion_id = new.organizacion_id;

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
      'deposito_id', new.deposito_id,
      'reservado', coalesce(v_reservado, 0),
      'disponible', coalesce(v_cantidad, new.saldo) - coalesce(v_reservado, 0),
      'ocurrido_en', clock_timestamp()
    )
  )
  on conflict (organizacion_id, tipo, clave_idempotencia) do nothing;
  return new;
end;
$$;

revoke execute on function private.emitir_stock_actualizado() from public, anon, authenticated;

comment on function private.emitir_stock_actualizado() is
  'F-STK-04/F-STK-14: encola stock.actualizado por cada movimiento de stock (con deposito_id, reservado y disponible totales), en la misma transacción.';
