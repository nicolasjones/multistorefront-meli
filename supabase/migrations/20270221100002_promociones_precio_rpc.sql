-- F-PRE-11 (MSF-439, épica MSF-363): crear, editar y anular una promoción de precio. FR-013.
-- Esquema: sin tablas nuevas (RPC en `public`; Principio VII).
--
-- Las RPC son SECURITY DEFINER porque `authenticated` solo lee `dominio.promociones_precio` (la
-- escritura pasa únicamente por acá). Por eso cada una valida a mano lo que RLS no verifica: sesión con
-- organización, sección `productos` = edicion, y que empresa y producto sean de ESA organización.
--
-- Errores: 42501 sin permiso · P0002 empresa, producto o promoción inexistente · 22023 datos
-- inválidos (precio ≤ 0, fechas, promoción vencida o anulada) · 23P01 solape · 40001 conflicto de
-- edición (otra persona la modificó) · 22003 importe fuera de rango.
--
-- Idempotencia: crear lo mismo que ya existe (misma empresa, producto, precio y fechas, no anulada)
-- devuelve esa promoción sin duplicar ni registrar evento; guardar sin cambios y anular una ya anulada
-- también. Un reintento tras un conflicto aparente (el `updated_at` ya avanzó pero los valores son los
-- pedidos) devuelve la fila sin error.
--
-- Eventos de actividad: promocion_precio.programada / .actualizada / .anulada. El detalle lleva el
-- precio promocional (dato público de la tienda), nunca costos.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz);
--   drop function public.anular_promocion_precio(uuid, timestamptz);
--   drop function private.describir_promocion_precio(uuid);

create or replace function private.describir_promocion_precio(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select format('%s en %s: $ %s del %s al %s',
                p.nombre, e.nombre,
                replace(to_char(x.precio_promocional, 'FM999999999990.00'), '.', ','),
                to_char(x.desde at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'),
                to_char(x.hasta at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'))
    from dominio.promociones_precio x
    join dominio.productos p on p.id = x.producto_id and p.organizacion_id = x.organizacion_id
    join dominio.empresas e on e.id = x.empresa_id and e.organizacion_id = x.organizacion_id
   where x.id = p_id;
$$;

revoke execute on function private.describir_promocion_precio(uuid) from public, anon, authenticated;

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

comment on function public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz) is
  'F-PRE-11: crea (p_id null) o edita una promoción de precio. Exige productos=edicion; valida empresa y producto de la organización; sin solapes (23P01); bloqueo optimista por updated_at (40001); idempotente. No edita vencidas ni anuladas.';

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

comment on function public.anular_promocion_precio(uuid, timestamptz) is
  'F-PRE-11: anula una promoción programada o vigente. Exige productos=edicion; bloqueo optimista por updated_at (40001); idempotente; una vencida no se anula (22023).';

revoke execute on function public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.guardar_promocion_precio(uuid, uuid, uuid, numeric, timestamptz, timestamptz, timestamptz) to authenticated;
revoke execute on function public.anular_promocion_precio(uuid, timestamptz) from public, anon;
grant execute on function public.anular_promocion_precio(uuid, timestamptz) to authenticated;
