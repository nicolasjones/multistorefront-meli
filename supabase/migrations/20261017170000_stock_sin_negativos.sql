-- F-STK-06 (MSF-214, épica MSF-136, FR-016, FR-017): el stock nunca queda en negativo.
-- Esquema: sin tablas nuevas; endurece `dominio.existencias` (dominio, Principio VII),
-- que ya tiene RLS y no admite escritura directa de la app.
--
-- Doble barrera en la base, válida para la RPC, el SQL directo y futuras RPC:
--   1) `check (cantidad >= 0)`: red de seguridad estructural.
--   2) Disparador BEFORE INSERT/UPDATE OF cantidad: rechaza con «No hay stock
--      suficiente» y el detalle «Hay N unidades y la salida es de M…» (SQLSTATE
--      23514, el mismo del check, para que la interfaz lo distinga).
-- El rechazo ocurre dentro de la transacción de quien escribe: no queda cambio de
-- cantidad, ni fila en `movimientos_stock`, ni evento de actividad (FR-017). La
-- concurrencia la serializa `select … for update` de la RPC; en SQL directo, un
-- UPDATE concurrente re-evalúa la fila ya bloqueada y el disparador ve el valor vigente.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger existencias_sin_negativos on dominio.existencias;
--   drop function private.rechazar_stock_negativo();
--   alter table dominio.existencias drop constraint existencias_cantidad_no_negativa;

create or replace function private.rechazar_stock_negativo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_hay integer := case when tg_op = 'UPDATE' then old.cantidad else 0 end;
  v_pedida integer := v_hay - new.cantidad;
begin
  if new.cantidad < 0 then
    raise exception 'No hay stock suficiente'
      using errcode = '23514',
            detail = format('Hay %s %s y la salida es de %s.',
              v_hay, case when v_hay = 1 then 'unidad' else 'unidades' end, v_pedida);
  end if;
  return new;
end;
$$;

revoke execute on function private.rechazar_stock_negativo() from public, anon, authenticated;

create trigger existencias_sin_negativos
  before insert or update of cantidad on dominio.existencias
  for each row execute function private.rechazar_stock_negativo();

alter table dominio.existencias
  add constraint existencias_cantidad_no_negativa check (cantidad >= 0);

comment on function private.rechazar_stock_negativo() is
  'F-STK-06: rechaza con «No hay stock suficiente» cualquier escritura que deje existencias.cantidad en negativo.';
