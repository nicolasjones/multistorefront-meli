-- F-ROL-04 · Rol por empresa (épica MSF-121, spec 20261016-140000-permisos-por-empresa,
-- FR-001…FR-008).
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   usuarios_empresas        public  (nueva)  membresía/acceso: transversal, como usuarios_organizacion
--   usuario_empresa_activa   public  (nueva)  contexto de sesión del usuario: plataforma
--   dominio.empresas         dominio (existente) entidad del negocio; solo se referencia, no se altera
-- Funciones en `private`. Ambas tablas nuevas: RLS por organización, sin privilegios
-- para `anon` y sin escritura directa para `authenticated` (la escritura llega por las
-- RPC de F-ROL-06 y F-ROL-07).
--
-- Migración aditiva. Camino de reversión (no se ejecuta en el mismo PR; solo válido
-- tras revertir F-ROL-06 y F-ROL-07, que dependen de estas tablas):
--   1. restaurar private.nivel_seccion(text) y private.puede_accion(text, text) a su
--      definición de 20261014120000_usuarios_suspension_y_roles.sql;
--   2. drop function private.roles_de_referencia(text), private.nivel_de_rol(uuid, text, text),
--      private.accion_de_rol(uuid, text, text, text), private.rol_en_empresa(uuid),
--      private.empresa_activa_valida(), private.empresas_accesibles(),
--      private.secciones_por_empresa(), private.secciones_compartidas(),
--      private.validar_usuario_empresa();
--   3. drop table public.usuario_empresa_activa; drop table public.usuarios_empresas.
-- Mientras no haya filas en usuarios_empresas el comportamiento es idéntico al actual.

-- ============================================================================
-- Tablas (FR-001, FR-002, FR-004)
-- ============================================================================

create table public.usuarios_empresas (
  user_id uuid not null references public.usuarios_organizacion (user_id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  rol_id text not null references public.roles_organizacion (id)
    -- FR-002: solo los cinco roles por empresa; ni `administrador` ni `miembro`.
    constraint usuarios_empresas_rol_por_empresa
      check (rol_id in ('operador', 'consulta', 'mostrador', 'deposito', 'administracion')),
  created_at timestamptz not null default now(),
  primary key (user_id, empresa_id)
);

comment on table public.usuarios_empresas is
  'Rol de un usuario en una empresa (plataforma, esquema public). Lectura: el propio usuario y el Administrador; escritura solo por RPC (F-ROL-07). El Administrador de la organización no tiene filas: accede a todas las empresas.';

create index usuarios_empresas_empresa_id_idx on public.usuarios_empresas (empresa_id);
create index usuarios_empresas_organizacion_id_idx on public.usuarios_empresas (organizacion_id);

create table public.usuario_empresa_activa (
  user_id uuid primary key references auth.users (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  updated_at timestamptz not null default now()
);

comment on table public.usuario_empresa_activa is
  'Empresa con la que trabaja el usuario (plataforma, esquema public). Una fila por usuario; lectura propia; escritura solo por la RPC de F-ROL-06.';

-- FR-002: el usuario y la empresa deben pertenecer a la organización de la fila.
create or replace function private.validar_usuario_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.usuarios_organizacion u
    where u.user_id = new.user_id and u.organizacion_id = new.organizacion_id
  ) then
    raise exception 'El usuario no pertenece a la organización' using errcode = '23514';
  end if;
  if not exists (
    select 1 from dominio.empresas e
    where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id
  ) then
    raise exception 'La empresa no pertenece a la organización del usuario' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_usuario_empresa() from public, anon, authenticated;

create trigger usuarios_empresas_validar
  before insert or update on public.usuarios_empresas
  for each row execute function private.validar_usuario_empresa();

alter table public.usuarios_empresas enable row level security;
alter table public.usuario_empresa_activa enable row level security;

create policy usuarios_empresas_select on public.usuarios_empresas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (user_id = (select auth.uid()) or (select private.puede_escribir()))
  );

create policy usuario_empresa_activa_select on public.usuario_empresa_activa
  for select to authenticated
  using (user_id = (select auth.uid()));

-- auto_expose_new_tables = false: grants explícitos. Solo lectura; nada para anon.
grant select on public.usuarios_empresas to authenticated;
grant select on public.usuario_empresa_activa to authenticated;

-- ============================================================================
-- Helpers (FR-005). Todos `security definer`, `search_path` fijo.
-- ============================================================================

-- Fuente única de qué secciones se resuelven por empresa y cuáles son compartidas.
create or replace function private.secciones_compartidas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['productos', 'categorias', 'stock', 'clientes', 'proveedores', 'cotizacion_dolar'];
$$;

create or replace function private.secciones_por_empresa()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['ventas', 'consultas', 'reportes'];
$$;

comment on function private.secciones_compartidas() is
  'Secciones cuyo nivel es el mejor entre los roles del usuario en sus empresas (Clientes incluida, decisión 2026-10-16).';
comment on function private.secciones_por_empresa() is
  'Secciones cuyo nivel es el del rol del usuario en su empresa activa.';

-- Empresas activas a las que el usuario actual accede: todas las de la organización
-- si es Administrador; si no, las asignadas. Exige membresía vigente.
create or replace function private.empresas_accesibles()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.usuarios_organizacion u
  join dominio.empresas e on e.organizacion_id = u.organizacion_id and e.activa
  where u.user_id = (select auth.uid())
    and u.estado = 'activo'
    and (
      u.rol_id = 'administrador'
      or exists (
        select 1 from public.usuarios_empresas ue
        where ue.user_id = u.user_id and ue.empresa_id = e.id
      )
    );
$$;

-- Empresa activa del usuario solo si sigue siendo accesible (activa, asignada, vigente).
create or replace function private.empresa_activa_valida()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.empresa_id
  from public.usuario_empresa_activa a
  where a.user_id = (select auth.uid())
    and a.empresa_id in (select private.empresas_accesibles());
$$;

-- Rol del usuario actual en una empresa: el de la asignación, `administrador` para el
-- Administrador de la organización, null si no accede.
create or replace function private.rol_en_empresa(p_empresa_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when u.rol_id = 'administrador' then 'administrador' else ue.rol_id end
  from public.usuarios_organizacion u
  join dominio.empresas e on e.organizacion_id = u.organizacion_id and e.activa and e.id = p_empresa_id
  left join public.usuarios_empresas ue on ue.user_id = u.user_id and ue.empresa_id = e.id
  where u.user_id = (select auth.uid())
    and u.estado = 'activo'
    and (u.rol_id = 'administrador' or ue.rol_id is not null);
$$;

-- Nivel de un rol en una sección: fila de la organización, si no la matriz inicial,
-- si no `ninguno` (nunca acceso total por omisión).
create or replace function private.nivel_de_rol(p_organizacion_id uuid, p_rol_id text, p_seccion text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.nivel from public.permisos_rol p
      where p.organizacion_id = p_organizacion_id and p.rol_id = p_rol_id and p.seccion = p_seccion),
    (select m.nivel from private.matriz_inicial() m where m.rol_id = p_rol_id and m.seccion = p_seccion),
    'ninguno'
  );
$$;

create or replace function private.accion_de_rol(p_organizacion_id uuid, p_rol_id text, p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select pa.permitido from public.permisos_rol_accion pa
      where pa.organizacion_id = p_organizacion_id and pa.rol_id = p_rol_id
        and pa.seccion = p_seccion and pa.accion = p_accion),
    (select ai.permitido from private.matriz_acciones_iniciales() ai
      where ai.rol_id = p_rol_id and ai.seccion = p_seccion and ai.accion = p_accion),
    false
  );
$$;

-- Roles que gobiernan la sección para el usuario actual (FR-006):
--  · sin asignaciones, Administrador o sección no listada → el rol de organización;
--  · sección compartida → los roles de todas sus empresas activas;
--  · sección por empresa → el rol de la empresa activa válida (ninguno si no hay).
create or replace function private.roles_de_referencia(p_seccion text)
returns table (organizacion_id uuid, rol_id text)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select u.user_id, u.organizacion_id, u.rol_id,
      (
        u.rol_id <> 'administrador'
        and exists (select 1 from public.usuarios_empresas ue where ue.user_id = u.user_id)
      ) as con_empresas
    from public.usuarios_organizacion u
    where u.user_id = (select auth.uid()) and u.estado = 'activo'
  )
  select m.organizacion_id, m.rol_id
  from m
  where not m.con_empresas
    or not (p_seccion = any (private.secciones_compartidas()) or p_seccion = any (private.secciones_por_empresa()))
  union
  select m.organizacion_id, ue.rol_id
  from m
  join public.usuarios_empresas ue on ue.user_id = m.user_id
  join dominio.empresas e on e.id = ue.empresa_id and e.organizacion_id = m.organizacion_id and e.activa
  where m.con_empresas and p_seccion = any (private.secciones_compartidas())
  union
  select m.organizacion_id, ue.rol_id
  from m
  join public.usuarios_empresas ue on ue.user_id = m.user_id
  where m.con_empresas
    and p_seccion = any (private.secciones_por_empresa())
    and ue.empresa_id = (select private.empresa_activa_valida());
$$;

revoke execute on function
  private.secciones_compartidas(), private.secciones_por_empresa(), private.empresas_accesibles(),
  private.empresa_activa_valida(), private.rol_en_empresa(uuid), private.nivel_de_rol(uuid, text, text),
  private.accion_de_rol(uuid, text, text, text), private.roles_de_referencia(text)
  from public, anon;
-- Los que no reciben una organización ajena como argumento se exponen a `authenticated`
-- (FR-005); nivel_de_rol / accion_de_rol / roles_de_referencia solo los usan, desde
-- security definer, nivel_seccion y puede_accion.
grant execute on function
  private.secciones_compartidas(), private.secciones_por_empresa(), private.empresas_accesibles(),
  private.empresa_activa_valida(), private.rol_en_empresa(uuid)
  to authenticated;
revoke execute on function
  private.nivel_de_rol(uuid, text, text), private.accion_de_rol(uuid, text, text, text),
  private.roles_de_referencia(text)
  from authenticated;

-- ============================================================================
-- Contrato por empresa (FR-006, FR-007): reemplazo de nivel_seccion / puede_accion
-- ============================================================================

create or replace function private.nivel_seccion(p_seccion text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then 'edicion'
    else coalesce(
      (
        select r.nivel
        from (
          select private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) as nivel
          from private.roles_de_referencia(p_seccion) x
        ) r
        order by case r.nivel when 'edicion' then 2 when 'lectura' then 1 else 0 end desc
        limit 1
      ),
      'ninguno'
    )
  end;
$$;

comment on function private.nivel_seccion(text) is
  'Nivel del usuario actual en la sección: edicion | lectura | ninguno. Secciones compartidas = mejor rol entre sus empresas; por empresa = rol de la empresa activa; el resto o sin asignaciones = rol de organización. Contrato en docs/permisos-por-rol.md.';

create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    -- eliminar exige edición; exportar y ver costos exigen al menos lectura.
    when p_accion = 'eliminar' and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion = 'eliminar' then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

revoke execute on function private.nivel_seccion(text), private.puede_accion(text, text) from public, anon;
grant execute on function private.nivel_seccion(text), private.puede_accion(text, text) to authenticated;
