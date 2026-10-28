-- F-VTA-28 (MSF-288, épica MSF-178, spec 20261027-100000-ventas-rma-devoluciones, FR-001): tablas del RMA
-- (devolución o reclamo por ítem de un comprobante vendido).
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.rma        dominio (nueva)  devolución/reclamo de venta: entidad de negocio del producto.
--   dominio.rma_items  dominio (nueva)  detalle por ítem: línea del comprobante y cantidad.
--   dominio.comprobantes_venta_lineas  dominio (existente)  solo recibe un índice único (id, organizacion_id)
--                                                           para la FK compuesta; sin cambio de estructura.
--
-- RLS por organización y sección `ventas` (`select` con `lectura` o `edicion`), igual que `comprobantes_venta_lineas`.
-- SIN políticas ni grants de escritura: solo escriben las RPC `security definer` (`registrar_rma`, 20270111120100).
-- `anon` sin privilegios.
--
-- Formas y estados son valores fijos (`check`), no tablas: Decisiones abiertas 5 de la spec.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes si Ventas ya escribe):
--   drop table dominio.rma_items;
--   drop table dominio.rma;
--   drop index dominio.comprobantes_venta_lineas_id_org_uq;   -- solo si ninguna otra FK lo usa

create unique index if not exists comprobantes_venta_lineas_id_org_uq
  on dominio.comprobantes_venta_lineas (id, organizacion_id);

create table dominio.rma (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  comprobante_id uuid not null,
  numero text not null check (numero ~ '^RMA-[0-9]{4,}$'),
  forma_rma text not null
    check (forma_rma in ('cambio_directo', 'enviado_a_proveedor', 'faltante_envio', 'reclamo_faltante', 'devolucion_importe')),
  motivo text not null check (btrim(motivo) <> '' and length(motivo) <= 200),
  observaciones text check (observaciones is null or length(observaciones) <= 1000),
  estado text not null default 'abierto' check (estado in ('abierto', 'en_gestion', 'cerrado')),
  operador_id uuid references auth.users (id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (id, organizacion_id),
  unique (organizacion_id, numero),
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id),
  foreign key (comprobante_id, organizacion_id) references dominio.comprobantes_venta (id, organizacion_id)
);

comment on table dominio.rma is
  'Devolución o reclamo por ítem sobre una factura vendida (F-VTA-28). Sin escritura directa: solo registrar_rma y las RPC de seguimiento.';
comment on column dominio.rma.numero is 'Correlativo por organización con formato RMA-0001.';
comment on column dominio.rma.estado is 'abierto → en_gestion → cerrado (F-VTA-29 gobierna las transiciones).';
comment on column dominio.rma.actualizado_en is 'Bloqueo optimista de los cambios de estado (F-VTA-29).';

create table dominio.rma_items (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  rma_id uuid not null,
  comprobante_linea_id uuid not null,
  producto_id uuid not null,
  cantidad integer not null check (cantidad > 0),
  creado_en timestamptz not null default now(),
  unique (rma_id, comprobante_linea_id),
  foreign key (rma_id, organizacion_id) references dominio.rma (id, organizacion_id) on delete cascade,
  foreign key (comprobante_linea_id, organizacion_id)
    references dominio.comprobantes_venta_lineas (id, organizacion_id),
  foreign key (producto_id, organizacion_id) references dominio.productos (id, organizacion_id)
);

comment on table dominio.rma_items is
  'Ítems de un RMA: línea del comprobante y cantidad devuelta (F-VTA-28). Sin escritura directa.';

create index if not exists rma_organizacion_creado_idx on dominio.rma (organizacion_id, creado_en desc);
create index if not exists rma_comprobante_idx on dominio.rma (comprobante_id);
create index if not exists rma_empresa_idx on dominio.rma (empresa_id);
create index if not exists rma_items_rma_idx on dominio.rma_items (rma_id);
create index if not exists rma_items_linea_idx on dominio.rma_items (comprobante_linea_id);
create index if not exists rma_items_producto_idx on dominio.rma_items (producto_id);

alter table dominio.rma enable row level security;
alter table dominio.rma_items enable row level security;

create policy rma_select on dominio.rma
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy rma_items_select on dominio.rma_items
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

revoke all on dominio.rma from anon, public;
revoke all on dominio.rma_items from anon, public;
grant select on dominio.rma to authenticated;
grant select on dominio.rma_items to authenticated;
