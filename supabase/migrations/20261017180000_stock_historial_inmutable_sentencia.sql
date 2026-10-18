-- F-STK-03 (MSF-173, devolución del CTO, AGE-382): defensa en profundidad de la inmutabilidad.
--
-- El disparador `FOR EACH ROW` no se dispara si la RLS oculta todas las filas (no hay policy de
-- UPDATE/DELETE): un `update`/`delete` con privilegio afectaba 0 filas y no levantaba nada.
-- Se agrega un disparador `BEFORE UPDATE OR DELETE ... FOR EACH STATEMENT` que rechaza con 42501
-- aunque no haya filas visibles.
--
-- El borrado en cascada de `public.organizaciones` (FK `on delete cascade`) corre como acción
-- referencial dentro del disparador RI de la organización, es decir con `pg_trigger_depth() > 1`
-- en este disparador; esa cascada se deja pasar (las filas igual las revisa el disparador de fila,
-- que solo admite el borrado cuando la organización padre ya no existe). Una sentencia directa
-- (profundidad 1) siempre se rechaza.
--
-- Esquema (Principio VII): no se crea ni altera ninguna tabla. Migración aditiva.
-- Reversión (migración posterior):
--   drop trigger movimientos_stock_inmutable_sentencia on dominio.movimientos_stock;
--   drop function private.rechazar_sentencia_movimiento_stock();

create or replace function private.rechazar_sentencia_movimiento_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return null;
  end if;
  raise exception 'Los movimientos de stock no se pueden modificar' using errcode = '42501';
end;
$$;

revoke execute on function private.rechazar_sentencia_movimiento_stock() from public, anon, authenticated;

create trigger movimientos_stock_inmutable_sentencia
  before update or delete on dominio.movimientos_stock
  for each statement execute function private.rechazar_sentencia_movimiento_stock();
