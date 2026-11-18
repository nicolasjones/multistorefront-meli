-- MSF-723 (lote 38): vaciar el costo en la ficha del producto debe BORRARLO.
-- Decisión tomada: `public.actualizar_producto` leía un costo nulo como «sin cambio»; ahora el borrado es explícito con
-- `p_borrar_costo boolean default false` (distingue «no enviado» de «vaciar»), igual que los demás campos opcionales
-- (`p_cambiar_proveedor`, `p_cambiar_codigo_barras`, `p_cambiar_disponibilidad`).
--
-- Esquema (Principio VII): sin tablas ni columnas nuevas; solo funciones. Parte de la definición vigente
-- (20261022120900_catalogo_disponibilidad.sql: 16 parámetros) y agrega el parámetro 17 al final.
-- Reglas: borrar el costo exige edición en Rentabilidad (42501, como cargarlo); `p_costo` y `p_borrar_costo` juntos
-- son contradictorios (22023). El borrado lo hace `private.borrar_costo_producto` (security definer, acotada a la
-- organización y a Rentabilidad en edición): la tabla `producto_costos` sigue sin privilegio DELETE para nadie.
-- Quitar el costo vigente no toca la historia (`producto_costos_historial` es append-only) ni el costo congelado en
-- los comprobantes ya confirmados; deja un evento de Actividad «Quitó el costo de …».
--
-- Seguridad: `revoke … from public, anon`, `grant execute … to authenticated` explícitos en la función nueva.
--
-- Reversión (migración posterior): drop function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean, boolean);
-- drop function private.borrar_costo_producto(uuid, uuid); y recrear la función de 16 parámetros con el cuerpo de
-- 20261022120900_catalogo_disponibilidad.sql.

drop function if exists public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean);

create or replace function private.borrar_costo_producto(p_producto uuid, p_organizacion uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_nombre text;
  v_filas integer;
begin
  if v_actor is null
     or p_organizacion is distinct from (select private.organizacion_id())
     or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar el costo' using errcode = '42501';
  end if;
  delete from dominio.producto_costos c
   where c.producto_id = p_producto and c.organizacion_id = p_organizacion;
  get diagnostics v_filas = row_count;
  if v_filas > 0 then
    select p.nombre into v_nombre from dominio.productos p
     where p.id = p_producto and p.organizacion_id = p_organizacion;
    perform private.insertar_actividad(
      p_organizacion, v_actor, 'producto.precio_actualizado',
      format('Quitó el costo de %s', coalesce(v_nombre, 'un producto')), null);
  end if;
  return v_filas > 0;
end;
$$;

comment on function private.borrar_costo_producto(uuid, uuid) is
  'MSF-723: borra el costo vigente de un producto (solo Rentabilidad en edición, misma organización) y deja el evento en Actividad.';

revoke execute on function private.borrar_costo_producto(uuid, uuid) from public, anon;
grant execute on function private.borrar_costo_producto(uuid, uuid) to authenticated;

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
  p_cambiar_disponibilidad boolean default false,
  p_borrar_costo boolean default false
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
  if (p_costo is not null or coalesce(p_borrar_costo, false))
     and (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar el costo' using errcode = '42501';
  end if;
  if coalesce(p_borrar_costo, false) and p_costo is not null then
    raise exception 'No se puede cargar y borrar el costo a la vez' using errcode = '22023';
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
  elsif coalesce(p_borrar_costo, false) then
    -- «Vaciar» el costo lo borra (un costo nulo = «sin cambio» no lo distinguía de «no se envió»).
    v_costo_cambio := private.borrar_costo_producto(p_id, v_actual.organizacion_id);
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

comment on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean, boolean) is
  'F-CAT-04: edita un producto con bloqueo optimista por updated_at (40001 ante conflicto); costo solo con edición en Rentabilidad, nulo = sin cambio, p_borrar_costo = true lo borra (MSF-723). F-PRV-03: proveedor y código solo cambian con p_cambiar_proveedor = true. MSF-529: el código de barras solo cambia con p_cambiar_codigo_barras = true. F-CAT-17: la disponibilidad manual solo cambia con p_cambiar_disponibilidad = true.';

revoke execute on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean, boolean) from public, anon;
grant execute on function public.actualizar_producto(uuid, timestamptz, text, text, text, text[], text, numeric, numeric, uuid, text, boolean, text, boolean, text, boolean, boolean) to authenticated;
