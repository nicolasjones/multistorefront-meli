-- MSF-724 (devolución de la revisión del PR #566) — la ejecución del chat IA
-- corre con los privilegios de QUIEN CONFIRMA, no con los del dueño.
--
-- Qué había quedado:
--   20270122110000 acotó QUÉ se puede ejecutar (allowlist (feature, rpc) en
--   acciones_chat_ia + EXECUTE de authenticated) y cerró la escritura
--   directa de propuestas por el cliente. Pero el wrapper seguía siendo
--   `security definer`: el `execute format('select ... from public.%I(...)')`
--   corría como postgres, así que
--     - una RPC registrada `security invoker` (o que confíe en la RLS) veía
--       los datos de las organizaciones que la RLS del usuario esconde, y
--     - los `revoke execute ... from authenticated` de otras funciones de
--       `public` no la alcanzaban: el definer las ejecutaba igual.
--   El propio fix.md lo reconocía como desvío ("las RPC registradas siguen
--   corriendo como dueño").
--
-- Por qué NO se usa `set local role authenticated` (como sugería la revisión):
--   PostgreSQL lo prohíbe dentro de una función SECURITY DEFINER — "SET ROLE
--   cannot be used within a SECURITY DEFINER function" (docs de SET ROLE; el
--   código de PostgreSQL lo rechaza con InLocalUserIdChange()). Y el wrapper
--   que hace el `execute` es justamente un SECURITY DEFINER.
--
-- Cómo queda:
--   - `public.ejecutar_accion_chat_ia` pasa a `security invoker`: corre con
--     el rol de quien llama (authenticated) y la RPC de negocio se ejecuta
--     con los grants y la RLS del usuario. Es la vía que la propia revisión
--     propose: "security invoker en el wrapper".
--   - Lo que sí necesita privilegio del dueño (auditoría en
--     `ejecuciones_chat_ia` y cambio de estado del mensaje) queda en
--     funciones `private` security definer. `private` NO está expuesto por
--     PostgREST (supabase/config.toml expone public, graphql_public,
--     dominio y publico), así que el navegador no las alcanza.
--   - Los parámetros de una propuesta se validan contra los que la acción
--     declara de verdad (`pg_proc.proargnames`), en la propuesta y en la
--     ejecución: nadie puede inventar un parámetro (por ejemplo un
--     `p_organizacion_id` forjado) para alcanzar datos de otro tenant.
--   - La feature de la propuesta se elige de forma determinista (ordenada por
--     feature_id), no por el plan de ejecución de la consulta.
--
-- Reversión: volver a `public.ejecutar_accion_chat_ia` como security definer
-- (la versión de 20270122110000) y recrear `private.ejecutar_accion_chat_ia`
-- tal como estaba; retirar las funciones private nuevas y sus permisos.
-- Revertir reabre la escalada de privilegios (no hacerlo).

-- ============================================================================
-- 1. Nombres de parámetro que la acción registrada acepta de verdad
-- ============================================================================
-- Solo lee el catálogo (pg_proc/pg_namespace), legible por todos: no hace
-- falta definer. Se excluyen los parámetros OUT (modo 'o'), que no se pueden
-- pasar en la llamada.
create or replace function private.argumentos_permitidos_accion_chat_ia(p_rpc text)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select array_agg(a.nombre order by a.orden)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proargnames, '{}'::text[])) with ordinality as a(nombre, orden)
      where n.nspname = 'public'
        and p.proname = p_rpc
        and coalesce(p.proargmodes[a.orden], 'i'::"char") in ('i'::"char", 'b'::"char", 'v'::"char")
    ),
    '{}'::text[]
  );
$$;

comment on function private.argumentos_permitidos_accion_chat_ia(text) is
  'Nombres de los parámetros que acepta public.<rpc> (solo IN/INOUT/VARIADIC). Los parámetros de una propuesta del chat se validan contra esta lista: nadie puede pasar un parámetro que la acción no declara (MSF-724).';

revoke execute on function private.argumentos_permitidos_accion_chat_ia(text) from public, anon;
grant execute on function private.argumentos_permitidos_accion_chat_ia(text) to authenticated;

-- ============================================================================
-- 2. Propuesta: feature determinista + parámetros declarados
-- ============================================================================
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
  v_permitidos text[];
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

  -- Determinista: la misma RPC puede estar registrada en varias features.
  -- Se recorren ordenadas por feature_id y se toma la primera que la
  -- organización del usuario puede ejecutar. Antes era `limit 1` sin orden:
  -- la feature elegida dependía del plan de ejecución de la consulta.
  select a.feature_id into v_feature_id
  from public.acciones_chat_ia a
  where a.rpc = p_rpc
    and private.puede_chat_ejecutar_funcionalidad(a.feature_id)
  order by a.feature_id
  limit 1;

  if v_feature_id is null then
    return jsonb_build_object('propuesta', false, 'motivo', 'ACCION_NO_DISPONIBLE');
  end if;

  -- La acción tiene que ser ejecutable por el rol del chat: una RPC
  -- revocada a authenticated no se puede ni proponer.
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = p_rpc
      and has_function_privilege('authenticated', p.oid, 'execute')
  ) then
    return jsonb_build_object('propuesta', false, 'motivo', 'ACCION_NO_DISPONIBLE');
  end if;

  -- Los parámetros tienen que ser los que la acción declara: nadie puede
  -- inventar un parámetro (por ejemplo un p_organizacion_id de otra
  -- organización) para forjar el alcance de la acción.
  v_permitidos := private.argumentos_permitidos_accion_chat_ia(p_rpc);

  if exists (
    select 1
    from jsonb_object_keys(p_parametros) as k(clave)
    where not (k.clave = any(coalesce(v_permitidos, '{}'::text[])))
  ) then
    return jsonb_build_object('propuesta', false, 'motivo', 'PARAMETROS_NO_PERMITIDOS');
  end if;

  insert into public.mensajes_chat_ia (conversacion_id, origen, contenido, estado, accion_feature_id, accion_rpc, accion_parametros)
  values (p_conversacion_id, 'chat', coalesce(p_descripcion, ''), 'propuesta', v_feature_id, p_rpc, p_parametros);

  return jsonb_build_object('propuesta', true);
end;
$$;

comment on function private.proponer_accion_chat_ia(uuid, text, jsonb, text) is
  'Crea la propuesta validando: conversación propia, allowlist (feature, rpc) con capacidad de ejecución, RPC ejecutable por authenticated y parámetros declarados por la acción. La feature se elige de forma determinista (ordenada por feature_id) (MSF-724).';

-- ============================================================================
-- 3. Auditoría y estado: lo que sí necesita privilegios del dueño
-- ============================================================================
-- Las dos funciones siguientes son security definer y viven en `private`
-- (no expuesto por PostgREST): el wrapper invoker las usa para escribir la
-- auditoría y el estado del mensaje sin abrirle escritura al cliente.
create or replace function private.abrir_ejecucion_chat_ia(p_mensaje_id uuid, p_feature_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.mensajes_chat_ia m
    join public.conversaciones_chat_ia c on c.id = m.conversacion_id
    where m.id = p_mensaje_id
      and c.usuario_id = (select auth.uid())
  ) then
    raise exception 'MENSAJE_NO_ENCONTRADO' using errcode = '42501';
  end if;

  begin
    insert into public.ejecuciones_chat_ia (mensaje_id, feature_id, usuario_id, estado)
    values (p_mensaje_id, p_feature_id, (select auth.uid()), 'en_curso');
    return jsonb_build_object('ok', true);
  exception when unique_violation then
    -- Índice único parcial: ya hay una ejecución en curso para este mensaje.
    return jsonb_build_object('ok', false, 'motivo', 'ya hay una ejecución en curso para este mensaje');
  end;
end;
$$;

comment on function private.abrir_ejecucion_chat_ia(uuid, text) is
  'Abre la auditoría de la ejecución (FR-014, FR-016). Security definer: la escritura en ejecuciones_chat_ia no se le concede al cliente (MSF-724).';

create or replace function private.cerrar_ejecucion_chat_ia(p_mensaje_id uuid, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.mensajes_chat_ia m
    join public.conversaciones_chat_ia c on c.id = m.conversacion_id
    where m.id = p_mensaje_id
      and c.usuario_id = (select auth.uid())
  ) then
    raise exception 'MENSAJE_NO_ENCONTRADO' using errcode = '42501';
  end if;

  if p_ok then
    update public.ejecuciones_chat_ia
      set estado = 'completada', finalizada_en = now()
      where mensaje_id = p_mensaje_id and estado = 'en_curso';

    update public.mensajes_chat_ia set estado = 'confirmada' where id = p_mensaje_id;
  else
    update public.ejecuciones_chat_ia
      set estado = 'fallida', motivo_error = p_error, finalizada_en = now()
      where mensaje_id = p_mensaje_id and estado = 'en_curso';

    update public.mensajes_chat_ia set estado = 'fallida' where id = p_mensaje_id;
  end if;
end;
$$;

comment on function private.cerrar_ejecucion_chat_ia(uuid, boolean, text) is
  'Cierra la auditoría de la ejecución y el estado del mensaje (FR-014, FR-016). Security definer: el cliente no puede escribir el estado del mensaje (MSF-724).';

revoke execute on function private.abrir_ejecucion_chat_ia(uuid, text) from public, anon;
grant execute on function private.abrir_ejecucion_chat_ia(uuid, text) to authenticated;
revoke execute on function private.cerrar_ejecucion_chat_ia(uuid, boolean, text) from public, anon;
grant execute on function private.cerrar_ejecucion_chat_ia(uuid, boolean, text) to authenticated;

-- ============================================================================
-- 4. El wrapper público: security invoker — la RPC de negocio corre como el
--    usuario que confirma, no como el dueño.
-- ============================================================================
create or replace function public.ejecutar_accion_chat_ia(p_mensaje_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mensaje record;
  v_rpc text;
  v_feature_id text;
  v_args text;
  v_resultado jsonb;
  v_sobrecargas int;
  v_ejecutables int;
  v_permitidos text[];
  v_apertura jsonb;
begin
  -- El mensaje tiene que ser de una conversación del usuario (RLS de la
  -- tabla + filtro explícito por auth.uid()).
  select m.id, m.estado, m.accion_feature_id, m.accion_rpc, m.accion_parametros
    into v_mensaje
  from public.mensajes_chat_ia m
  join public.conversaciones_chat_ia c on c.id = m.conversacion_id
  where m.id = p_mensaje_id
    and c.usuario_id = (select auth.uid());

  if v_mensaje.id is null then
    raise exception 'MENSAJE_NO_ENCONTRADO' using errcode = '42501';
  end if;

  -- `is distinct from` y no `<>`: un mensaje normal (estado null) tampoco
  -- es una propuesta.
  if v_mensaje.estado is distinct from 'propuesta' then
    raise exception 'MENSAJE_NO_ES_PROPUESTA' using errcode = '22023';
  end if;

  v_feature_id := v_mensaje.accion_feature_id;
  v_rpc := v_mensaje.accion_rpc;

  -- Allowlist (MSF-724): el par (feature, rpc) debe existir en
  -- acciones_chat_ia, curada por un superadmin. La fila del mensaje la puede
  -- haber fabricado cualquiera, no es confiable por sí sola.
  if v_feature_id is null
     or v_rpc is null
     or jsonb_typeof(v_mensaje.accion_parametros) <> 'object'
     or not exists (
       select 1 from public.acciones_chat_ia a
       where a.feature_id = v_feature_id and a.rpc = v_rpc
     ) then
    perform private.cerrar_ejecucion_chat_ia(p_mensaje_id, false, 'acción no registrada');
    return jsonb_build_object('estado', 'fallida', 'motivo', 'acción no registrada');
  end if;

  -- La función tiene que ser ejecutable por el rol que confirma: con el
  -- wrapper invoker el `execute` de abajo corre con esos mismos permisos,
  -- así que el chequeo deja de ser cosmético (una RPC revocada falla).
  select count(*), count(*) filter (where has_function_privilege(current_user, p.oid, 'execute'))
    into v_sobrecargas, v_ejecutables
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = v_rpc;

  if v_sobrecargas = 0 or v_sobrecargas <> v_ejecutables then
    perform private.cerrar_ejecucion_chat_ia(p_mensaje_id, false, 'acción no permitida');
    return jsonb_build_object('estado', 'fallida', 'motivo', 'acción no permitida');
  end if;

  -- Los parámetros tienen que ser los que la acción declara: un parámetro
  -- inventado (por ejemplo un p_organizacion_id de otra organización) no se
  -- ejecuta.
  v_permitidos := private.argumentos_permitidos_accion_chat_ia(v_rpc);

  if exists (
    select 1
    from jsonb_object_keys(v_mensaje.accion_parametros) as k(clave)
    where not (k.clave = any(coalesce(v_permitidos, '{}'::text[])))
  ) then
    perform private.cerrar_ejecucion_chat_ia(p_mensaje_id, false, 'parámetros no permitidos');
    return jsonb_build_object('estado', 'fallida', 'motivo', 'parámetros no permitidos');
  end if;

  -- Revalidación TOCTOU (FR-013): la capacidad pudo cambiar entre que se
  -- ofreció la acción y que el usuario confirmó.
  if not (select private.puede_chat_ejecutar_funcionalidad(v_feature_id))
     or not (select private.puede_escribir()) then
    perform private.cerrar_ejecucion_chat_ia(p_mensaje_id, false, 'capacidad revocada');
    return jsonb_build_object('estado', 'fallida', 'motivo', 'capacidad revocada');
  end if;

  -- Auditoría antes de ejecutar (índice único parcial: evita dos ejecuciones
  -- concurrentes sobre el mismo mensaje — FR-014).
  v_apertura := private.abrir_ejecucion_chat_ia(p_mensaje_id, v_feature_id);

  if not coalesce((v_apertura->>'ok')::boolean, false) then
    return jsonb_build_object('estado', 'en_curso', 'motivo', v_apertura->>'motivo');
  end if;

  -- rpc validada arriba contra acciones_chat_ia y pg_proc; %I/%L escapan.
  select string_agg(format('%I := %L', key, value), ', ')
    into v_args
  from jsonb_each_text(v_mensaje.accion_parametros);

  begin
    -- Corre con los privilegios de quien confirma (wrapper security invoker):
    -- la RPC de negocio ve los grants y la RLS del usuario, no los del dueño.
    execute format('select to_jsonb(r) from public.%I(%s) r', v_rpc, coalesce(v_args, '')) into v_resultado;
  exception when others then
    perform private.cerrar_ejecucion_chat_ia(p_mensaje_id, false, sqlerrm);
    return jsonb_build_object('estado', 'fallida', 'motivo', sqlerrm);
  end;

  perform private.cerrar_ejecucion_chat_ia(p_mensaje_id, true, null);

  return jsonb_build_object('estado', 'completada', 'resultado', v_resultado);
end;
$$;

comment on function public.ejecutar_accion_chat_ia(uuid) is
  'Ejecuta la acción propuesta: allowlist (feature, rpc), RPC ejecutable por quien confirma, parámetros declarados por la acción, revalidación de capacidad y rol, auditoría y estado. Corre como security invoker: la RPC de negocio se ejecuta con los privileges y la RLS del usuario, nunca con los del dueño (MSF-724; FR-005, FR-013, FR-014, FR-016).';

revoke execute on function public.ejecutar_accion_chat_ia(uuid) from public;
grant execute on function public.ejecutar_accion_chat_ia(uuid) to authenticated;

-- La versión anterior (security definer) queda sin uso: su `execute` corría
-- como dueño. Se retira para que nadie la vuelva a usar por error.
drop function if exists private.ejecutar_accion_chat_ia(uuid);
