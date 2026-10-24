-- MSF-319 · F-NOT-01 (FR-001): catálogo de tipos de aviso por correo.
-- Esquema `public` (Principio VII): catálogo transversal de plataforma; cada componente
-- registra sus tipos. Esta migración registra `consulta_nueva`.
-- Los avisos de seguridad (invitación, recuperación) NO son tipos: salen por Supabase Auth.
--
-- Reversión (migración posterior): drop table public.tipos_aviso cascade;
-- (solo después de revertir 20261024120100…120600, que dependen de ella).

create table public.tipos_aviso (
  clave text primary key check (clave ~ '^[a-z][a-z0-9_]*$'),
  nombre text not null check (btrim(nombre) <> ''),
  -- Sección de permisos (private.nivel_seccion) que habilita el tipo.
  seccion text not null check (btrim(seccion) <> ''),
  created_at timestamptz not null default now()
);

comment on table public.tipos_aviso is
  'Catálogo de tipos de aviso por correo (plataforma, esquema public). Lectura para authenticated; sin escritura desde la app: cada componente registra sus tipos por migración.';

alter table public.tipos_aviso enable row level security;

create policy tipos_aviso_select on public.tipos_aviso
  for select to authenticated
  using (true);

revoke all on public.tipos_aviso from public, anon;
grant select on public.tipos_aviso to authenticated;

insert into public.tipos_aviso (clave, nombre, seccion) values
  ('consulta_nueva', 'Consulta nueva', 'consultas');
