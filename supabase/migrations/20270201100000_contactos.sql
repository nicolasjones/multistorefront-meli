-- MSF-260 · F-CON-05 (épica MSF-144, spec 20261029-120000-contactos-y-respuestas-rapidas, FR-001, FR-003):
-- libreta de contactos por empresa.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.contactos  dominio (nueva)  entidad de negocio con datos personales: a quién le vende o responde
--                                       cada empresa. No es un dato de plataforma → nunca `public`.
--   dominio.empresas   dominio (existente), solo se referencia por FK compuesta.
--
-- Seguridad:
--   * RLS por organización, empresa accesible y sección `consultas` (lectura o edición).
--   * SIN insert, update ni delete desde la app: el alta y la edición son solo RPC `security definer`
--     (20270201100200) y la anonimización otra (20270201100500). `anon` sin privilegios.
--
-- Duplicados (FR-003): índices únicos parciales por empresa sobre el correo normalizado (minúsculas, sin
-- espacios) y el teléfono normalizado (solo dígitos), únicamente entre contactos NO anonimizados: anonimizar
-- libera las claves.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos, que son personales):
--   drop trigger contactos_normalizar on dominio.contactos;
--   drop function private.normalizar_contacto();
--   drop table dominio.contactos;

create table dominio.contactos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 120),
  correo text check (correo is null or (btrim(correo) <> '' and length(correo) <= 200)),
  telefono text check (telefono is null or (btrim(telefono) <> '' and length(telefono) <= 40)),
  correo_normalizado text,
  telefono_normalizado text,
  consentimiento_en timestamptz not null default now(),
  consentimiento_texto text not null check (btrim(consentimiento_texto) <> '' and length(consentimiento_texto) <= 2000),
  consentimiento_por uuid references auth.users (id) on delete set null,
  anonimizado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organizacion_id),
  constraint contactos_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  -- Un contacto activo tiene al menos correo o teléfono; el anonimizado ya no los conserva.
  constraint contactos_medio_requerido check (anonimizado_en is not null or correo is not null or telefono is not null)
);

comment on table dominio.contactos is
  'F-CON-05: libreta de contactos por empresa (datos personales). Alta y edición solo por public.crear_contacto / actualizar_contacto; anonimización por public.anonimizar_contacto; sin delete.';
comment on column dominio.contactos.consentimiento_texto is
  'Copia del texto de consentimiento vigente al aceptar (FR-004).';
comment on column dominio.contactos.updated_at is
  'Bloqueo optimista de public.actualizar_contacto / anonimizar_contacto: avanza solo ante un cambio real.';

create unique index if not exists contactos_empresa_correo_uq
  on dominio.contactos (empresa_id, correo_normalizado)
  where anonimizado_en is null and correo_normalizado is not null;
create unique index if not exists contactos_empresa_telefono_uq
  on dominio.contactos (empresa_id, telefono_normalizado)
  where anonimizado_en is null and telefono_normalizado is not null;
create index if not exists contactos_organizacion_id_idx on dominio.contactos (organizacion_id);
create index if not exists contactos_empresa_nombre_idx on dominio.contactos (empresa_id, lower(nombre));

-- Normaliza al escribir (la base es la autoridad) y hace avanzar `updated_at` solo ante un cambio real.
create or replace function private.normalizar_contacto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  new.correo := nullif(btrim(coalesce(new.correo, '')), '');
  new.telefono := nullif(btrim(coalesce(new.telefono, '')), '');
  new.correo_normalizado := case when new.anonimizado_en is null then lower(new.correo) end;
  new.telefono_normalizado := case when new.anonimizado_en is null
    then nullif(regexp_replace(coalesce(new.telefono, ''), '\D', '', 'g'), '') end;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') is not distinct from (to_jsonb(old) - 'updated_at') then
      new.updated_at := old.updated_at;
    else
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_contacto() from public, anon, authenticated;

create trigger contactos_normalizar
  before insert or update on dominio.contactos
  for each row execute function private.normalizar_contacto();

alter table dominio.contactos enable row level security;

-- Lectura: organización de la sesión, empresa accesible y sección `consultas`.
-- Sin políticas de escritura (ver encabezado).
create policy contactos_select on dominio.contactos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('consultas')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.contactos from public, anon, authenticated;
grant select on dominio.contactos to authenticated;
