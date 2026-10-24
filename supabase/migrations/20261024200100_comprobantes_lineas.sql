-- F-VTA-06 (MSF-295, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-010):
-- líneas de los comprobantes de venta.
--
-- Esquema (Principio VII): `dominio.comprobantes_venta_lineas` es dominio del producto (qué se vendió,
-- a qué precio y desde qué depósito) → `dominio`, nunca `public`.
--
-- Cada línea guarda una COPIA de lo que se vio al cotizar (descripción, código, precio, escala, alícuota):
-- el documento no cambia si después se edita el producto. El precio y la escala los calcula la RPC
-- `guardar_lineas_comprobante` (20261024200300); nadie escribe la tabla directamente.
--
-- RLS: por organización y sección `ventas` (`lectura` o `edicion`), igual que `comprobantes_venta`. Sin
-- políticas de escritura ni DELETE para `authenticated`: solo la RPC `security definer` (reemplazo
-- transaccional). `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes si hay datos):
--   drop table dominio.comprobantes_venta_lineas;

create table dominio.comprobantes_venta_lineas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  comprobante_id uuid not null,
  orden integer not null check (orden > 0),
  producto_id uuid not null,
  descripcion text not null check (btrim(descripcion) <> ''),
  codigo text,
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(14, 2) not null check (precio_unitario >= 0),
  escala text not null check (escala in ('x1', 'x5', 'x10', 'x50')),
  precio_manual boolean not null default false,
  alicuota_id uuid,
  alicuota_porcentaje numeric(5, 2) not null default 0 check (alicuota_porcentaje >= 0),
  deposito_id uuid not null,
  a_pedido boolean not null default false,
  subtotal_sin_iva numeric(14, 2) not null check (subtotal_sin_iva >= 0),
  iva numeric(14, 2) not null check (iva >= 0),
  creado_en timestamptz not null default now(),
  unique (comprobante_id, orden),
  foreign key (comprobante_id, organizacion_id)
    references dominio.comprobantes_venta (id, organizacion_id) on delete cascade,
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id),
  foreign key (deposito_id, organizacion_id)
    references dominio.depositos (id, organizacion_id)
);

comment on table dominio.comprobantes_venta_lineas is
  'Líneas de un comprobante de venta (F-VTA-06): copia del producto, cantidad, precio sin IVA, escala aplicada, depósito de salida y totales de la línea. Solo las escribe guardar_lineas_comprobante.';
comment on column dominio.comprobantes_venta_lineas.escala is
  'Escala de precio aplicada (x1/x5/x10/x50), según la cantidad de la línea y el tipo de cliente.';
comment on column dominio.comprobantes_venta_lineas.precio_manual is
  'true si el precio lo fijó una persona con la acción editar_precio; el recálculo lo respeta.';
comment on column dominio.comprobantes_venta_lineas.a_pedido is
  'Copia de la disponibilidad «A pedido» del producto al guardar: no descuenta stock (F-VTA-07 reserva).';

create index if not exists comprobantes_venta_lineas_organizacion_idx on dominio.comprobantes_venta_lineas (organizacion_id);
create index if not exists comprobantes_venta_lineas_producto_idx on dominio.comprobantes_venta_lineas (producto_id);
create index if not exists comprobantes_venta_lineas_deposito_idx on dominio.comprobantes_venta_lineas (deposito_id);

alter table dominio.comprobantes_venta_lineas enable row level security;

create policy comprobantes_venta_lineas_select on dominio.comprobantes_venta_lineas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

revoke all on dominio.comprobantes_venta_lineas from anon, public;
grant select on dominio.comprobantes_venta_lineas to authenticated;
