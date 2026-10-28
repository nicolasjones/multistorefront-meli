-- F-SVC-14 (MSF-424, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-020): historial de avisos por
-- correo al cliente por cambio de estado de una reparación.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.reparacion_avisos  dominio  aviso al cliente de una reparación: entidad de negocio del producto Service.
-- RLS por organización, nivel `service_tecnico` (lectura o edición) y tienda accesible (`private.empresas_accesibles()`).
-- Sin políticas ni grants de escritura para `authenticated`: se escribe solo por `public.avisar_cliente_reparacion`
-- (20270115020200) y por `private.cerrar_aviso_reparacion` (20270115020400). Sin `delete`. `anon` sin privilegios.
-- `authenticated` lee solo columnas sin el correo del cliente ni la ejecución: el historial completo sale por
-- `public.avisos_de_reparacion` (20270115020300), que valida permiso y tienda.
--
-- Migración aditiva. Reversión (migración posterior, después de revertir las funciones de 20270115020200 a 400):
--   drop table dominio.reparacion_avisos;

create table dominio.reparacion_avisos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Tienda de la reparación (copia): permite filtrar por tienda accesible sin unir.
  empresa_id uuid not null,
  reparacion_id uuid not null,
  estado_id uuid not null,
  -- Copia del nombre del estado avisado: si luego se renombra, el historial conserva lo que se avisó.
  estado_nombre text not null check (btrim(estado_nombre) <> '' and length(estado_nombre) <= 80),
  -- Correo del cliente al momento de pedir el aviso (foto).
  destinatario text not null check (length(destinatario) between 3 and 320),
  estado_envio text not null default 'pendiente' check (estado_envio in ('pendiente', 'enviado', 'fallido')),
  -- Ciclos de envío cerrados por el flow (el reintento del SMTP ocurre dentro del flow).
  intentos integer not null default 0 check (intentos >= 0),
  -- Motivo corto y sanitizado: nunca el detalle técnico del SMTP.
  error text check (error is null or length(error) <= 500),
  solicitado_por uuid references auth.users (id) on delete set null,
  solicitado_en timestamptz not null default now(),
  enviado_en timestamptz,
  -- Ejecución del ciclo de workers que despacha el flow; sin FK para no atar el aviso a su vida.
  ejecucion_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id),
  foreign key (reparacion_id, organizacion_id) references dominio.reparaciones (id, organizacion_id),
  foreign key (estado_id, organizacion_id) references dominio.estados_reparacion (id, organizacion_id),
  constraint reparacion_avisos_enviado_ck check (
    (estado_envio = 'enviado' and enviado_en is not null and error is null)
    or (estado_envio <> 'enviado' and enviado_en is null)
  )
);

comment on table dominio.reparacion_avisos is
  'F-SVC-14: aviso por correo al cliente por el estado de una reparación (destinatario, resultado, quién y cuándo). Se escribe solo por RPC y por la función del flow de Kestra.';
comment on column dominio.reparacion_avisos.error is
  'Motivo fijo y corto del fallo; el detalle técnico del SMTP no se guarda ni se muestra.';

-- Un solo aviso pendiente por reparación y estado: el doble clic es un solo aviso (FR-021).
create unique index if not exists reparacion_avisos_pendiente_uq
  on dominio.reparacion_avisos (reparacion_id, estado_id)
  where estado_envio = 'pendiente';

create index if not exists reparacion_avisos_reparacion_idx
  on dominio.reparacion_avisos (organizacion_id, reparacion_id, solicitado_en desc);
create index if not exists reparacion_avisos_empresa_idx
  on dominio.reparacion_avisos (empresa_id, organizacion_id);
create index if not exists reparacion_avisos_estado_idx
  on dominio.reparacion_avisos (estado_id, organizacion_id);

create index if not exists reparacion_avisos_solicitado_por_idx
  on dominio.reparacion_avisos (solicitado_por);

alter table dominio.reparacion_avisos enable row level security;

create policy reparacion_avisos_select on dominio.reparacion_avisos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
    and exists (select 1 from private.empresas_accesibles() a(id) where a.id = reparacion_avisos.empresa_id)
  );

revoke all on dominio.reparacion_avisos from public, anon, authenticated;
grant select (
  id, organizacion_id, empresa_id, reparacion_id, estado_id, estado_nombre, estado_envio, intentos,
  error, solicitado_en, enviado_en
) on dominio.reparacion_avisos to authenticated;
