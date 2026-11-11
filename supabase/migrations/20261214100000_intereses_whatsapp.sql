-- MSF-226 · F-CON-02 (épica MSF-130, spec 20261024-140000-consultas-seguimiento-y-whatsapp, FR-001):
-- interés por WhatsApp registrado.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.intereses_whatsapp  dominio (nueva)  registro de negocio: cuántas veces un visitante tocó
--                                                «Consultar por WhatsApp» en un producto de una tienda.
--                                                No es un dato de plataforma → nunca `public`.
--   dominio.empresas / dominio.productos  dominio (existentes), solo se referencian.
--
-- SIN datos personales: ni nombre, ni teléfono, ni correo, ni IP, ni mensaje. Cada fila es un «toque».
--
-- Seguridad:
--   * RLS por organización, empresa accesible y sección `consultas` (lectura o edición).
--   * SIN insert, update ni delete desde la app: el alta es solo `publico.registrar_interes_whatsapp`
--     (SECURITY DEFINER, empresa resuelta por dominio).
--   * `anon` sin privilegios sobre la tabla.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos si los hay):
--   drop table dominio.intereses_whatsapp;   (antes, revertir 20261214100200 y 20261214100100)

create table if not exists dominio.intereses_whatsapp (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  producto_id uuid not null,
  created_at timestamptz not null default now(),
  constraint intereses_whatsapp_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint intereses_whatsapp_producto_fk foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

comment on table dominio.intereses_whatsapp is
  'F-CON-02: un registro por cada toque en «Consultar por WhatsApp» de un producto de una tienda. Sin datos personales. Alta solo por publico.registrar_interes_whatsapp; sin update ni delete desde la app.';

create index if not exists intereses_whatsapp_organizacion_id_idx on dominio.intereses_whatsapp (organizacion_id);
create index if not exists intereses_whatsapp_empresa_producto_idx
  on dominio.intereses_whatsapp (empresa_id, producto_id, created_at desc);
create index if not exists intereses_whatsapp_producto_id_idx on dominio.intereses_whatsapp (producto_id);

alter table dominio.intereses_whatsapp enable row level security;

-- Lectura: organización de la sesión, empresa accesible y sección `consultas`.
-- Sin políticas de escritura: nadie inserta, edita ni borra directo (ver encabezado).
drop policy if exists intereses_whatsapp_select on dominio.intereses_whatsapp;
create policy intereses_whatsapp_select on dominio.intereses_whatsapp
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('consultas')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.intereses_whatsapp from public, anon, authenticated;
grant select on dominio.intereses_whatsapp to authenticated;
