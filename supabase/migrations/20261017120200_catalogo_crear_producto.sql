-- F-CAT-02 (MSF-458, épica MSF-456): alta de producto por RPC y evento de Actividad.
-- Esquema: sin tablas nuevas (usa `dominio.productos` / `dominio.producto_costos`
-- de la migración anterior; Principio VII).
--
-- `crear_producto` es SECURITY INVOKER: rigen las políticas RLS del llamador
-- (sección `productos` en edición; el costo exige `rentabilidad` en edición).
-- No recibe stock (FR-002) ni organización (sale de la sesión).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger productos_registrar_actividad on dominio.productos;
--   drop function private.registrar_actividad_producto();
--   drop function public.crear_producto(text, text, text, text[], text, numeric, numeric);

create or replace function public.crear_producto(
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
  v_organizacion_id uuid := (select private.organizacion_id());
  v_fila dominio.productos;
begin
  if v_organizacion_id is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede crear productos' using errcode = '42501';
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

  insert into dominio.productos (organizacion_id, nombre, sku, descripcion, compatible_con, moneda, precio_lista)
  values (v_organizacion_id, p_nombre, p_sku, p_descripcion, coalesce(p_compatible_con, '{}'), p_moneda, p_precio_lista)
  returning * into v_fila;

  if p_costo is not null then
    insert into dominio.producto_costos (producto_id, organizacion_id, costo)
    values (v_fila.id, v_organizacion_id, p_costo);
  end if;

  return v_fila;
end;
$$;

comment on function public.crear_producto(text, text, text, text[], text, numeric, numeric) is
  'F-CAT-02: alta de producto (activo) en la organización de la sesión; costo opcional solo con edición en Rentabilidad. Sin stock inicial.';

revoke execute on function public.crear_producto(text, text, text, text[], text, numeric, numeric) from public, anon;
grant execute on function public.crear_producto(text, text, text, text[], text, numeric, numeric) to authenticated;

-- ============================================================================
-- Actividad (FR-006): misma transacción, sin costo en el detalle, solo con sesión.
-- ============================================================================

create or replace function private.registrar_actividad_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'producto.creado',
      format('Creó el producto %s%s', new.nombre, case when new.sku is null then '' else format(' (SKU %s)', new.sku) end),
      null
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_producto() from public, anon, authenticated;

create trigger productos_registrar_actividad
  after insert on dominio.productos
  for each row execute function private.registrar_actividad_producto();
