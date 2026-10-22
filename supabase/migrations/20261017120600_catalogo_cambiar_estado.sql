-- F-CAT-06 (MSF-462, épica MSF-456): activar / desactivar un producto y evento de Actividad.
-- Esquema: sin tablas nuevas (usa `dominio.productos`; Principio VII).
--
-- `cambiar_estado_producto` es SECURITY INVOKER: rigen las políticas RLS del llamador
-- (sección `productos` en edición). Solo cambia la columna `activo`: nombre, SKU, precio,
-- costo e imágenes quedan intactos (SC-005); nunca se borra nada (no hay DELETE).
-- Es idempotente: pedir el estado que el producto ya tiene no escribe ni registra evento.
-- El disparador registra `producto.activado` / `producto.desactivado` ante cualquier cambio
-- real de `activo` (también si alguien actualiza la columna directo), sin costo ni precio.
-- `updated_at` avanza con el cambio de estado (lo hace `productos_updated_at_real`, M4), así
-- una ficha abierta en otra pestaña detecta el conflicto al guardar.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger productos_registrar_actividad_estado on dominio.productos;
--   drop function private.registrar_actividad_producto_estado();
--   drop function public.cambiar_estado_producto(uuid, boolean);

create or replace function public.cambiar_estado_producto(p_id uuid, p_activo boolean)
returns dominio.productos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.productos;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los productos' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  -- Serializa cambios concurrentes del mismo producto; RLS acota a la organización.
  select * into v_fila from dominio.productos where id = p_id for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.productos set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.cambiar_estado_producto(uuid, boolean) is
  'F-CAT-06: activa o desactiva un producto sin tocar sus datos; idempotente; solo con edición en Productos.';

revoke execute on function public.cambiar_estado_producto(uuid, boolean) from public, anon;
grant execute on function public.cambiar_estado_producto(uuid, boolean) to authenticated;

-- ============================================================================
-- Actividad (FR-016): solo ante cambio real de `activo`, misma transacción.
-- ============================================================================

create or replace function private.registrar_actividad_producto_estado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or new.activo is not distinct from old.activo then
    return new;
  end if;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor,
    case when new.activo then 'producto.activado' else 'producto.desactivado' end,
    format('%s el producto %s%s',
      case when new.activo then 'Activó' else 'Desactivó' end,
      new.nombre,
      case when new.sku is null then '' else format(' (SKU %s)', new.sku) end),
    null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_producto_estado() from public, anon, authenticated;

create trigger productos_registrar_actividad_estado
  after update of activo on dominio.productos
  for each row execute function private.registrar_actividad_producto_estado();
