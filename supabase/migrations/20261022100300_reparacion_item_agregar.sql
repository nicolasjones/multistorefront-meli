-- F-SVC-06 (MSF-362, épica MSF-199): `agregar_item_reparacion`.
-- Esquema: sin tablas nuevas (escribe `dominio.reparacion_items`; Principio VII).
--
-- SECURITY DEFINER (la tabla no admite insert directo). La compuerta común
-- `private.bloquear_reparacion_para_items` valida sesión, permiso `edicion`, tienda accesible y situación
-- (55000 si está anulada o entregada) y bloquea la reparación (`for update`); luego se valida el ítem
-- (22023 con el campo en `hint`), se inserta y se recalculan los totales en la MISMA transacción. No toca
-- stock ni existencias (supuesto P0). Cantidad: entero de 1 a 9999. Precio: 0 a 99.999.999,99.
-- Un `producto_id` solo se admite en un repuesto y debe ser un producto activo de la organización; si la
-- descripción llega vacía se completa con el nombre del producto.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric);

create or replace function public.agregar_item_reparacion(
  p_reparacion_id uuid,
  p_tipo text,
  p_descripcion text,
  p_producto_id uuid,
  p_cantidad numeric,
  p_precio numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual dominio.reparaciones;
  v_org uuid := (select private.organizacion_id());
  v_descripcion text := btrim(coalesce(p_descripcion, ''));
  v_nombre_producto text;
begin
  v_actual := private.bloquear_reparacion_para_items(p_reparacion_id);

  if p_tipo is null or p_tipo not in ('mano_obra', 'repuesto') then
    raise exception 'Elegí si es mano de obra o repuesto' using errcode = '22023', hint = 'tipo';
  end if;
  if p_producto_id is not null then
    if p_tipo <> 'repuesto' then
      raise exception 'Solo un repuesto se vincula a un producto' using errcode = '22023', hint = 'producto_id';
    end if;
    select p.nombre into v_nombre_producto
      from dominio.productos p
     where p.id = p_producto_id and p.organizacion_id = v_org and p.activo;
    if not found then
      raise exception 'El producto no existe o está inactivo' using errcode = '22023', hint = 'producto_id';
    end if;
    if v_descripcion = '' then
      v_descripcion := v_nombre_producto;
    end if;
  end if;
  if v_descripcion = '' then
    raise exception 'Ingresá la descripción' using errcode = '22023', hint = 'descripcion';
  end if;
  if length(v_descripcion) > 200 then
    raise exception 'Máximo 200 caracteres' using errcode = '22023', hint = 'descripcion';
  end if;
  if p_cantidad is null or p_cantidad <> trunc(p_cantidad) or p_cantidad < 1 or p_cantidad > 9999 then
    raise exception 'La cantidad debe ser un entero de 1 a 9999' using errcode = '22023', hint = 'cantidad';
  end if;
  if p_precio is null or p_precio < 0 or round(p_precio, 2) > 99999999.99 then
    raise exception 'El precio debe estar entre 0 y 99.999.999,99' using errcode = '22023', hint = 'precio';
  end if;

  insert into dominio.reparacion_items (organizacion_id, reparacion_id, tipo, descripcion, producto_id,
                                        cantidad, precio_unitario, creado_por)
  values (v_org, p_reparacion_id, p_tipo, v_descripcion, p_producto_id,
          p_cantidad::integer, round(p_precio, 2), (select auth.uid()));

  perform private.recalcular_totales_reparacion(p_reparacion_id);

  return private.reparacion_json(p_reparacion_id);
end;
$$;

comment on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric) is
  'F-SVC-06: agrega un ítem de mano de obra o repuesto y recalcula los totales en la misma transacción; rechaza entregadas y anuladas (55000); no mueve stock.';

revoke execute on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric) from public, anon;
grant execute on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric) to authenticated;
