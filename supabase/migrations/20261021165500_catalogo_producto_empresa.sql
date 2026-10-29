-- F-CAT-07 (MSF-276, épica MSF-160): empresas (tiendas) que venden cada producto.
-- Esquemas (Principio VII), verificados tabla por tabla:
--   dominio.producto_empresa  dominio (nueva)     relación de negocio producto ↔ empresa que lo vende,
--                                                 junto a dominio.productos y dominio.empresas.
--   dominio.empresas          dominio (existente) solo suma una restricción única (id, organizacion_id)
--                                                 para la FK compuesta; `id` ya es PK, no cambia datos.
-- Aísla por organización con RLS y FKs compuestas (una fila no puede cruzar organizaciones).
-- Sin cantidad fija de empresas (N). Un producto nuevo no se vende en ninguna hasta marcarlas.
--
-- Migración aditiva. Reversión (migración posterior, no en este PR; la tabla es dato nuevo):
--   drop table dominio.producto_empresa;
--   alter table dominio.empresas drop constraint empresas_id_organizacion_uk;

alter table dominio.empresas
  add constraint empresas_id_organizacion_uk unique (id, organizacion_id);

create table dominio.producto_empresa (
  producto_id uuid not null,
  empresa_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (producto_id, empresa_id),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade,
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.producto_empresa is
  'F-CAT-07: empresas (tiendas) que venden un producto. Escritura por public.definir_empresas_producto; lectura por RLS de organización y sección productos. Sin UPDATE: se agrega o se quita.';

-- Filtro de tienda del listado y borrado en cascada por empresa.
create index IF NOT EXISTS producto_empresa_empresa_idx on dominio.producto_empresa (empresa_id, producto_id);
create index IF NOT EXISTS producto_empresa_org_idx on dominio.producto_empresa (organizacion_id);

alter table dominio.producto_empresa enable row level security;

create policy producto_empresa_select on dominio.producto_empresa
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

create policy producto_empresa_insert on dominio.producto_empresa
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

create policy producto_empresa_delete on dominio.producto_empresa
  for delete to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

-- Sin privilegios para anon y sin UPDATE para nadie.
revoke all on dominio.producto_empresa from public, anon, authenticated;
grant select, delete on dominio.producto_empresa to authenticated;
grant insert (producto_id, empresa_id, organizacion_id) on dominio.producto_empresa to authenticated;
