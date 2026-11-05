-- F-TDA-22 (MSF-289, épica MSF-149, spec 20270125-100000-tienda-seo-legal-y-estados, FR-030 y FR-031):
-- información legal de la tienda pública (razón social, CUIT, dirección y enlaces legales por empresa).
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * `dominio.tienda_legal_enlaces` -> `dominio`: dato del producto Tiendas online atado a una empresa
--     (los enlaces legales del pie de su tienda). No es plataforma genérica.
--   * `publico.legal_por_dominio` -> función de lectura anónima en `publico` (`publico` sigue sin tablas).
--   * `dominio.empresas` (razon_social, cuit, direccion) no se altera: solo se lee.
--
-- RLS por organización: solo `select` a `authenticated` con acceso a Empresas; sin políticas ni privilegios
-- de escritura (D5: el equipo técnico carga los enlaces por SQL/migración, sin pantalla ni RPC). `anon` no
-- recibe privilegios sobre la tabla; solo ejecuta la función de `publico`.
--
-- Migración aditiva. Reversión (migración posterior, no en este PR):
--   drop function publico.legal_por_dominio(text);
--   drop table dominio.tienda_legal_enlaces;

create schema if not exists publico;
revoke all on schema publico from public;
grant usage on schema publico to anon, authenticated;

-- ============================================================================
-- dominio.tienda_legal_enlaces (FR-030)
-- ============================================================================

create table dominio.tienda_legal_enlaces (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  titulo text not null,
  url text not null,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  constraint tienda_legal_enlaces_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint tienda_legal_enlaces_titulo_ck check (btrim(titulo) <> '' and char_length(titulo) <= 80),
  -- Solo https: un `javascript:` o `http:` no entra a la base (el front tampoco lo renderiza).
  constraint tienda_legal_enlaces_url_ck check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 500)
);

comment on table dominio.tienda_legal_enlaces is
  'MSF-289 (F-TDA-22): enlaces legales (título + URL https) del pie de la tienda de una empresa. Los carga el equipo técnico (D5); sin escritura desde la app.';

create index tienda_legal_enlaces_empresa_orden_idx on dominio.tienda_legal_enlaces (empresa_id, orden);
create index tienda_legal_enlaces_organizacion_id_idx on dominio.tienda_legal_enlaces (organizacion_id);

alter table dominio.tienda_legal_enlaces enable row level security;

create policy tienda_legal_enlaces_select on dominio.tienda_legal_enlaces
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.tienda_legal_enlaces from public, anon, authenticated;
grant select on dominio.tienda_legal_enlaces to authenticated;

-- ============================================================================
-- publico.legal_por_dominio (FR-031)
-- ============================================================================

-- Lista blanca: razón social, CUIT, dirección y enlaces (título + URL) por orden. Nunca whatsapp interno,
-- organizacion_id ni otros campos de la empresa. Dominio desconocido, host inválido y empresa desactivada
-- devuelven el mismo null. Campos vacíos salen como null / lista vacía.
create or replace function publico.legal_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'razon_social', nullif(btrim(e.razon_social), ''),
    'cuit', nullif(btrim(e.cuit), ''),
    'direccion', nullif(btrim(e.direccion), ''),
    'enlaces', coalesce((
      select jsonb_agg(jsonb_build_object('titulo', l.titulo, 'url', l.url) order by l.orden, l.titulo, l.id)
        from dominio.tienda_legal_enlaces l
       where l.empresa_id = e.id and l.organizacion_id = e.organizacion_id
    ), '[]'::jsonb)
  )
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  where t.dominio = private.normalizar_host(host) and e.activa;
$$;

comment on function publico.legal_por_dominio(text) is
  'F-TDA-22: datos legales públicos de la tienda del host (razón social, CUIT, dirección y enlaces https por orden). null idéntico para host desconocido o empresa desactivada. Lista blanca.';

revoke execute on function publico.legal_por_dominio(text) from public, anon;
grant execute on function publico.legal_por_dominio(text) to anon, authenticated;
