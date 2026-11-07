-- MSF-354 (F-IMP-01, FR-005, FR-006, FR-007, FR-010): funciones del worker sobre su proceso masivo.
-- Las ejecuta solo un rol `worker_<org>` (miembro de `workers_orquestacion`) de la organización dueña
-- del proceso; la organización sale de la sesión, nunca de un parámetro.
--
-- Esquemas (Principio VII): solo funciones en `public` (superficie de ejecución) y `private`
-- (autorización). Migración aditiva. Reversión (migración posterior):
--   drop function public.cerrar_proceso_masivo(uuid, text, text);
--   drop function public.registrar_error_proceso_masivo(uuid, integer, text, text);
--   drop function public.actualizar_progreso_proceso_masivo(uuid, integer, integer);
--   drop function private.autorizar_worker_proceso(uuid);

create or replace function private.autorizar_worker_proceso(p_proceso_id uuid)
returns public.procesos_masivos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.procesos_masivos;
begin
  -- El dueño de la función (postgres) también puede: ver autorizar_worker_importacion.
  if session_user <> current_user
     and (session_user not like 'worker\_%'
          or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member')) then
    raise exception 'NO_AUTORIZADO: solo un worker accede a su proceso masivo' using errcode = 'P0001';
  end if;

  select * into v_p from public.procesos_masivos p where p.id = p_proceso_id for update;
  if not found then
    raise exception 'PROCESO_DESCONOCIDO: %', p_proceso_id using errcode = 'P0001';
  end if;
  perform private.autorizar_llamante_ciclo(v_p.organizacion_id);
  return v_p;
end;
$$;

revoke execute on function private.autorizar_worker_proceso(uuid) from public, anon, authenticated;

-- Avance por lote: `procesados` no retrocede y se acota a `total`; el primer avance pasa a en_curso.
create or replace function public.actualizar_progreso_proceso_masivo(
  p_proceso_id uuid,
  p_procesados integer,
  p_total integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.procesos_masivos;
  v_total integer;
  v_procesados integer;
begin
  v_p := private.autorizar_worker_proceso(p_proceso_id);
  if v_p.estado not in ('pendiente', 'en_curso') then
    raise exception 'PROCESO_TERMINADO: el proceso ya terminó' using errcode = 'P0001';
  end if;
  if p_procesados is null or p_procesados < 0 or (p_total is not null and p_total < 0) then
    raise exception 'ARGUMENTO_INVALIDO: procesados y total no pueden ser negativos' using errcode = '22023';
  end if;

  v_total := coalesce(p_total, v_p.total);
  v_procesados := greatest(v_p.procesados, p_procesados);
  if v_total is not null then
    v_total := greatest(v_total, v_p.procesados);
    v_procesados := least(v_procesados, v_total);
  end if;

  update public.procesos_masivos
  set total = v_total,
      procesados = v_procesados,
      estado = 'en_curso',
      iniciado_en = coalesce(iniciado_en, clock_timestamp())
  where id = p_proceso_id;
end;
$$;

comment on function public.actualizar_progreso_proceso_masivo(uuid, integer, integer) is
  'F-IMP-01 (FR-005): avance del worker. Monótono y acotado a total; el primer avance pasa el proceso a en_curso. Solo el worker de la organización dueña.';

-- Error por fila: motivo sanitizado en la base; tope de errores guardados (con_errores cuenta todos).
create or replace function public.registrar_error_proceso_masivo(
  p_proceso_id uuid,
  p_fila integer,
  p_referencia text,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tope constant integer := 1000;
  v_p public.procesos_masivos;
  v_motivo text := private.sanitizar_motivo_proceso(p_motivo);
begin
  v_p := private.autorizar_worker_proceso(p_proceso_id);
  if v_p.estado not in ('pendiente', 'en_curso') then
    raise exception 'PROCESO_TERMINADO: el proceso ya terminó' using errcode = 'P0001';
  end if;
  if v_motivo = '' then
    raise exception 'ARGUMENTO_INVALIDO: el motivo es obligatorio' using errcode = '22023';
  end if;
  if p_fila is not null and p_fila < 0 then
    raise exception 'ARGUMENTO_INVALIDO: la fila no puede ser negativa' using errcode = '22023';
  end if;

  if (select count(*) from public.procesos_masivos_errores e where e.proceso_id = p_proceso_id) < c_tope then
    insert into public.procesos_masivos_errores (proceso_id, organizacion_id, fila, referencia, motivo_sanitizado)
    values (p_proceso_id, v_p.organizacion_id, p_fila,
            left(private.sanitizar_motivo_proceso(p_referencia, false), 200), v_motivo);
  end if;

  update public.procesos_masivos
  set con_errores = con_errores + 1,
      estado = 'en_curso',
      iniciado_en = coalesce(iniciado_en, clock_timestamp())
  where id = p_proceso_id;
end;
$$;

comment on function public.registrar_error_proceso_masivo(uuid, integer, text, text) is
  'F-IMP-01 (FR-006): error por fila con motivo sanitizado en la base. Guarda hasta 1000 detalles por proceso; con_errores cuenta todos. Solo el worker de la organización dueña.';

-- Cierre: completado (sin errores), con_errores (filas rechazadas), fallido o cancelado (confirmado).
-- El motivo del cierre queda como un error sin fila, sin contarlo en con_errores.
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
end;
$$;

comment on function public.cerrar_proceso_masivo(uuid, text, text) is
  'F-IMP-01 (FR-007): cierra el proceso como completado, con_errores, fallido o cancelado. Un terminal no se reabre (PROCESO_TERMINADO). Solo el worker de la organización dueña.';

revoke execute on function public.actualizar_progreso_proceso_masivo(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.registrar_error_proceso_masivo(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.cerrar_proceso_masivo(uuid, text, text) from public, anon, authenticated;
grant execute on function public.actualizar_progreso_proceso_masivo(uuid, integer, integer) to workers_orquestacion;
grant execute on function public.registrar_error_proceso_masivo(uuid, integer, text, text) to workers_orquestacion;
grant execute on function public.cerrar_proceso_masivo(uuid, text, text) to workers_orquestacion;
