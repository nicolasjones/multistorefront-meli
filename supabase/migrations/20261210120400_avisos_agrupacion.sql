-- MSF-319 · F-NOT-01 (FR-007): agrupación de avisos por destinatario + tipo.
-- La ventana la abre el primer aviso y dura `private.ventana_agrupacion_aviso()` (15 min,
-- propuesta a confirmar con el cliente); los siguientes del mismo tipo para el mismo
-- destinatario, mientras la ventana siga abierta, se suman al mismo grupo (un solo correo).
-- Un aviso fuera de ventana abre un grupo nuevo.
--
-- Reversión (migración posterior): restaurar private.emitir_aviso a la versión de
-- 20261210120300_avisos_cola.sql y drop function private.ventana_agrupacion_aviso();

create or replace function private.ventana_agrupacion_aviso()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '15 minutes';
$$;

comment on function private.ventana_agrupacion_aviso() is
  'Duración de la ventana de agrupación de avisos del mismo tipo para un destinatario (15 minutos).';

create or replace function private.emitir_aviso(p_tipo text, p_organizacion uuid, p_datos jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seccion text;
  v_destinatario uuid;
  v_encolados integer := 0;
  v_grupo uuid;
  v_vence timestamptz;
begin
  select t.seccion into v_seccion from public.tipos_aviso t where t.clave = p_tipo;
  if not found then
    raise exception 'Tipo de aviso desconocido' using errcode = '22023';
  end if;

  for v_destinatario in
    select u.user_id
    from public.usuarios_organizacion u
    join auth.users a on a.id = u.user_id
    where u.organizacion_id = p_organizacion
      and u.estado = 'activo'
      and btrim(coalesce(a.email, '')) <> ''
      and private.nivel_seccion_de_usuario(u.user_id, v_seccion) <> 'ninguno'
      and coalesce(
        (select p.activo from public.preferencias_aviso p
          where p.user_id = u.user_id and p.tipo_aviso = p_tipo),
        true
      )
  loop
    -- Evita que dos emisiones simultáneas abran dos grupos para lo mismo.
    perform pg_advisory_xact_lock(hashtextextended(v_destinatario::text || ':' || p_tipo, 0));

    v_grupo := null;
    select a.grupo_id, a.ventana_vence_en into v_grupo, v_vence
    from public.avisos_pendientes a
    where a.user_id = v_destinatario
      and a.tipo_aviso = p_tipo
      and a.organizacion_id = p_organizacion
      and a.estado = 'pendiente'
      and a.ventana_vence_en > now()
    order by a.ventana_vence_en desc
    limit 1;

    if v_grupo is null then
      v_grupo := gen_random_uuid();
      v_vence := now() + (select private.ventana_agrupacion_aviso());
    end if;

    insert into public.avisos_pendientes
      (organizacion_id, user_id, tipo_aviso, grupo_id, datos, ventana_vence_en)
    values
      (p_organizacion, v_destinatario, p_tipo, v_grupo, coalesce(p_datos, '{}'::jsonb), v_vence);
    v_encolados := v_encolados + 1;
  end loop;

  return v_encolados;
end;
$$;

comment on function private.emitir_aviso(text, uuid, jsonb) is
  'Encola un aviso para cada destinatario con acceso a la sección del tipo y preferencia encendida, agrupando por destinatario + tipo en la ventana de private.ventana_agrupacion_aviso(). Devuelve la cantidad de destinatarios. Solo para funciones security definer de otros componentes.';

revoke execute on function
  private.ventana_agrupacion_aviso(),
  private.emitir_aviso(text, uuid, jsonb)
  from public, anon, authenticated;
