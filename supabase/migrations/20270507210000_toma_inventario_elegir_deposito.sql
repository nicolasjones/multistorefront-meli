-- MSF-719 (lote 38): la toma de inventario permite ELEGIR el depósito.
-- Decisión tomada: `public.confirmar_toma_inventario` recibe `p_deposito_id` (null = depósito por defecto).
--
-- Esquema (Principio VII): sin tablas ni columnas nuevas; solo funciones de `public`.
-- Parte de la definición vigente (20261202130100_stock_confirmar_toma.sql): misma validación, mismos errores y misma
-- única vía de escritura (`registrar_movimiento_stock`). Cambia solo el depósito sobre el que opera:
--   · con `p_deposito_id` el depósito debe ser de la organización de la sesión y estar activo (22023 si no);
--   · sin él (null) opera sobre el depósito por defecto, como hasta ahora.
-- La firma de dos parámetros `(jsonb, date)` se conserva como envoltorio de la nueva (sin depósito = por defecto),
-- así los llamadores anteriores siguen funcionando sin cambios.
--
-- Seguridad: `security definer`, `search_path = ''`, objetos calificados; `revoke … from public, anon` y
-- `grant execute … to authenticated` explícitos en las dos firmas (ninguna ejecutable por anon).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.confirmar_toma_inventario(jsonb, date, uuid);
--   (y volver a definir el envoltorio de dos parámetros con el cuerpo de 20261202130100_stock_confirmar_toma.sql).

create or replace function public.confirmar_toma_inventario(
  p_items jsonb,
  p_fecha date,
  p_deposito_id uuid
)
returns table (producto uuid, diferencia integer, saldo integer, movimiento_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_fecha date := coalesce(p_fecha, current_date);
  v_motivo uuid;
  v_deposito uuid;
  v_activo boolean;
  v_item record;
  v_actual integer;
  v_fila dominio.movimientos_stock;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede registrar movimientos de stock' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cargá al menos un producto contado' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 1000 then
    raise exception 'La toma admite hasta 1000 productos por confirmación' using errcode = '22023';
  end if;
  if v_fecha > current_date then
    raise exception 'La fecha no puede ser futura' using errcode = '22023';
  end if;

  -- Validación de forma de cada ítem antes de tocar nada.
  if exists (
    select 1 from jsonb_array_elements(p_items) e(v)
     where jsonb_typeof(e.v) <> 'object'
        or jsonb_typeof(e.v -> 'producto') is distinct from 'string'
        or (e.v ->> 'producto') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(e.v -> 'contado') is distinct from 'number'
  ) then
    raise exception 'Cada producto necesita su id y el stock contado' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e(v)
     where (e.v ->> 'contado')::numeric <> trunc((e.v ->> 'contado')::numeric)
        or (e.v ->> 'contado')::numeric < 0
        or (e.v ->> 'contado')::numeric > 2147483647
  ) then
    raise exception 'El stock contado debe ser un entero de cero o más' using errcode = '22023';
  end if;
  if (select count(distinct (e.v ->> 'producto')::uuid) from jsonb_array_elements(p_items) e(v))
     <> jsonb_array_length(p_items) then
    raise exception 'Hay productos repetidos en la toma' using errcode = '22023';
  end if;

  select m.id into v_motivo
    from dominio.motivos_movimiento m
   where m.organizacion_id = v_organizacion
     and lower(btrim(m.nombre)) = 'toma de inventario'
     and m.activo;
  if v_motivo is null then
    raise exception 'El motivo «Toma de inventario» no está disponible: activalo desde Motivos' using errcode = '22023';
  end if;

  -- Depósito elegido (de la organización de la sesión) o, sin elegir, el depósito por defecto.
  select d.id, d.activo into v_deposito, v_activo
    from dominio.depositos d
   where d.organizacion_id = v_organizacion
     and (d.id = p_deposito_id or (p_deposito_id is null and d.por_defecto));
  if v_deposito is null then
    raise exception 'No encontramos ese depósito' using errcode = '22023';
  end if;
  if not v_activo then
    raise exception 'El depósito está inactivo y no admite movimientos' using errcode = '22023';
  end if;

  for v_item in
    select (e.v ->> 'producto')::uuid as producto_id, (e.v ->> 'contado')::integer as contado
      from jsonb_array_elements(p_items) e(v)
     order by 1
  loop
    -- Serializa por producto antes de leer el stock: la diferencia se calcula sobre el valor vigente.
    perform 1 from dominio.existencias x
     where x.producto_id = v_item.producto_id and x.organizacion_id = v_organizacion
     for update;
    if not found then
      raise exception 'No encontramos ese producto' using errcode = '22023';
    end if;

    select coalesce((select x.cantidad from dominio.existencias_deposito x
                      where x.producto_id = v_item.producto_id and x.deposito_id = v_deposito), 0)
      into v_actual;

    if v_actual <> v_item.contado then
      v_fila := public.registrar_movimiento_stock(
        v_item.producto_id, 'ajuste', v_item.contado, v_motivo,
        'Toma de inventario', v_fecha, v_deposito);
      producto := v_item.producto_id;
      diferencia := v_fila.diferencia;
      saldo := v_fila.saldo;
      movimiento_id := v_fila.id;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.confirmar_toma_inventario(jsonb, date, uuid) is
  'F-STK-11: confirma una toma de inventario sobre el depósito elegido (null = por defecto, debe estar activo). Un ajuste por producto con diferencia, motivo «Toma de inventario», todo o nada. Exige edición en Stock.';

revoke execute on function public.confirmar_toma_inventario(jsonb, date, uuid) from public, anon;
grant execute on function public.confirmar_toma_inventario(jsonb, date, uuid) to authenticated;

-- Envoltorio de la firma anterior: sin depósito elegido opera sobre el por defecto.
create or replace function public.confirmar_toma_inventario(
  p_items jsonb,
  p_fecha date default current_date
)
returns table (producto uuid, diferencia integer, saldo integer, movimiento_id uuid)
language sql
security definer
set search_path = ''
as $$
  select * from public.confirmar_toma_inventario(p_items, p_fecha, null::uuid);
$$;

comment on function public.confirmar_toma_inventario(jsonb, date) is
  'F-STK-11: toma de inventario sobre el depósito por defecto (envoltorio de la firma con p_deposito_id).';

revoke execute on function public.confirmar_toma_inventario(jsonb, date) from public, anon;
grant execute on function public.confirmar_toma_inventario(jsonb, date) to authenticated;
