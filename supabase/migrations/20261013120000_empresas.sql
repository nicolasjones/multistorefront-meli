-- Empresas (spec 20261012-140000-empresas, F-EMP-01, FR-001/FR-002).
-- Entidad de negocio (quién vende) -> esquema `dominio` (Principio VII).
-- N empresas por organización: sin unique ni check que limite la cantidad.
-- Migración aditiva. Reversión documentada en plan.md / docs/empresas.md:
--   drop table dominio.empresas;   (en una migración posterior, no en este PR)
create table dominio.empresas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> ''),
  whatsapp text,
  correo text,
  instagram text,
  direccion text,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index empresas_organizacion_id_idx on dominio.empresas (organizacion_id);

alter table dominio.empresas enable row level security;

-- Lectura: toda la organización resuelta por private.organizacion_id().
-- Escritura: solo quien private.puede_escribir(), en using y with check.
-- Sin política insert/delete: crear empresas es F-EMP-03 (Etapa 2).
create policy empresas_select on dominio.empresas
  for select to authenticated
  using (organizacion_id = private.organizacion_id());

create policy empresas_update on dominio.empresas
  for update to authenticated
  using (organizacion_id = private.organizacion_id() and private.puede_escribir())
  with check (organizacion_id = private.organizacion_id() and private.puede_escribir());

grant usage on schema dominio to authenticated;
grant select, update on dominio.empresas to authenticated;
