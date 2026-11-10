-- MSF-354 (F-IMP-01, RF-IMP-01-5): el centro registra en la actividad de la organización
-- `importacion.iniciada`, `importacion.finalizada` e `importacion.cancelada` (hallazgo de la revisión).
--
--   * iniciada   : `iniciar_proceso_masivo`, en la misma transacción que crea el proceso.
--   * cancelada  : `solicitar_cancelacion_proceso_masivo`, al pedirla el usuario (una sola vez); y
--                  `cerrar_proceso_masivo('cancelado')` solo si nadie la había pedido.
--   * finalizada : `cerrar_proceso_masivo` (completado, con_errores, fallido) y la reconciliación de una
--                  ejecución caída (fallido). Lleva solo las cifras (correctas y con error).
-- Sin datos sensibles: el detalle trae el nombre del proceso (sanitizado) y conteos; nunca el motivo de un
-- error, filas, referencias ni parámetros. El actor es quien lo pidió (`solicitado_por`); si el worker cierra
-- sin sesión, la actividad queda atribuida a esa persona. Los tipos no son sensibles.
--
-- Mismas firmas y grants que las versiones de 20270211100002…05 (`create or replace`); solo se suma el
-- registro. Esquemas (Principio VII): funciones en `public` y `private` sobre tablas de plataforma.
-- Migración aditiva. Reversión: volver a aplicar las funciones de 20270211100002…05 y
--   delete from public.tipos_evento_actividad where tipo in
--     ('importacion.iniciada', 'importacion.finalizada', 'importacion.cancelada');
--   drop function private.registrar_cancelacion_proceso(public.procesos_masivos);

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('importacion.iniciada', false, 'Inicio de una importación o exportación masiva'),
  ('importacion.finalizada', false, 'Fin de una importación o exportación masiva (con sus cifras)'),
  ('importacion.cancelada', false, 'Cancelación de una importación o exportación masiva')
on conflict (tipo) do nothing;

-- Evento de cancelación compartido por el pedido del usuario (inmediato o diferido).
create or replace function private.registrar_cancelacion_proceso(p_p public.procesos_masivos)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.insertar_actividad(
    p_p.organizacion_id, (select auth.uid()), 'importacion.cancelada',
    format('Canceló %s «%s»', case when p_p.tipo = 'exportacion' then 'la exportación' else 'la importación' end,
           private.sanitizar_motivo_proceso(p_p.nombre, false)),
    p_p.empresa_id);
end;
$$;

revoke execute on function private.registrar_cancelacion_proceso(public.procesos_masivos) from public, anon, authenticated;

create or replace function public.iniciar_proceso_masivo(
  p_conexion_id uuid,
  p_capacidad text,
  p_tipo text,
  p_funcionalidad text,
  p_nombre text,
  p_empresa_id uuid default null,
  p_parametros jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_proceso uuid := gen_random_uuid();
  v_ejecucion uuid;
begin
  if v_org is null or v_uid is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'NO_AUTORIZADO: solo un administrador de la organización inicia un proceso masivo'
      using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('importacion', 'exportacion') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser importacion o exportacion' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_funcionalidad, ''))) not between 1 and 80
     or length(btrim(coalesce(p_nombre, ''))) not between 1 and 160 then
    raise exception 'ARGUMENTO_INVALIDO: funcionalidad (hasta 80) y nombre (hasta 160) son obligatorios' using errcode = '22023';
  end if;
  if p_parametros is null or jsonb_typeof(p_parametros) <> 'object' then
    raise exception 'ARGUMENTO_INVALIDO: los parámetros deben ser un objeto' using errcode = '22023';
  end if;
  if p_parametros::text ~* '(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)["'']?\s*[:=]\s*\S+'
     or p_parametros::text ~ 'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+' then
    raise exception 'SECRETO_DETECTADO: los parámetros no pueden llevar credenciales' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.conexiones c where c.id = p_conexion_id and c.organizacion_id = v_org) then
    raise exception 'NO_AUTORIZADO: la conexión no pertenece a la organización' using errcode = '42501';
  end if;
  if p_empresa_id is not null and not exists (
    select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org
  ) then
    raise exception 'EMPRESA_INVALIDA: la empresa no pertenece a la organización' using errcode = '22023';
  end if;

  -- Ejecución auditable + orden de despacho; propaga YA_EN_CURSO, CAPACIDAD_NO_HABILITADA, etc.
  v_ejecucion := public.iniciar_ejecucion_worker(
    p_conexion_id, p_capacidad, 'manual', v_uid,
    jsonb_build_object('proceso_id', v_proceso, 'parametros', p_parametros)
  );

  insert into public.procesos_masivos
    (id, organizacion_id, empresa_id, tipo, funcionalidad, nombre, ejecucion_id, solicitado_por)
  values (v_proceso, v_org, p_empresa_id, p_tipo, btrim(p_funcionalidad), btrim(p_nombre), v_ejecucion, v_uid);

  -- RF-IMP-01-5: `importacion.iniciada` en la misma transacción (sin parámetros ni datos del archivo).
  perform private.insertar_actividad(
    v_org, v_uid, 'importacion.iniciada',
    format('Inició %s «%s»', case when p_tipo = 'exportacion' then 'la exportación' else 'la importación' end,
           private.sanitizar_motivo_proceso(btrim(p_nombre), false)),
    p_empresa_id);

  return v_proceso;
end;
$$;


create or replace function public.cerrar_proceso_masivo(
  p_proceso_id uuid,
  p_estado text,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.procesos_masivos;
  v_motivo text := private.sanitizar_motivo_proceso(p_motivo);
begin
  v_p := private.autorizar_worker_proceso(p_proceso_id);
  if p_estado is null or p_estado not in ('completado', 'con_errores', 'fallido', 'cancelado') then
    raise exception 'ESTADO_INVALIDO: el cierre debe ser completado, con_errores, fallido o cancelado' using errcode = '22023';
  end if;
  if v_p.estado not in ('pendiente', 'en_curso') then
    raise exception 'PROCESO_TERMINADO: el proceso ya terminó' using errcode = 'P0001';
  end if;
  if p_estado = 'completado' and v_p.con_errores > 0 then
    raise exception 'ESTADO_INVALIDO: un proceso con filas rechazadas se cierra con_errores' using errcode = '22023';
  end if;
  if p_estado = 'con_errores' and v_p.con_errores = 0 then
    raise exception 'ESTADO_INVALIDO: con_errores requiere al menos una fila rechazada' using errcode = '22023';
  end if;

  update public.procesos_masivos
  set estado = p_estado,
      finalizado_en = clock_timestamp(),
      iniciado_en = coalesce(iniciado_en, clock_timestamp()),
      total = case when p_estado in ('completado', 'con_errores') then coalesce(total, procesados) else total end
  where id = p_proceso_id;

  if v_motivo <> '' then
    insert into public.procesos_masivos_errores (proceso_id, organizacion_id, motivo_sanitizado)
    values (p_proceso_id, v_p.organizacion_id, v_motivo);
  end if;

  -- RF-IMP-01-5: `importacion.finalizada` (completado, con_errores o fallido) o, si el worker cierra como
  -- cancelado una cancelación que nadie había registrado, `importacion.cancelada`. Una cancelación pedida
  -- por el usuario ya quedó registrada al pedirla: no se repite. Solo conteos, nunca el motivo ni filas.
  if p_estado <> 'cancelado' then
    perform private.insertar_actividad(
      v_p.organizacion_id, v_p.solicitado_por, 'importacion.finalizada',
      format('Terminó %s «%s» (%s): %s correctas y %s con error',
        case when v_p.tipo = 'exportacion' then 'la exportación' else 'la importación' end,
        private.sanitizar_motivo_proceso(v_p.nombre, false),
        case p_estado when 'completado' then 'completada' when 'con_errores' then 'con errores' else 'fallida' end,
        greatest(0, v_p.procesados - v_p.con_errores), v_p.con_errores),
      v_p.empresa_id);
  elsif not v_p.cancelacion_solicitada then
    perform private.insertar_actividad(
      v_p.organizacion_id, v_p.solicitado_por, 'importacion.cancelada',
      format('Se canceló %s «%s»', case when v_p.tipo = 'exportacion' then 'la exportación' else 'la importación' end,
             private.sanitizar_motivo_proceso(v_p.nombre, false)),
      v_p.empresa_id);
  end if;
end;
$$;


create or replace function public.solicitar_cancelacion_proceso_masivo(p_proceso_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.procesos_masivos;
  v_liberado integer := 0;
begin
  select * into v_p from public.procesos_masivos p where p.id = p_proceso_id for update;
  -- Sin distinguir "no existe" de "es de otra organización": no se filtra su existencia.
  if not found or not (select private.es_administrador_de(v_p.organizacion_id)) then
    raise exception 'NO_AUTORIZADO: no hay un proceso que puedas cancelar con ese identificador' using errcode = '42501';
  end if;
  if v_p.estado not in ('pendiente', 'en_curso') then
    raise exception 'PROCESO_TERMINADO: el proceso ya terminó' using errcode = 'P0001';
  end if;

  if v_p.estado = 'pendiente' then
    update public.despachos_ejecucion d
    set estado = 'cancelada', reclamada_en = null, vence_en = null, updated_at = clock_timestamp()
    where d.ejecucion_id = v_p.ejecucion_id and d.estado = 'pendiente';
    get diagnostics v_liberado = row_count;

    if v_liberado > 0 then
      update public.procesos_masivos
      set estado = 'cancelado', cancelacion_solicitada = true, finalizado_en = clock_timestamp()
      where id = p_proceso_id;
      -- La ejecución no corrió: se cierra para que la capacidad quede libre (YA_EN_CURSO).
      update public.ejecuciones_worker e
      set estado = 'fallida', finalizada_en = clock_timestamp(), motivo_sanitizado = 'CANCELADA'
      where e.id = v_p.ejecucion_id and e.estado = 'en_curso';
      perform private.registrar_cancelacion_proceso(v_p);
      return 'cancelado';
    end if;
  end if;

  -- Un segundo pedido sobre una cancelación ya pedida no vuelve a registrar el evento.
  if not v_p.cancelacion_solicitada then
    update public.procesos_masivos set cancelacion_solicitada = true where id = p_proceso_id;
    perform private.registrar_cancelacion_proceso(v_p);
  end if;
  return 'cancelacion_solicitada';
end;
$$;


create or replace function private.reconciliar_proceso_masivo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registrados integer;
begin
  with cerrados as (
    update public.procesos_masivos p
    set estado = 'fallido', finalizado_en = clock_timestamp(),
        iniciado_en = coalesce(p.iniciado_en, clock_timestamp())
    where p.ejecucion_id = new.id and p.estado in ('pendiente', 'en_curso')
    returning p.id, p.organizacion_id, p.empresa_id, p.solicitado_por, p.tipo, p.nombre, p.procesados, p.con_errores
  ), actividad as (
    select private.insertar_actividad(
      c.organizacion_id, c.solicitado_por, 'importacion.finalizada',
      format('Terminó %s «%s» (fallida): %s correctas y %s con error',
        case when c.tipo = 'exportacion' then 'la exportación' else 'la importación' end,
        private.sanitizar_motivo_proceso(c.nombre, false), greatest(0, c.procesados - c.con_errores), c.con_errores),
      c.empresa_id)
    from cerrados c
  ), motivos as (
    insert into public.procesos_masivos_errores (proceso_id, organizacion_id, motivo_sanitizado)
    select c.id, c.organizacion_id,
           coalesce(nullif(private.sanitizar_motivo_proceso(new.motivo_sanitizado), ''), 'La ejecución terminó con error')
    from cerrados c
    returning 1
  )
  select count(*) into v_registrados from motivos, (select count(*) from actividad) a;
  return new;
end;
$$;

revoke execute on function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb) to authenticated;
revoke execute on function public.solicitar_cancelacion_proceso_masivo(uuid) from public, anon;
grant execute on function public.solicitar_cancelacion_proceso_masivo(uuid) to authenticated;
revoke execute on function public.cerrar_proceso_masivo(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cerrar_proceso_masivo(uuid, text, text) to workers_orquestacion;
revoke execute on function private.reconciliar_proceso_masivo() from public, anon, authenticated;
