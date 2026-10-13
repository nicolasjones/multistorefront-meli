-- F-ROL-02 · Matriz de permisos editable por rol (épica MSF-125, spec
-- 20261013-120000-usuarios-y-roles, FR-003, FR-013, FR-015).
--
-- Esquemas (Principio VII): no crea tablas; solo dos RPC en `public` (superficie
-- de PostgREST) que escriben en `permisos_rol` / `permisos_rol_accion`
-- (plataforma, `public`). Las tablas siguen sin policies de escritura: toda
-- edición pasa por estas funciones, que verifican en servidor que quien llama
-- es Administrador de la organización (o superadmin con organización activa).
--
-- Migración aditiva (solo funciones nuevas). Camino de reversión (no se ejecuta):
--   drop function public.restablecer_matriz_permisos();
--   drop function public.guardar_matriz_permisos(jsonb, jsonb);

-- p_niveles:  [{"rol_id": "...", "seccion": "...", "nivel": "edicion|lectura|ninguno"}, ...]
-- p_acciones: [{"rol_id": "...", "seccion": "...", "accion": "eliminar|exportar|ver_costos", "permitido": true|false}, ...]
-- Se aplica todo o nada (una sola transacción). Solo toca la organización de
-- private.organizacion_id(): el cliente no elige la organización.
create or replace function public.guardar_matriz_permisos(p_niveles jsonb default '[]', p_acciones jsonb default '[]')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_cambio jsonb;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un Administrador de la organización puede editar la matriz de permisos' using errcode = '42501';
  end if;

  if jsonb_typeof(p_niveles) is distinct from 'array' or jsonb_typeof(p_acciones) is distinct from 'array' then
    raise exception 'Los cambios deben ser listas' using errcode = '22023';
  end if;

  for v_cambio in select * from jsonb_array_elements(p_niveles) loop
    -- FR-003: el Administrador no se restringe (además lo impide un check en la tabla).
    if v_cambio ->> 'rol_id' = 'administrador' then
      raise exception 'El rol Administrador no se puede restringir' using errcode = '22023';
    end if;
    if v_cambio ->> 'nivel' not in ('edicion', 'lectura', 'ninguno') then
      raise exception 'Nivel inválido: %', v_cambio ->> 'nivel' using errcode = '22023';
    end if;
    -- Solo se actualizan filas existentes (sembradas): rol o sección desconocidos fallan.
    update public.permisos_rol
       set nivel = v_cambio ->> 'nivel'
     where organizacion_id = v_org
       and rol_id = v_cambio ->> 'rol_id'
       and seccion = v_cambio ->> 'seccion';
    if not found then
      raise exception 'Rol o sección desconocidos: % / %', v_cambio ->> 'rol_id', v_cambio ->> 'seccion' using errcode = '22023';
    end if;
  end loop;

  for v_cambio in select * from jsonb_array_elements(p_acciones) loop
    if v_cambio ->> 'rol_id' = 'administrador' then
      raise exception 'El rol Administrador no se puede restringir' using errcode = '22023';
    end if;
    if jsonb_typeof(v_cambio -> 'permitido') is distinct from 'boolean' then
      raise exception 'permitido debe ser booleano' using errcode = '22023';
    end if;
    update public.permisos_rol_accion
       set permitido = (v_cambio ->> 'permitido')::boolean
     where organizacion_id = v_org
       and rol_id = v_cambio ->> 'rol_id'
       and seccion = v_cambio ->> 'seccion'
       and accion = v_cambio ->> 'accion';
    if not found then
      raise exception 'Rol, sección o acción desconocidos: % / % / %',
        v_cambio ->> 'rol_id', v_cambio ->> 'seccion', v_cambio ->> 'accion' using errcode = '22023';
    end if;
  end loop;
end;
$$;

comment on function public.guardar_matriz_permisos(jsonb, jsonb) is
  'Guarda cambios de la matriz de permisos de la organización actual (F-ROL-02, FR-013). Solo Administrador; todo o nada; el Administrador no es restringible.';

-- FR-015: vuelve a los valores iniciales de Roles.dc.html reutilizando la siembra.
create or replace function public.restablecer_matriz_permisos()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un Administrador de la organización puede restablecer la matriz de permisos' using errcode = '42501';
  end if;

  delete from public.permisos_rol_accion where organizacion_id = v_org;
  delete from public.permisos_rol where organizacion_id = v_org;
  perform private.sembrar_permisos(v_org);
end;
$$;

comment on function public.restablecer_matriz_permisos() is
  'Restablece la matriz de la organización actual a los valores iniciales (F-ROL-02, FR-015). Solo Administrador.';

revoke all on function public.guardar_matriz_permisos(jsonb, jsonb), public.restablecer_matriz_permisos() from public, anon;
grant execute on function public.guardar_matriz_permisos(jsonb, jsonb), public.restablecer_matriz_permisos() to authenticated;
