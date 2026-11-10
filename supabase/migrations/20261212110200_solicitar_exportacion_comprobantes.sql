-- F-VTA-09 (MSF-346, épica MSF-177, FR-007, FR-008): exportación DIFERIDA de comprobantes/presupuestos (más de 10.000 filas).
-- Bucket privado `exportaciones-ventas`, `public.solicitar_exportacion_comprobantes` y las funciones que usa el worker
-- `exportar-comprobantes` con su rol `worker_<org>` (miembro de `workers_orquestacion`).
--
-- Reutiliza el ciclo de ejecuciones (spec 016) y el outbox (spec 019) con un iniciador privado propio
-- (`private.iniciar_exportacion_comprobantes`): la RPC ya validó la acción `exportar`, mientras que
-- `public.iniciar_ejecucion_worker` exige administrador para un disparo manual. El iniciador privado hace lo mismo
-- —ejecución `manual` auditable (actor, estado, timestamps) y orden de despacho en `despachos_ejecucion` para que la
-- consuma Kestra— y no se otorga a ningún rol. Corre sobre la conexión `historial-ventas` de la organización (mismo
-- servidor y red de egress que el importador; ver docs/ventas-listado-comprobantes.md): no hace falta una conexión
-- nueva. Una capacidad POR USUARIO (`exportar-comprobantes-<user_id>`, creada al primer uso) da el bloqueo de
-- simultáneas por usuario: una segunda solicitud con filtros distintos mientras hay una en curso falla con
-- YA_EN_CURSO; con los MISMOS filtros devuelve la ejecución en curso (idempotente por solicitud).
--
-- Esquemas (Principio VII): sin tablas nuevas. Toca `public.conexiones`, `public.capacidades_ejecucion` y
-- `public.ejecuciones_worker` (plataforma, existentes) y lee `dominio.*` por `private.comprobantes_consulta`. El bucket
-- es Storage, no una tabla. Funciones de la app en `public`, ayudantes en `private`.
--
-- Seguridad:
--   · La solicitud exige `private.puede_accion('ventas','exportar')`; la organización y el actor salen de la sesión.
--   · Las EMPRESAS visibles del usuario se resuelven AL SOLICITAR y se guardan en el `detalle` (lo escribe esta función
--     `security definer`, no el cliente): el worker no tiene sesión y solo lee esas empresas.
--   · El archivo vive en `<organizacion_id>/<usuario_id>/<ejecucion_id>.csv`; la política de Storage deja descargarlo
--     solo a quien lo pidió, de su organización y con el permiso `exportar`. El worker escribe con la clave de servicio
--     del servidor (nunca del navegador); no hay política de insert/update/delete para `authenticated`.
--   · Las funciones del worker validan que la ejecución esté en curso, sea de la capacidad `exportar-comprobantes-*` y
--     la llame un worker (o el dueño en CI); `revoke` a todos salvo `workers_orquestacion`.
--
-- Errores: 42501 sin permiso · 22023 tipo/filtros inválidos · P0001 SIN_CONEXION_EXPORTACION (falta la conexión
-- `historial-ventas`) · P0001 YA_EN_CURSO (otra exportación del usuario sigue en curso).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function private.filas_exportacion_comprobantes(uuid, integer, integer);
--   drop function private.datos_exportacion_comprobantes(uuid);
--   drop function private.iniciar_exportacion_comprobantes(uuid, text, uuid, jsonb);
--   drop function public.solicitar_exportacion_comprobantes(text, jsonb);
--   drop function private.capacidad_exportacion_comprobantes(uuid);
--   drop policy exportaciones_ventas_select on storage.objects;
--   y el bucket `exportaciones-ventas` (tras vaciarlo desde la API de Storage).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exportaciones-ventas', 'exportaciones-ventas', false, 104857600, array['text/csv'])
on conflict (id) do nothing;

create policy exportaciones_ventas_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exportaciones-ventas'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select private.puede_accion('ventas', 'exportar'))
  );

-- Conexión `historial-ventas` de la organización de la sesión y capacidad del usuario, creada de forma perezosa.
create or replace function private.capacidad_exportacion_comprobantes(p_actor uuid)
returns table (conexion_id uuid, clave_capacidad text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_conexion uuid;
  v_clave text := 'exportar-comprobantes-' || p_actor::text;
begin
  if v_org is null or p_actor is null or p_actor is distinct from (select auth.uid()) then
    raise exception 'NO_AUTORIZADO: la exportación se pide con la propia sesión' using errcode = '42501';
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

  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, v_clave, 3600)
  on conflict on constraint capacidades_ejecucion_conexion_id_clave_key do nothing;

  return query select v_conexion, v_clave;
end;
$$;

revoke execute on function private.capacidad_exportacion_comprobantes(uuid) from public, anon;
grant execute on function private.capacidad_exportacion_comprobantes(uuid) to authenticated;

comment on function private.capacidad_exportacion_comprobantes(uuid) is
  'F-VTA-09: conexión historial-ventas de la organización de la sesión y capacidad por usuario para exportar (se crea al primer uso).';

-- Iniciador de la exportación: mismo contrato que `public.iniciar_ejecucion_worker` (capacidad habilitada,
-- cierre por timeout, YA_EN_CURSO y orden en el outbox), pero sin el gate de administrador del disparo manual:
-- lo llama `solicitar_exportacion_comprobantes`, que ya exigió la acción `exportar`. NO se otorga a ningún rol.
create or replace function private.iniciar_exportacion_comprobantes(
  p_conexion_id uuid,
  p_clave_capacidad text,
  p_actor uuid,
  p_detalle jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conexion public.conexiones;
  v_capacidad public.capacidades_ejecucion;
  v_nueva_id uuid;
begin
  if p_actor is null then
    raise exception 'ACTOR_REQUERIDO: la exportación registra quién la pidió' using errcode = 'P0001';
  end if;

  select * into v_conexion from public.conexiones c where c.id = p_conexion_id;
  if not found then
    raise exception 'SIN_CONEXION_EXPORTACION: la conexión % no existe', p_conexion_id using errcode = 'P0001';
  end if;
  select * into v_capacidad
    from public.capacidades_ejecucion cap
   where cap.conexion_id = p_conexion_id and cap.clave = p_clave_capacidad;
  if not found or not v_capacidad.habilitada or v_conexion.estado <> 'activa' then
    raise exception 'SIN_CONEXION_EXPORTACION: la conexión % no está activa o la capacidad no está habilitada', p_conexion_id
      using errcode = 'P0001';
  end if;

  update public.ejecuciones_worker e
     set estado = 'timeout',
         finalizada_en = clock_timestamp(),
         motivo_sanitizado = 'TIMEOUT:' || v_capacidad.tiempo_max_seg || 's'
   where e.organizacion_id = v_conexion.organizacion_id
     and e.capacidad_id = v_capacidad.id
     and e.estado = 'en_curso'
     and e.iniciada_en < clock_timestamp() - make_interval(secs => v_capacidad.tiempo_max_seg);

  if exists (
    select 1 from public.ejecuciones_worker e
    where e.organizacion_id = v_conexion.organizacion_id
      and e.capacidad_id = v_capacidad.id
      and e.estado = 'en_curso'
  ) then
    raise exception 'YA_EN_CURSO: ya hay una exportación activa para este usuario' using errcode = 'P0001';
  end if;

  insert into public.ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, actor, detalle)
  values (v_conexion.organizacion_id, p_conexion_id, v_capacidad.id, 'manual', p_actor, coalesce(p_detalle, '{}'::jsonb))
  returning id into v_nueva_id;

  insert into public.despachos_ejecucion (ejecucion_id, organizacion_id)
  values (v_nueva_id, v_conexion.organizacion_id);

  return v_nueva_id;
end;
$$;

revoke execute on function private.iniciar_exportacion_comprobantes(uuid, text, uuid, jsonb) from public, anon, authenticated;

comment on function private.iniciar_exportacion_comprobantes(uuid, text, uuid, jsonb) is
  'F-VTA-09: inicia la ejecución manual de la exportación y su orden de despacho. Sin grant: solo la llama solicitar_exportacion_comprobantes, que exige ventas/exportar.';

create or replace function public.solicitar_exportacion_comprobantes(p_tipo text, p_filtros jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_filtros jsonb;
  v_empresas uuid[];
  v_cap record;
  v_detalle jsonb;
  v_existente uuid;
  v_clave text;
begin
  if v_org is null or v_uid is null then
    raise exception 'NO_AUTORIZADO: necesitás una sesión con organización' using errcode = '42501';
  end if;
  if not (select private.puede_accion('ventas', 'exportar')) then
    raise exception 'NO_AUTORIZADO: no tenés permiso para exportar ventas' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('comprobantes', 'presupuestos') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser comprobantes o presupuestos' using errcode = '22023';
  end if;
  if p_filtros is null or jsonb_typeof(p_filtros) <> 'object' then
    raise exception 'FILTROS_INVALIDOS: los filtros deben ser un objeto' using errcode = '22023';
  end if;

  -- Solo las claves conocidas, con tipo validado: nada más llega al worker.
  begin
    v_filtros := jsonb_strip_nulls(jsonb_build_object(
      'busqueda', nullif(btrim(p_filtros->>'busqueda'), ''),
      'estado', nullif(btrim(p_filtros->>'estado'), ''),
      'pago_id', (p_filtros->>'pago_id')::uuid,
      'envio_id', (p_filtros->>'envio_id')::uuid,
      'operador_id', (p_filtros->>'operador_id')::uuid,
      'empresa_id', (p_filtros->>'empresa_id')::uuid
    ));
  exception when invalid_text_representation then
    raise exception 'FILTROS_INVALIDOS: un identificador de filtro no es válido' using errcode = '22023';
  end;

  select coalesce(array_agg(e.id order by e.id), '{}') into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');

  -- Valida el estado con la misma consulta del listado (22023 si no existe); no trae filas.
  perform 1 from private.comprobantes_consulta(
    v_org, v_empresas, array['factura'], null, v_filtros->>'estado', null, null, null, null, 0, 0);

  select * into v_cap from private.capacidad_exportacion_comprobantes(v_uid);
  v_clave := v_cap.clave_capacidad;

  v_detalle := jsonb_build_object(
    'tipo', p_tipo,
    'filtros', v_filtros,
    'empresas', to_jsonb(v_empresas),
    'actor', v_uid,
    'archivo_prefijo', v_org::text || '/' || v_uid::text || '/'
  );

  -- Idempotente por solicitud: la misma exportación (mismos filtros) ya en curso devuelve esa ejecución.
  select e.id into v_existente
    from public.ejecuciones_worker e
    join public.capacidades_ejecucion cap on cap.id = e.capacidad_id
   where e.organizacion_id = v_org
     and cap.conexion_id = v_cap.conexion_id and cap.clave = v_clave
     and e.estado = 'en_curso'
     and e.iniciada_en > clock_timestamp() - make_interval(secs => cap.tiempo_max_seg)
     and e.detalle = v_detalle;
  if v_existente is not null then
    return v_existente;
  end if;

  -- Ejecución auditable + orden de despacho; una segunda distinta en curso falla con YA_EN_CURSO.
  return private.iniciar_exportacion_comprobantes(v_cap.conexion_id, v_clave, v_uid, v_detalle);
end;
$$;

revoke execute on function public.solicitar_exportacion_comprobantes(text, jsonb) from public, anon;
grant execute on function public.solicitar_exportacion_comprobantes(text, jsonb) to authenticated;

comment on function public.solicitar_exportacion_comprobantes(text, jsonb) is
  'F-VTA-09 (FR-007): registra la exportación diferida (más de 10.000 filas) como ejecución del worker exportar-comprobantes con los filtros y las empresas visibles guardados. Exige ventas/exportar; bloquea simultáneas por usuario (YA_EN_CURSO); idempotente con los mismos filtros.';

-- ============================================================================
-- Funciones del worker (rol `worker_<org>`, miembro de `workers_orquestacion`)
-- ============================================================================

-- Autoriza al worker sobre su ejecución en curso y devuelve lo guardado al solicitar.
create or replace function private.datos_exportacion_comprobantes(p_ejecucion_id uuid)
returns table (organizacion_id uuid, tipo text, filtros jsonb, empresas uuid[], actor uuid, archivo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e public.ejecuciones_worker;
  v_clave text;
  v_vigente boolean;
begin
  -- El dueño de la función (postgres) también puede: en el CI no es superusuario y pgTAP no puede simular
  -- el login del worker (ver backups_postgres.test.sql).
  if session_user <> current_user
     and (session_user not like 'worker\_%'
          or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member')) then
    raise exception 'NO_AUTORIZADO: solo un worker accede a los datos de su exportación' using errcode = 'P0001';
  end if;

  select * into v_e from public.ejecuciones_worker e where e.id = p_ejecucion_id;
  if not found then
    raise exception 'EJECUCION_DESCONOCIDA: %', p_ejecucion_id using errcode = 'P0001';
  end if;
  perform private.autorizar_llamante_ciclo(v_e.organizacion_id);

  select ev.en_curso into v_vigente from private.estado_ejecucion_vigente(p_ejecucion_id) ev;
  if not coalesce(v_vigente, false) then
    raise exception 'EJECUCION_NO_EN_CURSO: %', p_ejecucion_id using errcode = 'P0001';
  end if;
  select cap.clave into v_clave from public.capacidades_ejecucion cap where cap.id = v_e.capacidad_id;
  if v_clave is null or v_clave not like 'exportar-comprobantes-%' then
    raise exception 'CONFIGURACION_INVALIDA: la ejecución % no es una exportación de comprobantes', p_ejecucion_id using errcode = 'P0001';
  end if;
  if v_e.detalle->>'tipo' not in ('comprobantes', 'presupuestos')
     or jsonb_typeof(v_e.detalle->'filtros') is distinct from 'object'
     or jsonb_typeof(v_e.detalle->'empresas') is distinct from 'array'
     or v_e.detalle->>'actor' is null
     or v_e.detalle->>'archivo_prefijo' is distinct from (v_e.organizacion_id::text || '/' || (v_e.detalle->>'actor') || '/') then
    raise exception 'CONFIGURACION_INVALIDA: la ejecución % no trae tipo, filtros, empresas o actor válidos', p_ejecucion_id using errcode = 'P0001';
  end if;

  return query
  select v_e.organizacion_id, v_e.detalle->>'tipo', v_e.detalle->'filtros',
         coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_e.detalle->'empresas') x), '{}'),
         (v_e.detalle->>'actor')::uuid,
         (v_e.detalle->>'archivo_prefijo') || p_ejecucion_id::text || '.csv';
end;
$$;

revoke execute on function private.datos_exportacion_comprobantes(uuid) from public, anon, authenticated;
grant execute on function private.datos_exportacion_comprobantes(uuid) to workers_orquestacion;

comment on function private.datos_exportacion_comprobantes(uuid) is
  'F-VTA-09: tipo, filtros, empresas visibles, actor y ruta del CSV de una exportación en curso. Solo workers de la organización dueña.';

-- Una página de filas de la exportación, con los filtros y empresas guardados. El worker pagina hasta agotar `filas`.
create or replace function private.filas_exportacion_comprobantes(p_ejecucion_id uuid, p_desde integer, p_limite integer)
returns table (
  numero text, tipo text, empresa text, fecha date, cliente text, operador text, estado_etiqueta text,
  forma_pago text, envio text, total numeric, filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d record;
begin
  select * into v_d from private.datos_exportacion_comprobantes(p_ejecucion_id);
  if p_desde is null or p_desde < 0 or p_limite is null or p_limite < 1 or p_limite > 5000 then
    raise exception 'LOTE_INVALIDO: desde >= 0 y límite entre 1 y 5000' using errcode = '22023';
  end if;

  return query
  select q.numero, q.tipo, q.empresa, q.fecha, q.cliente, q.operador, q.estado_etiqueta,
         q.forma_pago, q.envio, q.total, q.filas
    from private.comprobantes_consulta(
           v_d.organizacion_id, v_d.empresas,
           case v_d.tipo when 'presupuestos' then array['presupuesto'] else array['factura', 'nota_credito'] end,
           v_d.filtros->>'busqueda', v_d.filtros->>'estado',
           (v_d.filtros->>'pago_id')::uuid, (v_d.filtros->>'envio_id')::uuid,
           (v_d.filtros->>'operador_id')::uuid, (v_d.filtros->>'empresa_id')::uuid,
           p_limite, p_desde
         ) q;
end;
$$;

revoke execute on function private.filas_exportacion_comprobantes(uuid, integer, integer) from public, anon, authenticated;
grant execute on function private.filas_exportacion_comprobantes(uuid, integer, integer) to workers_orquestacion;

comment on function private.filas_exportacion_comprobantes(uuid, integer, integer) is
  'F-VTA-09: página de filas de una exportación en curso (lotes de hasta 5000), con los filtros y empresas guardados al solicitar.';
