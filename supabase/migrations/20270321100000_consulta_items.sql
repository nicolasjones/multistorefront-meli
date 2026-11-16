-- MSF-176 · Tienda compra y cuentas, historia B1 «Lista de pedido sin cobro» (F-CLI-20 / MSF-176), T030. FR-030, FR-031.
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * dominio.consulta_items (tabla NUEVA)          -> `dominio`: líneas de una consulta del negocio (copia de lo que vio el
--                                                       visitante: nombre, SKU, cantidad y el precio de referencia que calculó el
--                                                       servidor). Hoy `dominio.consultas` tiene un solo `producto_id` sin cantidad.
--   * dominio.consultas (ALTERADA)                  -> `dominio`: la tabla ya es de dominio y tiene RLS. `origen` suma `pedido`,
--                                                       columna `cliente_id` nullable (la fija el servidor solo con cuenta activa) y
--                                                       `consultas_mensaje_requerido` exime a `pedido` (la nota es opcional).
--   * dominio.tienda_envios (ALTERADA)              -> `dominio`: `origen` suma `pedido` y `presupuesto` (mismo límite por visitante).
--   * public.consulta_items_bandeja (vista NUEVA)   -> `public`: superficie de lectura del panel, `security_invoker` (hereda la RLS).
--   * public.consultas_bandeja (vista ALTERADA)     -> `public`: suma al FINAL `cliente_id`, `items_cantidad`, `cliente_numero` y
--                                                       `cliente_nombre` (cambio aditivo; no almacena datos).
--   * private.numero_cliente_consulta / nombre_cliente_consulta -> `private`: helpers de lectura acotados a la organización de la
--                                                       sesión (mismo patrón que `nombre_producto_consulta`).
--
-- Seguridad de `dominio.consulta_items`:
--   * RLS por organización, empresa accesible y sección `consultas` >= lectura (igual que `dominio.consultas`).
--   * `select` solo para `authenticated`; SIN políticas ni grants de escritura (la única escritura es
--     `private.crear_consulta_pedido`, security definer, sin execute de API); `anon` sin ningún privilegio.
--   * FK compuestas con `organizacion_id` (una línea no puede apuntar a otra organización ni a la consulta de otra empresa).
--
-- DDL idempotente (`if [not] exists`). Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR; exportar antes
-- los datos personales de consultas):
--   drop view if exists public.consulta_items_bandeja;
--   (consultas_bandeja: recrearla con `drop view` + la definición de 20270201100100, que no tiene las cuatro columnas nuevas)
--   drop table if exists dominio.consulta_items;
--   alter table dominio.consultas drop constraint if exists consultas_cliente_fk, drop column if exists cliente_id;
--   restaurar los `check` de `origen` y `consultas_mensaje_requerido` SOLO si no quedan filas `pedido`/`presupuesto`.

-- ============================================================================
-- dominio.consultas: origen `pedido`, cliente_id, nota opcional
-- ============================================================================
alter table dominio.consultas drop constraint if exists consultas_origen_check;
alter table dominio.consultas
  add constraint consultas_origen_check check (origen in ('formulario', 'whatsapp', 'pedido'));

-- Solo el origen WhatsApp puede venir sin mensaje (prototipo: «No dejó mensaje»); desde acá también el pedido (la nota es opcional).
alter table dominio.consultas drop constraint if exists consultas_mensaje_requerido;
alter table dominio.consultas
  add constraint consultas_mensaje_requerido check (origen in ('whatsapp', 'pedido') or btrim(coalesce(mensaje, '')) <> '');

alter table dominio.consultas add column if not exists cliente_id uuid;
-- `on delete set null (cliente_id)`: borrar un cliente no frena ni toca la organización de la consulta (PostgreSQL 15+).
alter table dominio.consultas drop constraint if exists consultas_cliente_fk;
alter table dominio.consultas
  add constraint consultas_cliente_fk foreign key (cliente_id, organizacion_id)
    references public.clientes (id, organizacion_id) on delete set null (cliente_id);

create index if not exists consultas_cliente_id_idx on dominio.consultas (cliente_id) where cliente_id is not null;

-- Clave candidata para que las líneas apunten a la consulta de SU empresa y SU organización.
create unique index if not exists consultas_id_org_empresa_uq on dominio.consultas (id, organizacion_id, empresa_id);

comment on column dominio.consultas.cliente_id is
  'MSF-176 (B1, D-8): cliente de la cuenta web activa que envió el pedido. Lo fija SOLO el servidor (private.crear_consulta_pedido) a partir de la sesión; nunca viene del llamador. Null en consultas de visitantes.';

-- ============================================================================
-- dominio.tienda_envios: orígenes `pedido` y `presupuesto`
-- ============================================================================
alter table dominio.tienda_envios drop constraint if exists tienda_envios_origen_check;
alter table dominio.tienda_envios
  add constraint tienda_envios_origen_check check (origen in ('formulario', 'whatsapp', 'pedido', 'presupuesto'));

-- ============================================================================
-- dominio.consulta_items
-- ============================================================================
create table if not exists dominio.consulta_items (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  empresa_id uuid not null,
  consulta_id uuid not null,
  orden integer not null,
  producto_id uuid,
  descripcion text not null,
  sku text,
  cantidad integer not null,
  precio_referencia numeric,
  creado_en timestamptz not null default now(),
  constraint consulta_items_orden_ck check (orden between 1 and 50),
  constraint consulta_items_cantidad_ck check (cantidad between 1 and 9999),
  constraint consulta_items_descripcion_ck check (btrim(descripcion) <> '' and length(descripcion) <= 300),
  constraint consulta_items_sku_ck check (sku is null or length(sku) <= 100),
  constraint consulta_items_precio_ck check (precio_referencia is null or (precio_referencia >= 0 and precio_referencia < 1000000000000)),
  constraint consulta_items_orden_uq unique (consulta_id, orden),
  constraint consulta_items_consulta_fk
    foreign key (consulta_id, organizacion_id, empresa_id)
    references dominio.consultas (id, organizacion_id, empresa_id) on delete cascade,
  constraint consulta_items_empresa_fk
    foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  -- Si el producto se borra, la línea conserva su descripción y SKU (copia de lo que vio la persona).
  constraint consulta_items_producto_fk
    foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete set null (producto_id)
);

create index if not exists consulta_items_organizacion_idx on dominio.consulta_items (organizacion_id);
create index if not exists consulta_items_empresa_idx on dominio.consulta_items (empresa_id, organizacion_id);
create index if not exists consulta_items_producto_idx on dominio.consulta_items (producto_id, organizacion_id) where producto_id is not null;

comment on table dominio.consulta_items is
  'MSF-176 (B1): líneas de una consulta de origen pedido (lista de pedido de la tienda): descripción y SKU copiados del producto, cantidad y precio_referencia calculado por el servidor (nunca recibido del cliente). Sin escritura desde la API: solo private.crear_consulta_pedido. Datos personales por vía de la consulta: sin purga automática (D-20).';
comment on column dominio.consulta_items.precio_referencia is
  'Precio unitario de referencia que el servidor calculó al enviar (el que vio la persona en la tienda): NO es firme, se confirma al responder.';

alter table dominio.consulta_items enable row level security;

drop policy if exists consulta_items_select on dominio.consulta_items;
create policy consulta_items_select on dominio.consulta_items
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('consultas')) in ('lectura', 'edicion')
  );

revoke all on dominio.consulta_items from public, anon, authenticated;
grant select on dominio.consulta_items to authenticated;
-- service_role (API admin) opera la tabla como toda tabla operativa de dominio (pgTAP `service_role_privilegios`).
grant select, insert, update, delete on dominio.consulta_items to service_role;

-- ============================================================================
-- Lectura del panel
-- ============================================================================
create or replace view public.consulta_items_bandeja
with (security_invoker = true) as
select
  i.consulta_id,
  i.empresa_id,
  i.orden,
  i.producto_id,
  i.descripcion,
  i.sku,
  i.cantidad,
  i.precio_referencia
from dominio.consulta_items i;

revoke all on public.consulta_items_bandeja from public, anon, authenticated;
grant select on public.consulta_items_bandeja to authenticated;

comment on view public.consulta_items_bandeja is
  'MSF-176 (B1, FR-031): ítems de las consultas de pedido (security_invoker: RLS de dominio.consulta_items). Sin anon.';

-- Número y nombre del cliente de la consulta: acotados a la organización de la sesión (quien ve consultas puede no tener acceso
-- a Clientes), igual que el nombre del producto y del responsable.
create or replace function private.numero_cliente_consulta(p_cliente_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select c.numero
    from public.clientes c
   where c.id = p_cliente_id
     and c.organizacion_id = (select private.organizacion_id());
$$;

create or replace function private.nombre_cliente_consulta(p_cliente_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.nombre
    from public.clientes c
   where c.id = p_cliente_id
     and c.organizacion_id = (select private.organizacion_id());
$$;

revoke execute on function private.numero_cliente_consulta(uuid) from public, anon;
revoke execute on function private.nombre_cliente_consulta(uuid) from public, anon;
grant execute on function private.numero_cliente_consulta(uuid) to authenticated;
grant execute on function private.nombre_cliente_consulta(uuid) to authenticated;

-- `consultas_bandeja`: las columnas nuevas van AL FINAL (create or replace view no permite reordenar). `items_cantidad` cuenta lo que
-- la RLS de las líneas deja ver (0 si la consulta no es un pedido).
create or replace view public.consultas_bandeja
with (security_invoker = true) as
select
  c.id,
  c.empresa_id,
  e.nombre as empresa_nombre,
  c.origen,
  c.nombre,
  c.contacto,
  c.mensaje,
  c.producto_id,
  private.nombre_producto_consulta(c.producto_id) as producto_nombre,
  c.estado,
  c.responsable_id,
  private.nombre_responsable_consulta(c.responsable_id) as responsable_nombre,
  c.nota_interna,
  c.created_at,
  c.updated_at,
  c.contacto_id,
  c.cliente_id,
  (select count(*)::integer from dominio.consulta_items i where i.consulta_id = c.id) as items_cantidad,
  private.numero_cliente_consulta(c.cliente_id) as cliente_numero,
  private.nombre_cliente_consulta(c.cliente_id) as cliente_nombre
from dominio.consultas c
join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id;

revoke all on public.consultas_bandeja from public, anon, authenticated;
grant select on public.consultas_bandeja to authenticated;

comment on view public.consultas_bandeja is
  'MSF-186 + MSF-176: bandeja de consultas (security_invoker: RLS de dominio.consultas). producto_nombre es null si la consulta no tiene producto; items_cantidad = ítems del pedido (0 si no es pedido); cliente_* = cliente de la cuenta web que lo envió (null si fue un visitante).';
