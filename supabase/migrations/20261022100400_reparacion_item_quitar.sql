-- F-SVC-06 (MSF-362, épica MSF-199): `quitar_item_reparacion`.
-- Esquema: sin tablas nuevas (borra de `dominio.reparacion_items` solo desde esta RPC; Principio VII).
--
-- SECURITY DEFINER. Ubica la reparación del ítem de la organización de la sesión, aplica la misma
-- compuerta que agregar (`edicion`, tienda accesible, bloqueo `for update`, 55000 si está entregada o
-- anulada) y recalcula los totales en la misma transacción. Un ítem inexistente o de otra organización
-- es `P0002`. No toca stock.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.quitar_item_reparacion(uuid);

create or replace function public.quitar_item_reparacion(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_reparacion uuid;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede modificar los ítems de una reparación' using errcode = '42501';
  end if;
  select i.reparacion_id into v_reparacion
    from dominio.reparacion_items i
   where i.id = p_item_id and i.organizacion_id = v_org;
  if not found then
    raise exception 'El ítem no existe' using errcode = 'P0002';
  end if;

  perform private.bloquear_reparacion_para_items(v_reparacion);

  -- Otra sesión pudo quitarlo mientras esperábamos el bloqueo.
  delete from dominio.reparacion_items where id = p_item_id and organizacion_id = v_org;
  if not found then
    raise exception 'El ítem no existe' using errcode = 'P0002';
  end if;

  perform private.recalcular_totales_reparacion(v_reparacion);

  return private.reparacion_json(v_reparacion);
end;
$$;

comment on function public.quitar_item_reparacion(uuid) is
  'F-SVC-06: quita un ítem y recalcula los totales en la misma transacción; mismas reglas de permiso y situación que agregar.';

revoke execute on function public.quitar_item_reparacion(uuid) from public, anon;
grant execute on function public.quitar_item_reparacion(uuid) to authenticated;
