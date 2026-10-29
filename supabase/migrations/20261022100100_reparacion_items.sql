-- F-SVC-06 (MSF-362, épica MSF-199): ítems de mano de obra y repuestos de una reparación.
-- Esquema (Principio VII): `dominio.reparacion_items` es una entidad de negocio del taller (qué se cobra
-- por una reparación) → `dominio`, nunca `public`.
--
-- Seguridad:
--   * RLS por organización, nivel de `service_tecnico` (select con `lectura`/`edicion`) y tienda de la
--     reparación accesible (mismo criterio que 20261021170000).
--   * SIN políticas ni grants de insert/update/delete: las escrituras pasan por las RPC `security
--     definer` `agregar_item_reparacion` / `quitar_item_reparacion` (recalculan los totales en la misma
--     transacción). `anon` sin privilegios.
--   * FK compuestas `(reparacion_id, organizacion_id)` y `(producto_id, organizacion_id)`: un ítem no
--     puede apuntar a una reparación o un producto de otra organización.
--
-- Migración aditiva (tabla, índice, política y grants nuevos).
-- Reversión (migración posterior, no en este PR; exportar antes los datos):
--   drop table dominio.reparacion_items;

create table dominio.reparacion_items (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  reparacion_id uuid not null,
  tipo text not null check (tipo in ('mano_obra', 'repuesto')),
  descripcion text not null check (btrim(descripcion) <> '' and length(descripcion) <= 200),
  producto_id uuid,
  cantidad integer not null check (cantidad between 1 and 9999),
  -- ARS sin IVA.
  precio_unitario numeric(10, 2) not null
    check (precio_unitario >= 0 and precio_unitario <= 99999999.99),
  subtotal numeric(14, 2) generated always as (round(cantidad * precio_unitario, 2)) stored,
  creado_en timestamptz not null default now(),
  creado_por uuid references auth.users (id) on delete set null,
  constraint reparacion_items_reparacion_fk foreign key (reparacion_id, organizacion_id)
    references dominio.reparaciones (id, organizacion_id),
  constraint reparacion_items_producto_fk foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id),
  -- Solo un repuesto se vincula al catálogo.
  constraint reparacion_items_producto_solo_repuesto_check
    check (producto_id is null or tipo = 'repuesto')
);

comment on table dominio.reparacion_items is
  'Ítems de mano de obra y repuestos de una reparación (F-SVC-06). Escritura solo por RPC; no mueve stock.';
comment on column dominio.reparacion_items.precio_unitario is 'ARS sin IVA (máximo 99.999.999,99).';

create index IF NOT EXISTS reparacion_items_reparacion_idx on dominio.reparacion_items (reparacion_id, creado_en);
create index IF NOT EXISTS reparacion_items_producto_idx on dominio.reparacion_items (producto_id) where producto_id is not null;

alter table dominio.reparacion_items enable row level security;

create policy reparacion_items_select on dominio.reparacion_items
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
    and exists (
      select 1 from dominio.reparaciones r
      where r.id = reparacion_items.reparacion_id
        and r.empresa_id in (select private.empresas_accesibles())
    )
  );

revoke all on dominio.reparacion_items from public, anon, authenticated;
grant select on dominio.reparacion_items to authenticated;
