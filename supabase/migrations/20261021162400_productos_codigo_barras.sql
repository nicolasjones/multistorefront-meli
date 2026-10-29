-- MSF-529 (seguimiento de MSF-205): código de barras (EAN-13) del producto, según el prototipo
-- (ProductoAlta/ProductoEditar «Código de barras (EAN-13)»). Decisiones: opcional; 13 dígitos
-- (sin validar dígito verificador: hay códigos internos); único por organización; solo por producto
-- (el de variantes es de otra épica de Catálogo).
-- Esquema (Principio VII): `dominio.productos` sigue en `dominio`; solo se agrega una columna.
--
-- CAMBIO DE CONTRATO (alto riesgo): se reemplazan `crear_producto` (+1 parámetro final opcional) y
-- `actualizar_producto` (+2). Los llamadores anteriores siguen funcionando sin perder datos: en
-- `actualizar_producto` el código solo cambia con `p_cambiar_codigo_barras = true`.
-- Reversión de grants: revoke insert (codigo_barras), update (codigo_barras) ... from authenticated.
-- Se conservan `revoke ... from public, anon` y `grant execute ... to authenticated`.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos): restaurar las RPC
-- y los disparadores de 20261021162200 y luego
--   drop index dominio.productos_org_codigo_barras_uidx;
--   alter table dominio.productos drop column codigo_barras;

alter table dominio.productos
  add column codigo_barras text,
  add constraint productos_codigo_barras_formato check (codigo_barras is null or codigo_barras ~ '^[0-9]{13}$');

comment on column dominio.productos.codigo_barras is
  'Código de barras EAN-13 del producto (13 dígitos, opcional, único por organización).';

create unique index IF NOT EXISTS productos_org_codigo_barras_uidx on dominio.productos (organizacion_id, codigo_barras)
  where codigo_barras is not null;

-- Las RPC son security invoker: los privilegios de `authenticated` son por columna.
grant insert (codigo_barras) on dominio.productos to authenticated;
grant update (codigo_barras) on dominio.productos to authenticated;

drop function IF EXISTS public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text);
drop function IF EXISTS public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean);

create or replace function public.crear_producto(
  p_nombre text,
  p_descripcion text,
  p_sku text,
  p_compatible_con text[],
  p_moneda text,
  p_precio_lista numeric,
  p_costo numeric default null,
  p_proveedor_id uuid default null,
  p_codigo_proveedor text default null,
  p_codigo_barras text default null
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
  if p_codigo_proveedor is not null and btrim(p_codigo_proveedor) <> '' and p_proveedor_id is null then
    raise exception 'El código del proveedor requiere elegir un proveedor' using errcode = '22023';
  end if;
  if nullif(btrim(p_codigo_barras), '') is not null and btrim(p_codigo_barras) !~ '^[0-9]{13}$' then
    raise exception 'El código de barras debe tener 13 dígitos' using errcode = '22023';
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

  insert into dominio.productos (organizacion_id, nombre, sku, descripcion, compatible_con, moneda, precio_lista, proveedor_id, codigo_proveedor, codigo_barras)
  values (v_organizacion_id, p_nombre, p_sku, p_descripcion, coalesce(p_compatible_con, '{}'), p_moneda, p_precio_lista, p_proveedor_id, p_codigo_proveedor, nullif(btrim(p_codigo_barras), ''))
  returning * into v_fila;

  if p_costo is not null then
    insert into dominio.producto_costos (producto_id, organizacion_id, costo)
    values (v_fila.id, v_organizacion_id, p_costo);
  end if;

  return v_fila;
end;
$$;

comment on function public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text) is
  'F-CAT-02: alta de producto (activo) en la organización de la sesión; costo opcional solo con edición en Rentabilidad. Sin stock inicial. F-PRV-03: proveedor y código del proveedor opcionales. MSF-529: código de barras (13 dígitos, único por organización) opcional.';

revoke execute on function public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text) to authenticated;


create or replace function public.actualizar_producto(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_descripcion text,
  p_sku text,
  p_compatible_con text[],
  p_moneda text,
  p_precio_lista numeric,
  p_costo numeric default null,
  p_proveedor_id uuid default null,
  p_codigo_proveedor text default null,
  p_cambiar_proveedor boolean default false,
  p_codigo_barras text default null,
  p_cambiar_codigo_barras boolean default false
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
  if coalesce(p_cambiar_proveedor, false) and p_codigo_proveedor is not null and btrim(p_codigo_proveedor) <> '' and p_proveedor_id is null then
    raise exception 'El código del proveedor requiere elegir un proveedor' using errcode = '22023';
  end if;
  if nullif(btrim(p_codigo_barras), '') is not null and btrim(p_codigo_barras) !~ '^[0-9]{13}$' then
    raise exception 'El código de barras debe tener 13 dígitos' using errcode = '22023';
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
         precio_lista = p_precio_lista,
         proveedor_id = case when coalesce(p_cambiar_proveedor, false) then p_proveedor_id else proveedor_id end,
         codigo_proveedor = case when coalesce(p_cambiar_proveedor, false) then p_codigo_proveedor else codigo_proveedor end,
         codigo_barras = case when coalesce(p_cambiar_codigo_barras, false) then nullif(btrim(p_codigo_barras), '') else codigo_barras end
   where id = p_id
  returning * into v_fila;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;

  perform set_config('catalogo.costo_cambio', 'off', true);
  return v_fila;
end;
$$;

comment on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean) is
  'F-CAT-04: edita un producto con bloqueo optimista por updated_at (40001 ante conflicto); costo solo con edición en Rentabilidad, nulo = sin cambio. F-PRV-03: proveedor y código solo cambian con p_cambiar_proveedor = true (default false = sin cambio); con true se reemplazan (nulo = sin proveedor, limpia el código). MSF-529: el código de barras solo cambia con p_cambiar_codigo_barras = true (nulo = sin código).';

revoke execute on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean) from public, anon;
grant execute on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean) to authenticated;


-- ============================================================================
-- updated_at y actividad cuentan también el código de barras.
-- ============================================================================

create or replace function private.conservar_updated_at_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('catalogo.costo_cambio', true), 'off') <> 'on'
     and (new.nombre, new.sku, new.descripcion, new.compatible_con, new.moneda, new.precio_lista, new.activo,
          new.proveedor_id, new.codigo_proveedor, new.codigo_barras)
         is not distinct from
         (old.nombre, old.sku, old.descripcion, old.compatible_con, old.moneda, old.precio_lista, old.activo,
          old.proveedor_id, old.codigo_proveedor, old.codigo_barras) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.conservar_updated_at_producto() from public, anon, authenticated;

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
     and (new.nombre, new.sku, new.descripcion, new.compatible_con, new.moneda, new.precio_lista,
          new.proveedor_id, new.codigo_proveedor, new.codigo_barras)
         is not distinct from
         (old.nombre, old.sku, old.descripcion, old.compatible_con, old.moneda, old.precio_lista,
          old.proveedor_id, old.codigo_proveedor, old.codigo_barras) then
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
