-- MSF-306 · F-TDA-23 (épica MSF-164, spec 20270210-100000-tienda-contenido-y-analitica,
-- FR-001…FR-003, FR-008): páginas de contenido de la tienda.
--
-- Esquemas (Principio VII, re-verificado):
--   * `dominio.tienda_paginas` -> `dominio`: dato del producto Tiendas online atado a una empresa.
--   * `publico.paginas_por_dominio` / `publico.pagina_por_dominio` -> funciones de lectura anónima
--     en `publico` (sin tablas nuevas).
--   * `public.guardar_pagina_tienda` / `public.eliminar_pagina_tienda` -> RPC de la app (authenticated).
--
-- Texto plano: se guarda literal (sin sanear ni interpretar HTML); el front lo escapa siempre.
-- RLS por organización: lectura con acceso a Empresas; sin políticas de escritura (la única vía es la
-- RPC, SECURITY DEFINER con permisos y organización verificados). `anon` no recibe privilegios sobre la
-- tabla; solo ejecuta las funciones de `publico`.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop function publico.pagina_por_dominio(text, text);
--   drop function publico.paginas_por_dominio(text);
--   drop function public.eliminar_pagina_tienda(uuid, uuid);
--   drop function public.guardar_pagina_tienda(uuid, uuid, text, text, boolean);
--   drop trigger tienda_paginas_normalizar on dominio.tienda_paginas;
--   drop function private.normalizar_tienda_pagina();
--   drop function private.slug_pagina_tienda(text);
--   drop table dominio.tienda_paginas;

create schema if not exists publico;
revoke all on schema publico from public;
grant usage on schema publico to anon, authenticated;

-- ============================================================================
-- dominio.tienda_paginas (FR-001)
-- ============================================================================

create table dominio.tienda_paginas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  titulo text not null,
  slug text not null,
  contenido text not null default '',
  visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tienda_paginas_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint tienda_paginas_slug_unico unique (empresa_id, slug),
  constraint tienda_paginas_titulo_largo check (char_length(titulo) between 1 and 80),
  constraint tienda_paginas_slug_largo check (char_length(slug) between 1 and 80),
  constraint tienda_paginas_slug_formato check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint tienda_paginas_contenido_largo check (char_length(contenido) <= 10000)
);

comment on table dominio.tienda_paginas is
  'MSF-306 (F-TDA-23): páginas de texto plano de la tienda de una empresa. Oculta por defecto. Se escribe solo con public.guardar_pagina_tienda / eliminar_pagina_tienda.';
comment on column dominio.tienda_paginas.slug is
  'Dirección legible (/pagina/<slug>), única por empresa; se genera del título al crear y no cambia después.';

create index tienda_paginas_organizacion_id_idx on dominio.tienda_paginas (organizacion_id);
create index tienda_paginas_empresa_titulo_idx on dominio.tienda_paginas (empresa_id, lower(titulo), slug);

-- Mantiene updated_at.
create or replace function private.normalizar_tienda_pagina()
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

revoke execute on function private.normalizar_tienda_pagina() from public, anon, authenticated;

create trigger tienda_paginas_normalizar
  before insert or update on dominio.tienda_paginas
  for each row execute function private.normalizar_tienda_pagina();

alter table dominio.tienda_paginas enable row level security;

create policy tienda_paginas_select on dominio.tienda_paginas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.tienda_paginas from public, anon, authenticated;
grant select on dominio.tienda_paginas to authenticated;

-- ============================================================================
-- private.slug_pagina_tienda: título -> slug (sin tildes, minúsculas, guiones)
-- ============================================================================

create or replace function private.slug_pagina_tienda(p_titulo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      left(
        btrim(
          regexp_replace(
            translate(lower(coalesce(p_titulo, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
            '[^a-z0-9]+', '-', 'g'
          ),
          '-'
        ),
        70
      ),
      ''
    ),
    'pagina'
  );
$$;

revoke execute on function private.slug_pagina_tienda(text) from public, anon, authenticated;

-- ============================================================================
-- public.guardar_pagina_tienda (FR-002)
-- ============================================================================

-- `p_pagina_id` null crea (visible por defecto false); si no, edita (el slug no cambia). Con `p_visible`
-- null al editar se conserva el valor actual. Un error no guarda nada y su `hint` nombra el campo.
create or replace function public.guardar_pagina_tienda(
  p_empresa_id uuid,
  p_pagina_id uuid,
  p_titulo text,
  p_contenido text,
  p_visible boolean
)
returns dominio.tienda_paginas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_contenido text := btrim(coalesce(p_contenido, ''));
  v_base text;
  v_slug text;
  v_n int := 1;
  v_fila dominio.tienda_paginas;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar las páginas de la tienda' using errcode = '42501';
  end if;

  perform 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe o no pertenece a tu organización' using errcode = '42501';
  end if;

  if v_titulo = '' then
    raise exception 'El título es obligatorio' using errcode = '22023', hint = 'titulo';
  end if;
  if char_length(v_titulo) > 80 then
    raise exception 'El título no puede superar los 80 caracteres' using errcode = '22023', hint = 'titulo';
  end if;
  if char_length(v_contenido) > 10000 then
    raise exception 'El contenido no puede superar los 10000 caracteres' using errcode = '22023', hint = 'contenido';
  end if;

  if p_pagina_id is null then
    -- Serializa las altas de la misma empresa: el slug elegido no choca con otra alta simultánea.
    perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text, 0));
    v_base := private.slug_pagina_tienda(v_titulo);
    v_slug := v_base;
    while exists (select 1 from dominio.tienda_paginas p where p.empresa_id = p_empresa_id and p.slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;
    insert into dominio.tienda_paginas (organizacion_id, empresa_id, titulo, slug, contenido, visible)
    values (v_org, p_empresa_id, v_titulo, v_slug, v_contenido, coalesce(p_visible, false))
    returning * into v_fila;
  else
    update dominio.tienda_paginas p
       set titulo = v_titulo,
           contenido = v_contenido,
           visible = coalesce(p_visible, p.visible)
     where p.id = p_pagina_id and p.empresa_id = p_empresa_id and p.organizacion_id = v_org
    returning * into v_fila;
    if not found then
      raise exception 'La página no existe' using errcode = '22023', hint = 'pagina';
    end if;
  end if;
  return v_fila;
end;
$$;

comment on function public.guardar_pagina_tienda(uuid, uuid, text, text, boolean) is
  'MSF-306: crea (pagina null) o edita una página de la tienda. Solo con edición en Empresas; valida organización y límites (hint = campo); el slug se genera al crear y no cambia.';

revoke execute on function public.guardar_pagina_tienda(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.guardar_pagina_tienda(uuid, uuid, text, text, boolean) to authenticated;

-- ============================================================================
-- public.eliminar_pagina_tienda (FR-002)
-- ============================================================================

create or replace function public.eliminar_pagina_tienda(p_empresa_id uuid, p_pagina_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar las páginas de la tienda' using errcode = '42501';
  end if;

  perform 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe o no pertenece a tu organización' using errcode = '42501';
  end if;

  delete from dominio.tienda_paginas p
   where p.id = p_pagina_id and p.empresa_id = p_empresa_id and p.organizacion_id = v_org;
  if not found then
    raise exception 'La página no existe' using errcode = '22023', hint = 'pagina';
  end if;
end;
$$;

comment on function public.eliminar_pagina_tienda(uuid, uuid) is
  'MSF-306: elimina una página de la tienda. Solo con edición en Empresas y empresa de la organización.';

revoke execute on function public.eliminar_pagina_tienda(uuid, uuid) from public, anon;
grant execute on function public.eliminar_pagina_tienda(uuid, uuid) to authenticated;

-- ============================================================================
-- publico.paginas_por_dominio / publico.pagina_por_dominio (FR-003)
-- ============================================================================

-- Lista blanca: solo título y slug de las páginas visibles. `null` idéntico para host desconocido,
-- inválido o empresa desactivada.
create or replace function publico.paginas_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'paginas',
    coalesce(
      (select jsonb_agg(jsonb_build_object('titulo', p.titulo, 'slug', p.slug) order by lower(p.titulo), p.slug)
         from dominio.tienda_paginas p
        where p.empresa_id = t.empresa_id and p.visible),
      '[]'::jsonb
    )
  )
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  where t.dominio = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.paginas_por_dominio(text) from public, anon;
grant execute on function publico.paginas_por_dominio(text) to anon, authenticated;

comment on function publico.paginas_por_dominio(text) is
  'MSF-306: páginas visibles (titulo, slug) de la tienda del host. null si el host no existe o la empresa está desactivada.';

-- `null` idéntico: host desconocido, empresa desactivada, slug inexistente, oculto o de otra empresa.
create or replace function publico.pagina_por_dominio(host text, slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('titulo', p.titulo, 'slug', p.slug, 'contenido', p.contenido)
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  join dominio.tienda_paginas p on p.empresa_id = t.empresa_id and p.visible and p.slug = pagina_por_dominio.slug
  where t.dominio = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.pagina_por_dominio(text, text) from public, anon;
grant execute on function publico.pagina_por_dominio(text, text) to anon, authenticated;

comment on function publico.pagina_por_dominio(text, text) is
  'MSF-306: una página visible (titulo, slug, contenido) de la tienda del host. null idéntico si no existe, está oculta o es de otra empresa.';
