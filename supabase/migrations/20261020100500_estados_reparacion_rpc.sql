-- F-SVC-01 (MSF-254, épica MSF-182): RPC de alta, edición, orden y estado de los estados de reparación.
-- Esquema: sin tablas nuevas (usa `dominio.estados_reparacion`; Principio VII).
--
-- Todas SECURITY INVOKER: rige la RLS del llamador (`service_tecnico` en `edicion`). La organización
-- sale de la sesión. `avisa_cliente` y `cierra` se guardan, pero NO se envía ningún aviso en esta épica
-- (FR-006); `cierra` lo fija el sembrado y ninguna RPC lo cambia.
-- `mover_estado_reparacion` intercambia el `orden` con el vecino en una sola sentencia (atómico) y
-- serializa por organización con un bloqueo transaccional, así dos movimientos simultáneos no repiten orden.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.cambiar_estado_estado_reparacion(uuid, boolean);
--   drop function public.mover_estado_reparacion(uuid, text);
--   drop function public.actualizar_estado_reparacion(uuid, timestamptz, text, text, boolean);
--   drop function public.crear_estado_reparacion(text, text, boolean);

create or replace function public.crear_estado_reparacion(
  p_nombre text,
  p_descripcion text default '',
  p_avisa_cliente boolean default false
)
returns dominio.estados_reparacion
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.estados_reparacion;
begin
  if v_org is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede crear estados de reparación' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre del estado es obligatorio' using errcode = '22023';
  end if;
  if length(btrim(p_nombre)) > 80 then
    raise exception 'El nombre del estado admite hasta 80 caracteres' using errcode = '22023';
  end if;
  if length(coalesce(p_descripcion, '')) > 500 then
    raise exception 'La descripción admite hasta 500 caracteres' using errcode = '22023';
  end if;

  -- Serializa las altas y los movimientos de la organización: el orden nuevo es max + 1 sin repetir.
  perform pg_advisory_xact_lock(hashtextextended('estados_reparacion:' || v_org::text, 0));

  insert into dominio.estados_reparacion (nombre, descripcion, orden, avisa_cliente)
  values (
    p_nombre, coalesce(p_descripcion, ''),
    (select coalesce(max(e.orden), 0) + 1 from dominio.estados_reparacion e where e.organizacion_id = v_org),
    coalesce(p_avisa_cliente, false)
  )
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.crear_estado_reparacion(text, text, boolean) is
  'F-SVC-01: alta de estado de reparación al final del orden; guarda avisa_cliente sin enviar avisos; solo con edición en Service técnico.';

revoke execute on function public.crear_estado_reparacion(text, text, boolean) from public, anon;
grant execute on function public.crear_estado_reparacion(text, text, boolean) to authenticated;

create or replace function public.actualizar_estado_reparacion(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_descripcion text,
  p_avisa_cliente boolean
)
returns dominio.estados_reparacion
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.estados_reparacion;
  v_fila dominio.estados_reparacion;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede editar estados de reparación' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre del estado es obligatorio' using errcode = '22023';
  end if;
  if length(btrim(p_nombre)) > 80 then
    raise exception 'El nombre del estado admite hasta 80 caracteres' using errcode = '22023';
  end if;
  if length(coalesce(p_descripcion, '')) > 500 then
    raise exception 'La descripción admite hasta 500 caracteres' using errcode = '22023';
  end if;
  if p_avisa_cliente is null then
    raise exception 'Indicá si el estado avisa al cliente' using errcode = '22023';
  end if;

  select * into v_actual from dominio.estados_reparacion where id = p_id for update;
  if not found then
    raise exception 'El estado no existe' using errcode = 'P0002';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El estado fue modificado por otra persona' using errcode = '40001';
  end if;

  update dominio.estados_reparacion
     set nombre = p_nombre, descripcion = coalesce(p_descripcion, ''), avisa_cliente = p_avisa_cliente
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.actualizar_estado_reparacion(uuid, timestamptz, text, text, boolean) is
  'F-SVC-01: edita nombre, descripción y avisa_cliente con bloqueo optimista por updated_at (40001); solo con edición en Service técnico.';

revoke execute on function public.actualizar_estado_reparacion(uuid, timestamptz, text, text, boolean) from public, anon;
grant execute on function public.actualizar_estado_reparacion(uuid, timestamptz, text, text, boolean) to authenticated;

-- p_direccion: 'subir' (hacia el primero) o 'bajar' (hacia el último). En un extremo es un no-op.
create or replace function public.mover_estado_reparacion(p_id uuid, p_direccion text)
returns dominio.estados_reparacion
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.estados_reparacion;
  v_vecino dominio.estados_reparacion;
begin
  if v_org is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede reordenar estados de reparación' using errcode = '42501';
  end if;
  if p_direccion is null or p_direccion not in ('subir', 'bajar') then
    raise exception 'La dirección debe ser subir o bajar' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('estados_reparacion:' || v_org::text, 0));

  select * into v_actual from dominio.estados_reparacion where id = p_id for update;
  if not found then
    raise exception 'El estado no existe' using errcode = 'P0002';
  end if;

  if p_direccion = 'subir' then
    select * into v_vecino from dominio.estados_reparacion e
     where e.organizacion_id = v_org and (e.orden, e.id) < (v_actual.orden, v_actual.id)
     order by e.orden desc, e.id desc limit 1 for update;
  else
    select * into v_vecino from dominio.estados_reparacion e
     where e.organizacion_id = v_org and (e.orden, e.id) > (v_actual.orden, v_actual.id)
     order by e.orden asc, e.id asc limit 1 for update;
  end if;
  if not found then
    return v_actual;
  end if;

  -- Intercambio atómico en una sola sentencia.
  update dominio.estados_reparacion
     set orden = case when id = v_actual.id then v_vecino.orden else v_actual.orden end
   where id in (v_actual.id, v_vecino.id);

  select * into v_actual from dominio.estados_reparacion where id = p_id;
  return v_actual;
end;
$$;

comment on function public.mover_estado_reparacion(uuid, text) is
  'F-SVC-01: sube o baja un estado intercambiando su orden con el vecino en una sola sentencia; serializado por organización.';

revoke execute on function public.mover_estado_reparacion(uuid, text) from public, anon;
grant execute on function public.mover_estado_reparacion(uuid, text) to authenticated;

create or replace function public.cambiar_estado_estado_reparacion(p_id uuid, p_activo boolean)
returns dominio.estados_reparacion
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.estados_reparacion;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los estados de reparación' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.estados_reparacion where id = p_id for update;
  if not found then
    raise exception 'El estado no existe' using errcode = 'P0002';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.estados_reparacion set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.cambiar_estado_estado_reparacion(uuid, boolean) is
  'F-SVC-01: activa o desactiva un estado de reparación; idempotente; no existe borrado.';

revoke execute on function public.cambiar_estado_estado_reparacion(uuid, boolean) from public, anon;
grant execute on function public.cambiar_estado_estado_reparacion(uuid, boolean) to authenticated;
