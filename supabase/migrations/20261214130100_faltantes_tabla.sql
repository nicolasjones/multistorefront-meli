-- F-VTA-18 (MSF-201, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-040):
-- tabla de faltantes de venta: qué línea de una factura no se pudo despachar por falta de stock.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.faltantes_venta       dominio (NUEVA, registro de negocio)   qué línea del pedido quedó sin
--                                                                       stock: es un dato de negocio del
--                                                                       producto, nunca `public`.
--   dominio.comprobantes_venta    dominio (existente)                   la factura del faltante (FK compuesta).
--   dominio.productos              dominio (existente)                  el producto que faltó (FK compuesta).
--   dominio.depositos              dominio (existente)                  el depósito desde el que se armaba.
--   dominio.empresas               dominio (existente)                  la tienda del faltante (FK compuesta).
--   public.organizaciones          plataforma                           solo se referencia (organización).
--   auth.users                     plataforma                           solo se referencia (`registrado_por`).
-- Ninguna tabla de `public` se crea ni se altera: los permisos, la organización y el actor salen de la sesión.
--
-- RLS: por organización, empresa accesible y nivel de Ventas EN LA EMPRESA DEL FALTANTE, no en la empresa
-- activa (`private.puede_leer_faltantes_empresa`, el mismo patrón de `private.puede_leer_documento_empresa`).
-- Sin políticas de escritura ni DELETE: los faltantes los escribe SOLO la RPC `security definer`
-- `registrar_faltantes_despacho` (T029) y los resuelve el disparador de T030. `anon` sin privilegios.
--
-- El dato: una fila por línea de una factura que quedó sin stock. `cantidad_faltante` es lo que falta de lo
-- pedido (siempre mayor a cero) y `estado` va de `abierto` a `resuelto` (cuando el armado se reanuda, FR-042).
-- Un registro de faltante NO mueve stock: corregir el stock es de Stock · toma de inventario (spec, *Stock*).
--
-- Migración aditiva. Reversión (en una migración posterior; los faltantes cargados son dato nuevo de esta
-- épica: exportarlos antes):
--   drop table if exists dominio.faltantes_venta;
--   drop function if exists private.puede_leer_faltantes_empresa(uuid);

create table if not exists dominio.faltantes_venta (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  comprobante_id uuid not null,
  linea_orden integer not null check (linea_orden > 0),
  producto_id uuid not null,
  deposito_id uuid not null,
  cantidad_faltante integer not null check (cantidad_faltante > 0),
  estado text not null default 'abierto' check (estado in ('abierto', 'resuelto')),
  registrado_por uuid references auth.users (id) on delete set null,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  unique (id, organizacion_id),
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id),
  foreign key (comprobante_id, organizacion_id)
    references dominio.comprobantes_venta (id, organizacion_id) on delete cascade,
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id),
  foreign key (deposito_id, organizacion_id)
    references dominio.depositos (id, organizacion_id),
  -- `abierto` sin fecha de resolución y `resuelto` con ella: los dos estados no se mezclan.
  check ((estado = 'abierto') = (resuelto_en is null))
);

comment on table dominio.faltantes_venta is
  'Faltantes de venta (F-VTA-18, FR-040): línea de una factura que no se pudo despachar por falta de stock. Solo los escribe `registrar_faltantes_despacho`; un faltante no mueve stock.';
comment on column dominio.faltantes_venta.cantidad_faltante is
  'Unidades que faltaron de lo pedido en la línea (siempre mayor a cero).';
comment on column dominio.faltantes_venta.estado is
  '`abierto` (falta stock) o `resuelto` (el armado se reanudó y el faltante se cerró, FR-042).';
comment on column dominio.faltantes_venta.registrado_por is
  'Persona que registró el faltante. Referencia a auth.users: si se borra el usuario, queda nulo.';
comment on column dominio.faltantes_venta.creado_en is
  'Momento en que se registró el faltante (la columna «Desde» de la pantalla Faltantes).';
comment on column dominio.faltantes_venta.resuelto_en is
  'Momento en que el faltante pasó a `resuelto` (al reanudar el armado, FR-042).';

-- Una línea abierta por vez: la misma línea no puede tener dos faltantes abiertos (FR-040). Los faltantes ya
-- resueltos quedan como historial y no bloquean el índice.
create unique index if not exists faltantes_venta_abierto_uq
  on dominio.faltantes_venta (comprobante_id, linea_orden)
  where estado = 'abierto';

-- La pantalla Faltantes (F-VTA-18, FR-043) lee los abiertos por tienda y por fecha.
create index if not exists faltantes_venta_empresa_idx
  on dominio.faltantes_venta (organizacion_id, empresa_id, estado, creado_en desc);

alter table dominio.faltantes_venta enable row level security;

-- Lectura por empresa DEL FALTANTE (FR-040): `private.nivel_seccion('ventas')` toma el mejor rol entre todas
-- las empresas del usuario, así que no alcanza; `private.nivel_ventas_en_empresa` mira el rol en la empresa
-- concreta (igual que las RPC de despacho). `security definer` porque `nivel_ventas_en_empresa` no es
-- ejecutable por `authenticated`; las políticas sí la llaman.
create or replace function private.puede_leer_faltantes_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.nivel_ventas_en_empresa(p_empresa_id)) in ('lectura', 'edicion');
$$;

comment on function private.puede_leer_faltantes_empresa(uuid) is
  'true si la persona actual tiene Ventas al menos en lectura en esa empresa (F-VTA-18, FR-040). La usan las políticas de RLS de los faltantes.';

revoke execute on function private.puede_leer_faltantes_empresa(uuid) from public, anon;
grant execute on function private.puede_leer_faltantes_empresa(uuid) to authenticated;

-- `drop policy if exists` + `create`: la migración se puede reintentar si una aplicación anterior quedó a medias.
drop policy if exists faltantes_venta_select on dominio.faltantes_venta;
create policy faltantes_venta_select on dominio.faltantes_venta
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.puede_leer_faltantes_empresa(empresa_id))
  );

-- Grants: `anon` sin privilegios; `authenticated` solo lee. Sin INSERT/UPDATE/DELETE para el navegador: la
-- escritura es de la RPC `security definer` (T029) y del disparador de resolución (T030).
grant usage on schema dominio to authenticated;
revoke all on dominio.faltantes_venta from anon, public;
grant select on dominio.faltantes_venta to authenticated;
