-- F-STK-03 (MSF-173, devolución del Revisor): el disparador de inmutabilidad también se
-- disparaba con el borrado en cascada de `public.organizaciones` (FK `on delete cascade`),
-- por lo que no se podía dar de baja una organización con movimientos.
--
-- Ahora el borrado de fila se deja pasar solo cuando la organización padre ya no existe
-- (es decir, es la cascada); un `delete` directo sobre movimientos sigue rechazado. La
-- función pasa a *security definer* para que el chequeo no dependa de la RLS de quien borra.
-- Esquema (Principio VII): no se crea ni altera ninguna tabla. Migración aditiva
-- (reemplaza el cuerpo de la función). Reversión: volver a la definición de
-- 20261017150000_stock_historial_inmutable.sql.

create or replace function private.rechazar_cambio_movimiento_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and tg_level = 'ROW'
     and not exists (select 1 from public.organizaciones o where o.id = old.organizacion_id) then
    return old;
  end if;
  raise exception 'Los movimientos de stock no se pueden modificar' using errcode = '42501';
end;
$$;

revoke execute on function private.rechazar_cambio_movimiento_stock() from public, anon, authenticated;
