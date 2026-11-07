-- F-SVC-01 (MSF-254, épica MSF-182): estados de reparación configurables.
-- Esquema (Principio VII): `dominio.estados_reparacion` son las etapas del proceso de
-- reparación del producto → `dominio`, nunca `public`. Por organización.
-- `avisa_cliente` y `cierra` solo se guardan: esta épica NO envía ningún aviso (FR-006).
-- `orden` define el flujo y se reordena por intercambio atómico (RPC mover_estado_reparacion).
-- Se desactiva, no se borra: sin política DELETE ni grant DELETE.
--
-- Migración aditiva (tabla, índices, disparador y políticas nuevas).
-- Reversión (migración posterior, no en este PR; exportar antes los datos):
--   drop trigger estados_reparacion_normalizar on dominio.estados_reparacion;
--   drop function private.normalizar_estado_reparacion();
--   drop table dominio.estados_reparacion;

create table dominio.estados_reparacion (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 80),
  -- «Qué significa» en la pantalla.
  descripcion text not null default '' check (length(descripcion) <= 500),
  orden integer not null check (orden > 0),
  avisa_cliente boolean not null default false,
  cierra boolean not null default false,
  -- Tono visual del chip (variantes de EtiquetaEstado).
  tono text not null default 'neutral' check (tono in ('neutral', 'primario', 'exito', 'aviso', 'error', 'info')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Habilita la FK compuesta de reparaciones (F-SVC-02).
  unique (id, organizacion_id)
);

comment on table dominio.estados_reparacion is
  'Estados de reparación de Service técnico (F-SVC-01). Se desactiva, no se borra: sin política DELETE.';
comment on column dominio.estados_reparacion.cierra is
  'El estado cierra la reparación (entrega). Lo fija el sembrado; la pantalla lo muestra en solo lectura.';

-- Nombre único por organización sin distinguir mayúsculas ni tildes (incluye inactivos).
-- Nombre estable: lo reconoce esEstadoRepetido (apps/web/src/lib/serviceTecnico.ts).
create unique index estados_reparacion_org_nombre_key
  on dominio.estados_reparacion (organizacion_id, private.clave_texto(nombre));

create index estados_reparacion_org_orden_idx
  on dominio.estados_reparacion (organizacion_id, orden, id);

-- `orden` no es único a propósito: así el intercambio atómico de dos filas no choca con
-- una restricción intermedia. El alta lo asigna al final (RPC crear_estado_reparacion).
create or replace function private.normalizar_estado_reparacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  new.descripcion := btrim(coalesce(new.descripcion, ''));
  if new.nombre = '' then
    raise exception 'El nombre del estado no puede estar vacío' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if (new.nombre, new.descripcion, new.orden, new.avisa_cliente, new.cierra, new.tono, new.activo)
       is not distinct from
       (old.nombre, old.descripcion, old.orden, old.avisa_cliente, old.cierra, old.tono, old.activo) then
      new.updated_at := old.updated_at;
    else
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_estado_reparacion() from public, anon, authenticated;

create trigger estados_reparacion_normalizar
  before insert or update on dominio.estados_reparacion
  for each row execute function private.normalizar_estado_reparacion();

alter table dominio.estados_reparacion enable row level security;

create policy estados_reparacion_select on dominio.estados_reparacion
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
  );

create policy estados_reparacion_insert on dominio.estados_reparacion
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) = 'edicion'
  );

create policy estados_reparacion_update on dominio.estados_reparacion
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) = 'edicion'
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.estados_reparacion from public, anon, authenticated;

grant select on dominio.estados_reparacion to authenticated;
-- `cierra` y `tono` no los fija el llamador: vienen del sembrado.
grant insert (id, nombre, descripcion, orden, avisa_cliente) on dominio.estados_reparacion to authenticated;
grant update (nombre, descripcion, orden, avisa_cliente, activo) on dominio.estados_reparacion to authenticated;
