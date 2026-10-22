-- F-PRV-04 (MSF-383, épica MSF-219): registrar un ingreso de mercadería por proveedor.
-- Única vía de escritura de `dominio.ingresos_mercaderia` y sus líneas. Cada línea
-- llama a `public.registrar_movimiento_stock` (MSF-136) con tipo `entrada` y motivo
-- «Compra a proveedor»; la suma de stock, el costo y el evento son atómicos.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.registrar_ingreso_mercaderia(uuid, uuid, date, text, jsonb, boolean, uuid);

create or replace function public.registrar_ingreso_mercaderia(
  p_empresa uuid,
  p_proveedor uuid,
  p_fecha date,
  p_comprobante text,
  p_lineas jsonb,
  p_actualizar_costo boolean default false,
  p_clave_idempotencia uuid default null
)
returns dominio.ingresos_mercaderia
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actor_nombre text;
  v_fecha date := coalesce(p_fecha, current_date);
  v_comprobante text := nullif(btrim(coalesce(p_comprobante, '')), '');
  v_clave uuid := coalesce(p_clave_idempotencia, gen_random_uuid());
  v_motivo uuid;
  v_ingreso dominio.ingresos_mercaderia;
  v_existente dominio.ingresos_mercaderia;
  v_linea jsonb;
  v_producto uuid;
  v_cantidad integer;
  v_costo numeric(14, 2);
  v_movimiento uuid;
  v_unidades integer := 0;
  v_productos integer := 0;
  v_vistos uuid[] := '{}';
  v_proveedor text;
  v_empresa text;
  v_detalle text;
  v_nota text;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede registrar ingresos de mercadería' using errcode = '42501';
  end if;

  -- Reintento con la misma clave: devuelve el ingreso ya creado sin mover stock.
  if p_clave_idempotencia is not null then
    select * into v_existente
      from dominio.ingresos_mercaderia
     where organizacion_id = v_organizacion
       and clave_idempotencia = v_clave;
    if found then
      return v_existente;
    end if;
  end if;

  if p_empresa is null
     or p_empresa not in (select private.empresas_accesibles())
     or not exists (
       select 1 from dominio.empresas e
        where e.id = p_empresa
          and e.organizacion_id = v_organizacion
          and e.activa
     ) then
    raise exception 'Elegí una empresa activa a la que tengas acceso' using errcode = '22023';
  end if;

  if p_proveedor is null or not exists (
    select 1 from dominio.proveedores p
     where p.id = p_proveedor
       and p.organizacion_id = v_organizacion
       and p.activo
  ) then
    raise exception 'Elegí un proveedor activo de la organización' using errcode = '22023';
  end if;

  if v_fecha > current_date then
    raise exception 'La fecha del ingreso no puede ser futura' using errcode = '22023';
  end if;
  if v_comprobante is not null and length(v_comprobante) > 100 then
    raise exception 'El comprobante admite hasta 100 caracteres' using errcode = '22023';
  end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agregá al menos un producto para registrar el ingreso' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lineas) > 100 then
    raise exception 'Un ingreso admite hasta 100 productos' using errcode = '22023';
  end if;

  if coalesce(p_actualizar_costo, false)
     and (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede actualizar el costo de los productos' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_actor_nombre
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  select p.razon_social into v_proveedor
    from dominio.proveedores p where p.id = p_proveedor;
  select e.nombre into v_empresa
    from dominio.empresas e where e.id = p_empresa;

  select m.id into v_motivo
    from dominio.motivos_movimiento m
   where m.organizacion_id = v_organizacion
     and lower(btrim(m.nombre)) = 'compra a proveedor'
     and m.activo
     and 'entrada' = any (m.aplica_a);
  if v_motivo is null then
    raise exception 'Falta el motivo «Compra a proveedor» en la organización' using errcode = '22023';
  end if;

  -- La clave de idempotencia es única por organización: dos envíos simultáneos con
  -- la misma clave no crean dos ingresos. El segundo devuelve el primero.
  begin
    insert into dominio.ingresos_mercaderia
      (organizacion_id, empresa_id, proveedor_id, fecha, comprobante,
       clave_idempotencia, actor_id, actor_nombre)
    values
      (v_organizacion, p_empresa, p_proveedor, v_fecha, v_comprobante,
       v_clave, v_actor, v_actor_nombre)
    returning * into v_ingreso;
  exception when unique_violation then
    select * into v_ingreso
      from dominio.ingresos_mercaderia
     where organizacion_id = v_organizacion
       and clave_idempotencia = v_clave;
    if found then
      return v_ingreso;
    end if;
    raise;
  end;

  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_linea) <> 'object'
       or not (v_linea ? 'producto_id')
       or not (v_linea ? 'cantidad')
       or not (v_linea ? 'costo_unitario_usd')
       or jsonb_typeof(v_linea -> 'producto_id') <> 'string'
       or jsonb_typeof(v_linea -> 'cantidad') <> 'number'
       or jsonb_typeof(v_linea -> 'costo_unitario_usd') <> 'number' then
      raise exception 'Cada línea necesita producto, cantidad y costo unitario' using errcode = '22023';
    end if;

    if (v_linea ->> 'producto_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'La línea tiene un producto inválido' using errcode = '22023';
    end if;
    if (v_linea ->> 'cantidad') !~ '^[0-9]{1,7}$' then
      raise exception 'La cantidad debe ser un entero mayor a cero' using errcode = '22023';
    end if;
    if (v_linea ->> 'costo_unitario_usd') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
      raise exception 'El costo unitario debe ser un número de hasta dos decimales' using errcode = '22023';
    end if;

    v_producto := (v_linea ->> 'producto_id')::uuid;
    v_cantidad := (v_linea ->> 'cantidad')::integer;
    v_costo := (v_linea ->> 'costo_unitario_usd')::numeric(14, 2);

    if v_cantidad <= 0 or v_cantidad > 1000000 then
      raise exception 'La cantidad debe ser un entero entre 1 y 1.000.000' using errcode = '22023';
    end if;

    if v_producto = any (v_vistos) then
      raise exception 'No se puede repetir el mismo producto en un ingreso' using errcode = '22023';
    end if;
    v_vistos := array_append(v_vistos, v_producto);

    if not exists (
      select 1 from dominio.productos p
       where p.id = v_producto
         and p.organizacion_id = v_organizacion
         and p.activo
    ) then
      raise exception 'Uno de los productos no existe, está inactivo o es de otra organización' using errcode = '22023';
    end if;

    v_nota := case
      when v_comprobante is null then 'Ingreso de mercadería por proveedor'
      else format('Ingreso de mercadería · comprobante %s', v_comprobante)
    end;

    v_movimiento := (public.registrar_movimiento_stock(
      v_producto, 'entrada', v_cantidad, v_motivo, v_nota, v_fecha
    )).id;

    insert into dominio.ingresos_mercaderia_lineas
      (ingreso_id, organizacion_id, producto_id, cantidad, costo_unitario_usd, movimiento_id)
    values
      (v_ingreso.id, v_organizacion, v_producto, v_cantidad, v_costo, v_movimiento);

    if coalesce(p_actualizar_costo, false) then
      insert into dominio.producto_costos (producto_id, organizacion_id, costo)
      values (v_producto, v_organizacion, v_costo)
      on conflict (producto_id) do update
        set costo = excluded.costo,
            organizacion_id = excluded.organizacion_id;
    end if;

    v_unidades := v_unidades + v_cantidad;
    v_productos := v_productos + 1;
  end loop;

  v_detalle := format(
    'Ingreso de mercadería de %s para %s: %s unidades en %s %s',
    v_proveedor, v_empresa, v_unidades, v_productos,
    case when v_productos = 1 then 'producto' else 'productos' end
  );
  if v_comprobante is not null then
    v_detalle := v_detalle || format(' (comprobante %s)', v_comprobante);
  end if;
  perform private.registrar_actividad('ingreso.registrado', v_detalle, p_empresa);

  return v_ingreso;
end;
$$;

comment on function public.registrar_ingreso_mercaderia(uuid, uuid, date, text, jsonb, boolean, uuid) is
  'F-PRV-04: registra un ingreso por proveedor y mueve el stock por cada línea con registrar_movimiento_stock. Exige edición en Stock; el costo exige edición en Rentabilidad.';

revoke execute on function public.registrar_ingreso_mercaderia(uuid, uuid, date, text, jsonb, boolean, uuid) from public, anon;
grant execute on function public.registrar_ingreso_mercaderia(uuid, uuid, date, text, jsonb, boolean, uuid) to authenticated;
