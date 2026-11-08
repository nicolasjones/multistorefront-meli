-- MSF-396 (revisión retroactiva): la exportación total es la copia completa de los datos personales de una organización y
-- NO se abre al acceso de soporte. `private.es_administrador_de` acepta a un superadmin con organización activa; la
-- solicitud y la descarga del ZIP pasan a exigir la MEMBRESÍA propia (`private.es_administrador_propio_de`).
-- Decisión de producto de Nicolás (2026-11-08): un superadmin no exporta los datos de otra organización.
--
-- Redefine `public.solicitar_exportacion_total()` (misma firma, mismos privilegios) y la política de lectura del bucket
-- `exportaciones-organizacion`. `iniciar_proceso_masivo` conserva su propia regla; el punto de entrada ya lo filtra.
--
-- Migración aditiva. Reversión (migración posterior): volver a las definiciones de
-- `20270217000004_exportacion_total_solicitud.sql` (función y política con `es_administrador_de`) y
-- `drop function private.es_administrador_propio_de(uuid);`

create or replace function private.es_administrador_propio_de(p_organizacion_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_organizacion u
    where u.user_id = (select auth.uid())
      and u.organizacion_id = p_organizacion_id
      and u.rol_id = 'administrador'
      and u.estado = 'activo'
  );
$$;
revoke execute on function private.es_administrador_propio_de(uuid) from public, anon;
grant execute on function private.es_administrador_propio_de(uuid) to authenticated;

create or replace function public.solicitar_exportacion_total()
returns table (proceso_id uuid, ejecucion_id uuid, estado text, reutilizado boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_p public.procesos_masivos;
  v_conexion uuid;
  v_clave text;
  v_nuevo uuid;
begin
  if v_org is null or v_uid is null or not (select private.es_administrador_propio_de(v_org)) then
    raise exception 'NO_AUTORIZADO: solo un administrador de la organización exporta todos los datos'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('exportacion_total:' || v_org::text, 0));

  select * into v_p
  from public.procesos_masivos p
  where p.organizacion_id = v_org
    and p.funcionalidad = 'exportacion_total'
    and p.estado in ('pendiente', 'en_curso')
    and p.creado_en > clock_timestamp() - make_interval(secs => 3600)
  order by p.creado_en desc
  limit 1;
  if found then
    return query select v_p.id, v_p.ejecucion_id, v_p.estado, true;
    return;
  end if;

  select c.id into v_conexion
  from public.conexiones c
  where c.organizacion_id = v_org and c.sistema_externo = 'historial-ventas'
  order by c.created_at desc
  limit 1;
  if v_conexion is null then
    raise exception 'SIN_CONEXION_EXPORTACION: la organización no tiene habilitado el servidor de exportaciones'
      using errcode = 'P0001';
  end if;

  v_clave := 'exportar-organizacion-' || v_org::text;
  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, v_clave, 3600)
  on conflict on constraint capacidades_ejecucion_conexion_id_clave_key do nothing;

  -- Proceso + ejecución auditable + orden de despacho en una transacción.
  v_nuevo := public.iniciar_proceso_masivo(
    v_conexion, v_clave, 'exportacion', 'exportacion_total', 'Exportación total de datos', null, '{}'::jsonb
  );

  select * into v_p from public.procesos_masivos p where p.id = v_nuevo;
  return query select v_p.id, v_p.ejecucion_id, v_p.estado, false;
end;
$$;

revoke execute on function public.solicitar_exportacion_total() from public, anon;
grant execute on function public.solicitar_exportacion_total() to authenticated;

drop policy if exists exportaciones_organizacion_select on storage.objects;
create policy exportaciones_organizacion_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exportaciones-organizacion'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.es_administrador_propio_de((select private.organizacion_id())))
  );
