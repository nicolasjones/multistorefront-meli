-- F-SVC-01 (MSF-254, épica MSF-182): modelos de equipo que se reparan.
-- Esquema (Principio VII): `dominio.modelos_equipo` es una entidad de negocio del producto
-- (qué equipos se reparan), no de la plataforma → `dominio`, nunca `public`.
-- Los modelos son de la ORGANIZACIÓN (no de una empresa/tienda). Se desactivan, no se borran:
-- sin política DELETE ni grant DELETE. Los importes se cargan sin IVA.
--
-- Migración aditiva (función, tabla, índices, disparador y políticas nuevas).
-- Reversión (migración posterior, no en este PR; exportar antes los datos):
--   drop trigger modelos_equipo_normalizar on dominio.modelos_equipo;
--   drop function private.normalizar_modelo_equipo();
--   drop table dominio.modelos_equipo;
--   drop function private.clave_texto(text);

-- Clave de comparación sin mayúsculas ni tildes (no hay `unaccent` en el stack).
create or replace function private.clave_texto(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(lower(btrim(p_texto)), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun');
$$;

revoke execute on function private.clave_texto(text) from public, anon;
-- El índice único la evalúa con los privilegios de quien escribe.
grant execute on function private.clave_texto(text) to authenticated;

create table dominio.modelos_equipo (
  id uuid primary key default gen_random_uuid(),
  -- La organización sale de la sesión: el llamador no la fija (sin grant de columna).
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  equipo text not null check (btrim(equipo) <> '' and length(equipo) <= 100),
  modelo text not null check (btrim(modelo) <> '' and length(modelo) <= 100),
  mano_obra_base numeric(12, 2) not null default 0 check (mano_obra_base >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Habilita la FK compuesta de reparaciones (F-SVC-02): no se apunta a un modelo ajeno.
  unique (id, organizacion_id)
);

comment on table dominio.modelos_equipo is
  'Modelos de equipo de Service técnico (F-SVC-01). Se desactiva, no se borra: sin política DELETE.';
comment on column dominio.modelos_equipo.mano_obra_base is
  'Mano de obra base en ARS, sin IVA.';

-- Equipo + modelo únicos por organización sin distinguir mayúsculas ni tildes (incluye inactivos).
-- Nombre estable: lo reconoce esModeloRepetido (apps/web/src/lib/serviceTecnico.ts).
create unique index modelos_equipo_org_equipo_modelo_key
  on dominio.modelos_equipo (organizacion_id, private.clave_texto(equipo), private.clave_texto(modelo));

-- Normaliza al escribir: la base es la autoridad. `updated_at` avanza solo ante un cambio
-- real (así el bloqueo optimista no se rompe por una escritura idempotente).
create or replace function private.normalizar_modelo_equipo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.equipo := btrim(new.equipo);
  new.modelo := btrim(new.modelo);
  if new.equipo = '' or new.modelo = '' then
    raise exception 'El equipo y el modelo no pueden estar vacíos' using errcode = '23514';
  end if;
  new.mano_obra_base := round(new.mano_obra_base, 2);

  if tg_op = 'UPDATE' then
    if (new.equipo, new.modelo, new.mano_obra_base, new.activo)
       is not distinct from (old.equipo, old.modelo, old.mano_obra_base, old.activo) then
      new.updated_at := old.updated_at;
    else
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_modelo_equipo() from public, anon, authenticated;

create trigger modelos_equipo_normalizar
  before insert or update on dominio.modelos_equipo
  for each row execute function private.normalizar_modelo_equipo();

-- RLS por organización y nivel de la sección `service_tecnico`; sin DELETE (FR-001).
alter table dominio.modelos_equipo enable row level security;

create policy modelos_equipo_select on dominio.modelos_equipo
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
  );

create policy modelos_equipo_insert on dominio.modelos_equipo
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) = 'edicion'
  );

create policy modelos_equipo_update on dominio.modelos_equipo
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) = 'edicion'
  );

-- Grants: `anon` sin privilegios, sin DELETE, columnas explícitas.
grant usage on schema dominio to authenticated;

revoke all on dominio.modelos_equipo from public, anon, authenticated;

grant select on dominio.modelos_equipo to authenticated;
grant insert (id, equipo, modelo, mano_obra_base) on dominio.modelos_equipo to authenticated;
grant update (equipo, modelo, mano_obra_base, activo) on dominio.modelos_equipo to authenticated;
