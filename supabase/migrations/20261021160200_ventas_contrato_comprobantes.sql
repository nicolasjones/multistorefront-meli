-- F-CLI-08 (MSF-238, épica MSF-126, spec 20261018-100000-ranking-de-clientes,
-- FR-001): contrato mínimo de datos de venta que lee el ranking de clientes.
--
-- Esquema (Principio VII): `dominio.comprobantes_venta` es un documento de venta,
-- entidad de negocio del producto → `dominio`, nunca `public`. `public.clientes`
-- no se altera (solo se le agrega un índice único aditivo para la FK compuesta).
-- RLS por organización y sección `ventas` (solo `select`). Sin políticas ni grants
-- de escritura: escribe Ventas (MSF-159/177) con sus propias migraciones aditivas.
-- `anon` sin privilegios.
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los
-- datos si Ventas ya escribe):
--   drop table dominio.comprobantes_venta;
--   drop index public.clientes_id_organizacion_uq;

-- Habilita la FK compuesta: un comprobante no puede apuntar a un cliente de otra organización.
create unique index if not exists clientes_id_organizacion_uq
  on public.clientes (id, organizacion_id);

create table dominio.comprobantes_venta (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  cliente_id uuid not null,
  tipo text not null check (tipo in ('factura', 'presupuesto')),
  numero text not null check (btrim(numero) <> ''),
  fecha date not null,
  estado text not null check (btrim(estado) <> ''),
  total_sin_iva numeric(14, 2) not null check (total_sin_iva >= 0),
  total_con_iva numeric(14, 2) not null check (total_con_iva >= total_sin_iva),
  creado_en timestamptz not null default now(),
  unique (id, organizacion_id),
  foreign key (cliente_id, organizacion_id)
    references public.clientes (id, organizacion_id)
);

comment on table dominio.comprobantes_venta is
  'Contrato de datos de venta (F-CLI-08): un documento por fila. Solo lectura para el panel; Ventas (MSF-159/177) escribe y completa el contrato con migraciones aditivas.';

create index IF NOT EXISTS comprobantes_venta_cliente_fecha_idx
  on dominio.comprobantes_venta (organizacion_id, cliente_id, fecha desc);
create index IF NOT EXISTS comprobantes_venta_fecha_idx
  on dominio.comprobantes_venta (organizacion_id, fecha);

alter table dominio.comprobantes_venta enable row level security;

create policy comprobantes_venta_select on dominio.comprobantes_venta
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;
revoke all on dominio.comprobantes_venta from anon, public;
grant select on dominio.comprobantes_venta to authenticated;
