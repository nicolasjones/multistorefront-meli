-- F-PRV-09 (MSF-454, épica MSF-450, spec 20261109-103000-ordenes-de-compra-a-proveedores):
-- tablas de la orden de compra a proveedor.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.ordenes_compra       dominio (NUEVA, cabecera del pedido)   qué se le pide a un proveedor:
--                                                                     empresa, fecha, estado y sus líneas.
--   dominio.ordenes_compra_items  dominio (NUEVA, línea del pedido)     producto y cantidad pedida.
--   dominio.proveedores           dominio (existente)                   el proveedor del pedido (F-PRV-01).
--   dominio.productos             dominio (existente)                   el producto pedido: un producto tiene
--                                                                     UN proveedor (F-PRV-03).
--   dominio.empresas              dominio (existente)                   «a nombre de» quién se compra.
--   public.organizaciones         plataforma                            solo se referencia (organización).
-- Ninguna tabla de `public` se crea ni se altera: la organización, el actor y el permiso salen de la sesión.
--
-- RLS: por organización y por nivel de la sección `stock` (`private.nivel_seccion('stock')`): lectura
-- con `lectura` o `edicion`. SIN políticas de escritura: las órdenes las escriben SOLO las RPC
-- `security definer` de esta historia (`crear_orden_compra`, `cambiar_estado_orden_compra`).
-- `anon` sin privilegios.
--
-- El dato: una orden es de UN proveedor y sus productos son los de ese proveedor (no hay «varios
-- proveedores por producto» ni «compra para» en esta historia). La recepción NO mueve stock: el
-- stock entra por «Ingreso de mercadería» (F-PRV-04), que esta historia no modifica.
--
-- Migración aditiva. Reversión (en una migración posterior; las órdenes cargadas son dato nuevo de
-- esta historia: exportarlas antes):
--   drop table if exists dominio.ordenes_compra_items;
--   drop table if exists dominio.ordenes_compra;

-- ============================================================================
-- dominio.ordenes_compra
-- ============================================================================

create table if not exists dominio.ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  -- La organización sale de la sesión: el llamador no la fija (sin grant de columna).
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  proveedor_id uuid not null,
  fecha date not null default current_date,
  estado text not null default 'emitida' check (estado in ('emitida', 'recibida', 'anulada')),
  observaciones text check (observaciones is null or length(observaciones) <= 1000),
  fecha_recepcion date,
  motivo_anulacion text check (
    motivo_anulacion is null
    or length(btrim(motivo_anulacion)) between 3 and 500
  ),
  anulado_por uuid,
  anulado_en timestamptz,
  creado_por uuid references auth.users (id) on delete set null,
  creado_en timestamptz not null default now(),
  -- Habilita la FK compuesta de las líneas: una línea no puede apuntar a una orden ajena.
  unique (id, organizacion_id),
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete restrict,
  foreign key (proveedor_id, organizacion_id)
    references dominio.proveedores (id, organizacion_id) on delete restrict,
  -- Un estado, sus datos y nada más: no se mezclan «recibida» sin fecha ni «anulada» sin motivo.
  constraint ordenes_compra_estado_ck check (
    (estado = 'emitida'
      and fecha_recepcion is null
      and motivo_anulacion is null
      and anulado_por is null
      and anulado_en is null)
    or
    (estado = 'recibida'
      and fecha_recepcion is not null
      and motivo_anulacion is null
      and anulado_por is null
      and anulado_en is null)
    or
    (estado = 'anulada'
      and fecha_recepcion is null
      and motivo_anulacion is not null
      and anulado_por is not null
      and anulado_en is not null)
  )
);

comment on table dominio.ordenes_compra is
  'Órdenes de compra a proveedor (F-PRV-09). Se anulan, no se editan ni se borran. La recepción no mueve stock: la mercadería entra por Ingreso de mercadería.';
comment on column dominio.ordenes_compra.estado is
  'emitida | recibida | anulada. Los dos últimos estados son finales.';
comment on column dominio.ordenes_compra.empresa_id is
  'Empresa a nombre de quien se compra (la empresa activa de la barra superior por omisión).';

create index ordenes_compra_org_creado_idx
  on dominio.ordenes_compra (organizacion_id, fecha desc, id);
create index ordenes_compra_org_empresa_idx
  on dominio.ordenes_compra (organizacion_id, empresa_id, fecha desc);
create index ordenes_compra_org_proveedor_idx
  on dominio.ordenes_compra (organizacion_id, proveedor_id, fecha desc);

alter table dominio.ordenes_compra enable row level security;

create policy ordenes_compra_select on dominio.ordenes_compra
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- dominio.ordenes_compra_items
-- ============================================================================

create table if not exists dominio.ordenes_compra_items (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null,
  organizacion_id uuid not null,
  producto_id uuid not null,
  cantidad integer not null check (cantidad > 0),
  creado_en timestamptz not null default now(),
  foreign key (orden_id, organizacion_id)
    references dominio.ordenes_compra (id, organizacion_id) on delete cascade,
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete restrict,
  -- Una línea por producto: la misma mercadería no se pide dos veces en la misma orden.
  unique (orden_id, producto_id)
);

comment on table dominio.ordenes_compra_items is
  'Líneas de la orden de compra (F-PRV-09): producto y cantidad pedida. Sin costo: el costo se conoce al ingresar la mercadería.';

create index ordenes_compra_items_org_producto_idx
  on dominio.ordenes_compra_items (organizacion_id, producto_id);
create index ordenes_compra_items_orden_idx
  on dominio.ordenes_compra_items (orden_id);

alter table dominio.ordenes_compra_items enable row level security;

create policy ordenes_compra_items_select on dominio.ordenes_compra_items
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- Privilegios
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.ordenes_compra, dominio.ordenes_compra_items
  from public, anon, authenticated;
grant select on dominio.ordenes_compra, dominio.ordenes_compra_items to authenticated;
