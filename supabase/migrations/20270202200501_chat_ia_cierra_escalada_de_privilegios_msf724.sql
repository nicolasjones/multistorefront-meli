-- MSF-724 — Cierra la escalada de privilegios del chat IA: un usuario podía
-- insertar un mensaje 'propuesta' con cualquier accion_rpc y ejecutarlo como
-- dueño (security definer). Migración aditiva sobre
-- 20261005000500_chat_companion_ejecucion.sql (esquema: `public`, plataforma;
-- no crea tablas). Reversión: restaurar la versión previa de
-- private.ejecutar_accion_chat_ia desde esa migración, volver a otorgar
-- `insert, update` sobre mensajes_chat_ia a authenticated y retirar
-- public.proponer_accion_chat_ia (revertir implica reabrir la vulnerabilidad).

-- 1. El usuario ya no escribe propuestas: solo inserta mensajes comunes.
--    accion_* y los updates quedan reservados a las RPC security definer.
revoke insert, update on table mensajes_chat_ia from authenticated;
grant insert (conversacion_id, origen, contenido, estado) on table mensajes_chat_ia to authenticated;

-- 2. Las propuestas se crean por RPC, validadas contra acciones_chat_ia.
create or replace function private.proponer_accion_chat_ia(
  p_conversacion_id uuid,
  p_rpc text,
  p_parametros jsonb,
  p_descripcion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feature_id text;
begin
  if not exists (
    select 1 from public.conversaciones_chat_ia c
    where c.id = p_conversacion_id
      and c.usuario_id = (select auth.uid())
      and c.organizacion_id = (select private.organizacion_id())
  ) then
    raise exception 'CONVERSACION_NO_ENCONTRADA' using errcode = '42501';
  end if;

  if p_parametros is null or jsonb_typeof(p_parametros) <> 'object' then
    return jsonb_build_object('propuesta', false, 'motivo', 'ACCION_NO_DISPONIBLE');
  end if;

  select a.feature_id into v_feature_id
  from public.acciones_chat_ia a
  where a.rpc = p_rpc
    and private.puede_chat_ejecutar_funcionalidad(a.feature_id)
  limit 1;

  if v_feature_id is null then
    return jsonb_build_object('propuesta', false, 'motivo', 'ACCION_NO_DISPONIBLE');
  end if;

  insert into public.mensajes_chat_ia (conversacion_id, origen, contenido, estado, accion_feature_id, accion_rpc, accion_parametros)
  values (p_conversacion_id, 'chat', coalesce(p_descripcion, ''), 'propuesta', v_feature_id, p_rpc, p_parametros);

  return jsonb_build_object('propuesta', true);
end;
$$;

create or replace function public.proponer_accion_chat_ia(
  p_conversacion_id uuid,
  p_rpc text,
  p_parametros jsonb,
  p_descripcion text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.proponer_accion_chat_ia(p_conversacion_id, p_rpc, p_parametros, p_descripcion);
$$;

revoke execute on function public.proponer_accion_chat_ia(uuid, text, jsonb, text) from public, anon;
grant execute on function public.proponer_accion_chat_ia(uuid, text, jsonb, text) to authenticated;

-- 3. La ejecución exige que (feature, rpc) esté registrada y que la función
--    sea ejecutable por authenticated: el definer ya no puede saltear revokes.
create or replace function private.ejecutar_accion_chat_ia(p_mensaje_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mensaje record;
  v_puede_ejecutar boolean;
  v_puede_escribir boolean;
  v_ejecucion_id uuid;
  v_llamada text;
  v_args text;
  v_resultado jsonb;
  v_sobrecargas int;
  v_ejecutables int;
begin
  select m.id, m.conversacion_id, m.estado, m.accion_feature_id, m.accion_rpc, m.accion_parametros
    into v_mensaje
  from public.mensajes_chat_ia m
  join public.conversaciones_chat_ia c on c.id = m.conversacion_id
  where m.id = p_mensaje_id
    and c.usuario_id = (select auth.uid())
  for update of m;

  if v_mensaje.id is null then
    raise exception 'MENSAJE_NO_ENCONTRADO' using errcode = '42501';
  end if;

  if v_mensaje.estado <> 'propuesta' then
    raise exception 'MENSAJE_NO_ES_PROPUESTA' using errcode = '22023';
  end if;

  -- Allowlist (MSF-724): el par (feature, rpc) debe existir en
  -- acciones_chat_ia, curada por un superadmin. La fila del mensaje la puede
  -- haber fabricado cualquiera, no es confiable por sí sola.
  if v_mensaje.accion_feature_id is null
     or v_mensaje.accion_rpc is null
     or jsonb_typeof(v_mensaje.accion_parametros) <> 'object'
     or not exists (
       select 1 from public.acciones_chat_ia a
       where a.feature_id = v_mensaje.accion_feature_id and a.rpc = v_mensaje.accion_rpc
     ) then
    update public.mensajes_chat_ia set estado = 'fallida' where id = p_mensaje_id;
    return jsonb_build_object('estado', 'fallida', 'motivo', 'acción no registrada');
  end if;

  -- La función corre como dueño: solo se permite si authenticated tiene
  -- EXECUTE sobre todas sus sobrecargas (una revocada no se alcanza por acá).
  select count(*), count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))
    into v_sobrecargas, v_ejecutables
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = v_mensaje.accion_rpc;

  if v_sobrecargas = 0 or v_sobrecargas <> v_ejecutables then
    update public.mensajes_chat_ia set estado = 'fallida' where id = p_mensaje_id;
    return jsonb_build_object('estado', 'fallida', 'motivo', 'acción no permitida');
  end if;

  -- Revalidación TOCTOU (FR-013): la capacidad pudo cambiar entre que se
  -- ofreció la acción y que el usuario confirmó.
  v_puede_ejecutar := private.puede_chat_ejecutar_funcionalidad(v_mensaje.accion_feature_id);
  v_puede_escribir := private.puede_escribir();

  if not v_puede_ejecutar or not v_puede_escribir then
    update public.mensajes_chat_ia set estado = 'fallida' where id = p_mensaje_id;
    return jsonb_build_object('estado', 'fallida', 'motivo', 'capacidad revocada');
  end if;

  begin
    insert into public.ejecuciones_chat_ia (mensaje_id, feature_id, usuario_id, estado)
    values (p_mensaje_id, v_mensaje.accion_feature_id, (select auth.uid()), 'en_curso')
    returning id into v_ejecucion_id;
  exception when unique_violation then
    return jsonb_build_object('estado', 'en_curso', 'motivo', 'ya hay una ejecución en curso para este mensaje');
  end;

  -- rpc validada arriba contra acciones_chat_ia y pg_proc; %I/%L escapan.
  select string_agg(format('%I := %L', key, value), ', ')
    into v_args
  from jsonb_each_text(v_mensaje.accion_parametros);

  v_llamada := format('select to_jsonb(r) from public.%I(%s) r', v_mensaje.accion_rpc, coalesce(v_args, ''));

  begin
    execute v_llamada into v_resultado;

    update public.ejecuciones_chat_ia
      set estado = 'completada', finalizada_en = now()
      where id = v_ejecucion_id;
    update public.mensajes_chat_ia set estado = 'confirmada' where id = p_mensaje_id;

    return jsonb_build_object('estado', 'completada', 'resultado', v_resultado);
  exception when others then
    update public.ejecuciones_chat_ia
      set estado = 'fallida', motivo_error = sqlerrm, finalizada_en = now()
      where id = v_ejecucion_id;
    update public.mensajes_chat_ia set estado = 'fallida' where id = p_mensaje_id;

    return jsonb_build_object('estado', 'fallida', 'motivo', sqlerrm);
  end;
end;
$$;

comment on function private.ejecutar_accion_chat_ia(uuid) is
  'Exige (feature, rpc) en acciones_chat_ia y EXECUTE de authenticated sobre la función (MSF-724); revalida capacidad + rol, evita doble ejecución y audita (FR-005, FR-013, FR-014, FR-016). Corre como definer: la RPC de negocio ve auth.uid() del usuario pero no hereda sus grants.';
