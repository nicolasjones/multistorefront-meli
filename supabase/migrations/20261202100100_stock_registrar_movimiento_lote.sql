-- F-STK-10 (MSF-407, épica MSF-131, FR-006): `registrar_movimiento_stock` gana `p_lote uuid default null`
-- al final; `movimientos_stock.lote_id` se fija al insertar. Cuerpo idéntico al de
-- 20261023120200 salvo el lote: libro inmutable y stock sin negativos intactos.
-- Esquema: sin tablas nuevas (Principio VII).
--
-- CONTRATO que cambia (alto riesgo, gate humano): firma de 7 → 8 parámetros; el nuevo es opcional y
-- va al final, así que los llamadores existentes (registrar_ingreso_mercaderia, anulación, UI) siguen
-- válidos. Se reemplaza la firma anterior para no dejar dos sobrecargas ambiguas en PostgREST.
--
-- Migración aditiva. Reversión (migración posterior):
--   eliminar la función de 8 parámetros (uuid, text, integer, uuid, text, date, uuid, uuid);
--   restaurar la firma de 7 parámetros de 20261023120200_stock_movimiento_deposito.sql (con grants).

drop function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid);

create or replace function public.registrar_movimiento_stock(
  p_producto uuid,
  p_tipo text,
  p_cantidad integer,
  p_motivo uuid,
  p_nota text default null,
  p_fecha date default current_date,
  p_deposito uuid default null,
  p_lote uuid default null
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

  if p_lote is not null and not exists (
    select 1 from dominio.lotes_stock l
    where l.id = p_lote and l.organizacion_id = v_organizacion
  ) then
    raise exception 'No encontramos ese lote' using errcode = '22023';
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
    (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha, actor_id, actor_nombre, deposito_id, lote_id)
  values
    (v_organizacion, p_producto, p_tipo, p_cantidad, v_diferencia, v_saldo, p_motivo, v_nota, v_fecha, v_actor, v_nombre_actor, v_deposito.id, p_lote)
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

comment on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid, uuid) is
  'F-STK-02/F-STK-14: única vía de escritura de stock. Exige edición en Stock; organización y responsable salen de la sesión. Aplica al depósito indicado (por defecto, el depósito por defecto) y bloquea sobre el disponible. F-STK-10: p_lote opcional vincula la entrada con su lote.';

revoke execute on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid, uuid) from public, anon;
grant execute on function public.registrar_movimiento_stock(uuid, text, integer, uuid, text, date, uuid, uuid) to authenticated;
