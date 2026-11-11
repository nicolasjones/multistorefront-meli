-- F-PRE-11 (MSF-439, épica MSF-363): los permisos de las promociones de precio se resuelven POR TIENDA.
--
-- Hallazgo de la revisión de MSF-363: `guardar_promocion_precio` y `anular_promocion_precio` exigían `productos` en
-- edición con el nivel GLOBAL de la persona (el más alto entre sus tiendas) y solo comprobaban que la tienda fuera de la
-- organización, así que quien editaba productos en la tienda A podía programar o anular promociones de la tienda B, donde
-- no tiene acceso o solo lectura. La política de lectura de `dominio.promociones_precio` tenía el mismo defecto.
--
-- Esquema (Principio VII): sin tablas nuevas. Se agrega `private.nivel_productos_en_empresa` (mecanismo de plataforma,
-- gemela de `private.nivel_ventas_en_empresa`), se reemplazan dos RPC (mismas firmas y grants) y la política de lectura.
-- Migración aditiva: no destruye datos ni columnas. Reversión (migración posterior): recrear las funciones y la política
-- de `20270221100001` y `20270221100002`, y `drop function private.nivel_productos_en_empresa(uuid)`.

-- Nivel de `productos` del usuario actual en una tienda concreta: edicion | lectura | ninguno. Superadmin con
-- organización activa = edicion; si no, la tienda debe ser accesible y rige el rol de la persona EN ella.
create or replace function private.nivel_productos_en_empresa(p_empresa_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_empresa_id is null then 'ninguno'
    when not exists (
      select 1 from dominio.empresas e
      where e.id = p_empresa_id and e.organizacion_id = (select private.organizacion_id())
    ) then 'ninguno'
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then 'edicion'
    when p_empresa_id not in (select private.empresas_accesibles()) then 'ninguno'
    else private.nivel_de_rol(
      (select private.organizacion_id()),
      (select private.rol_en_empresa(p_empresa_id)),
      'productos'
    )
  end;
$$;

-- La política de lectura de promociones_precio la evalúa el rol `authenticated`: necesita ejecutarla (como `nivel_ventas_en_empresa`).
revoke execute on function private.nivel_productos_en_empresa(uuid) from public, anon;
grant execute on function private.nivel_productos_en_empresa(uuid) to authenticated;

comment on function private.nivel_productos_en_empresa(uuid) is
  'Nivel de la sección productos del usuario actual en una tienda concreta (MSF-363). Solo la llaman las RPC security definer y la política de promociones_precio.';

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

  select * into v_actual
    from dominio.promociones_precio x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La promoción no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_productos_en_empresa(v_actual.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede anular promociones de precio de esa tienda' using errcode = '42501';
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

-- La lectura directa también respeta la tienda: sin `productos` en la tienda de la promoción no se lee.
drop policy if exists promociones_precio_select on dominio.promociones_precio;
create policy promociones_precio_select on dominio.promociones_precio
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_productos_en_empresa(empresa_id)) in ('lectura', 'edicion')
  );
