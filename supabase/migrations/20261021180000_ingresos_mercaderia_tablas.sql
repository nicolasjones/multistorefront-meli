-- F-PRV-04 (MSF-383, épica MSF-219): tablas del ingreso de mercadería por proveedor.
-- Esquema (Principio VII): `dominio.ingresos_mercaderia` y sus líneas son entidades
-- del negocio → `dominio`, nunca `public`. Las RPC se publican en `public`.
--
-- El stock es único por organización (MSF-136): este ingreso no guarda depósito ni
-- separa Local/Depósito. Cada línea se vincula al movimiento de entrada que crea
-- `public.registrar_movimiento_stock`; la anulación se vincula al movimiento de salida.
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los datos):
--   drop table dominio.ingresos_mercaderia_lineas;
--   drop table dominio.ingresos_mercaderia;
--   delete from dominio.motivos_movimiento where lower(btrim(nombre)) = 'anulación de ingreso de mercadería';
--   -- y restaurar private.sembrar_motivos_movimiento a la definición de 20261017140000.

-- ============================================================================
-- dominio.ingresos_mercaderia
-- ============================================================================

create table dominio.ingresos_mercaderia (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete restrict,
  proveedor_id uuid not null,
  fecha date not null,
  comprobante text check (comprobante is null or length(comprobante) <= 100),
  estado text not null default 'registrado' check (estado in ('registrado', 'anulado')),
  motivo_anulacion text check (
    motivo_anulacion is null
    or length(btrim(motivo_anulacion)) between 3 and 500
  ),
  anulado_por uuid,
  anulado_en timestamptz,
  actor_id uuid,
  actor_nombre text,
  clave_idempotencia uuid not null default gen_random_uuid(),
  creado_en timestamptz not null default now(),
  foreign key (proveedor_id, organizacion_id)
    references dominio.proveedores (id, organizacion_id) on delete restrict,
  constraint ingresos_mercaderia_anulacion_ck check (
    (estado = 'registrado'
      and motivo_anulacion is null
      and anulado_por is null
      and anulado_en is null)
    or
    (estado = 'anulado'
      and motivo_anulacion is not null
      and anulado_por is not null
      and anulado_en is not null)
  ),
  unique (organizacion_id, clave_idempotencia)
);

comment on table dominio.ingresos_mercaderia is
  'Cabecera del ingreso de mercadería por proveedor (F-PRV-04). Se anula, no se edita ni se borra.';
comment on column dominio.ingresos_mercaderia.clave_idempotencia is
  'Clave generada por el cliente para que un reintento devuelva el mismo ingreso sin volver a mover stock.';
comment on column dominio.ingresos_mercaderia.estado is
  'registrado | anulado. La anulación crea una salida por línea y conserva el historial.';

create index IF NOT EXISTS ingresos_mercaderia_org_creado_idx
  on dominio.ingresos_mercaderia (organizacion_id, creado_en desc, id);
create index IF NOT EXISTS ingresos_mercaderia_org_proveedor_idx
  on dominio.ingresos_mercaderia (organizacion_id, proveedor_id, fecha desc);
create index IF NOT EXISTS ingresos_mercaderia_org_empresa_idx
  on dominio.ingresos_mercaderia (organizacion_id, empresa_id, fecha desc);

alter table dominio.ingresos_mercaderia enable row level security;

create policy ingresos_mercaderia_select on dominio.ingresos_mercaderia
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- dominio.ingresos_mercaderia_lineas
-- ============================================================================

create table dominio.ingresos_mercaderia_lineas (
  id uuid primary key default gen_random_uuid(),
  ingreso_id uuid not null references dominio.ingresos_mercaderia (id) on delete cascade,
  organizacion_id uuid not null,
  producto_id uuid not null,
  cantidad integer not null check (cantidad > 0),
  costo_unitario_usd numeric(14, 2) not null check (costo_unitario_usd >= 0),
  movimiento_id uuid not null unique references dominio.movimientos_stock (id) on delete restrict,
  movimiento_anulacion_id uuid unique references dominio.movimientos_stock (id) on delete restrict,
  creado_en timestamptz not null default now(),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete restrict,
  unique (ingreso_id, producto_id)
);

comment on table dominio.ingresos_mercaderia_lineas is
  'Líneas del ingreso (F-PRV-04): producto, cantidad y costo unitario USD; una por producto.';
comment on column dominio.ingresos_mercaderia_lineas.costo_unitario_usd is
  'Costo de compra en USD. Se copia a dominio.producto_costos solo si se pidió actualizar el costo.';

create index IF NOT EXISTS ingresos_mercaderia_lineas_org_producto_idx
  on dominio.ingresos_mercaderia_lineas (organizacion_id, producto_id);
create index IF NOT EXISTS ingresos_mercaderia_lineas_ingreso_idx
  on dominio.ingresos_mercaderia_lineas (ingreso_id);

alter table dominio.ingresos_mercaderia_lineas enable row level security;

create policy ingresos_mercaderia_lineas_select on dominio.ingresos_mercaderia_lineas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- Motivo de anulación (dato, no esquema)
-- ============================================================================

create or replace function private.sembrar_motivos_movimiento(p_organizacion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
  values
    (p_organizacion_id, 'Compra a proveedor', '{entrada}'),
    (p_organizacion_id, 'Venta en local', '{salida}'),
    (p_organizacion_id, 'Conteo de inventario', '{ajuste}'),
    (p_organizacion_id, 'Devolución', '{entrada,salida}'),
    (p_organizacion_id, 'Rotura o pérdida', '{salida,ajuste}'),
    (p_organizacion_id, 'Anulación de ingreso de mercadería', '{salida}')
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
$$;

revoke execute on function private.sembrar_motivos_movimiento(uuid) from public, anon, authenticated;

insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
select o.id, 'Anulación de ingreso de mercadería', '{salida}'::text[]
from public.organizaciones o
on conflict (organizacion_id, lower(btrim(nombre))) do nothing;

-- ============================================================================
-- Grants: solo lectura para authenticated; escribe únicamente la RPC
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.ingresos_mercaderia, dominio.ingresos_mercaderia_lineas
  from public, anon, authenticated;

grant select on dominio.ingresos_mercaderia, dominio.ingresos_mercaderia_lineas
  to authenticated;
