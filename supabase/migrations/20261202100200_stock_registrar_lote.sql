-- F-STK-10 (MSF-407, épica MSF-131, FR-003, FR-004, FR-007, FR-008): registrar un lote de stock.
-- Única vía de escritura de `dominio.lotes_stock`. Una entrada por línea mediante
-- `public.registrar_movimiento_stock(..., p_lote := lote.id)`; todo o nada en una transacción.
-- Esquema: sin tablas nuevas (Principio VII); la tabla vive en `dominio` (20261202100000).
--
-- Numeración: correlativa por organización. Se toma un bloqueo de transacción por organización
-- ANTES de leer la clave y el máximo: dos lotes simultáneos reciben números distintos y
-- consecutivos, y dos envíos con la misma clave crean un solo lote (el segundo espera, ve el
-- lote del primero y lo devuelve).
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.registrar_lote_stock(jsonb, uuid, text, date, uuid);
--   drop function private.lote_stock_json(uuid);

create or replace function private.lote_stock_json(p_lote uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lote', jsonb_build_object(
      'id', l.id, 'numero', l.numero, 'proveedor', l.proveedor,
      'fecha', l.fecha, 'motivo_id', l.motivo_id
    ),
    'movimientos', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.creado_en, m.id)
        from dominio.movimientos_stock m
       where m.lote_id = l.id and m.organizacion_id = l.organizacion_id
    ), '[]'::jsonb)
  )
  from dominio.lotes_stock l
  where l.id = p_lote;
$$;

revoke execute on function private.lote_stock_json(uuid) from public, anon, authenticated;

create or replace function public.registrar_lote_stock(
  p_lineas jsonb,
  p_motivo uuid,
  p_proveedor text default null,
  p_fecha date default current_date,
  p_clave uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actor_nombre text;
  v_fecha date := coalesce(p_fecha, current_date);
  v_proveedor text := nullif(btrim(coalesce(p_proveedor, '')), '');
  v_clave uuid := coalesce(p_clave, gen_random_uuid());
  v_lote dominio.lotes_stock;
  v_linea jsonb;
  v_producto uuid;
  v_cantidad integer;
  v_vistos uuid[] := '{}';
  v_unidades integer := 0;
  v_productos integer := 0;
  v_numero integer;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede registrar lotes de stock' using errcode = '42501';
  end if;

  -- Serializa por organización: numeración correlativa e idempotencia por clave.
  perform pg_advisory_xact_lock(hashtextextended('lotes_stock:' || v_organizacion::text, 0));

  select * into v_lote
    from dominio.lotes_stock
   where organizacion_id = v_organizacion and clave_idempotencia = v_clave;
  if found then
    return private.lote_stock_json(v_lote.id);
  end if;

  if v_fecha > current_date then
    raise exception 'La fecha del lote no puede ser futura' using errcode = '22023';
  end if;
  if v_proveedor is not null and length(v_proveedor) > 120 then
    raise exception 'El proveedor admite hasta 120 caracteres' using errcode = '22023';
  end if;
  if p_motivo is null or not exists (
    select 1 from dominio.motivos_movimiento m
     where m.id = p_motivo
       and m.organizacion_id = v_organizacion
       and m.activo
       and 'entrada' = any (m.aplica_a)
  ) then
    raise exception 'Elegí un motivo activo que aplique a las entradas' using errcode = '22023';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agregá al menos un producto para registrar el lote' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lineas) > 100 then
    raise exception 'Un lote admite hasta 100 productos' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_actor_nombre
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  select coalesce(max(l.numero), 0) + 1 into v_numero
    from dominio.lotes_stock l
   where l.organizacion_id = v_organizacion;

  insert into dominio.lotes_stock
    (organizacion_id, numero, proveedor, fecha, motivo_id, clave_idempotencia, actor_id, actor_nombre)
  values
    (v_organizacion, v_numero, v_proveedor, v_fecha, p_motivo, v_clave, v_actor, v_actor_nombre)
  returning * into v_lote;

  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_linea) <> 'object'
       or jsonb_typeof(v_linea -> 'producto') is distinct from 'string'
       or jsonb_typeof(v_linea -> 'cantidad') is distinct from 'number' then
      raise exception 'Cada línea necesita producto y cantidad' using errcode = '22023';
    end if;
    if (v_linea ->> 'producto') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'La línea tiene un producto inválido' using errcode = '22023';
    end if;
    if (v_linea ->> 'cantidad') !~ '^[0-9]{1,7}$' or (v_linea ->> 'cantidad')::integer <= 0 then
      raise exception 'La cantidad debe ser un entero mayor a cero' using errcode = '22023';
    end if;

    v_producto := (v_linea ->> 'producto')::uuid;
    v_cantidad := (v_linea ->> 'cantidad')::integer;

    if v_producto = any (v_vistos) then
      raise exception 'No se puede repetir el mismo producto en un lote' using errcode = '22023';
    end if;
    v_vistos := array_append(v_vistos, v_producto);

    if not exists (
      select 1 from dominio.productos p
       where p.id = v_producto and p.organizacion_id = v_organizacion and p.activo
    ) then
      raise exception 'Uno de los productos no existe, está inactivo o es de otra organización' using errcode = '22023';
    end if;

    perform public.registrar_movimiento_stock(
      v_producto, 'entrada', v_cantidad, p_motivo,
      format('Lote %s', v_numero), v_fecha, null, v_lote.id
    );

    v_unidades := v_unidades + v_cantidad;
    v_productos := v_productos + 1;
  end loop;

  perform private.registrar_actividad(
    'stock.lote_registrado',
    format('Lote de stock %s%s: %s unidades en %s %s',
      v_numero,
      case when v_proveedor is null then '' else format(' de %s', v_proveedor) end,
      v_unidades, v_productos,
      case when v_productos = 1 then 'producto' else 'productos' end)
  );

  return private.lote_stock_json(v_lote.id);
end;
$$;

comment on function public.registrar_lote_stock(jsonb, uuid, text, date, uuid) is
  'F-STK-10: registra un lote de entradas (todo o nada) con número correlativo por organización. Exige edición en Stock; idempotente por clave.';

revoke execute on function public.registrar_lote_stock(jsonb, uuid, text, date, uuid) from public, anon;
grant execute on function public.registrar_lote_stock(jsonb, uuid, text, date, uuid) to authenticated;
