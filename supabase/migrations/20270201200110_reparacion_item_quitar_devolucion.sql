-- F-SVC-11 (MSF-402, épica MSF-217, FR-020, FR-021, FR-024, FR-026): quitar un repuesto descontado lo devuelve al stock.
--
-- Esquema: sin tablas nuevas (Principio VII; escribe `dominio.reparacion_items` y, por `private.mover_stock_reparacion`,
-- `dominio.existencias(_deposito)` y el libro `dominio.movimientos_stock`, todo en `dominio`).
--
-- `private.devolver_stock_item_reparacion(org, item)`: si el ítem está `descontado`, registra la ENTRADA al depósito
-- ORIGINAL (aunque hoy esté inactivo: la mercadería vuelve físicamente ahí, FR-026) y lo marca `devuelto`. Cualquier
-- otro estado (`pendiente`, `sin_movimiento`, `consumido`, `devuelto`) no mueve stock (FR-024). Es idempotente: el
-- ítem se lee con `for update` y la `referencia` única del libro (`…:devolucion`) impide una segunda entrada (FR-021).
--
-- `public.quitar_item_reparacion(uuid)` conserva firma, gate y mensajes; bajo el bloqueo de la reparación devuelve el
-- stock, borra el ítem y recalcula los totales en UNA transacción. El segundo intento sobre el mismo ítem es `P0002`.
-- Orden de bloqueo: reparación → ítem → existencias (el mismo que al agregar).
--
-- Migración aditiva en datos. Reversión (migración posterior; las entradas ya registradas no se deshacen solas):
--   restaurar `quitar_item_reparacion(uuid)` de 20261022100400_reparacion_item_quitar.sql;
--   drop function private.devolver_stock_item_reparacion(uuid, uuid);

create or replace function private.devolver_stock_item_reparacion(p_organizacion uuid, p_item uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item dominio.reparacion_items;
begin
  select * into v_item
    from dominio.reparacion_items i
   where i.id = p_item and i.organizacion_id = p_organizacion
   for update;
  if not found or v_item.stock_estado <> 'descontado'
     or v_item.deposito_id is null or v_item.producto_id is null then
    return false;
  end if;

  perform private.mover_stock_reparacion(p_organizacion, v_item.reparacion_id, v_item.id, v_item.producto_id,
                                         v_item.deposito_id, v_item.cantidad, 'entrada');
  update dominio.reparacion_items set stock_estado = 'devuelto' where id = v_item.id;
  return true;
end;
$$;

revoke execute on function private.devolver_stock_item_reparacion(uuid, uuid) from public, anon, authenticated;

comment on function private.devolver_stock_item_reparacion(uuid, uuid) is
  'F-SVC-11: devuelve al depósito original un repuesto descontado (idempotente); no hace nada si no estaba descontado.';

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

  -- Otra sesión pudo quitarlo mientras esperábamos el bloqueo: se relee ya bajo el bloqueo.
  perform 1 from dominio.reparacion_items i where i.id = p_item_id and i.organizacion_id = v_org for update;
  if not found then
    raise exception 'El ítem no existe' using errcode = 'P0002';
  end if;

  perform private.devolver_stock_item_reparacion(v_org, p_item_id);

  delete from dominio.reparacion_items where id = p_item_id and organizacion_id = v_org;
  perform private.recalcular_totales_reparacion(v_reparacion);

  return private.reparacion_json(v_reparacion);
end;
$$;

comment on function public.quitar_item_reparacion(uuid) is
  'F-SVC-11: quita un ítem; si era un repuesto descontado lo devuelve a su depósito original y recalcula los totales en la misma transacción.';

revoke execute on function public.quitar_item_reparacion(uuid) from public, anon;
grant execute on function public.quitar_item_reparacion(uuid) to authenticated;
