-- Seguridad retroactiva de #1008: `private.confirmar_claves_diferidas()` hacía `set constraints all immediate` y luego
-- `set constraints all deferred`: dejaba DIFERIDA toda restricción diferible de la transacción, incluso las declaradas
-- `deferrable initially immediate`. Ahora la vuelta restaura el modo de declaración: solo se vuelven a diferir las
-- restricciones `deferrable initially deferred` (`pg_constraint.condeferred`), con nombre calificado; las que nacen
-- inmediatas quedan inmediatas. Mismo contrato para quien la llama (comprueba, traduce el 23503 a P0001).
--
-- Reversión (migración posterior): recrear la función con la definición de
-- `20270324120300_baja_organizacion_reparaciones_y_error_diferido.sql`.

create or replace function private.confirmar_claves_diferidas()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_restriccion text;
  v_tabla text;
  v_diferidas text;
begin
  begin
    set constraints all immediate;
  exception when foreign_key_violation then
    get stacked diagnostics v_restriccion = constraint_name, v_tabla = table_name;
    raise exception 'No se puede borrar: el registro está en uso por otros datos.'
      using errcode = 'P0001',
            detail = format('restricción %s, tabla %s', coalesce(v_restriccion, '?'), coalesce(v_tabla, '?')),
            hint = 'Eliminá o reasigná primero los datos que lo usan.';
  end;

  -- Solo las que se declararon `initially deferred` (y solo claves foráneas, únicas y de exclusión diferibles).
  select string_agg(format('%I.%I', n.nspname, k.conname), ', ' order by n.nspname, k.conname)
    into v_diferidas
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_namespace n on n.oid = k.connamespace
   where k.condeferrable and k.condeferred;

  if v_diferidas is not null then
    execute 'set constraints ' || v_diferidas || ' deferred';
  end if;
end
$$;

comment on function private.confirmar_claves_diferidas() is
  'Fuerza la comprobación de las claves foráneas diferidas y traduce el 23503 a un error de negocio (P0001). Después restaura el modo de declaración: solo vuelven a diferirse las restricciones initially deferred; las deferrable initially immediate siguen inmediatas. Llamarla al final de una RPC que borre tablas con claves diferidas.';

revoke execute on function private.confirmar_claves_diferidas() from public, anon, authenticated;
