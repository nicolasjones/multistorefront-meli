-- F-SVC-14 (MSF-424, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-022, FR-029): funciones que usa
-- el flow `reparaciones-aviso-correo` de Kestra y el cierre de avisos vencidos.
--
-- Esquema (Principio VII): solo funciones (`private`); escriben `dominio.reparacion_avisos` (`dominio`) y cierran la
-- ejecución en `public.ejecuciones_worker` (plataforma).
--
--   private.datos_aviso_reparacion(aviso) → jsonb con lo mínimo para armar el correo: destinatario, cliente, tienda,
--     número `R-000N`, equipo y modelo, estado y su descripción, y el estado del aviso. SIN costos ni importes.
--     Los textos del asunto van sin saltos de línea ni tabulaciones (no se inyectan encabezados).
--   private.cerrar_aviso_reparacion(aviso, motivo) → cierra `enviado` (motivo nulo) o `fallido` (motivo corto,
--     sanitizado: si parece traer un secreto se reemplaza por uno fijo). Idempotente: un segundo cierre no cambia nada.
--     Deja la actividad `reparacion.aviso_enviado` / `reparacion.aviso_fallido` (FR-029) y cierra la ejecución.
--   private.expirar_avisos_reparacion(reparación) → cierra como fallido los pendientes que ya no pueden completarse
--     (orden agotada o cancelada, ejecución cerrada o más de 15 minutos), con el mismo cierre.
--
-- Solo el rol de servicio `kestra_orquestacion` ejecuta las dos primeras (mismo guardia que el envío de presupuestos,
-- `private.exigir_llamante_kestra`, 20261212100200): no son ejecutables por `authenticated` ni `anon`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function private.expirar_avisos_reparacion(uuid);
--   drop function private.cerrar_aviso_reparacion(uuid, text);
--   drop function private.aplicar_cierre_aviso_reparacion(uuid, text);
--   drop function private.datos_aviso_reparacion(uuid);

create or replace function private.datos_aviso_reparacion(p_aviso uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  perform private.exigir_llamante_kestra();

  select jsonb_build_object(
    'aviso_id', a.id,
    'estado_envio', a.estado_envio,
    'destinatario', a.destinatario,
    'cliente', regexp_replace(cl.nombre, '[\r\n\t]+', ' ', 'g'),
    'empresa', regexp_replace(coalesce(nullif(btrim(e.razon_social), ''), e.nombre), '[\r\n\t]+', ' ', 'g'),
    'numero', private.codigo_reparacion(r.numero),
    'equipo', regexp_replace(concat_ws(' ', m.equipo, m.modelo), '[\r\n\t]+', ' ', 'g'),
    'estado', regexp_replace(s.nombre, '[\r\n\t]+', ' ', 'g'),
    'descripcion', regexp_replace(s.descripcion, '[\r\n\t]+', ' ', 'g')
  )
  into v_resultado
  from dominio.reparacion_avisos a
  join dominio.reparaciones r on r.id = a.reparacion_id and r.organizacion_id = a.organizacion_id
  join dominio.empresas e on e.id = r.empresa_id and e.organizacion_id = r.organizacion_id
  join public.clientes cl on cl.id = r.cliente_id and cl.organizacion_id = r.organizacion_id
  join dominio.modelos_equipo m on m.id = r.modelo_id and m.organizacion_id = r.organizacion_id
  join dominio.estados_reparacion s on s.id = a.estado_id and s.organizacion_id = a.organizacion_id
  where a.id = p_aviso;

  if v_resultado is null then
    raise exception 'AVISO_DESCONOCIDO: %', p_aviso using errcode = 'P0001';
  end if;
  return v_resultado;
end;
$$;

comment on function private.datos_aviso_reparacion(uuid) is
  'F-SVC-14 (FR-022, FR-024): datos mínimos para armar el correo de un aviso (sin importes). Solo kestra_orquestacion; no ejecutable por authenticated.';

create or replace function private.aplicar_cierre_aviso_reparacion(p_aviso uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aviso dominio.reparacion_avisos;
  v_codigo text;
  v_error text;
  -- Formas de secreto en texto recuperable (mismo criterio que cerrar_envio_correo).
  c_patron_secreto constant text :=
    '(?i)(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)\s*[:=]\s*\S+'
    || '|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+'
    || '|://[^/\s:]+:[^/\s@]+@'
    || '|AKIA[0-9A-Z]{16}';
begin
  select * into v_aviso from dominio.reparacion_avisos a where a.id = p_aviso for update;
  if not found then
    raise exception 'AVISO_DESCONOCIDO: %', p_aviso using errcode = 'P0001';
  end if;
  if v_aviso.estado_envio <> 'pendiente' then
    return;
  end if;

  select private.codigo_reparacion(r.numero) into v_codigo
    from dominio.reparaciones r where r.id = v_aviso.reparacion_id and r.organizacion_id = v_aviso.organizacion_id;

  if p_motivo is null then
    update dominio.reparacion_avisos a
       set estado_envio = 'enviado', error = null, enviado_en = clock_timestamp(), intentos = a.intentos + 1,
           updated_at = clock_timestamp()
     where a.id = v_aviso.id;
    perform private.insertar_actividad(
      v_aviso.organizacion_id, v_aviso.solicitado_por, 'reparacion.aviso_enviado',
      format('Se envió al cliente el aviso de la reparación %s (estado «%s»)', v_codigo, v_aviso.estado_nombre),
      v_aviso.empresa_id);
  else
    v_error := left(coalesce(nullif(btrim(p_motivo), ''), 'No se pudo enviar el correo'), 500);
    if v_error ~ c_patron_secreto then
      v_error := 'No se pudo enviar el correo';
    end if;
    update dominio.reparacion_avisos a
       set estado_envio = 'fallido', error = v_error, enviado_en = null, intentos = a.intentos + 1,
           updated_at = clock_timestamp()
     where a.id = v_aviso.id;
    perform private.insertar_actividad(
      v_aviso.organizacion_id, v_aviso.solicitado_por, 'reparacion.aviso_fallido',
      format('No se pudo enviar al cliente el aviso de la reparación %s (estado «%s»)', v_codigo, v_aviso.estado_nombre),
      v_aviso.empresa_id);
  end if;

  update public.ejecuciones_worker x
     set estado = case when p_motivo is null then 'exitosa' else 'fallida' end,
         finalizada_en = clock_timestamp(),
         motivo_sanitizado = case when p_motivo is null then null else left(coalesce(v_error, ''), 200) end
   where x.id = v_aviso.ejecucion_id and x.estado = 'en_curso';
end;
$$;

create or replace function private.cerrar_aviso_reparacion(p_aviso uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.exigir_llamante_kestra();
  perform private.aplicar_cierre_aviso_reparacion(p_aviso, p_motivo);
end;
$$;

comment on function private.cerrar_aviso_reparacion(uuid, text) is
  'F-SVC-14 (FR-022, FR-029): cierra el aviso como enviado (motivo nulo) o fallido (motivo sanitizado) y deja la actividad. Idempotente. Solo kestra_orquestacion; no ejecutable por authenticated.';

create or replace function private.expirar_avisos_reparacion(p_reparacion uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aviso record;
begin
  for v_aviso in
    select a.id, a.solicitado_en, a.ejecucion_id
      from dominio.reparacion_avisos a
     where a.reparacion_id = p_reparacion and a.estado_envio = 'pendiente'
     for update
  loop
    if v_aviso.solicitado_en < clock_timestamp() - interval '15 minutes'
       or exists (
         select 1 from public.despachos_ejecucion x
          where x.ejecucion_id = v_aviso.ejecucion_id and x.estado in ('agotada', 'cancelada')
       )
       or exists (
         select 1 from public.ejecuciones_worker w
          where w.id = v_aviso.ejecucion_id and w.estado <> 'en_curso'
       ) then
      perform private.aplicar_cierre_aviso_reparacion(v_aviso.id, 'El correo tardó demasiado en enviarse. Probá de nuevo.');
    end if;
  end loop;
end;
$$;

revoke execute on function private.datos_aviso_reparacion(uuid) from public, anon, authenticated;
revoke execute on function private.aplicar_cierre_aviso_reparacion(uuid, text) from public, anon, authenticated;
revoke execute on function private.cerrar_aviso_reparacion(uuid, text) from public, anon, authenticated;
revoke execute on function private.expirar_avisos_reparacion(uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function
      private.datos_aviso_reparacion(uuid),
      private.cerrar_aviso_reparacion(uuid, text)
      to kestra_orquestacion;
  end if;
end
$$;
