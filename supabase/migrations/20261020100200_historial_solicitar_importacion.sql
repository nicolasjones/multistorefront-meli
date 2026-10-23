-- F-VTA-37 (MSF-275, FR-003, FR-007): solicitud de importación del historial y funciones del
-- worker `historial-importador`.
--
-- Esquema (Principio VII): sin tablas nuevas. Solo funciones (la RPC que llama la app vive en
-- `public`; las del worker en `private`, sin exposición por PostgREST) y una fila del catálogo
-- `public.sistemas_externos` (plataforma) para registrar al importador como «sistema» de la
-- conexión que exige el ciclo de ejecuciones.
--
-- Cómo encaja con el ciclo de ejecuciones del template (spec 016/019):
--   * `iniciar_ejecucion_worker` exige una conexión y una capacidad habilitada. El importador no
--     tiene credencial externa: `private.asegurar_importador_historial` crea, la primera vez que
--     la organización importa, una conexión `historial-importador` (con un secreto de Vault de
--     relleno, sin valor) y tres capacidades `importar_historial_<tipo>`. Es idempotente.
--   * El inicio es `manual` (actor = quien importa): queda en `ejecuciones_worker` y en la outbox
--     que consume el flow de Kestra `historial-importador`.
--   * Una importación simultánea del mismo tipo se rechaza (`YA_EN_CURSO`): la capacidad es por
--     tipo y `ejecucion_activa_unica` lo garantiza aun en carrera.
--
-- El worker entra con su rol `worker_<org>` (heredado de `workers_orquestacion`) y solo puede
-- ejecutar dos funciones: `private.historial_contexto_ejecucion` (qué archivo y qué tienda existen)
-- e `private.importar_historial_lote` (inserta un lote de forma idempotente). La organización sale
-- siempre de `private.organizacion_del_rol_actual()`, nunca de un parámetro. Son las ÚNICAS vías
-- de escritura sobre `dominio.historial_*`.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.solicitar_importacion_historial(text, text);
--   drop function private.importar_historial_lote(uuid, text, jsonb);
--   drop function private.importar_historial_lote_core(uuid, uuid, text, jsonb);
--   drop function private.historial_contexto_ejecucion(uuid);
--   drop function private.historial_contexto_core(uuid, uuid);
--   drop function private.asegurar_importador_historial(uuid);
--   delete from public.sistemas_externos where id = 'historial-importador'; -- si no quedan conexiones

insert into public.sistemas_externos (id, descripcion)
values ('historial-importador', 'Importador del historial de ventas del panel anterior (worker propio, sin credencial externa)')
on conflict (id) do nothing;

-- ============================================================================
-- Conexión y capacidades del importador (idempotente)
-- ============================================================================

create or replace function private.asegurar_importador_historial(p_organizacion_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conexion uuid;
  v_vault uuid;
  v_tipo text;
begin
  if p_organizacion_id is distinct from (select private.organizacion_id())
     or not (select private.puede_escribir()) then
    raise exception 'NO_AUTORIZADO: solo quien puede escribir en la organización prepara el importador' using errcode = '42501';
  end if;

  -- Evita dos conexiones por dos primeras solicitudes simultáneas.
  perform pg_advisory_xact_lock(hashtextextended('historial-importador:' || p_organizacion_id::text, 0));

  select c.id into v_conexion
  from public.conexiones c
  where c.organizacion_id = p_organizacion_id and c.sistema_externo = 'historial-importador'
  order by c.created_at, c.id
  limit 1;

  if v_conexion is null then
    -- La columna exige una referencia a Vault; el importador no usa credencial externa.
    v_vault := vault.create_secret('sin-credencial-externa', 'historial_importador_' || replace(p_organizacion_id::text, '-', ''));
    insert into public.conexiones (organizacion_id, sistema_externo, credencial_vault_id, created_by)
    values (p_organizacion_id, 'historial-importador', v_vault, (select auth.uid()))
    returning id into v_conexion;
  end if;

  foreach v_tipo in array array['comprobantes', 'cobros', 'cotizaciones'] loop
    insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave)
    values (p_organizacion_id, v_conexion, 'importar_historial_' || v_tipo)
    on conflict (conexion_id, clave) do nothing;
  end loop;

  return v_conexion;
end;
$$;

comment on function private.asegurar_importador_historial(uuid) is
  'F-VTA-37. Crea (una vez) la conexión historial-importador y sus tres capacidades por organización. Solo la llama public.solicitar_importacion_historial.';

revoke execute on function private.asegurar_importador_historial(uuid) from public, anon;
grant execute on function private.asegurar_importador_historial(uuid) to authenticated;

-- ============================================================================
-- RPC de la app (FR-003)
-- ============================================================================

create or replace function public.solicitar_importacion_historial(p_tipo text, p_archivo text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_conexion uuid;
  v_ejecucion uuid;
begin
  if v_organizacion is null or not (select private.puede_escribir()) then
    raise exception 'NO_AUTORIZADO: no podés importar el historial' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('comprobantes', 'cobros', 'cotizaciones') then
    raise exception 'TIPO_INVALIDO: el tipo debe ser comprobantes, cobros o cotizaciones' using errcode = 'P0001';
  end if;
  -- Ruta <organizacion_id>/<tipo>/<archivo>.csv|xlsx: la carpeta de la propia organización.
  if p_archivo is null
     or length(p_archivo) > 300
     or split_part(p_archivo, '/', 1) <> v_organizacion::text
     or split_part(p_archivo, '/', 2) <> p_tipo
     or p_archivo !~* '\.(csv|xlsx)$' then
    raise exception 'ARCHIVO_INVALIDO: la ruta del archivo no corresponde a esta organización y tipo, o no es .csv/.xlsx' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'historial-importaciones' and o.name = p_archivo
  ) then
    raise exception 'ARCHIVO_NO_ENCONTRADO: subí la planilla antes de pedir la importación' using errcode = 'P0001';
  end if;

  v_conexion := private.asegurar_importador_historial(v_organizacion);

  begin
    -- Origen manual: queda el actor y se encola el despacho (misma transacción). Rechaza con
    -- YA_EN_CURSO una segunda importación activa del mismo tipo (capacidad por tipo).
    v_ejecucion := public.iniciar_ejecucion_worker(
      v_conexion,
      'importar_historial_' || p_tipo,
      'manual',
      (select auth.uid()),
      jsonb_build_object('tipo', p_tipo, 'archivo', p_archivo)
    );
  exception when unique_violation then
    raise exception 'YA_EN_CURSO: ya hay una importación de % en curso', p_tipo using errcode = 'P0001';
  end;

  return v_ejecucion;
end;
$$;

comment on function public.solicitar_importacion_historial(text, text) is
  'F-VTA-37 (FR-003). Crea la ejecución auditable de una importación del historial (tipo: comprobantes | cobros | cotizaciones; archivo: ruta en el bucket historial-importaciones). Errores: NO_AUTORIZADO, TIPO_INVALIDO, ARCHIVO_INVALIDO, ARCHIVO_NO_ENCONTRADO, YA_EN_CURSO.';

revoke execute on function public.solicitar_importacion_historial(text, text) from public, anon;
grant execute on function public.solicitar_importacion_historial(text, text) to authenticated;

-- ============================================================================
-- Funciones del worker
-- ============================================================================

-- Lógica sin autorización por sesión (mismo patrón que estado_ejecucion_vigente): la prueba pgTAP
-- no puede adoptar el session_user de un worker, así que el núcleo recibe la organización.
create or replace function private.historial_contexto_core(p_ejecucion_id uuid, p_organizacion_id uuid)
returns table (tipo text, archivo text, empresas jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_detalle jsonb;
  v_clave text;
begin
  select e.detalle, c.clave into v_detalle, v_clave
  from public.ejecuciones_worker e
  join public.capacidades_ejecucion c on c.id = e.capacidad_id
  where e.id = p_ejecucion_id
    and e.organizacion_id = p_organizacion_id
    and e.estado = 'en_curso'
    and c.clave like 'importar\_historial\_%';
  if not found then
    raise exception 'EJECUCION_NO_EN_CURSO: %', p_ejecucion_id using errcode = 'P0001';
  end if;

  tipo := v_detalle ->> 'tipo';
  archivo := v_detalle ->> 'archivo';
  if tipo is null or v_clave <> 'importar_historial_' || tipo
     or archivo is null or split_part(archivo, '/', 1) <> p_organizacion_id::text then
    raise exception 'CONFIGURACION_INVALIDA: la ejecución % no trae un tipo y un archivo válidos', p_ejecucion_id using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', em.id, 'nombre', em.nombre) order by em.nombre), '[]'::jsonb)
    into empresas
  from dominio.empresas em
  where em.organizacion_id = p_organizacion_id and em.activa;

  return next;
end;
$$;

revoke execute on function private.historial_contexto_core(uuid, uuid) from public, anon, authenticated;

create or replace function private.historial_contexto_ejecucion(p_ejecucion_id uuid)
returns table (tipo text, archivo text, empresas jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid;
begin
  if session_user not like 'worker\_%'
     or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then
    raise exception 'NO_AUTORIZADO: solo un worker consulta el contexto de su ejecución' using errcode = 'P0001';
  end if;
  v_organizacion := private.organizacion_del_rol_actual();
  if v_organizacion is null then
    raise exception 'NO_AUTORIZADO: el rol no tiene organización' using errcode = 'P0001';
  end if;
  return query select * from private.historial_contexto_core(p_ejecucion_id, v_organizacion);
end;
$$;

comment on function private.historial_contexto_ejecucion(uuid) is
  'F-VTA-37. El worker historial-importador obtiene tipo, ruta del archivo y las tiendas (empresas activas) de su organización. Errores: NO_AUTORIZADO, EJECUCION_NO_EN_CURSO, CONFIGURACION_INVALIDA. Solo lectura.';

revoke execute on function private.historial_contexto_ejecucion(uuid) from public, anon, authenticated;
grant execute on function private.historial_contexto_ejecucion(uuid) to workers_orquestacion;

-- Inserción idempotente de un lote (FR-007). Las filas ya validadas llegan como jsonb; cada una
-- trae su empresa_id (la tienda ya resuelta por el worker). Devuelve cuántas son nuevas y
-- cuántas ya existían (clave natural). El tope por lote evita llamadas desmesuradas.
create or replace function private.importar_historial_lote_core(
  p_ejecucion_id uuid,
  p_organizacion_id uuid,
  p_tipo text,
  p_filas jsonb
)
returns table (nuevas integer, existentes integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_nuevas integer;
begin
  if p_tipo is null or p_tipo not in ('comprobantes', 'cobros', 'cotizaciones') then
    raise exception 'TIPO_INVALIDO: %', p_tipo using errcode = 'P0001';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'LOTE_INVALIDO: el lote debe ser un arreglo' using errcode = 'P0001';
  end if;
  v_total := jsonb_array_length(p_filas);
  if v_total > 5000 then
    raise exception 'LOTE_INVALIDO: un lote admite hasta 5000 filas' using errcode = 'P0001';
  end if;

  -- La ejecución debe estar en curso, ser de esta organización y de ESTE tipo.
  if not exists (
    select 1
    from public.ejecuciones_worker e
    join public.capacidades_ejecucion c on c.id = e.capacidad_id
    where e.id = p_ejecucion_id
      and e.organizacion_id = p_organizacion_id
      and e.estado = 'en_curso'
      and c.clave = 'importar_historial_' || p_tipo
  ) then
    raise exception 'EJECUCION_NO_EN_CURSO: %', p_ejecucion_id using errcode = 'P0001';
  end if;

  if p_tipo = 'comprobantes' then
    if exists (
      select 1 from jsonb_to_recordset(p_filas) as x(empresa_id uuid)
      where not exists (select 1 from dominio.empresas em where em.id = x.empresa_id and em.organizacion_id = p_organizacion_id)
    ) then
      raise exception 'EMPRESA_INVALIDA: hay filas con una tienda que no es de esta organización' using errcode = 'P0001';
    end if;
    with ins as (
      insert into dominio.historial_comprobantes
        (organizacion_id, empresa_id, numero, fecha, cliente_nombre, cliente_numero, operador, estado_final, total)
      select p_organizacion_id, x.empresa_id, x.numero, x.fecha, x.cliente_nombre, nullif(btrim(x.cliente_numero), ''),
             coalesce(x.operador, ''), x.estado_final, x.total
      from jsonb_to_recordset(p_filas) as x(
        empresa_id uuid, numero text, fecha date, cliente_nombre text, cliente_numero text,
        operador text, estado_final text, total numeric)
      on conflict do nothing
      returning 1
    )
    select count(*)::integer into v_nuevas from ins;
  elsif p_tipo = 'cobros' then
    if exists (
      select 1 from jsonb_to_recordset(p_filas) as x(empresa_id uuid)
      where not exists (select 1 from dominio.empresas em where em.id = x.empresa_id and em.organizacion_id = p_organizacion_id)
    ) then
      raise exception 'EMPRESA_INVALIDA: hay filas con una tienda que no es de esta organización' using errcode = 'P0001';
    end if;
    with ins as (
      insert into dominio.historial_cobros
        (organizacion_id, empresa_id, fecha, comprobante_numero, cliente_nombre, cliente_numero, cuenta_cobro, aprobado_por, importe)
      select p_organizacion_id, x.empresa_id, x.fecha, x.comprobante_numero, x.cliente_nombre, nullif(btrim(x.cliente_numero), ''),
             x.cuenta_cobro, coalesce(x.aprobado_por, ''), x.importe
      from jsonb_to_recordset(p_filas) as x(
        empresa_id uuid, fecha date, comprobante_numero text, cliente_nombre text, cliente_numero text,
        cuenta_cobro text, aprobado_por text, importe numeric)
      on conflict do nothing
      returning 1
    )
    select count(*)::integer into v_nuevas from ins;
  else
    with ins as (
      insert into dominio.historial_cotizaciones_dolar
        (organizacion_id, fecha, dolar_comprador, dolar_vendedor, cargo)
      select p_organizacion_id, x.fecha, x.dolar_comprador, x.dolar_vendedor, coalesce(x.cargo, '')
      from jsonb_to_recordset(p_filas) as x(fecha date, dolar_comprador numeric, dolar_vendedor numeric, cargo text)
      on conflict do nothing
      returning 1
    )
    select count(*)::integer into v_nuevas from ins;
  end if;

  nuevas := v_nuevas;
  existentes := v_total - v_nuevas;
  return next;
end;
$$;

revoke execute on function private.importar_historial_lote_core(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.importar_historial_lote(p_ejecucion_id uuid, p_tipo text, p_filas jsonb)
returns table (nuevas integer, existentes integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid;
begin
  if session_user not like 'worker\_%'
     or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then
    raise exception 'NO_AUTORIZADO: solo un worker importa el historial' using errcode = 'P0001';
  end if;
  v_organizacion := private.organizacion_del_rol_actual();
  if v_organizacion is null then
    raise exception 'NO_AUTORIZADO: el rol no tiene organización' using errcode = 'P0001';
  end if;
  return query select * from private.importar_historial_lote_core(p_ejecucion_id, v_organizacion, p_tipo, p_filas);
end;
$$;

comment on function private.importar_historial_lote(uuid, text, jsonb) is
  'F-VTA-37 (FR-007). Única vía de escritura de dominio.historial_*: inserta un lote ya validado con on conflict do nothing y devuelve (nuevas, existentes). Errores: NO_AUTORIZADO, TIPO_INVALIDO, LOTE_INVALIDO, EJECUCION_NO_EN_CURSO, EMPRESA_INVALIDA.';

revoke execute on function private.importar_historial_lote(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.importar_historial_lote(uuid, text, jsonb) to workers_orquestacion;
