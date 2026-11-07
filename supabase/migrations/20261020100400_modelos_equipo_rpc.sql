-- F-SVC-01 (MSF-254, épica MSF-182): RPC de alta, edición y estado de modelos de equipo.
-- Esquema: sin tablas nuevas (usa `dominio.modelos_equipo`; Principio VII).
--
-- Las tres son SECURITY INVOKER: rige la RLS del llamador (sección `service_tecnico` en
-- `edicion`). La organización sale de la sesión (default de la columna), nunca del llamador.
-- `actualizar_modelo_equipo` usa bloqueo optimista: el llamador envía el `updated_at` que leyó;
-- si cambió se rechaza con 40001 y no se pisa nada. `cambiar_estado_modelo_equipo` es idempotente.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.cambiar_estado_modelo_equipo(uuid, boolean);
--   drop function public.actualizar_modelo_equipo(uuid, timestamptz, text, text, numeric);
--   drop function public.crear_modelo_equipo(text, text, numeric);

create or replace function public.crear_modelo_equipo(
  p_equipo text,
  p_modelo text,
  p_mano_obra_base numeric default 0
)
returns dominio.modelos_equipo
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.modelos_equipo;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede crear modelos de equipo' using errcode = '42501';
  end if;
  if btrim(coalesce(p_equipo, '')) = '' then
    raise exception 'El equipo es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_modelo, '')) = '' then
    raise exception 'El modelo es obligatorio' using errcode = '22023';
  end if;
  if p_mano_obra_base is null or p_mano_obra_base < 0 then
    raise exception 'La mano de obra base no puede ser negativa' using errcode = '22023';
  end if;

  -- El índice único rechaza el duplicado equipo + modelo (23505).
  insert into dominio.modelos_equipo (equipo, modelo, mano_obra_base)
  values (p_equipo, p_modelo, p_mano_obra_base)
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.crear_modelo_equipo(text, text, numeric) is
  'F-SVC-01: alta de modelo de equipo; solo con edición en Service técnico; organización de la sesión.';

revoke execute on function public.crear_modelo_equipo(text, text, numeric) from public, anon;
grant execute on function public.crear_modelo_equipo(text, text, numeric) to authenticated;

create or replace function public.actualizar_modelo_equipo(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_equipo text,
  p_modelo text,
  p_mano_obra_base numeric
)
returns dominio.modelos_equipo
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.modelos_equipo;
  v_fila dominio.modelos_equipo;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede editar modelos de equipo' using errcode = '42501';
  end if;
  if btrim(coalesce(p_equipo, '')) = '' then
    raise exception 'El equipo es obligatorio' using errcode = '22023';
  end if;
  if btrim(coalesce(p_modelo, '')) = '' then
    raise exception 'El modelo es obligatorio' using errcode = '22023';
  end if;
  if p_mano_obra_base is null or p_mano_obra_base < 0 then
    raise exception 'La mano de obra base no puede ser negativa' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes del mismo modelo; RLS acota a la organización.
  select * into v_actual from dominio.modelos_equipo where id = p_id for update;
  if not found then
    raise exception 'El modelo no existe' using errcode = 'P0002';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'El modelo fue modificado por otra persona' using errcode = '40001';
  end if;

  update dominio.modelos_equipo
     set equipo = p_equipo, modelo = p_modelo, mano_obra_base = p_mano_obra_base
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.actualizar_modelo_equipo(uuid, timestamptz, text, text, numeric) is
  'F-SVC-01: edita un modelo con bloqueo optimista por updated_at (40001 ante conflicto); solo con edición en Service técnico.';

revoke execute on function public.actualizar_modelo_equipo(uuid, timestamptz, text, text, numeric) from public, anon;
grant execute on function public.actualizar_modelo_equipo(uuid, timestamptz, text, text, numeric) to authenticated;

create or replace function public.cambiar_estado_modelo_equipo(p_id uuid, p_activo boolean)
returns dominio.modelos_equipo
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.modelos_equipo;
begin
  if (select private.organizacion_id()) is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los modelos de equipo' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.modelos_equipo where id = p_id for update;
  if not found then
    raise exception 'El modelo no existe' using errcode = 'P0002';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.modelos_equipo set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.cambiar_estado_modelo_equipo(uuid, boolean) is
  'F-SVC-01: activa o desactiva un modelo sin tocar sus datos; idempotente; no existe borrado.';

revoke execute on function public.cambiar_estado_modelo_equipo(uuid, boolean) from public, anon;
grant execute on function public.cambiar_estado_modelo_equipo(uuid, boolean) to authenticated;
