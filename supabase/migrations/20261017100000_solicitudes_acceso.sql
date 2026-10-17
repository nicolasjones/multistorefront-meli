-- MSF-302 · F-ROL-05 (épica MSF-148, spec 20261016-130000-perfil-y-permisos-avanzados,
-- FR-007, FR-009): registro de los pedidos de acceso a una sección.
--
-- Esquema (Principio VII): `public.solicitudes_acceso` vive en `public`
-- (plataforma: ciclo de vida de acceso/permisos de una persona en la
-- organización, igual que `eventos_membresia`; no es una entidad de negocio
-- del producto). No se crea ninguna tabla en `dominio`.
--
-- RLS por organización: el solicitante ve sus filas y los administradores de
-- la organización ven las de su organización. Sin policies de escritura:
-- solo se agrega con `public.solicitar_acceso` (migración siguiente). Nada
-- para `anon`. `correo_enviado_en` lo actualiza la Edge Function con la
-- service-role (que no pasa por RLS).
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   drop function public.solicitar_acceso(text);
--   drop table public.solicitudes_acceso;   (pierde los pedidos: exportarlos antes)

create table public.solicitudes_acceso (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  seccion text not null check (btrim(seccion) <> '' and length(seccion) <= 60),
  dia date not null default current_date,
  creada_en timestamptz not null default now(),
  correo_enviado_en timestamptz,
  constraint solicitudes_acceso_unica_por_dia unique (organizacion_id, usuario_id, seccion, dia)
);

comment on table public.solicitudes_acceso is
  'Pedidos de acceso a una sección (F-ROL-05): uno por persona, sección y día. Se escribe solo con solicitar_acceso.';
comment on column public.solicitudes_acceso.correo_enviado_en is
  'Cuándo salió el aviso por correo a los administradores; null = pendiente de envío (permite reintentar).';

create index solicitudes_acceso_org_dia_idx on public.solicitudes_acceso (organizacion_id, dia desc);

alter table public.solicitudes_acceso enable row level security;

create policy solicitudes_acceso_select on public.solicitudes_acceso
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (
      usuario_id = (select auth.uid())
      or (select private.es_administrador_de(organizacion_id))
    )
  );

revoke all on public.solicitudes_acceso from public, anon, authenticated;
grant select on public.solicitudes_acceso to authenticated;
