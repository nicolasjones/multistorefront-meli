-- F-PRE-01 (MSF-115, épica MSF-114): evento `producto.precio_actualizado`.
-- Esquema: sin tablas nuevas (usa `public.registro_actividad`; Principio VII).
--
-- Disparadores `security definer` registran, en la misma transacción, un cambio de moneda,
-- de precio de lista (antes → después) o de costo. Sin evento si no cambió nada (guardar lo
-- mismo es idempotente) ni al crear el producto (no hay «antes»). El detalle del COSTO no
-- lleva importes: la Actividad la ve quien no tiene la sección `rentabilidad`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger producto_costos_registrar_precio on dominio.producto_costos;
--   drop trigger productos_registrar_precio on dominio.productos;
--   drop function private.registrar_precio_costo_producto();
--   drop function private.registrar_precio_producto();

create or replace function private.registrar_precio_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or (new.moneda, new.precio_lista) is not distinct from (old.moneda, old.precio_lista) then
    return new;
  end if;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'producto.precio_actualizado',
    format('Cambió el precio de lista de %s: %s %s → %s %s',
      new.nombre, old.moneda, replace(old.precio_lista::text, '.', ','),
      new.moneda, replace(new.precio_lista::text, '.', ',')),
    null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_precio_producto() from public, anon, authenticated;

create trigger productos_registrar_precio
  after update on dominio.productos
  for each row execute function private.registrar_precio_producto();

create or replace function private.registrar_precio_costo_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_nombre text;
begin
  if v_actor is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.costo is not distinct from old.costo then
    return new;
  end if;
  select p.nombre into v_nombre
    from dominio.productos p
   where p.id = new.producto_id
     -- Alta del producto: el costo inicial viaja en la misma transacción y no es un cambio.
     and (tg_op = 'UPDATE' or p.creado_en <> now());
  if v_nombre is null then
    return new;
  end if;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'producto.precio_actualizado',
    format('Cambió el costo de %s', v_nombre),
    null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_precio_costo_producto() from public, anon, authenticated;

create trigger producto_costos_registrar_precio
  after insert or update on dominio.producto_costos
  for each row execute function private.registrar_precio_costo_producto();
