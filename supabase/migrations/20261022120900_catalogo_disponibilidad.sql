-- F-CAT-17 (MSF-335, épica MSF-179): disponibilidad del producto (Stock / Sin stock derivadas;
-- A pedido / Stock entrante en breve elegibles).
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.productos.disponibilidad_manual   dominio (columna aditiva)   la tabla ya vive en `dominio`; hereda su RLS.
--   private.disponibilidad_producto(uuid)     private (función)           contrato de lectura para MSF-292 (solo la etiqueta).
--   private.productos_con_stock()             private (función)           versión por lotes que usa la vista (una sola evaluación).
--   public.v_productos_listado                public (VISTA, no tabla)    `create or replace` con `disponibilidad` AL FINAL;
--                                                                         security_invoker, sin costo, sin `anon`.
-- No se crea ninguna tabla.
--
-- Hasta MSF-292 (depósitos y reservas): disponible = existencias.cantidad y reservado = 0. Cuando MSF-292
-- llegue, SOLO se cambia el cuerpo de estas dos funciones (deben seguir dando el mismo resultado).
-- Las funciones son `security definer` para que quien NO tiene acceso a Stock vea la etiqueta correcta sin
-- ver cantidades; filtran por private.organizacion_id() y exigen lectura en `productos`.
--
-- CAMBIO DE CONTRATO (alto riesgo): se reemplazan `crear_producto` (+1 parámetro final opcional) y
-- `actualizar_producto` (+2). Los llamadores anteriores siguen funcionando: en `actualizar_producto` la
-- disponibilidad solo cambia con `p_cambiar_disponibilidad = true`. Se conservan
-- `revoke ... from public, anon` y `grant execute ... to authenticated`.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos de disponibilidad_manual):
--   restaurar las RPC, los disparadores de 20261019120000 y la vista de 20261020140200, y luego
--   drop function private.disponibilidad_producto(uuid);
--   drop function private.productos_con_stock();
--   alter table dominio.productos drop column disponibilidad_manual;

alter table dominio.productos
  add column disponibilidad_manual text,
  add constraint productos_disponibilidad_manual_valor check (disponibilidad_manual is null or disponibilidad_manual in ('a_pedido', 'stock_entrante'));

comment on column dominio.productos.disponibilidad_manual is
  'F-CAT-17: elección manual de disponibilidad (a_pedido | stock_entrante). Nulo = se deriva de las existencias.';

-- Las RPC son security invoker: los privilegios de `authenticated` son por columna.
grant insert (disponibilidad_manual) on dominio.productos to authenticated;
grant update (disponibilidad_manual) on dominio.productos to authenticated;

-- ============================================================================
-- Derivación (contrato para MSF-292): devuelve solo la etiqueta.
--   a_pedido | stock_entrante (manual manda) | stock | sin_stock. Nulo si el producto no es visible.
-- ============================================================================

create or replace function private.disponibilidad_producto(p_producto_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p.disponibilidad_manual,
    case
      when coalesce((select e.cantidad
                       from dominio.existencias e
                      where e.producto_id = p.id and e.organizacion_id = p.organizacion_id), 0) > 0
        then 'stock'
      else 'sin_stock'
    end
  )
    from dominio.productos p
   where p.id = p_producto_id
     and p.organizacion_id = (select private.organizacion_id())
     and (select private.nivel_seccion('productos')) in ('lectura', 'edicion');
$$;

comment on function private.disponibilidad_producto(uuid) is
  'F-CAT-17: disponibilidad del producto (a_pedido | stock_entrante | stock | sin_stock) en la organización de la sesión. Manual manda; si no, existencias.cantidad > 0 (− reservado, desde MSF-292). Solo la etiqueta, nunca cantidades. Exige lectura en productos; nulo si no existe o es de otra organización.';

revoke execute on function private.disponibilidad_producto(uuid) from public, anon;
grant execute on function private.disponibilidad_producto(uuid) to authenticated;

-- Versión por lotes: ids de los productos de la organización con disponible > 0. La vista la evalúa una
-- sola vez (subconsulta no correlacionada) en lugar de una llamada por fila. Mismo criterio que la anterior.
create or replace function private.productos_con_stock()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.producto_id
    from dominio.existencias e
   where e.organizacion_id = (select private.organizacion_id())
     and e.cantidad > 0
     and (select private.nivel_seccion('productos')) in ('lectura', 'edicion');
$$;

comment on function private.productos_con_stock() is
  'F-CAT-17: ids de los productos de la organización con disponible > 0 (existencias.cantidad hoy; − reservado desde MSF-292). Para la vista del listado; mismo criterio que private.disponibilidad_producto(uuid).';

revoke execute on function private.productos_con_stock() from public, anon;
grant execute on function private.productos_con_stock() to authenticated;

-- ============================================================================
-- RPC: alta y edición aceptan la disponibilidad manual
-- ============================================================================

drop function public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text);
drop function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean);

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
  p_codigo_barras text default null,
  p_disponibilidad_manual text default null
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
  if p_disponibilidad_manual is not null and p_disponibilidad_manual not in ('a_pedido', 'stock_entrante') then
    raise exception 'La disponibilidad solo puede ser A pedido o Stock entrante en breve' using errcode = '22023';
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

  insert into dominio.productos (organizacion_id, nombre, sku, descripcion, compatible_con, moneda, precio_lista, proveedor_id, codigo_proveedor, codigo_barras, disponibilidad_manual)
  values (v_organizacion_id, p_nombre, p_sku, p_descripcion, coalesce(p_compatible_con, '{}'), p_moneda, p_precio_lista, p_proveedor_id, p_codigo_proveedor, nullif(btrim(p_codigo_barras), ''), p_disponibilidad_manual)
  returning * into v_fila;

  if p_costo is not null then
    insert into dominio.producto_costos (producto_id, organizacion_id, costo)
    values (v_fila.id, v_organizacion_id, p_costo);
  end if;

  return v_fila;
end;
$$;

comment on function public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text, text) is
  'F-CAT-02: alta de producto (activo) en la organización de la sesión; costo opcional solo con edición en Rentabilidad. Sin stock inicial. F-PRV-03: proveedor y código del proveedor opcionales. MSF-529: código de barras (13 dígitos, único por organización) opcional. F-CAT-17: disponibilidad manual opcional (a_pedido | stock_entrante).';

revoke execute on function public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text, text) from public, anon;
grant execute on function public.crear_producto(text, text, text, text[], text, numeric, numeric, uuid, text, text, text) to authenticated;


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
  p_cambiar_codigo_barras boolean default false,
  p_disponibilidad_manual text default null,
  p_cambiar_disponibilidad boolean default false
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
  if p_disponibilidad_manual is not null and p_disponibilidad_manual not in ('a_pedido', 'stock_entrante') then
    raise exception 'La disponibilidad solo puede ser A pedido o Stock entrante en breve' using errcode = '22023';
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
         codigo_barras = case when coalesce(p_cambiar_codigo_barras, false) then nullif(btrim(p_codigo_barras), '') else codigo_barras end,
         disponibilidad_manual = case when coalesce(p_cambiar_disponibilidad, false) then p_disponibilidad_manual else disponibilidad_manual end
   where id = p_id
  returning * into v_fila;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;

  perform set_config('catalogo.costo_cambio', 'off', true);
  return v_fila;
end;
$$;

comment on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean) is
  'F-CAT-04: edita un producto con bloqueo optimista por updated_at (40001 ante conflicto); costo solo con edición en Rentabilidad, nulo = sin cambio. F-PRV-03: proveedor y código solo cambian con p_cambiar_proveedor = true (default false = sin cambio); con true se reemplazan (nulo = sin proveedor, limpia el código). MSF-529: el código de barras solo cambia con p_cambiar_codigo_barras = true (nulo = sin código). F-CAT-17: la disponibilidad manual solo cambia con p_cambiar_disponibilidad = true (nulo = quitar la elección y volver a la derivada).';

revoke execute on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean) from public, anon;
grant execute on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean) to authenticated;


-- ============================================================================
-- updated_at y actividad cuentan también la disponibilidad manual.
-- ============================================================================

create or replace function private.conservar_updated_at_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('catalogo.costo_cambio', true), 'off') <> 'on'
     and (new.nombre, new.sku, new.descripcion, new.compatible_con, new.moneda, new.precio_lista, new.activo,
          new.proveedor_id, new.codigo_proveedor, new.codigo_barras, new.disponibilidad_manual)
         is not distinct from
         (old.nombre, old.sku, old.descripcion, old.compatible_con, old.moneda, old.precio_lista, old.activo,
          old.proveedor_id, old.codigo_proveedor, old.codigo_barras, old.disponibilidad_manual) then
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
          new.proveedor_id, new.codigo_proveedor, new.codigo_barras, new.disponibilidad_manual)
         is not distinct from
         (old.nombre, old.sku, old.descripcion, old.compatible_con, old.moneda, old.precio_lista,
          old.proveedor_id, old.codigo_proveedor, old.codigo_barras, old.disponibilidad_manual) then
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

-- ============================================================================
-- Vista del listado: `disponibilidad` al final (sin costo)
-- ============================================================================

create or replace view public.v_productos_listado
with (security_invoker = true) as
select
  p.id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.activo,
  (select i.ruta
     from dominio.producto_imagenes i
    where i.producto_id = p.id and i.organizacion_id = p.organizacion_id
    order by i.posicion
    limit 1) as imagen_ruta,
  p.updated_at,
  coalesce(
    (select array_agg(pe.empresa_id order by pe.empresa_id)
       from dominio.producto_empresa pe
      where pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id),
    '{}'::uuid[]
  ) as empresa_ids,
  p.categoria_id,
  (select case when cp.id is null then c.nombre else cp.nombre || ' > ' || c.nombre end
     from dominio.categorias c
     left join dominio.categorias cp on cp.id = c.padre_id and cp.organizacion_id = c.organizacion_id
    where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ruta,
  (select array_remove(array[c.id, c.padre_id], null)
     from dominio.categorias c
    where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ids,
  -- F-CAT-17: misma regla que private.disponibilidad_producto(uuid), evaluada por lotes.
  coalesce(
    p.disponibilidad_manual,
    case when p.id in (select private.productos_con_stock()) then 'stock' else 'sin_stock' end
  ) as disponibilidad
from dominio.productos p;

comment on view public.v_productos_listado is
  'F-CAT-01/07/08/17: listado de productos (id, nombre, SKU, estado, imagen principal, empresa_ids, categoría, disponibilidad). security_invoker: rige la RLS de las tablas base. Sin costo. Las historias siguientes agregan columnas al final.';

revoke all on public.v_productos_listado from public, anon;
grant select on public.v_productos_listado to authenticated;
