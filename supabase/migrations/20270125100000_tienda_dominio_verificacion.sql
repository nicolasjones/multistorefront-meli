-- MSF-198 · F-TDA-05 (épica MSF-133, spec 20270125-100000-tienda-dominio-y-publicacion,
-- FR-002…FR-015): dominio de la tienda, verificación DNS y estado del certificado.
--
-- Esquemas (Principio VII, re-verificado):
--   * `dominio.tiendas` (columnas nuevas) y `dominio.tienda_registros_dns` -> `dominio`: el dominio
--     de la tienda y el resultado de su última comprobación son datos de negocio de esa tienda.
--   * `public.tienda_dns_plataforma` -> `public`: configuración de plataforma (a dónde debe apuntar
--     cualquier tienda), sin secretos, no es del producto en sí.
--   * `publico.redireccion_por_dominio` -> `publico`: SOLO función (el esquema sigue sin tablas).
--
-- RLS: `tienda_registros_dns` y `tienda_dns_plataforma` con política de solo lectura para
-- `authenticated`; nadie escribe por tabla: todo pasa por RPC SECURITY DEFINER (auditoría siempre).
--
-- Permisos: toda RPC de `public` lleva `revoke … from public, anon`; las del administrador
-- `grant … to authenticated`; `registrar_verificacion_dns` SOLO `service_role` (la ejecuta la Edge
-- Function `verificar-dominio-tienda`). `anon` solo ejecuta `publico.redireccion_por_dominio`.
--
-- Desvío menor respecto del contrato (ver commit de la historia): `dominio.tiendas` suma dos columnas
-- internas (`verificacion_solicitada_at`, `verificacion_solicitada_por`) que sostienen el límite de
-- 10 s (FR-010), el actor de la auditoría (FR-014) y rechazan resultados de una verificación
-- obsoleta (el dominio cambió mientras se comprobaba).
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop function publico.redireccion_por_dominio(text);
--   drop function public.registrar_verificacion_dns(uuid, jsonb, text);
--   drop function public.preparar_verificacion_tienda(uuid);
--   drop function public.obtener_dominio_tienda(uuid);
--   drop function public.configurar_dominio_tienda(uuid, text, text);
--   drop function private.promover_dominio_pendiente(uuid);
--   drop table dominio.tienda_registros_dns;
--   drop table public.tienda_dns_plataforma;
--   alter table dominio.tiendas drop column dominio_redireccion, drop column dominio_pendiente,
--     drop column token_verificacion, drop column dominio_verificado_at, drop column ultima_verificacion_at,
--     drop column certificado_estado, drop column certificado_verificado_at,
--     drop column verificacion_solicitada_at, drop column verificacion_solicitada_por;

-- ============================================================================
-- dominio.tiendas: columnas nuevas (FR-003, FR-007, FR-011)
-- ============================================================================

alter table dominio.tiendas
  add column dominio_redireccion text,
  add column dominio_pendiente text,
  add column token_verificacion text not null default replace(gen_random_uuid()::text, '-', ''),
  add column dominio_verificado_at timestamptz,
  add column ultima_verificacion_at timestamptz,
  add column certificado_estado text not null default 'pendiente',
  add column certificado_verificado_at timestamptz,
  add column verificacion_solicitada_at timestamptz,
  add column verificacion_solicitada_por uuid;

alter table dominio.tiendas
  add constraint tiendas_dominio_redireccion_formato check (
    dominio_redireccion is null or (
      dominio_redireccion = lower(dominio_redireccion)
      and length(dominio_redireccion) <= 253
      and dominio_redireccion ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    )
  ),
  add constraint tiendas_dominio_pendiente_formato check (
    dominio_pendiente is null or (
      dominio_pendiente = lower(dominio_pendiente)
      and length(dominio_pendiente) <= 253
      and dominio_pendiente ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    )
  ),
  add constraint tiendas_dominio_redireccion_distinto check (
    dominio_redireccion is null or (dominio_redireccion <> dominio and dominio_redireccion is distinct from dominio_pendiente)
  ),
  add constraint tiendas_certificado_estado_lista check (certificado_estado in ('pendiente', 'activo', 'error')),
  add constraint tiendas_dominio_pendiente_uk unique (dominio_pendiente),
  add constraint tiendas_dominio_redireccion_uk unique (dominio_redireccion);

comment on column dominio.tiendas.dominio_pendiente is
  'MSF-198: dominio principal nuevo todavía sin verificar. La tienda sigue resolviendo por `dominio` hasta que este quede verificado con certificado activo (D5).';
comment on column dominio.tiendas.dominio_redireccion is
  'MSF-198: «Redirigir también»: dominio que redirige al principal. Único a nivel plataforma junto con dominio y dominio_pendiente.';
comment on column dominio.tiendas.token_verificacion is
  'MSF-198: token propio de la tienda para el registro TXT `_verif` (`<prefijo>=<token>`). No es un secreto: lo ve quien administra la tienda.';

-- ============================================================================
-- dominio.tienda_registros_dns (FR-004, FR-005)
-- ============================================================================

create table dominio.tienda_registros_dns (
  empresa_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  tipo text not null,
  nombre text not null,
  estado text not null default 'pendiente',
  valor_encontrado text,
  comprobado_at timestamptz not null default now(),
  primary key (empresa_id, tipo),
  constraint tienda_registros_dns_tipo_lista check (tipo in ('A', 'CNAME', 'TXT')),
  constraint tienda_registros_dns_estado_lista check (estado in ('correcto', 'incorrecto', 'pendiente')),
  constraint tienda_registros_dns_nombre_largo check (length(nombre) between 1 and 253),
  constraint tienda_registros_dns_valor_largo check (valor_encontrado is null or length(valor_encontrado) <= 500),
  constraint tienda_registros_dns_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.tienda_registros_dns is
  'MSF-198 (F-TDA-05): resultado de la última comprobación de cada registro DNS de una tienda. Se escribe solo por public.registrar_verificacion_dns (service_role).';

create index tienda_registros_dns_organizacion_id_idx on dominio.tienda_registros_dns (organizacion_id);

alter table dominio.tienda_registros_dns enable row level security;

create policy tienda_registros_dns_select on dominio.tienda_registros_dns
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.tienda_registros_dns from public, anon, authenticated;
grant select on dominio.tienda_registros_dns to authenticated;

-- ============================================================================
-- public.tienda_dns_plataforma (FR-008): configuración de plataforma, fila única
-- ============================================================================

create table public.tienda_dns_plataforma (
  id boolean primary key default true,
  ip_publica text not null,
  cname_destino text not null,
  prefijo_txt text not null,
  updated_at timestamptz not null default now(),
  constraint tienda_dns_plataforma_fila_unica check (id),
  constraint tienda_dns_plataforma_ip_formato check (ip_publica ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'),
  constraint tienda_dns_plataforma_cname_formato check (
    cname_destino = lower(cname_destino)
    and cname_destino ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  ),
  constraint tienda_dns_plataforma_prefijo_formato check (prefijo_txt ~ '^[a-z][a-z0-9-]{0,30}$')
);

comment on table public.tienda_dns_plataforma is
  'MSF-198: a dónde debe apuntar el DNS de cualquier tienda (IP del A, destino del CNAME, prefijo del TXT). Configuración de plataforma por entorno: la carga el equipo técnico por SQL; sin secretos y sin política de escritura.';

alter table public.tienda_dns_plataforma enable row level security;

create policy tienda_dns_plataforma_select on public.tienda_dns_plataforma
  for select to authenticated
  using (true);

revoke all on public.tienda_dns_plataforma from public, anon, authenticated;
grant select on public.tienda_dns_plataforma to authenticated;

-- Valores de documentación (RFC 5737 / example.com): el equipo técnico carga los reales por entorno (D2).
insert into public.tienda_dns_plataforma (ip_publica, cname_destino, prefijo_txt)
values ('203.0.113.24', 'tiendas.plataforma.example.com', 'gc-verify')
on conflict (id) do nothing;

-- ============================================================================
-- Helpers internos
-- ============================================================================

-- Valida y normaliza un dominio (formato de nombre DNS). Devuelve null si no es válido.
create or replace function private.dominio_tienda_valido(p_dominio text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' and length(n) <= 253 then n
    else null
  end
  from (select private.normalizar_host(p_dominio) as n) as x;
$$;

revoke execute on function private.dominio_tienda_valido(text) from public, anon, authenticated;

-- Ver FR-003: el pendiente pasa a ser el principal solo si está verificado con certificado activo.
create or replace function private.promover_dominio_pendiente(p_empresa_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update dominio.tiendas
     set dominio = dominio_pendiente,
         dominio_pendiente = null
   where empresa_id = p_empresa_id
     and dominio_pendiente is not null
     and dominio_verificado_at is not null
     and certificado_estado = 'activo';
  return found;
exception
  when unique_violation then
    -- Alguien más ocupó ese dominio por fuera de la RPC: el pendiente queda a la espera, nada se corta.
    return false;
end;
$$;

revoke execute on function private.promover_dominio_pendiente(uuid) from public, anon, authenticated;

comment on function private.promover_dominio_pendiente(uuid) is
  'MSF-198: intercambia dominio_pendiente por dominio cuando está verificado con certificado activo (FR-003, D5).';

-- Permiso común de las RPC de gestión: edición en Empresas y empresa de la organización de la sesión.
create or replace function private.empresa_de_tienda_editable(p_empresa_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;
  return v_org;
end;
$$;

revoke execute on function private.empresa_de_tienda_editable(uuid) from public, anon, authenticated;

-- ============================================================================
-- public.configurar_dominio_tienda (FR-002, FR-003, FR-015)
-- ============================================================================

create or replace function public.configurar_dominio_tienda(
  p_empresa_id uuid,
  p_dominio text,
  p_redireccion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.empresa_de_tienda_editable(p_empresa_id);
  v_dominio text := private.dominio_tienda_valido(p_dominio);
  v_hay_redireccion boolean := nullif(btrim(coalesce(p_redireccion, '')), '') is not null;
  v_redireccion text := case when v_hay_redireccion then private.dominio_tienda_valido(p_redireccion) end;
  v_empresa text;
  v_tienda dominio.tiendas;
  v_nuevo_pendiente text;
  v_cambio_pendiente boolean;
  v_cambio_redireccion boolean;
  v_reinicia_dominio boolean;
  v_reinicia_cname boolean;
begin
  if v_dominio is null then
    raise exception 'dominio_invalido' using errcode = '22023';
  end if;
  if v_hay_redireccion and v_redireccion is null then
    raise exception 'redireccion_invalida' using errcode = '22023';
  end if;
  if v_redireccion is not null and v_redireccion = v_dominio then
    raise exception 'redireccion_invalida' using errcode = '22023';
  end if;

  -- Serializa las altas de dominio: la unicidad cruza tres columnas de todas las tiendas.
  perform pg_advisory_xact_lock(hashtext('dominio.tiendas.dominios'));
  perform 1 from dominio.empresas where id = p_empresa_id for update;

  if exists (
    select 1 from dominio.tiendas t
    where t.empresa_id <> p_empresa_id
      and v_dominio in (t.dominio, coalesce(t.dominio_pendiente, ''), coalesce(t.dominio_redireccion, ''))
  ) then
    raise exception 'dominio_en_uso' using errcode = '23505';
  end if;
  if v_redireccion is not null and exists (
    select 1 from dominio.tiendas t
    where t.empresa_id <> p_empresa_id
      and v_redireccion in (t.dominio, coalesce(t.dominio_pendiente, ''), coalesce(t.dominio_redireccion, ''))
  ) then
    raise exception 'redireccion_en_uso' using errcode = '23505';
  end if;

  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa_id;
  select * into v_tienda from dominio.tiendas where empresa_id = p_empresa_id;

  if not found then
    -- FR-015: la primera carga crea la tienda con ese dominio como principal.
    insert into dominio.tiendas (organizacion_id, empresa_id, dominio, dominio_redireccion)
    values (v_org, p_empresa_id, v_dominio, v_redireccion)
    returning * into v_tienda;
    return jsonb_build_object(
      'dominio_vigente', v_tienda.dominio,
      'dominio_pendiente', v_tienda.dominio_pendiente,
      'redireccion', v_tienda.dominio_redireccion
    );
  end if;

  if v_redireccion is not null and v_redireccion = v_tienda.dominio then
    raise exception 'redireccion_invalida' using errcode = '22023';
  end if;

  -- Volver al vigente cancela el pendiente; un dominio distinto queda pendiente (FR-003).
  v_nuevo_pendiente := case
    when v_dominio = v_tienda.dominio then null
    else v_dominio
  end;
  v_cambio_pendiente := v_nuevo_pendiente is distinct from v_tienda.dominio_pendiente;
  v_cambio_redireccion := v_redireccion is distinct from v_tienda.dominio_redireccion;
  -- Reinicia la verificación solo si hay algo nuevo que verificar: otro dominio o un CNAME nuevo.
  v_reinicia_dominio := v_cambio_pendiente and v_nuevo_pendiente is not null;
  v_reinicia_cname := v_cambio_redireccion and v_redireccion is not null;

  -- Un solo UPDATE: los checks «distinto del principal» ven el estado final, no uno intermedio.
  update dominio.tiendas
     set dominio_pendiente = v_nuevo_pendiente,
         dominio_redireccion = v_redireccion,
         dominio_verificado_at = case when v_reinicia_dominio or v_reinicia_cname then null else dominio_verificado_at end,
         ultima_verificacion_at = case when v_reinicia_dominio then null else ultima_verificacion_at end,
         certificado_estado = case when v_reinicia_dominio then 'pendiente' else certificado_estado end,
         certificado_verificado_at = case when v_reinicia_dominio then null else certificado_verificado_at end,
         verificacion_solicitada_at = case when v_cambio_pendiente or v_cambio_redireccion then null else verificacion_solicitada_at end
   where empresa_id = p_empresa_id;

  if v_reinicia_dominio then
    delete from dominio.tienda_registros_dns where empresa_id = p_empresa_id;
  elsif v_cambio_redireccion then
    delete from dominio.tienda_registros_dns where empresa_id = p_empresa_id and tipo = 'CNAME';
  end if;

  if v_reinicia_dominio then
    -- El trigger de dominio.tiendas solo audita el cambio del principal; el pendiente se audita acá (FR-014).
    perform private.insertar_actividad(
      v_org, (select auth.uid()), 'tienda.dominio_configurado',
      format('Configuró un dominio nuevo para la tienda de «%s» (pendiente de verificación)', v_empresa),
      p_empresa_id
    );
  end if;

  select * into v_tienda from dominio.tiendas where empresa_id = p_empresa_id;
  return jsonb_build_object(
    'dominio_vigente', v_tienda.dominio,
    'dominio_pendiente', v_tienda.dominio_pendiente,
    'redireccion', v_tienda.dominio_redireccion
  );
end;
$$;

comment on function public.configurar_dominio_tienda(uuid, text, text) is
  'F-TDA-05: alta/cambio del dominio principal y «Redirigir también» de la tienda. Normaliza, exige unicidad a nivel plataforma, guarda el principal nuevo como pendiente sin cortar el vigente y crea la tienda si no existe. Errores: dominio_invalido, dominio_en_uso, redireccion_invalida, redireccion_en_uso, sin_permiso (42501).';

revoke execute on function public.configurar_dominio_tienda(uuid, text, text) from public, anon;
grant execute on function public.configurar_dominio_tienda(uuid, text, text) to authenticated;

-- ============================================================================
-- public.obtener_dominio_tienda (FR-004, FR-005, FR-007)
-- ============================================================================

create or replace function public.obtener_dominio_tienda(p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.empresa_de_tienda_editable(p_empresa_id);
  v_t dominio.tiendas;
  v_p public.tienda_dns_plataforma;
  v_objetivo text;
  v_registros jsonb;
  v_nombre_cname text;
begin
  select * into v_t from dominio.tiendas where empresa_id = p_empresa_id and organizacion_id = v_org;
  if not found then
    return jsonb_build_object(
      'dominio_vigente', null, 'dominio_pendiente', null, 'redireccion', null,
      'dominio_verificado', false, 'certificado', 'pendiente', 'ultima_verificacion', null,
      'registros', '[]'::jsonb
    );
  end if;

  select * into v_p from public.tienda_dns_plataforma limit 1;
  v_objetivo := coalesce(v_t.dominio_pendiente, v_t.dominio);
  v_nombre_cname := case
    when v_t.dominio_redireccion is null then null
    when right(v_t.dominio_redireccion, length(v_objetivo) + 1) = '.' || v_objetivo
      then left(v_t.dominio_redireccion, length(v_t.dominio_redireccion) - length(v_objetivo) - 1)
    else v_t.dominio_redireccion
  end;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'tipo', r.tipo, 'nombre', r.nombre, 'valor', r.valor,
             'estado', coalesce(d.estado, 'pendiente'),
             'encontrado', case when coalesce(d.estado, 'pendiente') = 'incorrecto' then d.valor_encontrado end
           ) order by r.orden),
         '[]'::jsonb)
    into v_registros
    from (
      select 'A'::text as tipo, '@'::text as nombre, v_p.ip_publica as valor, 1 as orden
      where v_p.ip_publica is not null
      union all
      select 'CNAME', v_nombre_cname, v_p.cname_destino, 2
      where v_nombre_cname is not null and v_p.cname_destino is not null
      union all
      select 'TXT', '_verif', v_p.prefijo_txt || '=' || v_t.token_verificacion, 3
      where v_p.prefijo_txt is not null
    ) r
    left join dominio.tienda_registros_dns d on d.empresa_id = p_empresa_id and d.tipo = r.tipo;

  return jsonb_build_object(
    'dominio_vigente', v_t.dominio,
    'dominio_pendiente', v_t.dominio_pendiente,
    'redireccion', v_t.dominio_redireccion,
    'dominio_verificado', v_t.dominio_verificado_at is not null,
    'certificado', v_t.certificado_estado,
    'ultima_verificacion', v_t.ultima_verificacion_at,
    'registros', v_registros
  );
end;
$$;

comment on function public.obtener_dominio_tienda(uuid) is
  'F-TDA-05: estado del dominio de la tienda y tabla Tipo/Nombre/Valor/Estado calculada en el servidor con tienda_dns_plataforma y el token. Exige edición en Empresas.';

revoke execute on function public.obtener_dominio_tienda(uuid) from public, anon;
grant execute on function public.obtener_dominio_tienda(uuid) to authenticated;

-- ============================================================================
-- public.preparar_verificacion_tienda (FR-009, FR-010)
-- ============================================================================

-- La llama la Edge Function con el JWT de la persona: valida permiso, aplica el límite de 10 s y
-- devuelve los hostnames (guardados en la base, nunca del request) y los valores esperados.
create or replace function public.preparar_verificacion_tienda(p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.empresa_de_tienda_editable(p_empresa_id);
  v_t dominio.tiendas;
  v_p public.tienda_dns_plataforma;
begin
  select * into v_t from dominio.tiendas where empresa_id = p_empresa_id and organizacion_id = v_org;
  if not found then
    raise exception 'sin_dominio' using errcode = '22023';
  end if;
  select * into v_p from public.tienda_dns_plataforma limit 1;
  if not found then
    raise exception 'sin_dominio' using errcode = '22023';
  end if;

  -- Atómico: solo uno gana si llegan dos pedidos juntos.
  update dominio.tiendas
     set verificacion_solicitada_at = now(),
         verificacion_solicitada_por = (select auth.uid())
   where empresa_id = p_empresa_id
     and (verificacion_solicitada_at is null or verificacion_solicitada_at <= now() - interval '10 seconds');
  if not found then
    raise exception 'demasiado_pronto' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'dominio', coalesce(v_t.dominio_pendiente, v_t.dominio),
    'redireccion', v_t.dominio_redireccion,
    'token', v_t.token_verificacion,
    'ip_publica', v_p.ip_publica,
    'cname_destino', v_p.cname_destino,
    'prefijo_txt', v_p.prefijo_txt
  );
end;
$$;

comment on function public.preparar_verificacion_tienda(uuid) is
  'F-TDA-05: valida permiso, aplica el límite de una verificación cada 10 s por tienda y devuelve hostnames y valores esperados para la Edge Function. Errores: sin_permiso (42501), sin_dominio, demasiado_pronto (55000).';

revoke execute on function public.preparar_verificacion_tienda(uuid) from public, anon;
grant execute on function public.preparar_verificacion_tienda(uuid) to authenticated;

-- ============================================================================
-- public.registrar_verificacion_dns (FR-009, FR-011, FR-012, FR-014): SOLO service_role
-- ============================================================================

create or replace function public.registrar_verificacion_dns(
  p_empresa_id uuid,
  p_resultados jsonb,
  p_certificado text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t dominio.tiendas;
  v_item jsonb;
  v_tipo text;
  v_estado text;
  v_nombre text;
  v_valor text;
  v_verificado boolean;
  v_certificado text := coalesce(p_certificado, 'pendiente');
  v_empresa text;
begin
  if p_resultados is null or jsonb_typeof(p_resultados) <> 'array' then
    raise exception 'Los resultados deben ser una lista' using errcode = '22023';
  end if;
  if v_certificado not in ('pendiente', 'activo', 'error') then
    raise exception 'Estado de certificado inválido' using errcode = '22023';
  end if;

  select * into v_t from dominio.tiendas where empresa_id = p_empresa_id for update;
  if not found then
    raise exception 'sin_dominio' using errcode = '22023';
  end if;
  -- Una verificación solo vale si se pidió y el dominio no cambió desde entonces.
  if v_t.verificacion_solicitada_at is null then
    raise exception 'verificacion_obsoleta' using errcode = '55000';
  end if;

  for v_item in select * from jsonb_array_elements(p_resultados) loop
    v_tipo := v_item ->> 'tipo';
    v_estado := v_item ->> 'estado';
    v_nombre := left(coalesce(v_item ->> 'nombre', ''), 253);
    v_valor := left(v_item ->> 'valor_encontrado', 500);
    if v_tipo not in ('A', 'CNAME', 'TXT') or v_estado not in ('correcto', 'incorrecto', 'pendiente') or v_nombre = '' then
      raise exception 'Resultado de registro inválido' using errcode = '22023';
    end if;
    -- El CNAME solo existe si hay «Redirigir también».
    continue when v_tipo = 'CNAME' and v_t.dominio_redireccion is null;
    insert into dominio.tienda_registros_dns (empresa_id, organizacion_id, tipo, nombre, estado, valor_encontrado, comprobado_at)
    values (p_empresa_id, v_t.organizacion_id, v_tipo, v_nombre, v_estado, v_valor, now())
    on conflict (empresa_id, tipo) do update
      set nombre = excluded.nombre, estado = excluded.estado,
          valor_encontrado = excluded.valor_encontrado, comprobado_at = excluded.comprobado_at;
  end loop;

  -- FR-011: verificado = A y TXT correctos, y el CNAME si hay redirección.
  select
    count(*) filter (where tipo = 'A' and estado = 'correcto') = 1
    and count(*) filter (where tipo = 'TXT' and estado = 'correcto') = 1
    and (v_t.dominio_redireccion is null or count(*) filter (where tipo = 'CNAME' and estado = 'correcto') = 1)
    into v_verificado
    from dominio.tienda_registros_dns where empresa_id = p_empresa_id;

  -- FR-012: el certificado solo cuenta con el dominio verificado.
  if not v_verificado then
    v_certificado := 'pendiente';
  end if;

  update dominio.tiendas
     set ultima_verificacion_at = now(),
         dominio_verificado_at = case when v_verificado then coalesce(dominio_verificado_at, now()) end,
         certificado_estado = v_certificado,
         certificado_verificado_at = case when v_certificado = 'activo' then now() end
   where empresa_id = p_empresa_id;

  if v_verificado then
    select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa_id;
    -- FR-014: sin valores de registros.
    perform private.insertar_actividad(
      v_t.organizacion_id, v_t.verificacion_solicitada_por, 'tienda.dominio_verificado',
      format('Verificó el dominio de la tienda de «%s» (certificado: %s)', v_empresa, v_certificado),
      p_empresa_id
    );
  end if;

  perform private.promover_dominio_pendiente(p_empresa_id);
end;
$$;

comment on function public.registrar_verificacion_dns(uuid, jsonb, text) is
  'F-TDA-05: guarda el resultado de la verificación DNS/certificado, calcula si el dominio quedó verificado y promueve el pendiente. SOLO service_role (la ejecuta la Edge Function verificar-dominio-tienda).';

revoke execute on function public.registrar_verificacion_dns(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.registrar_verificacion_dns(uuid, jsonb, text) to service_role;

-- ============================================================================
-- publico.redireccion_por_dominio (FR-013)
-- ============================================================================

-- Lista blanca: solo el dominio principal. Desconocido, host inválido y empresa desactivada devuelven lo mismo.
create or replace function publico.redireccion_por_dominio(host text)
returns table (dominio_principal text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.dominio
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  where t.dominio_redireccion = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.redireccion_por_dominio(text) from public;
grant execute on function publico.redireccion_por_dominio(text) to anon, authenticated;

comment on function publico.redireccion_por_dominio(text) is
  'F-TDA-05: dominio principal al que redirigir si host es el «Redirigir también» de una tienda activa. Vacío para cualquier otro caso (misma respuesta para desconocido y desactivada).';
