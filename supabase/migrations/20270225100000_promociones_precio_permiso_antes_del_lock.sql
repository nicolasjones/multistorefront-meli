-- F-PRE-11 (MSF-439, épica MSF-363): menores de la revisión independiente de #842.
--
-- `guardar_promocion_precio` y `anular_promocion_precio` comprueban el permiso en la tienda de la promoción ANTES de tomar
-- el lock de la fila: quien no puede editar `productos` en esa tienda no la bloquea ni distingue «es de otra tienda»
-- (antes 22023) de «no es tuya» (42501). Mismas firmas, mismos grants (`create or replace`), sin tablas nuevas.
-- Migración aditiva. Reversión (migración posterior): recrear las dos funciones de `20270223200000`.

create or replace function public.guardar_promocion_precio(
  p_id uuid,
  p_empresa uuid,
  p_producto uuid,
  p_precio numeric,
  p_desde timestamptz,
  p_hasta timestamptz,
  p_actualizado timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_precio numeric(14, 2);
  v_actual dominio.promociones_precio;
  v_fila dominio.promociones_precio;
begin
  if v_organizacion is null or v_actor is null
     or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio' using errcode = '42501';
  end if;
  if p_empresa is null or p_producto is null then
    raise exception 'Elegí la empresa y el producto' using errcode = '22023';
  end if;
  if p_precio is null or p_precio <= 0 then
    raise exception 'El precio promocional debe ser mayor a 0' using errcode = '22023';
  end if;
  if abs(p_precio) >= 1e12 then
    raise exception 'El precio promocional es demasiado grande' using errcode = '22003';
  end if;
  v_precio := round(p_precio, 2);
  if v_precio <= 0 then
    raise exception 'El precio promocional debe ser mayor a 0' using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Indicá desde y hasta cuándo rige la promoción' using errcode = '22023';
  end if;
  if p_hasta <= p_desde then
    raise exception 'La fecha de fin tiene que ser posterior a la de inicio' using errcode = '22023';
  end if;

  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_organizacion
  ) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'P0002';
  end if;
  -- Hallazgo de la revisión de MSF-363: además de ser de la organización, la tienda debe ser accesible y la persona
  -- debe poder editar `productos` EN ELLA (el nivel global es el más alto entre sus tiendas).
  if (select private.nivel_productos_en_empresa(p_empresa)) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio en esa tienda' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.productos p where p.id = p_producto and p.organizacion_id = v_organizacion
  ) then
    raise exception 'El producto no existe en tu organización' using errcode = 'P0002';
  end if;

  if p_id is null then
    -- Idempotencia del alta: la misma promoción activa ya cargada se devuelve tal cual.
    select * into v_fila
      from dominio.promociones_precio x
     where x.organizacion_id = v_organizacion and x.empresa_id = p_empresa and x.producto_id = p_producto
       and x.anulada_at is null and x.precio_promocional = v_precio
       and x.desde = p_desde and x.hasta = p_hasta;
    if found then
      return to_jsonb(v_fila);
    end if;

    if p_hasta <= now() then
      raise exception 'La promoción ya venció: la fecha de fin tiene que ser futura' using errcode = '22023';
    end if;

    insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
    values (v_organizacion, p_empresa, p_producto, v_precio, p_desde, p_hasta)
    returning * into v_fila;

    perform private.insertar_actividad(
      v_organizacion, v_actor, 'promocion_precio.programada',
      'Programó la promoción de ' || private.describir_promocion_precio(v_fila.id), p_empresa
    );
    return to_jsonb(v_fila);
  end if;

  -- Primero sin lock: quien no puede editar `productos` en la tienda de la promoción no la bloquea ni distingue
  -- «otra tienda» (22023) de «no es tuya» (42501); recién con permiso se toma el lock y se relee.
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_productos_en_empresa(v_actual.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar promociones de precio en esa tienda' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'P0002';
  end if;
  if v_actual.empresa_id <> p_empresa or v_actual.producto_id <> p_producto then
    raise exception 'No se puede cambiar la empresa ni el producto de una promoción: anulala y creá otra'
      using errcode = '22023';
  end if;

  -- Guardar lo que ya está guardado es idempotente (también tras anular o vencer).
  if (v_actual.precio_promocional, v_actual.desde, v_actual.hasta) is not distinct from (v_precio, p_desde, p_hasta) then
    return to_jsonb(v_actual);
  end if;

  if v_actual.anulada_at is not null then
    raise exception 'La promoción está anulada y no se puede editar' using errcode = '22023';
  end if;
  if v_actual.hasta <= now() then
    raise exception 'La promoción ya venció y no se puede editar' using errcode = '22023';
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La promoción fue modificada por otra persona' using errcode = '40001';
  end if;
  if p_hasta <= now() then
    raise exception 'La fecha de fin tiene que ser futura' using errcode = '22023';
  end if;

  update dominio.promociones_precio
     set precio_promocional = v_precio, desde = p_desde, hasta = p_hasta
   where id = p_id
  returning * into v_fila;

  perform private.insertar_actividad(
    v_organizacion, v_actor, 'promocion_precio.actualizada',
    'Actualizó la promoción de ' || private.describir_promocion_precio(v_fila.id), p_empresa
  );
  return to_jsonb(v_fila);
end;
$$;

create or replace function public.anular_promocion_precio(p_id uuid, p_actualizado timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actual dominio.promociones_precio;
  v_fila dominio.promociones_precio;
begin
  if v_organizacion is null or v_actor is null
     or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede anular promociones de precio' using errcode = '42501';
  end if;

  -- Permiso en la tienda de la promoción ANTES de bloquear la fila (sin lock no hay señal de existencia por espera).
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_productos_en_empresa(v_actual.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede anular promociones de precio de esa tienda' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'P0002';
  end if;

  -- Idempotente: anular una ya anulada devuelve la fila sin evento.
  if v_actual.anulada_at is not null then
    return to_jsonb(v_actual);
  end if;
  if v_actual.hasta <= now() then
    raise exception 'La promoción ya venció: no hace falta anularla' using errcode = '22023';
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La promoción fue modificada por otra persona' using errcode = '40001';
  end if;

  update dominio.promociones_precio set anulada_at = clock_timestamp() where id = p_id
  returning * into v_fila;

  perform private.insertar_actividad(
    v_organizacion, v_actor, 'promocion_precio.anulada',
    'Anuló la promoción de ' || private.describir_promocion_precio(v_fila.id), v_fila.empresa_id
  );
  return to_jsonb(v_fila);
end;
$$;
