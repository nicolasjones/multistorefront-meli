-- F-SVC-12 (MSF-412, épica MSF-217, FR-030): `agregar_item_reparacion` acepta `p_dejar_pendiente`.
--
-- Esquema: sin tablas nuevas (Principio VII; escribe `dominio.reparacion_items`).
--
-- Si falta stock y `p_dejar_pendiente` es verdadero, el ítem se carga (suma al total al cliente) con su depósito
-- y `stock_estado = 'pendiente'`, sin movimiento de stock. Si hay stock, descuenta como en F-SVC-10. Sin la marca,
-- el rechazo `23514` «No hay stock suficiente» sigue igual. La reparación entregada o anulada se rechaza antes
-- (`private.bloquear_reparacion_para_items`).
--
-- CONTRATO que cambia (alto riesgo, gate humano): la firma de 7 parámetros de F-SVC-10 desaparece; la de 8 suma
-- `p_dejar_pendiente boolean default false` al final. `apps/web/src/lib/reparacionItems.ts` se actualiza en el mismo cambio.
--
-- Migración aditiva en datos. Reversión (migración posterior):
--   drop function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid, boolean);
--   restaurar la de 7 parámetros de 20270114130400_reparacion_item_agregar_stock.sql (con grants).

drop function if exists public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid);

create or replace function public.agregar_item_reparacion(
  p_reparacion_id uuid,
  p_tipo text,
  p_descripcion text,
  p_producto_id uuid,
  p_cantidad numeric,
  p_precio numeric,
  p_deposito_id uuid default null,
  p_dejar_pendiente boolean default false
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
  v_a_pedido boolean := false;
  v_deposito dominio.depositos;
  v_item uuid;
  v_estado text := 'sin_movimiento';
begin
  v_actual := private.bloquear_reparacion_para_items(p_reparacion_id);

  if p_tipo is null or p_tipo not in ('mano_obra', 'repuesto') then
    raise exception 'Elegí si es mano de obra o repuesto' using errcode = '22023', hint = 'tipo';
  end if;
  if p_producto_id is not null then
    if p_tipo <> 'repuesto' then
      raise exception 'Solo un repuesto se vincula a un producto' using errcode = '22023', hint = 'producto_id';
    end if;
    select p.nombre, p.disponibilidad_manual = 'a_pedido' into v_nombre_producto, v_a_pedido
      from dominio.productos p
     where p.id = p_producto_id and p.organizacion_id = v_org and p.activo;
    if not found then
      raise exception 'El producto no existe o está inactivo' using errcode = '22023', hint = 'producto_id';
    end if;
    v_a_pedido := coalesce(v_a_pedido, false);
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

  -- Depósito: el indicado o el por defecto; `for share` impide desactivarlo mientras sale mercadería.
  -- Mismo orden de bloqueo que `registrar_movimiento_stock` (existencias del producto y después el depósito).
  if p_producto_id is not null and not v_a_pedido then
    perform 1 from dominio.existencias e
     where e.producto_id = p_producto_id and e.organizacion_id = v_org
     for update;
    select d.* into v_deposito
      from dominio.depositos d
     where d.organizacion_id = v_org
       and (d.id = p_deposito_id or (p_deposito_id is null and d.por_defecto))
     for share;
    if not found then
      raise exception 'No encontramos ese depósito' using errcode = '22023', hint = 'deposito_id';
    end if;
    if not v_deposito.activo then
      raise exception 'El depósito está inactivo: elegí otro' using errcode = '22023', hint = 'deposito_id';
    end if;
  end if;

  insert into dominio.reparacion_items (organizacion_id, reparacion_id, tipo, descripcion, producto_id,
                                        cantidad, precio_unitario, creado_por, deposito_id, stock_estado)
  values (v_org, p_reparacion_id, p_tipo, v_descripcion, p_producto_id,
          p_cantidad::integer, round(p_precio, 2), (select auth.uid()), v_deposito.id,
          case when v_deposito.id is null then 'sin_movimiento' else 'descontado' end)
  returning id into v_item;

  if v_deposito.id is not null then
    begin
      perform private.mover_stock_reparacion(v_org, p_reparacion_id, v_item, p_producto_id, v_deposito.id,
                                             p_cantidad::integer, 'salida');
    exception when check_violation then
      -- Sin stock: con «dejar pendiente» el ítem queda cargado sin movimiento (el sub-bloque revirtió la salida);
      -- sin él, se relanza el rechazo y se revierte todo.
      if not coalesce(p_dejar_pendiente, false) or sqlerrm not like 'No hay stock suficiente%' then
        raise;
      end if;
      update dominio.reparacion_items set stock_estado = 'pendiente' where id = v_item;
    end;
  end if;

  perform private.recalcular_totales_reparacion(p_reparacion_id);

  return private.reparacion_json(p_reparacion_id);
end;
$$;

comment on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid, boolean) is
  'F-SVC-12: agrega un ítem; un repuesto del catálogo que no es «a pedido» se descuenta del depósito elegido. Si no alcanza el stock: 23514, o ítem `pendiente` sin movimiento con p_dejar_pendiente. Recalcula los totales en la misma transacción.';

revoke execute on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid, boolean) from public, anon;
grant execute on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid, boolean) to authenticated;
