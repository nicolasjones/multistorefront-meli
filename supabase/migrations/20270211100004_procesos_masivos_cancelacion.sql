-- MSF-354 (F-IMP-01, FR-009, FR-010): cancelación de procesos masivos.
--   * pendiente (orden aún sin reclamar) -> cancelado de inmediato: la orden de despacho pasa a
--     `cancelada` y la ejecución auditable se cierra para no bloquear la capacidad.
--   * en curso (o con la orden ya reclamada) -> `cancelacion_solicitada`: el worker lo detecta entre
--     lotes con `proceso_masivo_cancelado` y lo cierra `cancelado` conservando lo procesado.
--   * terminal -> PROCESO_TERMINADO.
--
-- `solicitar_cancelacion_proceso_masivo` es `security definer` (el contrato original decía invoker,
-- pero `authenticated` no escribe procesos ni despachos): autoriza dentro, solo administradores.
--
-- Esquemas (Principio VII): solo funciones en `public` sobre tablas de plataforma.
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.proceso_masivo_cancelado(uuid);
--   drop function public.solicitar_cancelacion_proceso_masivo(uuid);

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
      return 'cancelado';
    end if;
  end if;

  update public.procesos_masivos set cancelacion_solicitada = true where id = p_proceso_id;
  return 'cancelacion_solicitada';
end;
$$;

comment on function public.solicitar_cancelacion_proceso_masivo(uuid) is
  'F-IMP-01 (FR-009): cancela un proceso pendiente (libera su orden) o solicita la cancelación de uno en curso. Solo administradores. Errores: NO_AUTORIZADO, PROCESO_TERMINADO.';

revoke execute on function public.solicitar_cancelacion_proceso_masivo(uuid) from public, anon;
grant execute on function public.solicitar_cancelacion_proceso_masivo(uuid) to authenticated;

-- El worker consulta entre lotes si debe frenar.
create or replace function public.proceso_masivo_cancelado(p_proceso_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.procesos_masivos;
begin
  v_p := private.autorizar_worker_proceso(p_proceso_id);
  return v_p.cancelacion_solicitada or v_p.estado = 'cancelado';
end;
$$;

comment on function public.proceso_masivo_cancelado(uuid) is
  'F-IMP-01 (FR-009): true si hay una cancelación solicitada para el proceso. Solo el worker de la organización dueña.';

revoke execute on function public.proceso_masivo_cancelado(uuid) from public, anon, authenticated;
grant execute on function public.proceso_masivo_cancelado(uuid) to workers_orquestacion;
