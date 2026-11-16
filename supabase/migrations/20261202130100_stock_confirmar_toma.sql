-- F-STK-11 (MSF-415, épica MSF-131, spec 20261024-120000-stock-lotes-e-inventario,
-- FR-103, FR-105, SC-003): `public.confirmar_toma_inventario`.
-- Esquema (Principio VII): sin tablas nuevas; la toma no es una entidad persistida, produce
-- ajustes en `dominio.movimientos_stock` por la única vía de escritura de stock
-- (`registrar_movimiento_stock`).
--
-- Recibe [{ producto, contado }] y, en UNA transacción, crea un ajuste por cada producto cuyo
-- contado difiere del stock del depósito por defecto (D4c: la toma opera sobre ese depósito),
-- con el motivo de sistema «Toma de inventario». Sin diferencia no hay movimiento, así que
-- repetir la misma confirmación no crea nada. Ante cualquier error no queda ningún ajuste.
-- Procesa los productos en orden de id (sin cruces de bloqueos entre tomas simultáneas).
--
-- Errores: 42501 sin nivel `edicion` en Stock; 22023 ítems/contado/producto/fecha inválidos.
-- Contrato nuevo (aditivo): `revoke ... from public, anon` y `grant ... to authenticated`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.confirmar_toma_inventario(jsonb, date);

create or replace function public.confirmar_toma_inventario(
  p_items jsonb,
  p_fecha date default current_date
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

  select d.id into v_deposito
    from dominio.depositos d
   where d.organizacion_id = v_organizacion and d.por_defecto;
  if v_deposito is null then
    raise exception 'No encontramos ese depósito' using errcode = '22023';
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

comment on function public.confirmar_toma_inventario(jsonb, date) is
  'F-STK-11: confirma una toma de inventario. Un ajuste por producto con diferencia (depósito por defecto, motivo «Toma de inventario»), todo o nada. Exige edición en Stock.';

revoke execute on function public.confirmar_toma_inventario(jsonb, date) from public, anon;
grant execute on function public.confirmar_toma_inventario(jsonb, date) to authenticated;
