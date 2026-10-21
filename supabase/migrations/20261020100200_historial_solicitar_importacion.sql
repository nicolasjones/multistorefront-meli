-- MSF-293 (F-VTA-37, FR-003): solicitud de importación del historial.
--
-- Reutiliza el ciclo de ejecuciones de workers (spec 016) y el outbox (spec 019): la solicitud crea
-- una ejecución `manual` auditable (actor, estado, timestamps) y una orden de despacho que consume
-- Kestra. El importador no habla con un sistema externo, pero el ciclo cuelga de una conexión:
-- cada organización que importa tiene una conexión de `sistema_externo = 'historial-ventas'`
-- (creada por un administrador con `crear_conexion`, ver docs/historial-ventas.md) y el worker
-- corre en su servidor. Una capacidad por tipo (`importar-historial-<tipo>`) da el bloqueo de
-- simultáneas por (organización, tipo): `iniciar_ejecucion_worker` rechaza con YA_EN_CURSO.
--
-- Esquemas (Principio VII): solo funciones; las tablas tocadas son `public.conexiones` y
-- `public.capacidades_ejecucion` (plataforma, existentes). Funciones de la app en `public`,
-- ayudantes en `private`.
--
-- Migración aditiva (solo funciones). Reversión (migración posterior):
--   drop function public.solicitar_importacion_historial(text, text);
--   drop function private.capacidad_importacion_historial(text);

-- ============================================================================
-- Capacidad por tipo, creada de forma perezosa (security definer: authenticated no escribe
-- capacidades_ejecucion). La organización sale de la sesión, nunca de un parámetro.
-- ============================================================================

create or replace function private.capacidad_importacion_historial(p_tipo text)
returns table (conexion_id uuid, clave_capacidad text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_conexion uuid;
  v_clave text := 'importar-historial-' || p_tipo;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'NO_AUTORIZADO: solo quien puede escribir en la organización importa el historial'
      using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('comprobantes', 'cobros', 'cotizaciones') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser comprobantes, cobros o cotizaciones'
      using errcode = '22023';
  end if;

  select c.id into v_conexion
  from public.conexiones c
  where c.organizacion_id = v_org and c.sistema_externo = 'historial-ventas'
  order by c.created_at desc
  limit 1;
  if v_conexion is null then
    raise exception 'SIN_CONEXION_HISTORIAL: la organización no tiene habilitada la importación del historial'
      using errcode = 'P0001';
  end if;

  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, v_clave, 3600)
  on conflict (conexion_id, clave) do nothing;

  return query select v_conexion, v_clave;
end;
$$;

comment on function private.capacidad_importacion_historial(text) is
  'F-VTA-37: conexión historial-ventas de la organización de la sesión y su capacidad por tipo (se crea al primer uso). Solo administradores.';

revoke execute on function private.capacidad_importacion_historial(text) from public, anon;
grant execute on function private.capacidad_importacion_historial(text) to authenticated;

-- ============================================================================
-- public.solicitar_importacion_historial (FR-003)
-- ============================================================================

create or replace function public.solicitar_importacion_historial(p_tipo text, p_archivo text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_cap record;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'NO_AUTORIZADO: solo quien puede escribir en la organización importa el historial'
      using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('comprobantes', 'cobros', 'cotizaciones') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser comprobantes, cobros o cotizaciones'
      using errcode = '22023';
  end if;
  -- El archivo debe ser una planilla de la propia organización, ya subida al bucket.
  if p_archivo is null
     or p_archivo !~ ('^' || v_org::text || '/[^/]+\.(csv|xlsx)$')
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'historial-importaciones' and o.name = p_archivo
     ) then
    raise exception 'ARCHIVO_INVALIDO: subí primero una planilla .csv o .xlsx de la organización'
      using errcode = '22023';
  end if;

  select * into v_cap from private.capacidad_importacion_historial(p_tipo);

  -- Ejecución auditable + orden de despacho. Una segunda importación del mismo tipo mientras
  -- hay una en curso falla con YA_EN_CURSO (índice único parcial por organización y capacidad).
  return public.iniciar_ejecucion_worker(
    v_cap.conexion_id, v_cap.clave_capacidad, 'manual', (select auth.uid()),
    jsonb_build_object('tipo', p_tipo, 'archivo', p_archivo)
  );
end;
$$;

comment on function public.solicitar_importacion_historial(text, text) is
  'F-VTA-37 (FR-003): crea la ejecución del worker historial-importador para una planilla ya subida al bucket historial-importaciones. Solo administradores; bloquea simultáneas por (organización, tipo). Errores: NO_AUTORIZADO, TIPO_INVALIDO, ARCHIVO_INVALIDO, SIN_CONEXION_HISTORIAL, YA_EN_CURSO.';

revoke execute on function public.solicitar_importacion_historial(text, text) from public, anon;
grant execute on function public.solicitar_importacion_historial(text, text) to authenticated;
