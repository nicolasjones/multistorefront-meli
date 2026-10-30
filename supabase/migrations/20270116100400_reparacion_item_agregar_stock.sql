-- F-SVC-10 (MSF-390, épica MSF-217, FR-002, FR-003, FR-004, FR-005, FR-011): `agregar_item_reparacion` descuenta
-- el repuesto del depósito elegido.
--
-- Esquema: sin tablas nuevas (Principio VII; escribe `dominio.reparacion_items` y, por
-- `private.mover_stock_reparacion`, el stock y su libro).
--
-- Un repuesto con producto del catálogo que NO es «a pedido» inserta el ítem, aplica la salida del depósito,
-- registra el movimiento y recalcula los totales EN LA MISMA TRANSACCIÓN; el ítem queda `descontado` y guarda su
-- `deposito_id`. Si el disponible del depósito (cantidad − reservado) no alcanza, `aplicar_movimiento_deposito`
-- falla con `23514` «No hay stock suficiente» y se revierte todo: sin ítem, movimiento ni cambio de totales.
-- Dos cargas simultáneas del último artículo se serializan por el `for update` de `existencias` por producto.
-- «A pedido», repuesto libre y mano de obra quedan `sin_movimiento` (el `p_deposito_id` se ignora).
-- `p_deposito_id` nulo = depósito por defecto; debe ser un depósito ACTIVO de la organización (`22023`, hint
-- `deposito_id`). Gate: `edicion` en `service_tecnico` (`private.bloquear_reparacion_para_items`).
--
-- CONTRATO que cambia (alto riesgo, gate humano): la firma de 6 parámetros de MSF-199 desaparece; la de 7 suma
-- `p_deposito_id uuid default null` al final (dos sobrecargas con defaults serían ambiguas para PostgREST).
-- `apps/web/src/lib/reparacionItems.ts` se actualiza en el mismo cambio.
--
-- Migración aditiva en datos. Reversión (migración posterior):
--   drop function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid);
--   restaurar `agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric)` de
--     20261022100300_reparacion_item_agregar.sql (con grants); los ítems `descontado` ya no se devuelven solos.

drop function if exists public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric);

create or replace function public.agregar_item_reparacion(
  p_reparacion_id uuid,
  p_tipo text,
  p_descripcion text,
  p_producto_id uuid,
  p_cantidad numeric,
  p_precio numeric,
  p_deposito_id uuid default null
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
    perform private.mover_stock_reparacion(v_org, p_reparacion_id, v_item, p_producto_id, v_deposito.id,
                                           p_cantidad::integer, 'salida');
  end if;

  perform private.recalcular_totales_reparacion(p_reparacion_id);

  return private.reparacion_json(p_reparacion_id);
end;
$$;

comment on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid) is
  'F-SVC-10: agrega un ítem y, si es un repuesto del catálogo que no es «a pedido», lo descuenta del depósito elegido (23514 si no alcanza) y recalcula los totales en la misma transacción.';

revoke execute on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid) from public, anon;
grant execute on function public.agregar_item_reparacion(uuid, text, text, uuid, numeric, numeric, uuid) to authenticated;
