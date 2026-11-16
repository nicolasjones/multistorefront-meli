-- Renumerada al integrar la base `dokploy` (máxima `20270203120000`): antes `20270115120000_proveedores_contactos.sql`;
-- la versión vieja quedó bajo la cola aplicada y el aplicador la salteaba.
--
-- F-PRV-08 (MSF-449, épica MSF-445): varios contactos por proveedor.
-- Esquema (Principio VII): `dominio.proveedores_contactos` es parte de la entidad de negocio
-- «proveedor» (a quién llamar), no de la plataforma → `dominio`, nunca `public`.
--
-- A lo sumo un contacto principal por proveedor, garantizado por la base con un índice único
-- parcial (FR-021). Lectura con lectura/edición de la sección `proveedores`; la escritura es
-- solo por RPC (migración siguiente): sin grants de INSERT/UPDATE/DELETE y sin política DELETE.
-- `anon` sin acceso.
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los datos):
--   drop table dominio.proveedores_contactos;

create table if not exists dominio.proveedores_contactos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  proveedor_id uuid not null,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 200),
  rol text check (length(rol) <= 100),
  correo text check (length(correo) <= 254),
  telefono text check (length(telefono) <= 50),
  principal boolean not null default false,
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK compuesta: no se puede colgar un contacto de un proveedor de otra organización.
  foreign key (proveedor_id, organizacion_id)
    references dominio.proveedores (id, organizacion_id) on delete restrict
);

comment on table dominio.proveedores_contactos is
  'Personas de contacto de un proveedor (F-PRV-08). Escritura solo por RPC; sin DELETE.';
comment on column dominio.proveedores_contactos.principal is
  'A lo sumo uno por proveedor (índice único parcial). Alimenta persona de contacto, correo y teléfono de la ficha.';

create index if not exists proveedores_contactos_org_proveedor_idx
  on dominio.proveedores_contactos (organizacion_id, proveedor_id);

create unique index if not exists proveedores_contactos_un_principal_idx
  on dominio.proveedores_contactos (proveedor_id)
  where principal;

alter table dominio.proveedores_contactos enable row level security;

create policy proveedores_contactos_select on dominio.proveedores_contactos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('proveedores')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.proveedores_contactos from public, anon, authenticated;
grant select on dominio.proveedores_contactos to authenticated;
