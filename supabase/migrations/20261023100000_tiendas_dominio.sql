-- MSF-241 · F-TDA-01 (épica MSF-147, spec 20261022-084830-tienda-dominio-e-identidad,
-- FR-001, FR-002, FR-005, FR-006, FR-012): una tienda por empresa, resuelta por dominio.
--
-- Esquemas (Principio VII, re-verificado):
--   * `dominio.tiendas` -> `dominio`: entidad de negocio (la tienda de quien vende y su dominio).
--   * `publico` -> esquema NUEVO que contiene SOLO funciones de lectura anónima (sin tablas).
--     Existe porque la regla del proyecto limita a `anon` a las RPC de acceso de `public`
--     (migración 20261013120001); el acceso público de la tienda vive aparte y no reabre `public`.
--
-- RLS por organización en `dominio.tiendas` (`private.organizacion_id()`); `anon` no recibe
-- ningún privilegio sobre `dominio` ni `public`. No hay política de escritura para `authenticated`:
-- los dominios los configura el equipo técnico (FR-004), sin pantalla ni RPC de alta en esta épica.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop trigger tiendas_registrar_dominio_alta on dominio.tiendas;
--   drop trigger tiendas_registrar_dominio_cambio on dominio.tiendas;
--   drop trigger tiendas_normalizar_dominio on dominio.tiendas;
--   drop function private.registrar_actividad_tienda_dominio();
--   drop function private.normalizar_dominio_tienda();
--   drop function publico.tienda_por_dominio(text);
--   drop table dominio.tiendas;
--   drop function private.normalizar_host(text);
--   drop schema publico;   (solo si F-TDA-02/03/04 tampoco están aplicadas)

-- ============================================================================
-- Esquema `publico` (solo funciones)
-- ============================================================================

create schema if not exists publico;
revoke all on schema publico from public;
grant usage on schema publico to anon, authenticated;

comment on schema publico is
  'Lectura anónima de la tienda online (épica MSF-147). SOLO funciones SECURITY DEFINER de lectura con lista blanca de columnas; nunca tablas. Lo vigila el pgTAP tienda_dominio.';

-- ============================================================================
-- Normalización del host (FR-001, FR-002)
-- ============================================================================

-- Minúsculas, sin espacios, sin puerto y sin punto final (antes y después del puerto: `host.:443`). Devuelve null si queda vacío o excede
-- los 253 caracteres de un nombre DNS válido.
create or replace function private.normalizar_host(p_host text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n = '' or length(n) > 253 then null
    else n
  end
  from (
    select regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(p_host, ''))), '\.+$', ''), ':[0-9]*$', ''), '\.+$', '') as n
  ) as x;
$$;

revoke execute on function private.normalizar_host(text) from public, anon, authenticated;

comment on function private.normalizar_host(text) is
  'MSF-241: normaliza un host (minúsculas, sin puerto ni punto final). Uso interno.';

-- ============================================================================
-- dominio.tiendas (FR-001, FR-006)
-- ============================================================================

create table dominio.tiendas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  dominio text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Máximo una tienda por empresa y un dominio único a nivel plataforma.
  constraint tiendas_empresa_uk unique (empresa_id),
  constraint tiendas_dominio_uk unique (dominio),
  constraint tiendas_dominio_formato check (
    dominio = lower(dominio)
    and length(dominio) <= 253
    and dominio ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  ),
  constraint tiendas_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.tiendas is
  'MSF-241 (F-TDA-01): la tienda online de una empresa y su dominio. Una por empresa, dominio único y normalizado. El dominio lo configura el equipo técnico (sin pantalla ni RPC en esta épica).';
comment on column dominio.tiendas.dominio is
  'Host normalizado (minúsculas, sin puerto ni punto final). Se normaliza por trigger antes de validar el formato.';

create index tiendas_organizacion_id_idx on dominio.tiendas (organizacion_id);

-- Normaliza el dominio antes del check de formato (FR-001) y mantiene updated_at.
create or replace function private.normalizar_dominio_tienda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.dominio := private.normalizar_host(new.dominio);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_dominio_tienda() from public, anon, authenticated;

create trigger tiendas_normalizar_dominio
  before insert or update on dominio.tiendas
  for each row execute function private.normalizar_dominio_tienda();

alter table dominio.tiendas enable row level security;

-- Lectura: solo la organización de la sesión y con acceso a la sección Empresas.
-- Sin políticas de escritura: nadie edita dominios desde la app (FR-004).
create policy tiendas_select on dominio.tiendas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.tiendas from public, anon, authenticated;
grant select on dominio.tiendas to authenticated;

-- ============================================================================
-- Auditoría (FR-012): tienda.dominio_configurado
-- ============================================================================

-- Se registra al crear la tienda o al cambiar su dominio. Actor = sesión (nulo si lo hace el
-- equipo técnico por SQL/migración); empresa y fecha quedan en la fila de actividad. El detalle
-- nombra la empresa, nunca ids ni el valor del dominio (contrato de eventos de la spec).
create or replace function private.registrar_actividad_tienda_dominio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa text;
begin
  select e.nombre into v_empresa from dominio.empresas e where e.id = new.empresa_id;
  perform private.insertar_actividad(
    new.organizacion_id,
    (select auth.uid()),
    'tienda.dominio_configurado',
    case tg_op
      when 'INSERT' then format('Configuró el dominio de la tienda de «%s»', v_empresa)
      else format('Cambió el dominio de la tienda de «%s»', v_empresa)
    end,
    new.empresa_id
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_tienda_dominio() from public, anon, authenticated;

create trigger tiendas_registrar_dominio_alta
  after insert on dominio.tiendas
  for each row execute function private.registrar_actividad_tienda_dominio();

create trigger tiendas_registrar_dominio_cambio
  after update of dominio on dominio.tiendas
  for each row
  when (old.dominio is distinct from new.dominio)
  execute function private.registrar_actividad_tienda_dominio();

-- ============================================================================
-- publico.tienda_por_dominio (FR-002, FR-003, FR-005)
-- ============================================================================

-- Resuelve la tienda por el host crudo de la petición. Devuelve SOLO datos públicos: id público
-- de la tienda, nombre comercial de la empresa y estado. Dominio desconocido, host inválido y
-- empresa desactivada devuelven lo mismo (cero filas): no se revela si el dominio existe.
create or replace function publico.tienda_por_dominio(host text)
returns table (tienda_id uuid, empresa_nombre text, estado text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, e.nombre, 'publicada'::text
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  where t.dominio = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.tienda_por_dominio(text) from public;
grant execute on function publico.tienda_por_dominio(text) to anon, authenticated;

comment on function publico.tienda_por_dominio(text) is
  'MSF-241: tienda pública por host. Solo tienda_id, empresa_nombre y estado; vacío si el dominio no existe o la empresa está desactivada (misma respuesta).';
