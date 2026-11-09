-- MSF-315 · F-TDA-24 (épica MSF-164, spec 20270210-100000-tienda-contenido-y-analitica,
-- FR-010…FR-012, FR-017): analítica de visitas de la tienda (Google Analytics 4 y Meta Pixel).
--
-- Esquemas (Principio VII, re-verificado):
--   * `dominio.tienda_analitica` -> `dominio`: dato del producto Tiendas online atado a una empresa
--     (los identificadores de medición de ESA tienda).
--   * `publico.analitica_por_dominio` -> función de lectura anónima en `publico` (sin tablas nuevas).
--   * `public.guardar_analitica_tienda` -> RPC de la app (authenticated).
--
-- Lo que se guarda son identificadores públicos de medición (G-XXXXXXXXXX y el ID numérico del píxel): solo
-- dicen a dónde enviar las visitas, no son secretos. Se validan por formato en la base (la fuente de verdad) y
-- el front los pasa SIEMPRE como datos al cargar los scripts: nunca se arma código con ellos.
--
-- RLS por organización: lectura con acceso a Empresas; sin políticas de escritura (la única vía es la RPC,
-- SECURITY DEFINER con permisos y organización verificados). `anon` no recibe privilegios sobre la tabla; solo
-- ejecuta la función de `publico`.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop function publico.analitica_por_dominio(text);
--   drop function public.guardar_analitica_tienda(uuid, text, text);
--   drop trigger tienda_analitica_normalizar on dominio.tienda_analitica;
--   drop function private.normalizar_tienda_analitica();
--   drop table dominio.tienda_analitica;

create schema if not exists publico;
revoke all on schema publico from public;
grant usage on schema publico to anon, authenticated;

-- ============================================================================
-- dominio.tienda_analitica (FR-010)
-- ============================================================================

create table if not exists dominio.tienda_analitica (
  empresa_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  ga4_id text,
  meta_pixel_id text,
  updated_at timestamptz not null default now(),
  constraint tienda_analitica_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint tienda_analitica_ga4_formato check (ga4_id is null or ga4_id ~ '^G-[A-Z0-9]{4,20}$'),
  constraint tienda_analitica_pixel_formato check (meta_pixel_id is null or meta_pixel_id ~ '^[0-9]{8,20}$')
);

comment on table dominio.tienda_analitica is
  'MSF-315 (F-TDA-24): identificadores de medición de la tienda de una empresa (GA4 y Meta Pixel). Se escribe solo con public.guardar_analitica_tienda. Son identificadores públicos, no secretos.';
comment on column dominio.tienda_analitica.ga4_id is 'ID de medición de Google Analytics 4 (G-XXXXXXXXXX) o null.';
comment on column dominio.tienda_analitica.meta_pixel_id is 'ID del píxel de Meta (solo dígitos) o null.';

create index if not exists tienda_analitica_organizacion_id_idx on dominio.tienda_analitica (organizacion_id);

-- Mantiene updated_at.
create or replace function private.normalizar_tienda_analitica()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_tienda_analitica() from public, anon, authenticated;

create trigger tienda_analitica_normalizar
  before insert or update on dominio.tienda_analitica
  for each row execute function private.normalizar_tienda_analitica();

alter table dominio.tienda_analitica enable row level security;

create policy tienda_analitica_select on dominio.tienda_analitica
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.tienda_analitica from public, anon, authenticated;
grant select on dominio.tienda_analitica to authenticated;

-- ============================================================================
-- public.guardar_analitica_tienda (FR-011)
-- ============================================================================

-- Recorta espacios, pasa a mayúsculas el ID de GA4 y trata el vacío como «quitar la herramienta» (null). Un
-- formato inválido no guarda nada y su `hint` nombra el campo (`ga4_id` o `meta_pixel_id`).
create or replace function public.guardar_analitica_tienda(
  p_empresa_id uuid,
  p_ga4_id text,
  p_meta_pixel_id text
)
returns dominio.tienda_analitica
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_ga4 text := nullif(upper(btrim(coalesce(p_ga4_id, ''))), '');
  v_pixel text := nullif(btrim(coalesce(p_meta_pixel_id, '')), '');
  v_fila dominio.tienda_analitica;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la analítica de la tienda' using errcode = '42501';
  end if;

  perform 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe o no pertenece a tu organización' using errcode = '42501';
  end if;

  if v_ga4 is not null and v_ga4 !~ '^G-[A-Z0-9]{4,20}$' then
    raise exception 'El ID de Google Analytics 4 tiene un formato inválido (ejemplo: G-XXXXXXXXXX)'
      using errcode = '22023', hint = 'ga4_id';
  end if;
  if v_pixel is not null and v_pixel !~ '^[0-9]{8,20}$' then
    raise exception 'El ID de Meta Pixel tiene un formato inválido (solo números, de 8 a 20 dígitos)'
      using errcode = '22023', hint = 'meta_pixel_id';
  end if;

  insert into dominio.tienda_analitica (empresa_id, organizacion_id, ga4_id, meta_pixel_id)
  values (p_empresa_id, v_org, v_ga4, v_pixel)
  on conflict (empresa_id) do update
    set ga4_id = excluded.ga4_id,
        meta_pixel_id = excluded.meta_pixel_id
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.guardar_analitica_tienda(uuid, text, text) is
  'MSF-315: guarda (o quita, con vacío) los IDs de GA4 y Meta Pixel de una tienda. Solo con edición en Empresas y empresa de la organización; valida formato (hint = campo).';

revoke execute on function public.guardar_analitica_tienda(uuid, text, text) from public, anon;
grant execute on function public.guardar_analitica_tienda(uuid, text, text) to authenticated;

-- ============================================================================
-- publico.analitica_por_dominio (FR-012, FR-017)
-- ============================================================================

-- Lista blanca: solo los dos IDs (nunca `organizacion_id`). `null` idéntico para host desconocido, inválido o
-- empresa desactivada. Una empresa activa sin analítica cargada devuelve ambos IDs en null.
create or replace function publico.analitica_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ga4_id', a.ga4_id, 'meta_pixel_id', a.meta_pixel_id)
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  left join dominio.tienda_analitica a on a.empresa_id = t.empresa_id and a.organizacion_id = t.organizacion_id
  where t.dominio = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.analitica_por_dominio(text) from public, anon;
grant execute on function publico.analitica_por_dominio(text) to anon, authenticated;

comment on function publico.analitica_por_dominio(text) is
  'MSF-315: IDs de medición (ga4_id, meta_pixel_id) de la tienda del host. null si el host no existe o la empresa está desactivada.';
