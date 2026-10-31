-- F-SVC-20 (MSF-134, épica MSF-124): fotos y adjuntos del equipo de una reparación.
-- Esquema (Principio VII): `dominio.reparacion_adjuntos` es una entidad de negocio del taller (qué fotos
-- tiene una reparación) → `dominio`, nunca `public`.
--
-- Seguridad:
--   * RLS por organización, nivel de `service_tecnico` (select con `lectura`/`edicion`) y tienda de la
--     reparación accesible (mismo criterio que 20261020140000).
--   * SIN políticas ni grants de insert/update/delete: las escrituras pasan por las RPC `security
--     definer` `registrar_adjunto_reparacion` / `quitar_adjunto_reparacion`. `anon` sin privilegios.
--   * FK compuesta `(reparacion_id, organizacion_id)`: un adjunto no apunta a una reparación ajena.
--   * `ruta` única y obligatoriamente dentro del prefijo `<organizacion_id>/<reparacion_id>/`.
--
-- Migración aditiva (tabla, índice, política y grants nuevos).
-- Reversión (migración posterior, no en este PR; exportar antes los datos y vaciar el bucket):
--   drop table dominio.reparacion_adjuntos;

create table dominio.reparacion_adjuntos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  reparacion_id uuid not null,
  -- <organizacion_id>/<reparacion_id>/<uuid>.<ext> en el bucket `reparacion-adjuntos`.
  ruta text not null,
  nombre_original text not null check (btrim(nombre_original) <> '' and length(nombre_original) <= 200),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer not null check (bytes between 1 and 5242880),
  creado_por uuid references auth.users (id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint reparacion_adjuntos_reparacion_fk foreign key (reparacion_id, organizacion_id)
    references dominio.reparaciones (id, organizacion_id),
  constraint reparacion_adjuntos_ruta_unica unique (ruta),
  constraint reparacion_adjuntos_ruta_check check (
    length(ruta) <= 300
    and ruta ~* '\.(jpe?g|png|webp)$'
    and left(ruta, length(organizacion_id::text) + length(reparacion_id::text) + 2)
        = organizacion_id::text || '/' || reparacion_id::text || '/'
  )
);

comment on table dominio.reparacion_adjuntos is
  'Fotos y adjuntos del equipo de una reparación (F-SVC-20), máx. 20. El archivo vive en el bucket privado reparacion-adjuntos. Escritura solo por RPC.';

create index reparacion_adjuntos_reparacion_idx on dominio.reparacion_adjuntos (reparacion_id, creado_en);

alter table dominio.reparacion_adjuntos enable row level security;

create policy reparacion_adjuntos_select on dominio.reparacion_adjuntos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
    and exists (
      select 1 from dominio.reparaciones r
      where r.id = reparacion_adjuntos.reparacion_id
        and r.empresa_id in (select private.empresas_accesibles())
    )
  );

revoke all on dominio.reparacion_adjuntos from public, anon, authenticated;
grant select on dominio.reparacion_adjuntos to authenticated;
