-- MSF-468 (spec 20270328-100000-newsletter-de-la-tienda), Fase 4 · T019: borradores y envíos del newsletter (composición, sin envío).
-- RF-NL-14, RF-NL-22, RF-NL-24; D6, D10, D12, D13. NO envía nada: el botón «Enviar» y el motor son de la Fase 5.
--
-- Esquemas (Principio VII, verificado objeto por objeto):
--   * dominio.newsletters (nueva)  -> `dominio`: borrador o envío de una tienda (contenido compuesto por el dueño).
--   * public.guardar_newsletter, descartar_newsletter, detalle_newsletter -> `public`: RPC del panel sin datos propios.
--   * dominio.campanas_correo.newsletter_id (columna de 20270420000000) gana su FK a la tabla nueva.
--
-- Seguridad: RLS por organización y tienda accesible; lectura con la sección `clientes` en lectura o edición; `authenticated` solo `select`;
-- toda escritura por RPC `security definer` con `search_path = ''` que exige Administrador y acceso a la tienda (D6). `anon` sin privilegios.
-- Concurrencia: el bloqueo optimista (`version`, 40001) y `for update` en la fila impiden pisar un borrador editado en paralelo o editar
-- uno que se envió entre medio (55000).
--
-- Aditiva e idempotente. Reversión (migración posterior; exportar antes si hace falta):
--   drop function public.detalle_newsletter(uuid), public.descartar_newsletter(uuid),
--     public.guardar_newsletter(uuid, integer, uuid, text, text, text, boolean, boolean);
--   alter table dominio.campanas_correo drop constraint campanas_correo_newsletter_fk;
--   drop table dominio.newsletters;

create table if not exists dominio.newsletters (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  nombre_interno text not null check (btrim(nombre_interno) <> '' and char_length(nombre_interno) <= 100),
  asunto text not null check (btrim(asunto) <> '' and char_length(asunto) <= 200 and asunto !~ '[\r\n]'),
  mensaje text not null check (btrim(mensaje) <> '' and char_length(mensaje) <= 10000),
  incluir_destacados boolean not null default false,
  incluir_promociones boolean not null default false,
  -- Foto del contenido al enviar (D13); null mientras es borrador.
  contenido_enviado jsonb check (contenido_enviado is null or (jsonb_typeof(contenido_enviado) = 'object' and pg_column_size(contenido_enviado) <= 200000)),
  -- Campaña del motor de correo masivo creada al enviar (Fase 5).
  campana_id uuid,
  enviada_en timestamptz,
  cancelada_en timestamptz,
  version integer not null default 1 check (version >= 1),
  creada_por uuid references auth.users (id) on delete set null,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  constraint newsletters_id_org_uq unique (id, organizacion_id),
  constraint newsletters_enviada_ck check ((enviada_en is null) = (campana_id is null) and (cancelada_en is null or enviada_en is not null)),
  constraint newsletters_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint newsletters_campana_fk foreign key (campana_id, organizacion_id)
    references dominio.campanas_correo (id, organizacion_id) on delete restrict
);

comment on table dominio.newsletters is
  'MSF-468 (D10, D12, D13): borrador o envío del newsletter de UNA tienda. Se escribe solo por RPC security definer (Administrador).';

create index if not exists newsletters_organizacion_idx on dominio.newsletters (organizacion_id, empresa_id, creada_en desc);

alter table dominio.campanas_correo drop constraint if exists campanas_correo_newsletter_fk;
alter table dominio.campanas_correo add constraint campanas_correo_newsletter_fk
  foreign key (newsletter_id, organizacion_id) references dominio.newsletters (id, organizacion_id) on delete set null (newsletter_id);
create unique index if not exists campanas_correo_newsletter_uq on dominio.campanas_correo (newsletter_id) where newsletter_id is not null;

alter table dominio.newsletters enable row level security;

drop policy if exists newsletters_select on dominio.newsletters;
create policy newsletters_select on dominio.newsletters
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
    and empresa_id in (select private.empresas_accesibles())
  );

revoke all on dominio.newsletters from public, anon, authenticated;
grant select on dominio.newsletters to authenticated;
grant select, insert, update, delete on dominio.newsletters to service_role;

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('newsletter.guardar', false, 'Borrador de newsletter creado o actualizado (sin asunto ni texto)')
on conflict (tipo) do nothing;

-- RF-NL-14 · crea (p_id nulo) o actualiza un borrador. Bloqueo optimista: `40001` si cambió; `55000` si ya se envió o la bandera está apagada.
create or replace function public.guardar_newsletter(
  p_id uuid,
  p_version integer,
  p_empresa uuid,
  p_nombre text,
  p_asunto text,
  p_mensaje text,
  p_destacados boolean,
  p_promociones boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.exigir_admin_newsletter(p_empresa);
  v_fila dominio.newsletters%rowtype;
  v_version integer;
begin
  if p_empresa is null then
    raise exception 'La tienda no existe' using errcode = 'P0002';
  end if;
  if not private.bandera_activa('newsletter') then
    raise exception 'El newsletter no está habilitado en este entorno' using errcode = '55000';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' or char_length(p_nombre) > 100 then
    raise exception 'El nombre interno es obligatorio y admite hasta 100 caracteres' using errcode = '22023', hint = 'nombre';
  end if;
  perform private.validar_redaccion_correo_masivo(p_asunto, p_mensaje);
  if p_destacados is null or p_promociones is null then
    raise exception 'Falta indicar las secciones del newsletter' using errcode = '22023';
  end if;

  if p_id is null then
    insert into dominio.newsletters (organizacion_id, empresa_id, nombre_interno, asunto, mensaje, incluir_destacados, incluir_promociones, creada_por)
    values (v_org, p_empresa, btrim(p_nombre), btrim(p_asunto), p_mensaje, p_destacados, p_promociones, (select auth.uid()))
    returning id, version into p_id, v_version;
  else
    select * into v_fila from dominio.newsletters n where n.id = p_id and n.organizacion_id = v_org for update;
    if not found then
      raise exception 'El newsletter no existe' using errcode = 'P0002';
    end if;
    -- Un borrador de una tienda sin acceso no se toca, aunque el destino sea otra.
    perform private.exigir_admin_newsletter(v_fila.empresa_id);
    if v_fila.enviada_en is not null then
      raise exception 'Un newsletter enviado no se puede editar' using errcode = '55000';
    end if;
    if p_version is distinct from v_fila.version then
      raise exception 'El borrador cambió: recargá para ver la última versión' using errcode = '40001';
    end if;
    update dominio.newsletters n
       set empresa_id = p_empresa, nombre_interno = btrim(p_nombre), asunto = btrim(p_asunto), mensaje = p_mensaje,
           incluir_destacados = p_destacados, incluir_promociones = p_promociones,
           version = n.version + 1, actualizada_en = now()
     where n.id = p_id
    returning version into v_version;
  end if;
  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.guardar', 'Guardó un borrador de newsletter', p_empresa);
  return jsonb_build_object('id', p_id, 'version', v_version);
end;
$$;

-- Descarta un borrador (solo si no se envió). Idempotente no: un borrador inexistente es P0002.
create or replace function public.descartar_newsletter(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.newsletters%rowtype;
begin
  select * into v_fila from dominio.newsletters n where n.id = p_id and n.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El newsletter no existe' using errcode = 'P0002';
  end if;
  perform private.exigir_admin_newsletter(v_fila.empresa_id);
  if v_fila.enviada_en is not null then
    raise exception 'Un newsletter enviado no se puede descartar' using errcode = '55000';
  end if;
  delete from dominio.newsletters n where n.id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Detalle de un borrador o envío (lectura en clientes + acceso a la tienda), con la foto enviada y los totales.
create or replace function public.detalle_newsletter(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_res jsonb;
begin
  if v_org is null or (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el newsletter' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'id', n.id, 'version', n.version, 'empresa_id', n.empresa_id, 'tienda', e.nombre,
           'nombre_interno', n.nombre_interno, 'asunto', n.asunto, 'mensaje', n.mensaje,
           'incluir_destacados', n.incluir_destacados, 'incluir_promociones', n.incluir_promociones,
           'contenido_enviado', n.contenido_enviado, 'enviada_en', n.enviada_en, 'cancelada_en', n.cancelada_en,
           'creada_en', n.creada_en, 'actualizada_en', n.actualizada_en,
           'estado', case when n.enviada_en is null then 'borrador'
                          when n.cancelada_en is not null then 'cancelada'
                          when t.pendientes > 0 then 'enviando' else 'enviada' end,
           'destinatarios', t.destinatarios, 'enviados', t.enviados, 'fallidos', t.fallidos,
           'omitidos', t.omitidos, 'pendientes', t.pendientes, 'bajas', t.bajas)
    into v_res
    from dominio.newsletters n
    join dominio.empresas e on e.id = n.empresa_id and e.organizacion_id = n.organizacion_id
    cross join lateral (
      select count(d.id)::int as destinatarios,
             (count(d.id) filter (where d.estado = 'enviado'))::int as enviados,
             (count(d.id) filter (where d.estado = 'fallido'))::int as fallidos,
             (count(d.id) filter (where d.estado = 'omitido'))::int as omitidos,
             (count(d.id) filter (where d.estado = 'pendiente'))::int as pendientes,
             (count(d.id) filter (where d.baja_en is not null))::int as bajas
        from dominio.campana_correo_destinatarios d
       where d.campana_id = n.campana_id and d.organizacion_id = n.organizacion_id
    ) t
   where n.id = p_id and n.organizacion_id = v_org and n.empresa_id in (select private.empresas_accesibles());
  if v_res is null then
    raise exception 'El newsletter no existe' using errcode = 'P0002';
  end if;
  return v_res;
end;
$$;

comment on function public.guardar_newsletter(uuid, integer, uuid, text, text, text, boolean, boolean) is 'MSF-468 (RF-NL-14): crea o actualiza un borrador; Administrador; 40001 si cambió; 55000 si ya se envió o la bandera está apagada.';
comment on function public.descartar_newsletter(uuid) is 'MSF-468 (RF-NL-14): descarta un borrador; Administrador; 55000 si ya se envió.';
comment on function public.detalle_newsletter(uuid) is 'MSF-468 (RF-NL-19): borrador o envío con la foto enviada y los totales; lectura en clientes.';

revoke execute on function public.guardar_newsletter(uuid, integer, uuid, text, text, text, boolean, boolean) from public, anon;
revoke execute on function public.descartar_newsletter(uuid) from public, anon;
revoke execute on function public.detalle_newsletter(uuid) from public, anon;
grant execute on function public.guardar_newsletter(uuid, integer, uuid, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.descartar_newsletter(uuid) to authenticated;
grant execute on function public.detalle_newsletter(uuid) to authenticated;
