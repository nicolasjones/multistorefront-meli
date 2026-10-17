-- F-CAT-04 (MSF-460, épica MSF-456): edición de producto por RPC y evento de Actividad.
-- Esquema: sin tablas nuevas (usa `dominio.productos` / `dominio.producto_costos`;
-- Principio VII).
--
-- `actualizar_producto` es SECURITY INVOKER: rigen las políticas RLS del llamador
-- (sección `productos` en edición; el costo exige `rentabilidad` en edición).
-- Bloqueo optimista (Decisión 4): el llamador envía el `updated_at` que leyó; si la
-- fila cambió desde entonces se rechaza con 40001 y no se pisa nada en silencio.
-- `p_costo` nulo = no tocar el costo (no hay baja de costo en esta historia).
-- `updated_at` solo avanza ante cambios reales (también ante un cambio de costo).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger productos_registrar_actividad_edicion on dominio.productos;
--   drop trigger productos_updated_at_real on dominio.productos;
--   drop function private.registrar_actividad_producto_editado();
--   drop function private.conservar_updated_at_producto();
--   drop function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric);

create or replace function public.actualizar_producto(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_descripcion text,
  p_sku text,
  p_compatible_con text[],
  p_moneda text,
  p_precio_lista numeric,
  p_costo numeric default null
)
returns dominio.productos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.productos;
  v_fila dominio.productos;
  v_costo_cambio boolean := false;
  v_filas integer;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if p_costo is not null and (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar el costo' using errcode = '42501';
  end if;

  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre del producto es obligatorio' using errcode = '22023';
  end if;
  if p_moneda is null or p_moneda not in ('USD', 'ARS') then
    raise exception 'La moneda debe ser USD o ARS' using errcode = '22023';
  end if;
  if p_precio_lista is null or p_precio_lista <= 0 or p_precio_lista <> round(p_precio_lista, 2) then
    raise exception 'El precio de lista debe ser mayor a cero y tener hasta 2 decimales' using errcode = '22023';
  end if;
  if p_costo is not null and (p_costo < 0 or p_costo <> round(p_costo, 2)) then
    raise exception 'El costo no puede ser negativo y admite hasta 2 decimales' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes del mismo producto; RLS acota a la organización.
  select * into v_actual from dominio.productos where id = p_id for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El producto fue modificado por otra persona' using errcode = '40001';
  end if;

  if p_costo is not null then
    insert into dominio.producto_costos as c (producto_id, organizacion_id, costo)
    values (p_id, v_actual.organizacion_id, p_costo)
    on conflict (producto_id) do update set costo = excluded.costo
      where c.costo is distinct from excluded.costo;
    get diagnostics v_filas = row_count;
    v_costo_cambio := v_filas > 0;
  end if;

  -- Avisa al disparador de updated_at que un cambio de costo cuenta como cambio real.
  perform set_config('catalogo.costo_cambio', case when v_costo_cambio then 'on' else 'off' end, true);

  update dominio.productos
     set nombre = p_nombre,
         descripcion = p_descripcion,
         sku = p_sku,
         compatible_con = coalesce(p_compatible_con, '{}'),
         moneda = p_moneda,
         precio_lista = p_precio_lista
   where id = p_id
  returning * into v_fila;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;

  perform set_config('catalogo.costo_cambio', 'off', true);
  return v_fila;
end;
$$;

comment on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric) is
  'F-CAT-04: edita un producto con bloqueo optimista por updated_at (40001 ante conflicto); costo solo con edición en Rentabilidad, nulo = sin cambio.';

revoke execute on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric) from public, anon;
grant execute on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric) to authenticated;

-- ============================================================================
-- updated_at solo avanza ante cambios reales. Corre después de
-- `productos_normalizar` (orden alfabético de disparadores), que ya normalizó
-- los valores nuevos y pisó updated_at con now().
-- ============================================================================

create or replace function private.conservar_updated_at_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('catalogo.costo_cambio', true), 'off') <> 'on'
     and (new.nombre, new.sku, new.descripcion, new.compatible_con, new.moneda, new.precio_lista, new.activo)
         is not distinct from
         (old.nombre, old.sku, old.descripcion, old.compatible_con, old.moneda, old.precio_lista, old.activo) then
    new.updated_at := old.updated_at;
  else
    -- now() es constante en la transacción: sin esto una 2.ª edición en la misma
    -- transacción repetiría updated_at y no dejaría evento ni avanzaría el bloqueo.
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.conservar_updated_at_producto() from public, anon, authenticated;

create trigger productos_updated_at_real
  before update on dominio.productos
  for each row execute function private.conservar_updated_at_producto();

-- ============================================================================
-- Actividad (FR-010): solo ante cambios reales, sin costo, misma transacción.
-- El cambio de estado (activo) lo registra F-CAT-06, no este evento.
-- ============================================================================

create or replace function private.registrar_actividad_producto_editado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or new.updated_at is not distinct from old.updated_at then
    return new;
  end if;
  if new.activo is distinct from old.activo
     and (new.nombre, new.sku, new.descripcion, new.compatible_con, new.moneda, new.precio_lista)
         is not distinct from
         (old.nombre, old.sku, old.descripcion, old.compatible_con, old.moneda, old.precio_lista) then
    return new;
  end if;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'producto.editado',
    format('Editó el producto %s%s', new.nombre, case when new.sku is null then '' else format(' (SKU %s)', new.sku) end),
    null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_producto_editado() from public, anon, authenticated;

create trigger productos_registrar_actividad_edicion
  after update on dominio.productos
  for each row execute function private.registrar_actividad_producto_editado();
