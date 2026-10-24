-- F-CFG-01 (MSF-333, épica MSF-189, spec 20261024-120000-avisos-y-listas-configurables, FR-016):
-- lista configurable de estados de consulta.
--
-- Verificación contra MSF-122 (T018): al implementar, `dominio.estados_consulta` NO existe en el
-- repo (MSF-122 sin mergear). Se crea con la forma mínima (id, organizacion_id, nombre, activo,
-- orden). Si MSF-122 la crea después, su migración deberá ser aditiva sobre esta (add column if
-- not exists) y no recrearla. Sin siembra: los estados iniciales los define MSF-122 / el
-- Administrador; este PR no inventa estados.
--
-- Esquema (Principio VII): los estados de la consulta son entidad del negocio (Consultas es
-- dominio) → `dominio`, nunca `public`. RLS por organización: select con acceso a `consultas`,
-- insert/update solo `private.puede_escribir()`, sin delete (se desactiva). `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop trigger estados_consulta_normalizar on dominio.estados_consulta;
--   drop function private.normalizar_estado_consulta();
--   drop table dominio.estados_consulta;

create table dominio.estados_consulta (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 80),
  activo boolean not null default true,
  orden integer not null default 0,
  creado_en timestamptz not null default now(),
  unique (id, organizacion_id)
);

comment on table dominio.estados_consulta is
  'Estados de la consulta (F-CFG-01). Los edita solo el Administrador; se desactivan, no se borran.';

create unique index estados_consulta_nombre_uq
  on dominio.estados_consulta (organizacion_id, lower(btrim(nombre)));

create or replace function private.normalizar_estado_consulta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre del estado no puede estar vacío' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_estado_consulta() from public, anon, authenticated;

create trigger estados_consulta_normalizar
  before insert or update on dominio.estados_consulta
  for each row execute function private.normalizar_estado_consulta();

alter table dominio.estados_consulta enable row level security;

create policy estados_consulta_select on dominio.estados_consulta
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('consultas')) in ('lectura', 'edicion')
  );

create policy estados_consulta_insert on dominio.estados_consulta
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_escribir())
  );

create policy estados_consulta_update on dominio.estados_consulta
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_escribir())
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_escribir())
  );

-- Sin delete y sin privilegios para anon: solo lo necesario a authenticated.
revoke all on dominio.estados_consulta from public, anon;
grant select, insert, update on dominio.estados_consulta to authenticated;
