-- F-ROL-01 · Roles básicos y permisos por sección/acción (épica MSF-125, spec
-- 20261013-120000-usuarios-y-roles, FR-001…FR-007, FR-016).
--
-- Esquemas (Principio VII): todo es mecanismo de acceso transversal, no
-- entidad de negocio del producto → tablas en `public`, funciones en `private`.
--   roles_organizacion  public  (alterada: 5 filas nuevas, aditiva)
--   permisos_rol        public  (nueva, RLS por organización)
--   permisos_rol_accion public  (nueva, RLS por organización)
--
-- Migración aditiva. Camino de reversión (no se ejecuta; documentado por
-- FR-016, solo válido mientras ninguna tabla de dominio use las funciones):
--   drop function public.permisos_actuales();
--   drop trigger organizaciones_sembrar_permisos on public.organizaciones;
--   drop function private.sembrar_permisos_trigger();
--   drop function private.puede_accion(text, text);
--   drop function private.nivel_seccion(text);
--   drop function private.sembrar_permisos(uuid);
--   drop function private.matriz_acciones_iniciales();
--   drop function private.matriz_inicial();
--   drop table public.permisos_rol_accion;
--   drop table public.permisos_rol;
--   (los 5 roles nuevos se quitan de roles_organizacion solo si ningún
--    usuarios_organizacion los usa)
-- private.puede_escribir() NO se toca: sigue gobernando las tablas que aún no
-- migraron al contrato nivel_seccion/puede_accion.

-- ============================================================================
-- Roles (FR-001)
-- ============================================================================

insert into public.roles_organizacion (id, descripcion) values
  ('operador', 'Productos, stock, ventas y clientes.'),
  ('consulta', 'Solo lectura.'),
  ('mostrador', 'Vende en el local: comprobantes y clientes.'),
  ('deposito', 'Arma y entrega pedidos, mueve stock.'),
  ('administracion', 'Cobros, proveedores y reportes.')
on conflict (id) do nothing;

-- ============================================================================
-- Matrices iniciales (valores de Roles.dc.html; E = edicion, L = lectura,
-- N = ninguno). `miembro` (rol del template) queda en lectura salvo en las
-- secciones que el prototipo reserva a Administrador/Administración: nunca
-- gana acceso que antes no tenía (supuesto de la spec).
-- ============================================================================

create or replace function private.matriz_inicial()
returns table (rol_id text, seccion text, nivel text)
language sql
immutable
set search_path = ''
as $$
  select r.rol, v.seccion,
    case r.c when 'E' then 'edicion' when 'L' then 'lectura' else 'ninguno' end
  from (values
    ('inicio',            'E','E','L','L','L','L','L'),
    ('productos',         'E','E','L','L','L','L','L'),
    ('categorias',        'E','E','L','N','N','N','L'),
    ('stock',             'E','E','L','L','E','L','L'),
    ('cotizacion_dolar',  'E','L','L','L','N','E','L'),
    ('empresas',          'E','N','N','N','N','N','N'),
    ('mercado_libre',     'E','N','N','N','N','N','N'),
    ('rentabilidad',      'E','N','N','N','N','L','N'),
    ('usuarios_permisos', 'E','N','N','N','N','N','N'),
    ('actividad',         'E','L','N','N','N','L','N'),
    ('consultas',         'E','E','L','N','N','L','L'),
    ('ventas',            'E','E','L','E','L','E','L'),
    ('clientes',          'E','E','L','E','N','E','L'),
    ('proveedores',       'E','N','N','N','N','E','N'),
    ('reportes',          'E','N','N','N','N','E','N'),
    ('service_tecnico',   'E','E','L','L','N','L','L')
  ) as v(seccion, administrador, operador, consulta, mostrador, deposito, administracion, miembro)
  cross join lateral (values
    ('administrador', v.administrador), ('operador', v.operador), ('consulta', v.consulta),
    ('mostrador', v.mostrador), ('deposito', v.deposito), ('administracion', v.administracion),
    ('miembro', v.miembro)
  ) as r(rol, c);
$$;

comment on function private.matriz_inicial() is
  'Matriz inicial rol × sección → nivel (Roles.dc.html). Fuente única para sembrar permisos_rol y para el valor por omisión cuando falta una fila (nunca acceso total).';

-- Acciones (extensión propuesta, FR-006): eliminar solo Administrador;
-- exportar Administrador/Operador/Administración; ver costos Administrador/Administración.
create or replace function private.matriz_acciones_iniciales()
returns table (rol_id text, seccion text, accion text, permitido boolean)
language sql
immutable
set search_path = ''
as $$
  select m.rol_id, m.seccion, a.accion,
    case a.accion
      when 'eliminar' then m.rol_id = 'administrador'
      when 'exportar' then m.rol_id in ('administrador', 'operador', 'administracion')
      else m.rol_id in ('administrador', 'administracion')
    end
  from private.matriz_inicial() m
  cross join (values ('eliminar'), ('exportar'), ('ver_costos')) as a(accion);
$$;

comment on function private.matriz_acciones_iniciales() is
  'Valores iniciales PROPUESTOS de permisos por acción (FR-006); pendientes de confirmar con el cliente.';

-- ============================================================================
-- Tablas (FR-002, FR-003, FR-006, FR-016)
-- ============================================================================

create table public.permisos_rol (
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  rol_id text not null references public.roles_organizacion (id),
  seccion text not null,
  nivel text not null check (nivel in ('edicion', 'lectura', 'ninguno')),
  primary key (organizacion_id, rol_id, seccion),
  -- FR-003: el Administrador no se puede restringir, garantizado en base de datos.
  constraint permisos_rol_administrador_edicion check (rol_id <> 'administrador' or nivel = 'edicion')
);

comment on table public.permisos_rol is
  'Matriz de permisos por organización × rol × sección (plataforma, esquema public). Sin policies de escritura: la edición llega con F-ROL-02 vía RPC.';

create table public.permisos_rol_accion (
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  rol_id text not null references public.roles_organizacion (id),
  seccion text not null,
  accion text not null check (accion in ('eliminar', 'exportar', 'ver_costos')),
  permitido boolean not null,
  primary key (organizacion_id, rol_id, seccion, accion),
  constraint permisos_rol_accion_administrador_permitido check (rol_id <> 'administrador' or permitido)
);

comment on table public.permisos_rol_accion is
  'Permisos por acción (eliminar / exportar / ver costos) por organización × rol × sección (plataforma, esquema public). Extensión propuesta, FR-006.';

alter table public.permisos_rol enable row level security;
alter table public.permisos_rol_accion enable row level security;

create policy permisos_rol_select on public.permisos_rol
  for select to authenticated
  using (organizacion_id = (select private.organizacion_id()));

create policy permisos_rol_accion_select on public.permisos_rol_accion
  for select to authenticated
  using (organizacion_id = (select private.organizacion_id()));

-- auto_expose_new_tables = false: grants explícitos. Solo lectura; sin escritura directa.
grant select on public.permisos_rol to authenticated;
grant select on public.permisos_rol_accion to authenticated;

-- ============================================================================
-- Siembra (FR-002): al crear una organización y backfill de las existentes
-- ============================================================================

create or replace function private.sembrar_permisos(p_organizacion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel)
  select p_organizacion_id, m.rol_id, m.seccion, m.nivel from private.matriz_inicial() m
  on conflict do nothing;

  insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
  select p_organizacion_id, a.rol_id, a.seccion, a.accion, a.permitido from private.matriz_acciones_iniciales() a
  on conflict do nothing;
$$;

comment on function private.sembrar_permisos(uuid) is
  'Siembra (idempotente) la matriz inicial de una organización. No exponer: solo trigger y migraciones.';

revoke execute on function private.sembrar_permisos(uuid) from public, anon, authenticated;

create or replace function private.sembrar_permisos_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sembrar_permisos(new.id);
  return new;
end;
$$;

revoke execute on function private.sembrar_permisos_trigger() from public, anon, authenticated;

create trigger organizaciones_sembrar_permisos
  after insert on public.organizaciones
  for each row execute function private.sembrar_permisos_trigger();

select private.sembrar_permisos(id) from public.organizaciones;

-- ============================================================================
-- Contrato para las demás épicas (FR-004, FR-006, FR-007)
-- ============================================================================

-- Superadmin con organización activa = administrador (mismo criterio que
-- private.puede_escribir()). Sin fila en permisos_rol se usa la matriz
-- inicial; sin ninguna, 'ninguno': nunca acceso total por omisión.
-- NOTA (MSF-119): cuando exista usuarios_organizacion.estado, esta función
-- DEBE excluir 'suspendido' (agregar `and u.estado <> 'suspendido'`);
-- la columna todavía no existe en esta rama.
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
        select coalesce(
          (select p.nivel from public.permisos_rol p
            where p.organizacion_id = u.organizacion_id and p.rol_id = u.rol_id and p.seccion = p_seccion),
          (select m.nivel from private.matriz_inicial() m
            where m.rol_id = u.rol_id and m.seccion = p_seccion)
        )
        from public.usuarios_organizacion u
        where u.user_id = (select auth.uid())
      ),
      'ninguno'
    )
  end;
$$;

comment on function private.nivel_seccion(text) is
  'Nivel del usuario actual en la sección, en la organización de private.organizacion_id(): edicion | lectura | ninguno. Contrato en docs/permisos-por-rol.md.';

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
        select coalesce(
          (select pa.permitido from public.permisos_rol_accion pa
            where pa.organizacion_id = u.organizacion_id and pa.rol_id = u.rol_id
              and pa.seccion = p_seccion and pa.accion = p_accion),
          (select ai.permitido from private.matriz_acciones_iniciales() ai
            where ai.rol_id = u.rol_id and ai.seccion = p_seccion and ai.accion = p_accion)
        )
        from public.usuarios_organizacion u
        where u.user_id = (select auth.uid())
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos en la sección. Cualquier otra acción → false. Contrato en docs/permisos-por-rol.md.';

revoke execute on function private.nivel_seccion(text), private.puede_accion(text, text) from public, anon;
grant execute on function private.nivel_seccion(text), private.puede_accion(text, text) to authenticated;
revoke execute on function private.matriz_inicial(), private.matriz_acciones_iniciales() from public, anon, authenticated;

-- ============================================================================
-- RPC de lectura para el panel (menú y accessControlProvider). No acepta
-- user_id: siempre resuelve para auth.uid(). No autoriza mutaciones.
-- ============================================================================

create or replace function public.permisos_actuales()
returns table (seccion text, nivel text, eliminar boolean, exportar boolean, ver_costos boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.seccion,
    (select private.nivel_seccion(s.seccion)),
    (select private.puede_accion(s.seccion, 'eliminar')),
    (select private.puede_accion(s.seccion, 'exportar')),
    (select private.puede_accion(s.seccion, 'ver_costos'))
  from (select distinct m.seccion from private.matriz_inicial() m) s
  order by s.seccion;
$$;

comment on function public.permisos_actuales() is
  'Niveles y acciones del usuario actual por sección, solo para presentar menú y rutas. La autorización real la hace RLS con private.nivel_seccion/puede_accion.';

revoke all on function public.permisos_actuales() from public, anon;
grant execute on function public.permisos_actuales() to authenticated;
