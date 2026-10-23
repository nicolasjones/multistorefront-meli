-- MSF-186 · F-CON-01 (FR-003): edición de una consulta (estado, responsable, nota interna).
--
-- Esquema (Principio VII): ninguna tabla nueva. Las funciones viven en `public` (superficie de
-- ejecución, no almacenan datos) y escriben en `dominio.consultas` por ser SECURITY DEFINER.
--
-- Seguridad: exige sección `consultas` = edición y empresa accesible; valida que el responsable
-- sea un usuario activo de la organización, con acceso a la empresa y a la sección `consultas`;
-- cambia SOLO esos tres campos. `revoke … from public, anon` + `grant … to authenticated`.
-- Bloqueo optimista por `updated_at` (40001). Idempotente: si no hay nada que cambiar devuelve
-- el `updated_at` vigente sin exigir el sello (un reintento tras éxito no es un conflicto).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.actualizar_consulta(uuid, text, uuid, text, timestamptz);
--   drop function private.responsables_posibles(uuid, uuid);

-- Usuarios a quienes se puede asignar una consulta de la empresa: membresía activa de la
-- organización, acceso a la empresa (Administrador o asignado) y `consultas` >= lectura según la
-- matriz del rol (misma resolución que private.nivel_seccion). Interna: sin grants.
create or replace function private.responsables_posibles(p_organizacion_id uuid, p_empresa_id uuid)
returns table (user_id uuid, nombre text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.user_id,
         coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), a.email::text) as nombre
  from public.usuarios_organizacion u
  join auth.users a on a.id = u.user_id
  left join public.perfiles_usuario p on p.user_id = u.user_id
  where u.organizacion_id = p_organizacion_id
    and u.estado = 'activo'
    and (
      u.rol_id = 'administrador'
      or exists (
        select 1 from public.usuarios_empresas ue
        where ue.user_id = u.user_id and ue.empresa_id = p_empresa_id
      )
    )
    and coalesce(
      (select pr.nivel from public.permisos_rol pr
        where pr.organizacion_id = u.organizacion_id and pr.rol_id = u.rol_id and pr.seccion = 'consultas'),
      (select m.nivel from private.matriz_inicial() m
        where m.rol_id = u.rol_id and m.seccion = 'consultas'),
      'ninguno'
    ) in ('lectura', 'edicion');
$$;

revoke execute on function private.responsables_posibles(uuid, uuid) from public, anon, authenticated;

create or replace function public.actualizar_consulta(
  p_id uuid,
  p_estado text,
  p_responsable_id uuid,
  p_nota_interna text,
  p_updated_at timestamptz
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.consultas%rowtype;
  v_nota text := nullif(btrim(coalesce(p_nota_interna, '')), '');
  v_empresa text;
  v_responsable text;
  v_nuevo timestamptz;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar consultas' using errcode = '42501';
  end if;

  if p_estado is null or p_estado not in ('nueva', 'en_curso', 'resuelta') then
    raise exception 'Estado inválido' using errcode = '22023', detail = 'estado';
  end if;
  if length(coalesce(v_nota, '')) > 2000 then
    raise exception 'La nota interna es demasiado larga' using errcode = '22023', detail = 'nota_interna';
  end if;

  select * into v_c from dominio.consultas c
  where c.id = p_id and c.organizacion_id = v_org
  for update;

  -- Inexistente, de otra organización o de una empresa sin acceso: misma respuesta.
  if not found or not exists (
    select 1 from private.empresas_accesibles() ea where ea = v_c.empresa_id
  ) then
    raise exception 'No tenés permiso para editar consultas' using errcode = '42501';
  end if;

  if p_responsable_id is not null and not exists (
    select 1 from private.responsables_posibles(v_org, v_c.empresa_id) r where r.user_id = p_responsable_id
  ) then
    raise exception 'El responsable no es válido para esta empresa' using errcode = '22023', detail = 'responsable_id';
  end if;

  -- Idempotente: sin cambios no hay conflicto posible ni escritura.
  if (v_c.estado, v_c.responsable_id, v_c.nota_interna)
     is not distinct from (p_estado, p_responsable_id, v_nota) then
    return v_c.updated_at;
  end if;

  if p_updated_at is distinct from v_c.updated_at then
    raise exception 'La consulta fue modificada por otra persona' using errcode = '40001';
  end if;

  update dominio.consultas
     set estado = p_estado, responsable_id = p_responsable_id, nota_interna = v_nota
   where id = p_id
  returning updated_at into v_nuevo;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_c.empresa_id;

  if v_c.estado is distinct from p_estado then
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.estado_cambiado',
      format('Cambió el estado de una consulta de «%s» a «%s»', v_empresa,
        case p_estado when 'nueva' then 'Nueva' when 'en_curso' then 'En curso' else 'Resuelta' end),
      v_c.empresa_id);
  end if;
  if v_c.responsable_id is distinct from p_responsable_id then
    select r.nombre into v_responsable
      from private.responsables_posibles(v_org, v_c.empresa_id) r where r.user_id = p_responsable_id;
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.asignada',
      case when p_responsable_id is null
        then format('Quitó el responsable de una consulta de «%s»', v_empresa)
        else format('Asignó una consulta de «%s» a %s', v_empresa, v_responsable) end,
      v_c.empresa_id);
  end if;
  if v_c.nota_interna is distinct from v_nota then
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.nota_actualizada',
      format('Actualizó la nota interna de una consulta de «%s»', v_empresa),
      v_c.empresa_id);
  end if;

  return v_nuevo;
end;
$$;

revoke execute on function public.actualizar_consulta(uuid, text, uuid, text, timestamptz) from public, anon;
grant execute on function public.actualizar_consulta(uuid, text, uuid, text, timestamptz) to authenticated;

comment on function public.actualizar_consulta(uuid, text, uuid, text, timestamptz) is
  'MSF-186: cambia estado, responsable y nota interna de una consulta (sección consultas = edición). 40001 si el sello updated_at no coincide; 42501 sin permiso o sin acceso; 22023 datos inválidos. Registra consulta.estado_cambiado / consulta.asignada / consulta.nota_actualizada solo si el valor cambió.';
