-- F-VTA-20 (MSF-245, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-023, FR-024, FR-029): registro de los
-- envíos por correo de un presupuesto y funciones que usa el flow `comprobantes-correo` de Kestra.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.comprobante_envios_correo  dominio  envío de un documento de venta al cliente: entidad de negocio.
--   private.datos_envio_correo / private.cerrar_envio_correo  funciones de soporte del flow (no son tablas).
-- RLS: select por organización y nivel de `ventas` (lectura o edición) EN LA EMPRESA del envío, igual que los
-- documentos. Sin políticas ni grants de escritura para `authenticated`: se escribe solo por la RPC
-- `enviar_presupuesto_correo` (20261212100300) y por `private.cerrar_envio_correo`. `anon` sin acceso.
--
-- Las dos funciones `private.*` las ejecuta únicamente el rol de servicio `kestra_orquestacion` (el mismo que
-- reclama la outbox): no son ejecutables por `authenticated` ni `anon`, y por eso no están en PostgREST.
-- `datos_envio_correo` devuelve lo mínimo para armar el correo; `cerrar_envio_correo` es idempotente.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function private.cerrar_envio_correo(uuid, text);
--   drop function private.aplicar_cierre_envio_correo(uuid, text);
--   drop function private.exigir_llamante_kestra();
--   drop function private.datos_envio_correo(uuid);
--   drop table dominio.comprobante_envios_correo;

create table dominio.comprobante_envios_correo (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  comprobante_id uuid not null,
  -- PDF que se adjunta: lo pide la propia RPC (puede ser uno ya generado y vigente).
  documento_id uuid not null references dominio.comprobante_documentos (id),
  -- Correo del cliente al momento de pedir el envío (foto: si el cliente cambia de correo después, queda el usado).
  destinatario text not null check (length(destinatario) between 3 and 320),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'fallido')),
  -- Motivo sanitizado y corto: nunca el detalle técnico del SMTP (credenciales, hosts, trazas).
  error text check (error is null or length(error) <= 500),
  solicitado_por uuid references auth.users (id) on delete set null,
  solicitado_en timestamptz not null default now(),
  enviado_en timestamptz,
  -- Ejecución del ciclo de workers (spec 016/019) que despacha el flow; sin FK para no atar el envío a su vida.
  ejecucion_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id),
  foreign key (comprobante_id, organizacion_id) references dominio.comprobantes_venta (id, organizacion_id),
  constraint comprobante_envios_correo_enviado_ck check (
    (estado = 'enviado' and enviado_en is not null and error is null)
    or (estado <> 'enviado' and enviado_en is null)
  )
);

comment on table dominio.comprobante_envios_correo is
  'F-VTA-20: envío por correo del PDF de un presupuesto al cliente (destinatario, estado, quién y cuándo). Se escribe solo por RPC y por la función del flow de Kestra.';
comment on column dominio.comprobante_envios_correo.error is
  'Motivo sanitizado del fallo; el detalle técnico del SMTP no se guarda ni se muestra.';

-- No puede haber dos envíos pendientes del mismo presupuesto (FR-023): el doble clic es un solo envío.
create unique index if not exists comprobante_envios_correo_pendiente_uq
  on dominio.comprobante_envios_correo (comprobante_id)
  where estado = 'pendiente';

create index if not exists comprobante_envios_correo_comprobante_idx
  on dominio.comprobante_envios_correo (organizacion_id, comprobante_id, solicitado_en desc);
create index if not exists comprobante_envios_correo_empresa_idx
  on dominio.comprobante_envios_correo (empresa_id, organizacion_id);
create index if not exists comprobante_envios_correo_documento_idx
  on dominio.comprobante_envios_correo (documento_id);

alter table dominio.comprobante_envios_correo enable row level security;

create policy comprobante_envios_correo_select on dominio.comprobante_envios_correo
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_leer_documento_empresa(empresa_id))
  );

revoke all on dominio.comprobante_envios_correo from public, anon, authenticated;
grant select on dominio.comprobante_envios_correo to authenticated;

-- ============================================================================
-- Funciones del flow de Kestra
-- ============================================================================

-- Solo el rol de servicio de Kestra (o el dueño de la función, que en el CI no es superusuario y pgTAP no puede
-- simular el login de kestra con `set session authorization`; mismo criterio que reclamar_despachos_capacidad).
create or replace function private.exigir_llamante_kestra()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user <> current_user
     and not (select rolsuper from pg_catalog.pg_roles where rolname = session_user)
     and session_user <> 'kestra_orquestacion' then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion opera los envíos por correo' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function private.exigir_llamante_kestra() from public, anon, authenticated;

-- Datos para armar el correo de un envío pendiente. Si el PDF todavía no está, el flow espera (estado_documento
-- `pendiente`); si falló, cierra el envío como fallido. Un documento pendiente que ya no puede completarse se
-- expira acá (mismo cierre perezoso que usa la pantalla).
create or replace function private.datos_envio_correo(p_envio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_envio dominio.comprobante_envios_correo;
  v_doc dominio.comprobante_documentos;
  v_resultado jsonb;
begin
  perform private.exigir_llamante_kestra();

  select * into v_envio from dominio.comprobante_envios_correo e where e.id = p_envio_id;
  if not found then
    raise exception 'ENVIO_DESCONOCIDO: %', p_envio_id using errcode = 'P0001';
  end if;

  perform private.expirar_documento_pendiente(v_envio.documento_id);
  select * into v_doc from dominio.comprobante_documentos d where d.id = v_envio.documento_id;

  select jsonb_build_object(
    'envio_id', v_envio.id,
    'estado_envio', v_envio.estado,
    'estado_documento', v_doc.estado,
    'ruta', v_doc.ruta,
    'destinatario', v_envio.destinatario,
    -- Sin saltos de línea ni tabulaciones: estos textos van al asunto del correo (evita inyectar encabezados).
    'numero', regexp_replace(c.numero, '[\r\n\t]+', ' ', 'g'),
    'valido_hasta', c.valido_hasta,
    'total_con_iva', c.total_con_iva,
    'empresa', regexp_replace(coalesce(nullif(btrim(e.razon_social), ''), e.nombre), '[\r\n\t]+', ' ', 'g'),
    'cliente', regexp_replace(cl.nombre, '[\r\n\t]+', ' ', 'g')
  )
  into v_resultado
  from dominio.comprobantes_venta c
  join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
  join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
  where c.id = v_envio.comprobante_id and c.organizacion_id = v_envio.organizacion_id;

  return v_resultado;
end;
$$;

comment on function private.datos_envio_correo(uuid) is
  'F-VTA-20 (FR-024): datos mínimos para armar el correo de un envío (destinatario, número, PDF). Solo kestra_orquestacion; no ejecutable por authenticated.';

-- Cierra el envío: `enviado` (p_error nulo) o `fallido` con un motivo sanitizado. Idempotente: un segundo cierre
-- no cambia nada. Deja el evento de actividad (FR-029) y cierra la ejecución del ciclo de workers.
create or replace function private.aplicar_cierre_envio_correo(p_envio_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_envio dominio.comprobante_envios_correo;
  v_numero text;
  v_error text;
  -- Formas de secreto en texto recuperable (mismo criterio que cerrar_documento_comprobante).
  c_patron_secreto constant text :=
    '(?i)(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)\s*[:=]\s*\S+'
    || '|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+'
    || '|://[^/\s:]+:[^/\s@]+@'
    || '|AKIA[0-9A-Z]{16}';
begin
  select * into v_envio from dominio.comprobante_envios_correo e where e.id = p_envio_id for update;
  if not found then
    raise exception 'ENVIO_DESCONOCIDO: %', p_envio_id using errcode = 'P0001';
  end if;
  if v_envio.estado <> 'pendiente' then
    return;
  end if;

  select c.numero into v_numero from dominio.comprobantes_venta c where c.id = v_envio.comprobante_id;

  if p_error is null then
    update dominio.comprobante_envios_correo e
    set estado = 'enviado', error = null, enviado_en = clock_timestamp(), updated_at = clock_timestamp()
    where e.id = v_envio.id;
    perform private.insertar_actividad(
      v_envio.organizacion_id, v_envio.solicitado_por, 'presupuesto.enviado_por_correo',
      format('Envió por correo el presupuesto %s a %s', v_numero, v_envio.destinatario), v_envio.empresa_id);
  else
    v_error := left(coalesce(nullif(btrim(p_error), ''), 'No se pudo enviar el correo'), 500);
    if v_error ~ c_patron_secreto then
      v_error := 'No se pudo enviar el correo';
    end if;
    update dominio.comprobante_envios_correo e
    set estado = 'fallido', error = v_error, enviado_en = null, updated_at = clock_timestamp()
    where e.id = v_envio.id;
    perform private.insertar_actividad(
      v_envio.organizacion_id, v_envio.solicitado_por, 'presupuesto.envio_fallido',
      format('No se pudo enviar por correo el presupuesto %s a %s', v_numero, v_envio.destinatario), v_envio.empresa_id);
  end if;

  update public.ejecuciones_worker x
  set estado = case when p_error is null then 'exitosa' else 'fallida' end,
      finalizada_en = clock_timestamp(),
      motivo_sanitizado = case when p_error is null then null else left(coalesce(v_error, ''), 200) end
  where x.id = v_envio.ejecucion_id and x.estado = 'en_curso';
end;
$$;

-- Cierre que usa el flow (solo kestra_orquestacion).
create or replace function private.cerrar_envio_correo(p_envio_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.exigir_llamante_kestra();
  perform private.aplicar_cierre_envio_correo(p_envio_id, p_error);
end;
$$;

comment on function private.cerrar_envio_correo(uuid, text) is
  'F-VTA-20 (FR-024, FR-029): cierra el envío como enviado o fallido (error sanitizado) y deja el evento de actividad. Idempotente. Solo kestra_orquestacion; no ejecutable por authenticated.';

revoke execute on function private.datos_envio_correo(uuid) from public, anon, authenticated;
revoke execute on function private.aplicar_cierre_envio_correo(uuid, text) from public, anon, authenticated;
revoke execute on function private.cerrar_envio_correo(uuid, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function
      private.exigir_llamante_kestra(),
      private.datos_envio_correo(uuid),
      private.cerrar_envio_correo(uuid, text)
      to kestra_orquestacion;
  end if;
end
$$;
