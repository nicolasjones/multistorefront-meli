-- MSF-354 · F-IMP-01 (épica MSF-206, revisión independiente QA y Code/Security): robustez de los procesos masivos.
--
-- Hallazgos que cierra:
--   * MEDIO: `procesos_masivos_errores_claves` guardaba una fila por error sin tope (un CSV de 1M de filas inválidas
--     = 1M de filas y de RPC serializadas por el `for update`). Desde 10.000 errores contados ya no se inserta la
--     clave: solo se cuenta y el proceso queda marcado `detalle_truncado` (también cuando se supera el tope de 1000
--     detalles visibles). Pasado el tope de claves la idempotencia pasa a una marca de agua de fila (`fila_maxima_sin_clave`), que supone errores informados en orden ascendente; un error sin fila solo se cuenta.
--   * MEDIO (huérfanos): cuando la orden de despacho pasa a `agotada`, la ejecución del proceso masivo se cierra
--     `fallida` y la base lleva el proceso a `fallido` con un motivo claro. Las ejecuciones vencidas por tiempo máximo
--     se cierran `timeout` con `private.cerrar_procesos_masivos_vencidos` (la invoca `evaluar_monitoreo`, cada 2
--     minutos). Un administrador puede cancelar un proceso abierto sin worker vivo (orden agotada, ejecución cerrada
--     o vencida): se cierra `cancelado` de inmediato.
--   * BAJO: `iniciar_proceso_masivo` valida la capacidad (`importar-…` para importación, `exportar-…` para exportación).
--   * BAJO: `cerrar_proceso_masivo` valida `cancelado` contra `cancelacion_solicitada` y que `completado` /
--     `con_errores` no queden con `procesados < total`.
--
-- Esquemas (Principio VII): `public` (plataforma); una columna nueva en `procesos_masivos` y funciones.
-- Migración aditiva e idempotente. Reversión (migración posterior):
--   drop trigger reconciliar_despacho_agotado on public.despachos_ejecucion;
--   drop function private.reconciliar_despacho_agotado();
--   drop function private.cerrar_procesos_masivos_vencidos();
--   alter table public.procesos_masivos drop column detalle_truncado, drop column fila_maxima_sin_clave;
--   y restaurar las funciones de 20270214100001 (registrar_error_proceso_masivo) y 20270214100002 (iniciar_proceso_masivo,
--   cerrar_proceso_masivo, solicitar_cancelacion_proceso_masivo, reconciliar_proceso_masivo).

alter table public.procesos_masivos add column if not exists detalle_truncado boolean not null default false;

-- Marca de agua de filas contadas sin clave (pasado el tope de 10.000): permite descartar el reintento de un lote
-- de errores informado en orden ascendente de fila sin guardar una fila por error. Sin grants para la app.
alter table public.procesos_masivos add column if not exists fila_maxima_sin_clave integer;

comment on column public.procesos_masivos.detalle_truncado is
  'F-IMP-01: true si algún error contado no se guardó en el detalle (tope de 1000 detalles o de 10.000 claves). con_errores sigue contando todos.';

grant select (detalle_truncado) on table public.procesos_masivos to authenticated;

-- ============================================================================
-- registrar_error_proceso_masivo: tope de claves
-- ============================================================================

create or replace function public.registrar_error_proceso_masivo(
  p_proceso_id uuid,
  p_fila integer,
  p_referencia text,
  p_motivo text,
  p_columna text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tope constant integer := 1000;
  c_tope_claves constant integer := 10000;
  v_p public.procesos_masivos;
  v_motivo text := private.sanitizar_motivo_proceso(p_motivo);
  v_referencia text := left(private.sanitizar_motivo_proceso(p_referencia, false), 200);
  v_columna text := nullif(left(private.sanitizar_motivo_proceso(p_columna, false), 120), '');
  v_clave text;
  v_nuevo integer;
  v_truncado boolean := false;
  v_marca integer;
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

  if v_p.con_errores >= c_tope_claves then
    -- Tope de claves: solo se cuenta (sin clave ni detalle). La idempotencia pasa a una marca de agua por proceso:
    -- una fila ya registrada con clave, o menor o igual a la mayor fila contada sin clave, es un reintento y no suma.
    -- Supone que el worker informa los errores en orden ascendente de fila (contrato). Sin fila, solo se cuenta.
    if p_fila is not null then
      if exists (select 1 from public.procesos_masivos_errores_claves k
                 where k.proceso_id = p_proceso_id and k.clave = 'f:' || p_fila)
         or p_fila <= coalesce(v_p.fila_maxima_sin_clave, -1) then
        return;
      end if;
      v_marca := p_fila;
    end if;
    v_truncado := true;
  else
    -- Idempotente: con fila, por (proceso, fila); sin fila, por (referencia, motivo).
    v_clave := case when p_fila is not null then 'f:' || p_fila
                    else 'm:' || md5(coalesce(v_referencia, '') || '|' || v_motivo) end;
    insert into public.procesos_masivos_errores_claves (proceso_id, clave)
    values (p_proceso_id, v_clave)
    on conflict do nothing;
    get diagnostics v_nuevo = row_count;
    if v_nuevo = 0 then
      return;
    end if;

    if v_p.detalle_truncado
       or (select count(*) from public.procesos_masivos_errores e where e.proceso_id = p_proceso_id) >= c_tope then
      v_truncado := true;
    else
      insert into public.procesos_masivos_errores (proceso_id, organizacion_id, fila, referencia, columna, motivo_sanitizado)
      values (p_proceso_id, v_p.organizacion_id, p_fila, v_referencia, v_columna, v_motivo)
      on conflict do nothing;
    end if;
  end if;

  update public.procesos_masivos
  set con_errores = con_errores + 1,
      detalle_truncado = detalle_truncado or v_truncado,
      fila_maxima_sin_clave = greatest(coalesce(fila_maxima_sin_clave, -1), coalesce(v_marca, -1)),
      estado = 'en_curso',
      iniciado_en = coalesce(iniciado_en, clock_timestamp())
  where id = p_proceso_id;
end;
$$;

comment on function public.registrar_error_proceso_masivo(uuid, integer, text, text, text) is
  'F-IMP-01 (FR-006): error por fila (fila, referencia, columna, motivo) sanitizado en la base. Idempotente por fila o, sin fila, por referencia y motivo hasta 10.000 errores (después, por marca de agua de fila: el worker informa en orden ascendente); guarda hasta 1000 detalles (el proceso queda detalle_truncado si hay más); con_errores cuenta todos. Solo el worker de la organización dueña.';

revoke execute on function public.registrar_error_proceso_masivo(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_error_proceso_masivo(uuid, integer, text, text, text) to workers_orquestacion;

-- ============================================================================
-- cerrar_proceso_masivo: validaciones coherentes con el contrato del worker
-- ============================================================================

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
  if p_estado in ('completado', 'con_errores') and v_p.total is not null and v_p.procesados < v_p.total then
    raise exception 'ESTADO_INVALIDO: % requiere procesar todas las filas (procesados % de %); si no terminó, se cierra fallido o cancelado',
      p_estado, v_p.procesados, v_p.total using errcode = '22023';
  end if;
  if p_estado = 'cancelado' and not v_p.cancelacion_solicitada then
    raise exception 'ESTADO_INVALIDO: cancelado requiere una cancelación solicitada por el administrador' using errcode = '22023';
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

  -- `importacion.finalizada` para completado, con_errores y fallido. Un cierre `cancelado` ya quedó registrado
  -- como `importacion.cancelada` cuando el administrador la pidió (el cierre exige que se haya pedido).
  if p_estado <> 'cancelado' then
    perform private.insertar_actividad(
      v_p.organizacion_id, v_p.solicitado_por, 'importacion.finalizada',
      format('Terminó %s «%s» (%s): %s correctas y %s con error',
        case when v_p.tipo = 'exportacion' then 'la exportación' else 'la importación' end,
        private.sanitizar_motivo_proceso(v_p.nombre, false),
        case p_estado when 'completado' then 'completada' when 'con_errores' then 'con errores' else 'fallida' end,
        greatest(0, v_p.procesados - v_p.con_errores), v_p.con_errores),
      v_p.empresa_id);
  end if;
end;
$$;

comment on function public.cerrar_proceso_masivo(uuid, text, text) is
  'F-IMP-01 (FR-007): cierra el proceso como completado, con_errores, fallido o cancelado. completado/con_errores exigen procesados = total (si se informó); cancelado exige cancelación solicitada. Un terminal no se reabre (PROCESO_TERMINADO). Solo el worker de la organización dueña.';

revoke execute on function public.cerrar_proceso_masivo(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cerrar_proceso_masivo(uuid, text, text) to workers_orquestacion;

-- ============================================================================
-- iniciar_proceso_masivo: la capacidad debe ser de importación o exportación
-- ============================================================================

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
  -- Capacidades permitidas: `importar-<algo>` para una importación y `exportar-<algo>` para una exportación.
  if p_capacidad is null
     or p_capacidad !~ '^(importar|exportar)-[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'
     or (p_tipo = 'importacion') <> (p_capacidad like 'importar-%') then
    raise exception 'CAPACIDAD_INVALIDA: la capacidad debe ser importar-… para una importación o exportar-… para una exportación'
      using errcode = '22023';
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

  perform private.insertar_actividad(
    v_org, v_uid, 'importacion.iniciada',
    format('Inició %s «%s»', case when p_tipo = 'exportacion' then 'la exportación' else 'la importación' end,
           private.sanitizar_motivo_proceso(btrim(p_nombre), false)),
    p_empresa_id);

  return v_proceso;
end;
$$;

comment on function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb) is
  'F-IMP-01 (FR-004): crea el proceso masivo (pendiente) y su ejecución de worker con orden de despacho en una transacción. Solo administradores. La capacidad debe ser importar-… (importación) o exportar-… (exportación). Errores: NO_AUTORIZADO, TIPO_INVALIDO, CAPACIDAD_INVALIDA, ARGUMENTO_INVALIDO, SECRETO_DETECTADO, EMPRESA_INVALIDA y los del ciclo (YA_EN_CURSO, CAPACIDAD_NO_HABILITADA).';

revoke execute on function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.iniciar_proceso_masivo(uuid, text, text, text, text, uuid, jsonb) to authenticated;

-- ============================================================================
-- Reconciliación: motivo legible cuando la ejecución cae (despacho agotado, tiempo máximo)
-- ============================================================================

create or replace function private.reconciliar_proceso_masivo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registrados integer;
  v_motivo text := case
    when new.motivo_sanitizado = 'DESPACHO_AGOTADO'
      then 'No se pudo iniciar el proceso: el worker no respondió tras varios intentos'
    when new.motivo_sanitizado like 'TIMEOUT:%'
      then 'El proceso superó el tiempo máximo permitido y se cerró'
    else new.motivo_sanitizado
  end;
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
           coalesce(nullif(private.sanitizar_motivo_proceso(v_motivo), ''), 'La ejecución terminó con error')
    from cerrados c
    returning 1
  )
  select count(*) into v_registrados from motivos, (select count(*) from actividad) a;
  return new;
end;
$$;

revoke execute on function private.reconciliar_proceso_masivo() from public, anon, authenticated;

-- Orden de despacho agotada: la ejecución de un proceso masivo abierto no puede avanzar. Se cierra `fallida`
-- (el trigger anterior lleva el proceso a `fallido`). Solo ejecuciones que pertenecen a un proceso masivo.
create or replace function private.reconciliar_despacho_agotado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ejecuciones_worker e
  set estado = 'fallida', finalizada_en = clock_timestamp(), motivo_sanitizado = 'DESPACHO_AGOTADO'
  where e.id = new.ejecucion_id
    and e.estado = 'en_curso'
    and exists (
      select 1 from public.procesos_masivos p
      where p.ejecucion_id = e.id and p.estado in ('pendiente', 'en_curso'));
  return new;
end;
$$;

comment on function private.reconciliar_despacho_agotado() is
  'F-IMP-01 (FR-008): al agotarse la orden de despacho, cierra fallida la ejecución del proceso masivo abierto (y el proceso pasa a fallido).';
revoke execute on function private.reconciliar_despacho_agotado() from public, anon, authenticated;

drop trigger if exists reconciliar_despacho_agotado on public.despachos_ejecucion;
create trigger reconciliar_despacho_agotado
  after update of estado on public.despachos_ejecucion
  for each row
  when (new.estado = 'agotada' and old.estado is distinct from 'agotada')
  execute function private.reconciliar_despacho_agotado();

-- Huérfanos que ya existían: orden agotada con proceso abierto y ejecución en curso.
update public.ejecuciones_worker e
set estado = 'fallida', finalizada_en = clock_timestamp(), motivo_sanitizado = 'DESPACHO_AGOTADO'
where e.estado = 'en_curso'
  and exists (select 1 from public.despachos_ejecucion d where d.ejecucion_id = e.id and d.estado = 'agotada')
  and exists (select 1 from public.procesos_masivos p where p.ejecucion_id = e.id and p.estado in ('pendiente', 'en_curso'));

-- El tiempo máximo de la capacidad se aplicaba solo de forma perezosa (al iniciar otra ejecución): cierra las
-- ejecuciones de procesos masivos abiertos que ya lo superaron (el proceso pasa a fallido por la reconciliación).
create or replace function private.cerrar_procesos_masivos_vencidos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cerradas integer;
begin
  update public.ejecuciones_worker e
  set estado = 'timeout', finalizada_en = clock_timestamp(), motivo_sanitizado = 'TIMEOUT:' || c.tiempo_max_seg || 's'
  from public.capacidades_ejecucion c
  where c.id = e.capacidad_id
    and e.estado = 'en_curso'
    and e.iniciada_en < clock_timestamp() - make_interval(secs => c.tiempo_max_seg)
    and exists (
      select 1 from public.procesos_masivos p
      where p.ejecucion_id = e.id and p.estado in ('pendiente', 'en_curso'));
  get diagnostics v_cerradas = row_count;
  return v_cerradas;
end;
$$;

comment on function private.cerrar_procesos_masivos_vencidos() is
  'F-IMP-01 (FR-008): cierra timeout las ejecuciones de procesos masivos abiertos que superaron el tiempo máximo de su capacidad. La invoca evaluar_monitoreo (cada 2 minutos).';
revoke execute on function private.cerrar_procesos_masivos_vencidos() from public, anon, authenticated;

-- ============================================================================
-- Cancelación: un proceso abierto sin worker vivo se cierra cancelado de inmediato
-- ============================================================================

create or replace function public.solicitar_cancelacion_proceso_masivo(p_proceso_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.procesos_masivos;
  v_liberado integer := 0;
  v_sin_worker boolean;
  v_vencida boolean;
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

  -- ¿Hay un worker vivo? No lo hay si la orden se agotó, la ejecución ya está cerrada o superó su tiempo máximo
  -- (o si la ejecución ya no existe). Entonces nadie va a confirmar la cancelación: se cierra acá.
  select coalesce((e.id is null)
         or e.estado <> 'en_curso'
         or coalesce(d.estado = 'agotada', false)
         or (e.iniciada_en < clock_timestamp() - make_interval(secs => c.tiempo_max_seg)), false),
         coalesce(e.estado = 'en_curso'
           and e.iniciada_en < clock_timestamp() - make_interval(secs => c.tiempo_max_seg), false)
    into v_sin_worker, v_vencida
  from (select 1) uno
  left join public.ejecuciones_worker e on e.id = v_p.ejecucion_id
  left join public.capacidades_ejecucion c on c.id = e.capacidad_id
  left join public.despachos_ejecucion d on d.ejecucion_id = e.id;

  if v_sin_worker then
    update public.procesos_masivos
    set estado = 'cancelado', cancelacion_solicitada = true, finalizado_en = clock_timestamp(),
        iniciado_en = coalesce(iniciado_en, clock_timestamp())
    where id = p_proceso_id;
    update public.despachos_ejecucion d
    set estado = 'cancelada', reclamada_en = null, vence_en = null, updated_at = clock_timestamp()
    where d.ejecucion_id = v_p.ejecucion_id and d.estado in ('pendiente', 'reclamada');
    update public.ejecuciones_worker e
    set estado = case when v_vencida then 'timeout' else 'fallida' end,
        finalizada_en = clock_timestamp(),
        motivo_sanitizado = case when v_vencida then 'TIMEOUT:' || (
          select c.tiempo_max_seg from public.capacidades_ejecucion c where c.id = e.capacidad_id) || 's' else 'CANCELADA' end
    where e.id = v_p.ejecucion_id and e.estado = 'en_curso';
    if not v_p.cancelacion_solicitada then
      perform private.registrar_cancelacion_proceso(v_p);
    end if;
    return 'cancelado';
  end if;

  -- Un segundo pedido sobre una cancelación ya pedida no vuelve a registrar el evento.
  if not v_p.cancelacion_solicitada then
    update public.procesos_masivos set cancelacion_solicitada = true where id = p_proceso_id;
    perform private.registrar_cancelacion_proceso(v_p);
  end if;
  return 'cancelacion_solicitada';
end;
$$;

comment on function public.solicitar_cancelacion_proceso_masivo(uuid) is
  'F-IMP-01 (FR-009): cancela un proceso pendiente (libera su orden), cierra cancelado uno abierto sin worker vivo (orden agotada, ejecución cerrada o vencida) o solicita la cancelación de uno en curso. Solo administradores. Errores: NO_AUTORIZADO, PROCESO_TERMINADO.';

revoke execute on function public.solicitar_cancelacion_proceso_masivo(uuid) from public, anon;
grant execute on function public.solicitar_cancelacion_proceso_masivo(uuid) to authenticated;
