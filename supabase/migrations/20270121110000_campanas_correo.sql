-- F-CLI-12 (MSF-370, épica MSF-155, spec 20261028-100000-correo-masivo-a-clientes): tablas del correo masivo.
-- Soporta FR-015 y FR-018.
--
-- Esquema (Principio VII), verificado tabla por tabla — todas son hechos del negocio del producto, por eso `dominio`:
--   dominio.campanas_correo                una campaña: asunto, mensaje, quién la creó y la empresa con la que se armó.
--   dominio.campana_correo_destinatarios   foto de los destinatarios elegibles al crear la campaña, con su estado.
--   dominio.correo_masivo_pruebas          envíos de prueba al autor (FR-014): no son campaña ni cuentan contra el cupo.
--
-- RLS (las tres): por organización. `campanas_correo` y `campana_correo_destinatarios` se leen con la sección
-- `clientes` en lectura o edición; `correo_masivo_pruebas` no se lee desde la API (solo la usa el flow).
-- `authenticated` no tiene `insert`/`update`/`delete`: se escribe solo por las RPC de las migraciones siguientes
-- (`security definer`). `anon` sin acceso. Los hashes de los enlaces de baja (`token_hashes`) quedan fuera del
-- `grant select` por columna: PostgREST no los expone.
--
-- Aditiva. Reversión (migración posterior; exportar antes si se quiere conservar el historial):
--   drop table dominio.correo_masivo_pruebas;
--   drop table dominio.campana_correo_destinatarios;
--   drop table dominio.campanas_correo;

create table dominio.campanas_correo (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Empresa (tienda) con la que se armó el grupo; null = todas.
  empresa_id uuid,
  -- Generada por el navegador al abrir el diálogo: el doble clic no crea dos campañas.
  clave uuid not null,
  asunto text not null check (btrim(asunto) <> '' and char_length(asunto) <= 200 and asunto !~ '[\r\n]'),
  mensaje text not null check (btrim(mensaje) <> '' and char_length(mensaje) <= 10000),
  creada_por uuid references auth.users (id) on delete set null,
  creada_en timestamptz not null default now(),
  unique (organizacion_id, clave),
  unique (id, organizacion_id),
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id)
);

comment on table dominio.campanas_correo is
  'F-CLI-12: una campaña de correo masivo a clientes. Se escribe solo por public.crear_campana_correo.';

create index if not exists campanas_correo_organizacion_idx on dominio.campanas_correo (organizacion_id, creada_en desc);
create index if not exists campanas_correo_empresa_idx on dominio.campanas_correo (empresa_id, organizacion_id);

create table dominio.campana_correo_destinatarios (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  campana_id uuid not null,
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  -- Correo usado: el de la foto al crear; el flow lo refresca con el vigente del cliente al reclamar.
  correo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'fallido', 'omitido')),
  -- Motivo corto y sanitizado de un fallo (nunca el detalle del SMTP).
  error text check (error is null or char_length(error) <= 200),
  -- Hash SHA-256 (hex) de cada enlace de baja generado para este destinatario: uno por reclamo, así el enlace de un
  -- correo que sí salió sigue valiendo aunque el reclamo venza y se repita. El token en claro nunca se guarda.
  token_hashes text[] not null default '{}',
  -- Reclamo con vencimiento (FR-018): mientras no venza, otro lote no lo toma.
  reclamado_hasta timestamptz,
  enviado_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (campana_id, cliente_id),
  foreign key (campana_id, organizacion_id) references dominio.campanas_correo (id, organizacion_id) on delete cascade
);

comment on table dominio.campana_correo_destinatarios is
  'F-CLI-12: foto de los destinatarios de una campaña y su estado de envío. Se escribe solo por RPC (crear, reclamar, cerrar, baja).';

create index if not exists campana_correo_destinatarios_pendientes_idx
  on dominio.campana_correo_destinatarios (organizacion_id, creado_en, id) where estado = 'pendiente';
create index if not exists campana_correo_destinatarios_enviados_idx
  on dominio.campana_correo_destinatarios (organizacion_id, enviado_en) where estado = 'enviado';
create index if not exists campana_correo_destinatarios_cliente_idx on dominio.campana_correo_destinatarios (cliente_id);
create index if not exists campana_correo_destinatarios_campana_idx on dominio.campana_correo_destinatarios (campana_id, organizacion_id);
create index if not exists campana_correo_destinatarios_token_idx on dominio.campana_correo_destinatarios using gin (token_hashes);

create table dominio.correo_masivo_pruebas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  solicitado_por uuid references auth.users (id) on delete set null,
  correo text not null,
  asunto text not null check (btrim(asunto) <> '' and char_length(asunto) <= 200 and asunto !~ '[\r\n]'),
  mensaje text not null check (btrim(mensaje) <> '' and char_length(mensaje) <= 10000),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'fallido')),
  error text check (error is null or char_length(error) <= 200),
  reclamado_hasta timestamptz,
  creada_en timestamptz not null default now()
);

comment on table dominio.correo_masivo_pruebas is
  'F-CLI-12 (FR-014): envíos de prueba del correo masivo al autor. No es campaña ni cuenta contra el cupo diario. Sin acceso desde la API.';

create index if not exists correo_masivo_pruebas_pendientes_idx on dominio.correo_masivo_pruebas (creada_en) where estado = 'pendiente';
create index if not exists correo_masivo_pruebas_autor_idx on dominio.correo_masivo_pruebas (organizacion_id, solicitado_por, creada_en desc);

alter table dominio.campanas_correo enable row level security;
alter table dominio.campana_correo_destinatarios enable row level security;
alter table dominio.correo_masivo_pruebas enable row level security;

create policy campanas_correo_select on dominio.campanas_correo
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
  );

create policy campana_correo_destinatarios_select on dominio.campana_correo_destinatarios
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
  );

revoke all on dominio.campanas_correo from public, anon, authenticated;
revoke all on dominio.campana_correo_destinatarios from public, anon, authenticated;
revoke all on dominio.correo_masivo_pruebas from public, anon, authenticated;

grant select on dominio.campanas_correo to authenticated;
-- Todas las columnas menos `token_hashes` y `reclamado_hasta` (detalle interno del flow).
grant select (id, organizacion_id, campana_id, cliente_id, correo, estado, error, enviado_en, creado_en)
  on dominio.campana_correo_destinatarios to authenticated;
