-- MSF-186 · F-CON-01, devolución del Revisor (PR #288).
--  * actualizar_consulta: el responsable se valida solo si cambia (un responsable que perdió
--    elegibilidad no bloquea cambiar estado o nota).
--  * responsables_consultas: exige `consultas` = edición (lo único que usa la UI).
--  * nombre_producto_consulta: exige `consultas` >= lectura, como nombre_responsable_consulta.
--
-- Esquema (Principio VII): sin tablas; solo se redefinen funciones. Migración aditiva.
-- Reversión: reaplicar las definiciones de 20261024100200 y 20261024100300.

create or replace function private.nombre_producto_consulta(p_producto_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.nombre
  from dominio.productos p
  where p.id = p_producto_id
    and p.organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('consultas')) in ('lectura', 'edicion');
$$;

revoke execute on function private.nombre_producto_consulta(uuid) from public, anon;
grant execute on function private.nombre_producto_consulta(uuid) to authenticated;

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

  -- Solo se valida si el responsable cambia: quien ya estaba asignado puede haber perdido
  -- elegibilidad y aun así se puede editar estado o nota sin reasignar.
  if p_responsable_id is not null
     and p_responsable_id is distinct from v_c.responsable_id
     and not exists (
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

create or replace function public.responsables_consultas(p_empresa_id uuid)
returns table (user_id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion'
     or not exists (select 1 from private.empresas_accesibles() ea where ea = p_empresa_id) then
    raise exception 'No tenés permiso para editar consultas' using errcode = '42501';
  end if;

  return query
    select r.user_id, r.nombre
    from private.responsables_posibles(v_org, p_empresa_id) r
    order by lower(r.nombre), r.user_id;
end;
$$;


revoke execute on function public.responsables_consultas(uuid) from public, anon;
grant execute on function public.responsables_consultas(uuid) to authenticated;

