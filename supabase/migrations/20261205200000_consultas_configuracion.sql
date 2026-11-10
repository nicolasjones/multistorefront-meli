-- MSF-207 · F-CON-03 (épica MSF-122, spec 20261023-120000-consultas-bandeja-y-aviso, FR-009):
-- dirección de avisos de consultas por empresa.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.consultas_configuracion  dominio (nueva)  configuración de una empresa para sus
--                                                     consultas: dato del producto, no de la
--                                                     plataforma → nunca `public`.
--   dominio.empresas                 dominio (existente), solo se referencia.
--
-- Seguridad:
--   * RLS por organización y empresa accesible; lectura con `consultas` o `empresas` >= lectura.
--   * SIN insert, update ni delete desde la app: se escribe solo con
--     `public.guardar_correo_avisos_consultas` (SECURITY DEFINER; `empresas` = edición, formato
--     validado, bloqueo optimista, evento de actividad).
--   * `anon` sin privilegios sobre la tabla ni sobre la RPC.
--
-- Migración aditiva. Reversión (migración posterior; antes revertir 20261024200100):
--   drop function public.guardar_correo_avisos_consultas(uuid, text, timestamptz);
--   drop function private.correo_avisos_consulta(uuid);
--   drop table dominio.consultas_configuracion;

create table dominio.consultas_configuracion (
  empresa_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- null = «volver al correo de contacto de la empresa».
  correo_avisos text check (
    correo_avisos is null
    or (length(correo_avisos) <= 254 and correo_avisos ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultas_configuracion_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.consultas_configuracion is
  'F-CON-03: configuración de consultas de una empresa (una fila por empresa). Escritura solo por public.guardar_correo_avisos_consultas; sin delete.';
comment on column dominio.consultas_configuracion.correo_avisos is
  'Dirección a la que llega el aviso de cada consulta nueva. Null: se usa dominio.empresas.correo.';
comment on column dominio.consultas_configuracion.updated_at is
  'Bloqueo optimista de public.guardar_correo_avisos_consultas.';

create index if not exists consultas_configuracion_organizacion_id_idx on dominio.consultas_configuracion (organizacion_id);

alter table dominio.consultas_configuracion enable row level security;

create policy consultas_configuracion_select on dominio.consultas_configuracion
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (
      (select private.nivel_seccion('consultas')) in ('lectura', 'edicion')
      or (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
    )
  );

revoke all on dominio.consultas_configuracion from public, anon, authenticated;
grant select on dominio.consultas_configuracion to authenticated;

-- Destinatario efectivo del aviso: la dirección propia o, si no hay, el correo de contacto de la
-- empresa. Interna (sin grants): la usan las funciones SECURITY DEFINER del aviso.
create or replace function private.correo_avisos_consulta(p_empresa_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(c.correo_avisos), ''),
    nullif(btrim(e.correo), '')
  )
  from dominio.empresas e
  left join dominio.consultas_configuracion c on c.empresa_id = e.id
  where e.id = p_empresa_id;
$$;

revoke execute on function private.correo_avisos_consulta(uuid) from public, anon, authenticated;

create or replace function public.guardar_correo_avisos_consultas(
  p_empresa_id uuid,
  p_correo text,
  p_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_correo text := nullif(btrim(coalesce(p_correo, '')), '');
  v_actual dominio.consultas_configuracion%rowtype;
  v_empresa text;
  v_nuevo timestamptz;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar la dirección de avisos' using errcode = '42501';
  end if;

  select e.nombre into v_empresa
    from dominio.empresas e
   where e.id = p_empresa_id and e.organizacion_id = v_org
     and exists (select 1 from private.empresas_accesibles() ea where ea = e.id);
  -- Inexistente, de otra organización o sin acceso: misma respuesta.
  if not found then
    raise exception 'No tenés permiso para editar la dirección de avisos' using errcode = '42501';
  end if;

  if v_correo is not null
     and (length(v_correo) > 254 or v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    raise exception 'El correo de avisos no tiene un formato válido' using errcode = '22023', detail = 'correo_avisos';
  end if;

  select * into v_actual from dominio.consultas_configuracion c
   where c.empresa_id = p_empresa_id for update;

  if not found then
    -- Sin fila todavía, «volver al contacto» ya es el estado vigente: nada que escribir.
    if v_correo is null then
      return null;
    end if;
    insert into dominio.consultas_configuracion (empresa_id, organizacion_id, correo_avisos)
    values (p_empresa_id, v_org, v_correo)
    on conflict (empresa_id) do nothing
    returning updated_at into v_nuevo;
    if v_nuevo is null then
      -- Otra sesión la creó entre el select y el insert: es un conflicto de edición.
      raise exception 'La dirección de avisos fue modificada por otra persona' using errcode = '40001';
    end if;
  else
    -- Idempotente: sin cambios no hay conflicto posible ni escritura.
    if v_actual.correo_avisos is not distinct from v_correo then
      return v_actual.updated_at;
    end if;
    if p_updated_at is distinct from v_actual.updated_at then
      raise exception 'La dirección de avisos fue modificada por otra persona' using errcode = '40001';
    end if;
    update dominio.consultas_configuracion
       set correo_avisos = v_correo,
           updated_at = greatest(clock_timestamp(), v_actual.updated_at + interval '1 microsecond')
     where empresa_id = p_empresa_id
    returning updated_at into v_nuevo;
  end if;

  perform private.insertar_actividad(
    v_org, v_actor, 'consulta.avisos_actualizados',
    case when v_correo is null
      then format('Volvió la dirección de avisos de consultas de «%s» al correo de contacto', v_empresa)
      else format('Cambió la dirección de avisos de consultas de «%s»', v_empresa) end,
    p_empresa_id);

  return v_nuevo;
end;
$$;

revoke execute on function public.guardar_correo_avisos_consultas(uuid, text, timestamptz) from public, anon;
grant execute on function public.guardar_correo_avisos_consultas(uuid, text, timestamptz) to authenticated;

comment on function public.guardar_correo_avisos_consultas(uuid, text, timestamptz) is
  'MSF-207: fija la dirección de avisos de consultas de una empresa (null = correo de contacto). Exige empresas = edición; 40001 si el sello updated_at no coincide; 42501 sin permiso; 22023 formato inválido. La actividad registra el hecho del cambio, no la dirección.';
