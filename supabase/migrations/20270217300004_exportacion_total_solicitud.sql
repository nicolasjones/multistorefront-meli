-- MSF-396 (F-OPS-06, MSF-224, FR-030, FR-036, FR-040): solicitud de la exportación total de datos de la organización.
-- `public.solicitar_exportacion_total()` registra el proceso masivo (tipo `exportacion`, funcionalidad
-- `exportacion_total`, sin empresa) con `iniciar_proceso_masivo`, que crea en la MISMA transacción la ejecución
-- auditable del worker `exportar-organizacion` y su orden en el outbox para que la consuma Kestra. Más el bucket
-- privado `exportaciones-organizacion` y su política de lectura.
--
-- Corre sobre la conexión `historial-ventas` de la organización (el mismo servidor y red de egress que la exportación
-- diferida de comprobantes; si falta, SIN_CONEXION_EXPORTACION) y una capacidad POR ORGANIZACIÓN
-- (`exportar-organizacion-<organizacion_id>`, creada al primer uso). Desvío del plan: no hace falta un iniciador
-- privado análogo al de comprobantes porque `iniciar_proceso_masivo` ya exige administrador, que es exactamente el
-- permiso de esta función.
--
-- Idempotencia: si la organización ya tiene una exportación total `pendiente` o `en_curso` (de la última hora, el
-- `tiempo_max_seg` de la capacidad), devuelve esa con `reutilizado = true` en vez de crear otra; un candado
-- transaccional por organización evita que dos pedidos simultáneos creen dos. Una abierta más vieja que el tiempo
-- máximo se considera colgada: el inicio cierra su ejecución por timeout y la base la pasa a `fallido`.
--
-- Seguridad:
--   · Solo administradores de la organización de la sesión; `anon` no ejecuta la función.
--   · El archivo vive en `<organizacion_id>/<ejecucion_id>.zip`; la política de Storage deja leerlo solo a un
--     administrador de esa organización. El worker escribe con la clave de servicio del servidor (nunca del
--     navegador); no hay política de insert/update/delete para `authenticated`.
--
-- Esquemas (Principio VII): sin tablas nuevas. Toca `public.conexiones`, `public.capacidades_ejecucion` y
-- `public.procesos_masivos` (plataforma, existentes). La función de la app vive en `public`; el bucket es Storage.
--
-- Errores: 42501 NO_AUTORIZADO · P0001 SIN_CONEXION_EXPORTACION (falta la conexión `historial-ventas`).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.solicitar_exportacion_total();
--   drop policy exportaciones_organizacion_select on storage.objects;
--   y el bucket `exportaciones-organizacion` (tras vaciarlo desde la API de Storage).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exportaciones-organizacion', 'exportaciones-organizacion', false, 524288000, array['application/zip'])
on conflict (id) do nothing;

drop policy if exists exportaciones_organizacion_select on storage.objects;
create policy exportaciones_organizacion_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exportaciones-organizacion'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.es_administrador_de((select private.organizacion_id())))
  );

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
  if v_org is null or v_uid is null or not (select private.es_administrador_de(v_org)) then
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

comment on function public.solicitar_exportacion_total() is
  'F-OPS-06 (FR-030, FR-040): pide la exportación total de datos de la organización como proceso masivo. Solo administradores. Idempotente: con una pendiente o en curso devuelve esa (reutilizado = true). Errores: NO_AUTORIZADO, SIN_CONEXION_EXPORTACION.';
