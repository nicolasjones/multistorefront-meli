-- F-SVC-02 (MSF-283, épica MSF-182): lectura de una reparación y técnicos elegibles.
-- Esquema: sin tablas nuevas (Principio VII).
--
-- `obtener_reparacion` es SECURITY DEFINER porque los costos internos no tienen `select` directo:
-- exige al menos `lectura` en `service_tecnico` y los devuelve nulos sin la acción `ver_costos`
-- (FR-021). `tecnicos_de_service` devuelve solo `user_id` y nombre visible de los miembros activos
-- de la organización con `edicion` en `service_tecnico` (sin otros datos personales).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.tecnicos_de_service();
--   drop function public.obtener_reparacion(uuid);

create or replace function public.obtener_reparacion(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_json jsonb;
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver reparaciones' using errcode = '42501';
  end if;
  v_json := private.reparacion_json(p_id);
  if v_json is null then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  return v_json;
end;
$$;

comment on function public.obtener_reparacion(uuid) is
  'F-SVC-02: una reparación con cliente, modelo y estado; los costos internos llegan nulos sin ver_costos.';

revoke execute on function public.obtener_reparacion(uuid) from public, anon;
grant execute on function public.obtener_reparacion(uuid) to authenticated;

create or replace function public.tecnicos_de_service()
returns table (user_id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver técnicos' using errcode = '42501';
  end if;
  return query
    select u.user_id,
           coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), a.email::text)
      from public.usuarios_organizacion u
      join auth.users a on a.id = u.user_id
      left join public.perfiles_usuario p on p.user_id = u.user_id
     where u.organizacion_id = (select private.organizacion_id())
       and u.estado = 'activo'
       and private.nivel_de_rol(u.organizacion_id, u.rol_id, 'service_tecnico') = 'edicion'
     order by 2;
end;
$$;

comment on function public.tecnicos_de_service() is
  'F-SVC-02: usuarios activos de la organización con edición en Service técnico (id y nombre visible).';

revoke execute on function public.tecnicos_de_service() from public, anon;
grant execute on function public.tecnicos_de_service() to authenticated;
