-- F-SVC-22 (MSF-157, épica MSF-124): `dominio.reparacion_enlaces_consulta`, el enlace de seguimiento de una reparación.
-- Esquema (Principio VII): dato de negocio del taller → `dominio`, nunca `public`.
--
-- Seguridad: el token es un secreto. RLS habilitada SIN políticas y SIN grants para `authenticated`/`anon`:
-- solo lo tocan las funciones `security definer` (`obtener_enlace_consulta`, `private.estado_publico_reparacion`).
-- FK compuesta `(reparacion_id, organizacion_id)`: un enlace no apunta a una reparación ajena.
-- `reparacion_id` único (un token por reparación) y `token` único.
--
-- Migración aditiva. Reversión (migración posterior; los enlaces ya compartidos dejan de funcionar):
--   drop table dominio.reparacion_enlaces_consulta;

create table dominio.reparacion_enlaces_consulta (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  reparacion_id uuid not null,
  -- base64url de 24 bytes aleatorios (192 bits) = 32 caracteres.
  token text not null check (token ~ '^[A-Za-z0-9_-]{32}$'),
  creado_por uuid references auth.users (id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint reparacion_enlaces_consulta_reparacion_fk foreign key (reparacion_id, organizacion_id)
    references dominio.reparaciones (id, organizacion_id),
  constraint reparacion_enlaces_consulta_reparacion_key unique (reparacion_id),
  constraint reparacion_enlaces_consulta_token_key unique (token)
);

comment on table dominio.reparacion_enlaces_consulta is
  'Enlace público de seguimiento de una reparación (F-SVC-22). El token es un secreto: sin políticas ni grants para roles de API; solo funciones security definer.';

alter table dominio.reparacion_enlaces_consulta enable row level security;

revoke all on dominio.reparacion_enlaces_consulta from public, anon, authenticated;
