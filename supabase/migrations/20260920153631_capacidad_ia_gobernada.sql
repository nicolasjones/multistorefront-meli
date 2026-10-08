-- Capacidad de IA gobernada (spec 016). Migración aditiva.
-- Reversión: revocar grants/RPCs, retirar policies y eliminar tablas en orden
-- inverso sólo después de purgar evidencias y exportar auditoría necesaria.

create table public.ia_proveedores (
  id uuid primary key default extensions.gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z0-9-]+$'),
  nombre text not null,
  adaptador text not null,
  habilitado boolean not null default false,
  retencion_verificada_en timestamptz,
  retencion_verifica_hasta timestamptz,
  evidencia_retencion_url text,
  verificado_por uuid references auth.users(id) on delete set null,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((habilitado = false) or (retencion_verificada_en is not null and retencion_verifica_hasta > now() and evidencia_retencion_url is not null and verificado_por is not null))
);

create table public.ia_credenciales_proveedor (
  id uuid primary key default extensions.gen_random_uuid(),
  proveedor_id uuid not null references public.ia_proveedores(id) on delete restrict,
  nombre text not null,
  vault_secret_id uuid not null,
  activa boolean not null default true,
  configurada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proveedor_id, nombre)
);

create table public.ia_modelos_descubiertos (
  id uuid primary key default extensions.gen_random_uuid(),
  credencial_id uuid not null references public.ia_credenciales_proveedor(id) on delete cascade,
  modelo_id text not null,
  capacidades jsonb not null default '{}'::jsonb,
  activo boolean not null default true,
  descubierto_en timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (credencial_id, modelo_id)
);

create table public.ia_perfiles_modelo (
  id uuid primary key default extensions.gen_random_uuid(),
  credencial_id uuid not null references public.ia_credenciales_proveedor(id) on delete restrict,
  modelo_id text not null,
  nombre text not null,
  activo boolean not null default true,
  configurado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (credencial_id, modelo_id)
);

create table public.ia_contratos_consumidor (
  id uuid primary key default extensions.gen_random_uuid(),
  codigo text not null,
  version integer not null check (version > 0),
  consumidor_codigo text not null,
  esquema_entrada jsonb not null,
  esquema_salida jsonb not null,
  clasificacion_datos jsonb not null default '{}'::jsonb,
  acciones_permitidas jsonb not null default '[]'::jsonb,
  verificadores jsonb not null default '[]'::jsonb,
  estado text not null check (estado in ('borrador','aprobado','retirado')),
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (codigo, version)
);

create table public.ia_politicas (
  id uuid primary key default extensions.gen_random_uuid(),
  codigo text not null,
  version integer not null check (version > 0),
  contrato_id uuid not null references public.ia_contratos_consumidor(id) on delete restrict,
  perfil_principal_id uuid not null references public.ia_perfiles_modelo(id) on delete restrict,
  perfil_fallback_id uuid references public.ia_perfiles_modelo(id) on delete restrict,
  limite_intentos smallint not null check (limite_intentos between 1 and 2),
  limite_segundos integer not null check (limite_segundos between 1 and 90),
  estado text not null check (estado in ('borrador','aprobada','retirada')),
  aprobada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (codigo, version)
);
create unique index ia_politicas_aprobada_por_contrato_idx on public.ia_politicas(contrato_id) where estado = 'aprobada';

create table public.ia_interacciones (
  id uuid primary key default extensions.gen_random_uuid(),
  consumidor_codigo text not null,
  actor_id uuid references auth.users(id) on delete set null,
  origen text not null check (origen in ('aplicacion','worker','kestra')),
  idempotency_key text not null,
  ejecucion_id uuid,
  politica_id uuid not null references public.ia_politicas(id) on delete restrict,
  politica_version integer not null,
  perfil_principal_id uuid not null references public.ia_perfiles_modelo(id),
  perfil_fallback_id uuid references public.ia_perfiles_modelo(id),
  perfil_efectivo_id uuid references public.ia_perfiles_modelo(id),
  estado text not null check (estado in ('iniciada','preparando','invocando','respuesta_validada','completada','rechazada','fallida_tecnica','revision_humana','cancelada')),
  intentos smallint not null default 0 check (intentos between 0 and 2),
  iniciada_en timestamptz not null default now(),
  vence_en timestamptz not null,
  finalizada_en timestamptz,
  resultado_sanitizado jsonb,
  error_sanitizado text,
  evidencia_path text,
  purga_pendiente_en timestamptz not null,
  created_at timestamptz not null default now(),
  unique (consumidor_codigo, idempotency_key)
);
create index ia_interacciones_estado_idx on public.ia_interacciones(estado, created_at desc);
create index ia_interacciones_purga_idx on public.ia_interacciones(purga_pendiente_en) where evidencia_path is not null;

create table public.ia_eventos_interaccion (
  id uuid primary key default extensions.gen_random_uuid(),
  interaccion_id uuid not null references public.ia_interacciones(id) on delete cascade,
  secuencia integer not null check (secuencia > 0),
  tipo text not null,
  detalle_sanitizado jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (interaccion_id, secuencia)
);

insert into storage.buckets (id, name, public) values ('ia-evidencias', 'ia-evidencias', false)
on conflict (id) do nothing;

alter table public.ia_proveedores enable row level security;
alter table public.ia_credenciales_proveedor enable row level security;
alter table public.ia_modelos_descubiertos enable row level security;
alter table public.ia_perfiles_modelo enable row level security;
alter table public.ia_contratos_consumidor enable row level security;
alter table public.ia_politicas enable row level security;
alter table public.ia_interacciones enable row level security;
alter table public.ia_eventos_interaccion enable row level security;

create policy ia_proveedores_superadmin on public.ia_proveedores for select to authenticated using ((select private.is_superadmin()));
create policy ia_credenciales_proveedor_superadmin on public.ia_credenciales_proveedor for select to authenticated using ((select private.is_superadmin()));
create policy ia_modelos_descubiertos_superadmin on public.ia_modelos_descubiertos for select to authenticated using ((select private.is_superadmin()));
create policy ia_perfiles_modelo_superadmin on public.ia_perfiles_modelo for select to authenticated using ((select private.is_superadmin()));
create policy ia_contratos_consumidor_superadmin on public.ia_contratos_consumidor for select to authenticated using ((select private.is_superadmin()));
create policy ia_politicas_superadmin on public.ia_politicas for select to authenticated using ((select private.is_superadmin()));
create policy ia_interacciones_superadmin on public.ia_interacciones for select to authenticated using ((select private.is_superadmin()));
create policy ia_eventos_interaccion_superadmin on public.ia_eventos_interaccion for select to authenticated using ((select private.is_superadmin()));

revoke all on public.ia_proveedores, public.ia_credenciales_proveedor, public.ia_modelos_descubiertos, public.ia_perfiles_modelo, public.ia_contratos_consumidor, public.ia_politicas, public.ia_interacciones, public.ia_eventos_interaccion from anon, authenticated;
grant select on public.ia_proveedores, public.ia_modelos_descubiertos, public.ia_perfiles_modelo, public.ia_contratos_consumidor, public.ia_politicas, public.ia_interacciones, public.ia_eventos_interaccion to authenticated;
grant select (id, proveedor_id, nombre, activa, configurada_por, created_at, updated_at) on public.ia_credenciales_proveedor to authenticated;

create policy ia_evidencias_superadmin_select on storage.objects for select to authenticated using (bucket_id = 'ia-evidencias' and (select private.is_superadmin()));
