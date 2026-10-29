-- F-STK-14 (MSF-316, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas,
-- FR-007, FR-008, FR-009): los movimientos de stock se aplican a un depósito.
-- Esquema: sin tablas nuevas (usa dominio.existencias / existencias_deposito /
-- movimientos_stock / depositos; Principio VII).
--
-- 1. `private.aplicar_movimiento_deposito`: única rutina que cambia cantidad y reservado.
--    Serializa por producto (`select … for update` sobre `existencias`, el mismo mecanismo de
--    MSF-136), mantiene `existencias.cantidad/reservado` = suma por depósito en la misma
--    transacción y bloquea sobre el **disponible** del depósito (cantidad − reservado): ninguna
--    salida o ajuste puede dejarlo por debajo de 0. El rechazo es «No hay stock suficiente»
--    (23514, mismo detalle que F-STK-06) y revierte todo: sin movimiento, evento ni actividad.
--    La reutilizan trasladar_stock (F-STK-15) y las reservas (F-STK-16).
-- 2. `public.registrar_movimiento_stock(…, p_deposito)`: parámetro final opcional; sin él usa
--    el depósito por defecto. Los llamadores anteriores (sin p_deposito) siguen funcionando.
--    Se reemplaza la firma de 6 parámetros (dos sobrecargas con defaults serían ambiguas
--    para PostgREST). El depósito se toma `for share`: no se puede desactivar mientras entra
--    mercadería (ver cambiar_activo_deposito) y uno inactivo no admite movimientos.
--    `movimientos_stock.saldo` y `stock.actualizado.cantidad` siguen siendo el TOTAL único.
--
-- CONTRATO que cambia (alto riesgo, gate humano): `registrar_movimiento_stock` gana
-- `p_deposito uuid default null` al final.
--
-- Migración aditiva en datos. Reversión (migración posterior):
--   drop function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid);
--   restaurar `registrar_movimiento_stock(uuid, text, integer, uuid, text, date)` de
--     20261017140100_stock_registrar_movimiento.sql (con grants);
--   drop function private.aplicar_movimiento_deposito(uuid, uuid, uuid, integer, integer, boolean);

create or replace function private.aplicar_movimiento_deposito(
  p_organizacion uuid,
  p_producto uuid,
  p_deposito uuid,
  p_delta_cantidad integer,
  p_delta_reservado integer default 0,
  p_marcar_movimiento boolean default true
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_total_reservado integer;
  v_cantidad integer;
  v_reservado integer;
  v_disponible integer;
  -- Unidades que el cambio quita del disponible (salida, reserva) o devuelve (negativo).
  v_necesita integer := p_delta_reservado - p_delta_cantidad;
begin
  -- Serializa por producto: el segundo cambio espera y ve el resultado del primero.
  select e.cantidad, e.reservado into v_total, v_total_reservado
    from dominio.existencias e
   where e.producto_id = p_producto and e.organizacion_id = p_organizacion
   for update;
  if not found then
    raise exception 'No encontramos ese producto' using errcode = '22023';
  end if;

  insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id)
  values (p_producto, p_deposito, p_organizacion)
  on conflict (producto_id, deposito_id) do nothing;

  select x.cantidad, x.reservado into v_cantidad, v_reservado
    from dominio.existencias_deposito x
   where x.producto_id = p_producto and x.deposito_id = p_deposito
   for update;

  v_disponible := v_cantidad - v_reservado;
  -- La barrera es el disponible del depósito: cantidad − reservado nunca baja de 0.
  if v_disponible - v_necesita < 0 or v_reservado + p_delta_reservado < 0 then
    raise exception 'No hay stock suficiente'
      using errcode = '23514',
            detail = format('Hay %s %s y la salida es de %s.',
              v_disponible, case when v_disponible = 1 then 'unidad' else 'unidades' end,
              greatest(v_necesita, 0));
  end if;

  update dominio.existencias_deposito
     set cantidad = v_cantidad + p_delta_cantidad,
         reservado = v_reservado + p_delta_reservado,
         updated_at = now()
   where producto_id = p_producto and deposito_id = p_deposito;

  update dominio.existencias
     set cantidad = v_total + p_delta_cantidad,
         reservado = v_total_reservado + p_delta_reservado,
         ultimo_movimiento_en = case when p_marcar_movimiento then now() else ultimo_movimiento_en end,
         updated_at = now()
   where producto_id = p_producto and organizacion_id = p_organizacion;

  return v_total + p_delta_cantidad;
end;
$$;

revoke execute on function private.aplicar_movimiento_deposito(uuid, uuid, uuid, integer, integer, boolean)
  from public, anon, authenticated;

comment on function private.aplicar_movimiento_deposito(uuid, uuid, uuid, integer, integer, boolean) is
  'F-STK-14: única rutina que cambia cantidad y reservado por depósito y en el total. Serializa por producto y bloquea sobre el disponible del depósito.';

-- ============================================================================
-- registrar_movimiento_stock con depósito (FR-008)
-- ============================================================================

drop function IF EXISTS public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date);

create or replace function public.registrar_movimiento_stock(
  p_producto uuid,
  p_tipo text,
  p_cantidad integer,
  p_motivo uuid,
  p_nota text default null,
  p_fecha date default current_date,
  p_deposito uuid default null
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
  v_deposito dominio.depositos;
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
  perform 1 from dominio.existencias e
   where e.producto_id = p_producto and e.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'No encontramos ese producto' using errcode = '22023';
  end if;

  -- Depósito: el indicado o, si no se envía, el que está por defecto. `for share` impide que
  -- se lo desactive mientras entra o sale mercadería.
  select d.* into v_deposito
    from dominio.depositos d
   where d.organizacion_id = v_organizacion
     and (d.id = p_deposito or (p_deposito is null and d.por_defecto))
   for share;
  if not found then
    raise exception 'No encontramos ese depósito' using errcode = '22023';
  end if;
  if not v_deposito.activo then
    raise exception 'El depósito está inactivo: elegí otro para este movimiento' using errcode = '22023';
  end if;

  select coalesce((select x.cantidad from dominio.existencias_deposito x
                    where x.producto_id = p_producto and x.deposito_id = v_deposito.id), 0)
    into v_actual;

  -- El ajuste informa el stock contado EN ESE DEPÓSITO.
  if p_tipo = 'entrada' then
    v_diferencia := p_cantidad;
  elsif p_tipo = 'salida' then
    v_diferencia := -p_cantidad;
  else
    v_diferencia := p_cantidad - v_actual;
  end if;

  v_saldo := private.aplicar_movimiento_deposito(v_organizacion, p_producto, v_deposito.id, v_diferencia);

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_nombre_actor
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  insert into dominio.movimientos_stock
    (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha, actor_id, actor_nombre, deposito_id)
  values
    (v_organizacion, p_producto, p_tipo, p_cantidad, v_diferencia, v_saldo, p_motivo, v_nota, v_fecha, v_actor, v_nombre_actor, v_deposito.id)
  returning * into v_fila;

  select p.nombre || case when p.sku is null then '' else ' (SKU ' || p.sku || ')' end
    into v_producto
    from dominio.productos p
   where p.id = p_producto;

  perform private.registrar_actividad(
    'stock.' || p_tipo,
    format('%s de %s en %s: %s unidades, stock resultante %s',
      case p_tipo when 'entrada' then 'Entrada' when 'salida' then 'Salida' else 'Ajuste' end,
      v_producto, v_deposito.nombre, p_cantidad, v_saldo)
  );

  return v_fila;
end;
$$;

comment on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid) is
  'F-STK-02/F-STK-14: única vía de escritura de stock. Exige edición en Stock; organización y responsable salen de la sesión. Aplica al depósito indicado (por defecto, el depósito por defecto) y bloquea sobre el disponible.';

revoke execute on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid) from public, anon;
grant execute on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid) to authenticated;
