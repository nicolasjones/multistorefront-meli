-- MSF-274 · F-CON-06 (épica MSF-144, spec 20261029-120000-contactos-y-respuestas-rapidas, FR-013):
-- textos frecuentes por empresa para armar el texto inicial de «Responder».
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.respuestas_rapidas  dominio (nueva)  contenido de negocio configurable por empresa,
--                                                sin datos personales → nunca `public`.
--   dominio.empresas            dominio (existente), solo se referencia.
--
-- Seguridad:
--   * RLS por organización, empresa accesible y sección `consultas` (lectura o edición).
--   * SIN insert, update ni delete desde la app: la escritura es solo por
--     `public.guardar_respuesta_rapida` / `public.eliminar_respuesta_rapida` (SECURITY DEFINER).
--   * `anon` sin privilegios sobre la tabla.
--
-- Migración aditiva. Reversión (migración posterior, exportando antes los textos):
--   drop trigger respuestas_rapidas_normalizar on dominio.respuestas_rapidas;
--   drop function private.normalizar_respuesta_rapida();
--   drop table dominio.respuestas_rapidas;

create table dominio.respuestas_rapidas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  titulo text not null check (btrim(titulo) <> '' and length(titulo) <= 80),
  texto text not null check (btrim(texto) <> '' and length(texto) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint respuestas_rapidas_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint respuestas_rapidas_id_organizacion_uk unique (id, organizacion_id)
);

comment on table dominio.respuestas_rapidas is
  'F-CON-06: textos frecuentes por empresa (variables {nombre}, {tienda}, {producto}). Sin datos personales. Escritura solo por guardar_respuesta_rapida / eliminar_respuesta_rapida.';

create index if not exists respuestas_rapidas_empresa_idx on dominio.respuestas_rapidas (empresa_id, titulo);
create index if not exists respuestas_rapidas_organizacion_id_idx on dominio.respuestas_rapidas (organizacion_id);

create or replace function private.normalizar_respuesta_rapida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.titulo := btrim(new.titulo);
  -- El texto conserva sus saltos de línea internos; solo se recortan los extremos.
  new.texto := btrim(new.texto);
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_respuesta_rapida() from public, anon, authenticated;

create trigger respuestas_rapidas_normalizar
  before insert or update on dominio.respuestas_rapidas
  for each row execute function private.normalizar_respuesta_rapida();

alter table dominio.respuestas_rapidas enable row level security;

create policy respuestas_rapidas_select on dominio.respuestas_rapidas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('consultas')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.respuestas_rapidas from public, anon, authenticated;
grant select on dominio.respuestas_rapidas to authenticated;
