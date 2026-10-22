-- F-SVC-06 (MSF-362, épica MSF-199): actividad de ítems de reparación.
-- Esquema: sin tablas nuevas (usa `dominio.reparacion_items` y `public.registro_actividad`; Principio VII).
--
-- Disparadores `security definer` sobre `dominio.reparacion_items` que registran
-- `reparacion.item_agregado` y `reparacion.item_quitado` en la MISMA transacción que la RPC (FR-029),
-- con el código visible (R-0001) y la descripción del ítem, nunca ids. Sin sesión (`auth.uid()` nulo:
-- migraciones, sembrados) no registran nada. La actividad lleva la tienda de la reparación.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger reparacion_items_registrar_actividad_alta on dominio.reparacion_items;
--   drop trigger reparacion_items_registrar_actividad_baja on dominio.reparacion_items;
--   drop function private.registrar_actividad_reparacion_item_alta();
--   drop function private.registrar_actividad_reparacion_item_baja();

create or replace function private.registrar_actividad_reparacion_item_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_rep dominio.reparaciones;
begin
  if v_actor is null then
    return new;
  end if;
  select * into v_rep from dominio.reparaciones r where r.id = new.reparacion_id;
  perform private.registrar_actividad(
    'reparacion.item_agregado',
    format('Agregó %s «%s» (x%s) a la reparación %s',
           case new.tipo when 'mano_obra' then 'mano de obra' else 'el repuesto' end,
           new.descripcion, new.cantidad, private.codigo_reparacion(v_rep.numero)),
    v_rep.empresa_id
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_reparacion_item_alta() from public, anon, authenticated;

create trigger reparacion_items_registrar_actividad_alta
  after insert on dominio.reparacion_items
  for each row execute function private.registrar_actividad_reparacion_item_alta();

create or replace function private.registrar_actividad_reparacion_item_baja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_rep dominio.reparaciones;
begin
  if v_actor is null then
    return old;
  end if;
  select * into v_rep from dominio.reparaciones r where r.id = old.reparacion_id;
  perform private.registrar_actividad(
    'reparacion.item_quitado',
    format('Quitó %s «%s» (x%s) de la reparación %s',
           case old.tipo when 'mano_obra' then 'la mano de obra' else 'el repuesto' end,
           old.descripcion, old.cantidad, private.codigo_reparacion(v_rep.numero)),
    v_rep.empresa_id
  );
  return old;
end;
$$;

revoke execute on function private.registrar_actividad_reparacion_item_baja() from public, anon, authenticated;

create trigger reparacion_items_registrar_actividad_baja
  after delete on dominio.reparacion_items
  for each row execute function private.registrar_actividad_reparacion_item_baja();
