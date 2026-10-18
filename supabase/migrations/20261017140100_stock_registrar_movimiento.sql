-- F-STK-02 (MSF-153, épica MSF-136, FR-002…FR-006, FR-008): RPC única de escritura
-- de stock.
-- Esquema: sin tablas nuevas (usa dominio.existencias / movimientos_stock /
-- motivos_movimiento de la migración anterior; Principio VII).
--
-- `registrar_movimiento_stock` es SECURITY DEFINER (las tablas no tienen escritura
-- directa) con `search_path = ''`: valida sesión, organización activa y
-- `nivel_seccion('stock') = 'edicion'`; la organización y el responsable salen
-- de la sesión, nunca del llamador. Bloquea la fila de existencias (serializa
-- movimientos simultáneos), calcula diferencia y saldo, escribe el movimiento y
-- registra el evento `stock.<tipo>` en la misma transacción. Un saldo negativo
-- viola `movimientos_stock.saldo >= 0` y revierte todo sin dejar rastro (el
-- mensaje claro y el disparador de la tabla llegan con F-STK-06).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date);

create or replace function public.registrar_movimiento_stock(
  p_producto uuid,
  p_tipo text,
  p_cantidad integer,
  p_motivo uuid,
  p_nota text default null,
  p_fecha date default current_date
)
returns dominio.movimientos_stock
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_fecha date := coalesce(p_fecha, current_date);
  v_actual integer;
  v_saldo integer;
  v_diferencia integer;
  v_nombre_actor text;
  v_producto text;
  v_fila dominio.movimientos_stock;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede registrar movimientos de stock' using errcode = '42501';
  end if;

  if p_tipo is null or p_tipo not in ('entrada', 'salida', 'ajuste') then
    raise exception 'El tipo debe ser entrada, salida o ajuste' using errcode = '22023';
  end if;
  if p_cantidad is null or (p_tipo <> 'ajuste' and p_cantidad <= 0) or (p_tipo = 'ajuste' and p_cantidad < 0) then
    raise exception '%', case when p_tipo = 'ajuste'
      then 'El stock contado debe ser un entero de cero o más'
      else 'La cantidad debe ser un entero mayor a cero' end
      using errcode = '22023';
  end if;
  if v_fecha > current_date then
    raise exception 'La fecha no puede ser futura' using errcode = '22023';
  end if;
  if v_nota is not null and length(v_nota) > 500 then
    raise exception 'La nota admite hasta 500 caracteres' using errcode = '22023';
  end if;
  if not exists (
    select 1 from dominio.motivos_movimiento m
    where m.id = p_motivo
      and m.organizacion_id = v_organizacion
      and m.activo
      and p_tipo = any (m.aplica_a)
  ) then
    raise exception 'Elegí un motivo activo que aplique a este tipo de movimiento' using errcode = '22023';
  end if;

  -- Serializa por producto: el segundo movimiento espera y ve el saldo del primero.
  select e.cantidad into v_actual
    from dominio.existencias e
   where e.producto_id = p_producto and e.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'No encontramos ese producto' using errcode = '22023';
  end if;

  if p_tipo = 'entrada' then
    v_diferencia := p_cantidad;
  elsif p_tipo = 'salida' then
    v_diferencia := -p_cantidad;
  else
    v_diferencia := p_cantidad - v_actual;
  end if;
  v_saldo := v_actual + v_diferencia;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_nombre_actor
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  update dominio.existencias
     set cantidad = v_saldo, ultimo_movimiento_en = now(), updated_at = now()
   where producto_id = p_producto and organizacion_id = v_organizacion;

  insert into dominio.movimientos_stock
    (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha, actor_id, actor_nombre)
  values
    (v_organizacion, p_producto, p_tipo, p_cantidad, v_diferencia, v_saldo, p_motivo, v_nota, v_fecha, v_actor, v_nombre_actor)
  returning * into v_fila;

  select p.nombre || case when p.sku is null then '' else ' (SKU ' || p.sku || ')' end
    into v_producto
    from dominio.productos p
   where p.id = p_producto;

  perform private.registrar_actividad(
    'stock.' || p_tipo,
    format('%s de %s: %s unidades, stock resultante %s',
      case p_tipo when 'entrada' then 'Entrada' when 'salida' then 'Salida' else 'Ajuste' end,
      v_producto, p_cantidad, v_saldo)
  );

  return v_fila;
end;
$$;

comment on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date) is
  'F-STK-02: única vía de escritura de stock. Exige edición en Stock; organización y responsable salen de la sesión. Serializa por producto.';

revoke execute on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date) from public, anon;
grant execute on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date) to authenticated;
