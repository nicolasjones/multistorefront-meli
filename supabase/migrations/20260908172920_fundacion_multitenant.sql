-- Fundación multi-tenant (spec 003): organizaciones, membresías, primera
-- entidad de negocio (clientes) y el soporte de superadmin (perfil propio,
-- organización activa, auditoría de entradas). Ver specs/003-fundacion-multitenant/.
--
-- auto_expose_new_tables está en false (ver supabase/config.toml), así que
-- toda tabla/función que deba ser alcanzable por PostgREST necesita GRANT
-- explícito además de sus policies de RLS.

-- ============================================================================
-- Tablas
-- ============================================================================

create table roles_organizacion (
  id text primary key,
  descripcion text not null
);

comment on table roles_organizacion is
  'Catálogo de roles dentro de una organización. Tabla de datos, no un check fijo: agregar un rol es una fila nueva.';

insert into roles_organizacion (id, descripcion) values
  ('administrador', 'Gestiona membresías y datos: lee, crea y edita.'),
  ('miembro', 'Solo lee/lista datos de negocio; no crea ni edita, no gestiona membresías.');

create table organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  created_at timestamptz not null default now()
);

create table usuarios_organizacion (
  user_id uuid primary key references auth.users (id) on delete cascade,
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  rol_id text not null references roles_organizacion (id),
  created_at timestamptz not null default now()
);

comment on table usuarios_organizacion is
  'Membresía de un usuario a una organización. user_id como PK garantiza (FR-002) una sola organización por usuario a nivel de esquema, no solo de regla de negocio.';

create index usuarios_organizacion_organizacion_id_idx on usuarios_organizacion (organizacion_id);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create index clientes_organizacion_id_idx on clientes (organizacion_id);

create table superadmins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table superadmins is
  'Marca a un usuario como superadmin de toda la plataforma (FR-003), independiente de cualquier organización. Se carga a mano por SQL — no hay pantalla para esto (ver quickstart.md).';

create table superadmin_organizacion_activa (
  user_id uuid primary key references auth.users (id) on delete cascade,
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  entrado_en timestamptz not null default now()
);

comment on table superadmin_organizacion_activa is
  'Organización que el superadmin tiene activa ahora mismo (una a la vez, FR-006). Se sobrescribe en cada "Ingresar" — no es el historial.';

create table superadmin_entradas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  organizacion_id uuid not null references organizaciones (id) on delete cascade,
  entrado_en timestamptz not null default now()
);

comment on table superadmin_entradas is
  'Registro de auditoría append-only de cada entrada de un superadmin a una organización (FR-013, Principio III). Nunca se actualiza ni se borra.';

create index superadmin_entradas_organizacion_id_idx on superadmin_entradas (organizacion_id);

-- ============================================================================
-- Funciones helper de RLS (schema private)
-- ============================================================================
-- No van en el schema auth: postgres no tiene permiso para crear objetos
-- ahí (lo posee supabase_auth_admin), ni siquiera en local. "private" no
-- está en la lista de schemas expuestos por la Data API (ver
-- supabase/config.toml, [api].schemas), así que estas funciones quedan
-- disponibles para RLS pero no aparecen como RPC público.
--
-- security definer: leen usuarios_organizacion / superadmins /
-- superadmin_organizacion_activa sin quedar atrapadas por el RLS de esas
-- mismas tablas (evita recursión de policies).

create schema if not exists private;

create or replace function private.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from superadmins where user_id = auth.uid()
  );
$$;

comment on function private.is_superadmin() is
  'true si el usuario actual tiene fila en superadmins (FR-003).';

create or replace function private.organizacion_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select organizacion_id from usuarios_organizacion where user_id = auth.uid()),
    (select organizacion_id from superadmin_organizacion_activa where user_id = auth.uid())
  );
$$;

comment on function private.organizacion_id() is
  'Organización del usuario actual: su única membresía, o si es superadmin, la organización que entró (FR-004, SC-003). Función reutilizable por cualquier tabla de negocio futura.';

create or replace function private.puede_escribir()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from usuarios_organizacion
      where user_id = auth.uid() and rol_id = 'administrador'
    )
    or (
      private.is_superadmin()
      and exists (
        select 1 from superadmin_organizacion_activa where user_id = auth.uid()
      )
    );
$$;

comment on function private.puede_escribir() is
  'true si el usuario actual puede escribir en la organización resuelta por private.organizacion_id(): administrador de la organización, o superadmin con esa organización activa (FR-011).';

grant usage on schema private to authenticated;
grant execute on function private.is_superadmin() to authenticated;
grant execute on function private.organizacion_id() to authenticated;
grant execute on function private.puede_escribir() to authenticated;

-- ============================================================================
-- RPC: entrar_a_organizacion (Historia 4)
-- ============================================================================

create or replace function public.entrar_a_organizacion(org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.is_superadmin() then
    raise exception 'Solo un superadmin puede entrar a una organización' using errcode = '42501';
  end if;

  if not exists (select 1 from organizaciones where id = org_id) then
    raise exception 'La organización % no existe', org_id using errcode = 'P0002';
  end if;

  insert into superadmin_organizacion_activa (user_id, organizacion_id, entrado_en)
  values (auth.uid(), org_id, now())
  on conflict (user_id) do update
    set organizacion_id = excluded.organizacion_id,
        entrado_en = excluded.entrado_en;

  insert into superadmin_entradas (user_id, organizacion_id, entrado_en)
  values (auth.uid(), org_id, now());
end;
$$;

comment on function public.entrar_a_organizacion(uuid) is
  'Contrato: specs/003-fundacion-multitenant/contracts/entrar-a-organizacion.md. Cambia el contexto activo del superadmin y audita la entrada, en una sola transacción.';

grant execute on function public.entrar_a_organizacion(uuid) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table roles_organizacion enable row level security;
alter table organizaciones enable row level security;
alter table usuarios_organizacion enable row level security;
alter table clientes enable row level security;
alter table superadmins enable row level security;
alter table superadmin_organizacion_activa enable row level security;
alter table superadmin_entradas enable row level security;

-- roles_organizacion: catálogo de solo lectura para cualquier autenticado.
create policy roles_organizacion_select on roles_organizacion
  for select to authenticated
  using (true);

-- organizaciones: cada quien ve la suya (admin/miembro) o, si es
-- superadmin, todas (listado de Historia 2). Sin policy de escritura: el
-- alta pasa siempre por la Edge Function con service-role (FR-009, FR-010).
create policy organizaciones_select on organizaciones
  for select to authenticated
  using (private.is_superadmin() or id = private.organizacion_id());

-- usuarios_organizacion: cada quien ve su propia fila; superadmin ve todas
-- (para el flujo de "Ingresar"/soporte). Sin policy de escritura: el alta
-- inicial la hace la Edge Function, la gestión de membresías adicionales
-- queda fuera de alcance de esta spec (ver quickstart.md).
create policy usuarios_organizacion_select on usuarios_organizacion
  for select to authenticated
  using (user_id = auth.uid() or private.is_superadmin());

-- clientes: aislamiento por organización activa (FR-005, FR-006), escritura
-- restringida a quien private.puede_escribir() (FR-011) — en RLS, no solo UI.
create policy clientes_select on clientes
  for select to authenticated
  using (organizacion_id = private.organizacion_id());

create policy clientes_insert on clientes
  for insert to authenticated
  with check (organizacion_id = private.organizacion_id() and private.puede_escribir());

create policy clientes_update on clientes
  for update to authenticated
  using (organizacion_id = private.organizacion_id() and private.puede_escribir())
  with check (organizacion_id = private.organizacion_id() and private.puede_escribir());

-- superadmins: cada quien puede leer únicamente si su propia fila existe
-- (lo usa el frontend para decidir qué mostrar). Sin policy de escritura:
-- se carga a mano (ver quickstart.md).
create policy superadmins_select on superadmins
  for select to authenticated
  using (user_id = auth.uid());

-- superadmin_organizacion_activa: cada superadmin lee su propio contexto
-- activo. Sin policy de escritura: solo la RPC entrar_a_organizacion
-- (security definer) escribe acá.
create policy superadmin_organizacion_activa_select on superadmin_organizacion_activa
  for select to authenticated
  using (user_id = auth.uid());

-- superadmin_entradas: auditoría visible para cualquier superadmin. Sin
-- policy de escritura: append-only, solo vía la RPC.
create policy superadmin_entradas_select on superadmin_entradas
  for select to authenticated
  using (private.is_superadmin());

-- ============================================================================
-- Grants (auto_expose_new_tables = false: hacen falta explícitos)
-- ============================================================================

grant usage on schema public to authenticated, service_role;

grant select on roles_organizacion to authenticated;
grant select on organizaciones to authenticated;
grant select on usuarios_organizacion to authenticated;
grant select, insert, update on clientes to authenticated;
grant select on superadmins to authenticated;
grant select on superadmin_organizacion_activa to authenticated;
grant select on superadmin_entradas to authenticated;

-- service_role: la Edge Function crear-organizacion (contracts/crear-organizacion.md)
-- llama a PostgREST con la service-role key. bypassrls le evita el chequeo
-- de RLS, pero los GRANT de tabla se siguen aplicando igual — hacen falta
-- explícitos acá también, no solo para "authenticated".
grant select on superadmins to service_role;
grant select, insert, delete on organizaciones to service_role;
grant insert on usuarios_organizacion to service_role;
