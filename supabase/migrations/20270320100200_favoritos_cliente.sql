-- MSF-176 · Tienda compra y cuentas, historia A «Mi cuenta» (F-CLI-20 · MSF-452), T010. FR-007 a FR-010, D-2, D-11.
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * dominio.favoritos_cliente (tabla nueva) -> `dominio`: dato del negocio sobre productos del catálogo (qué guardó un
--     cliente de una tienda), no plataforma. Se ata a la cuenta web (que vive en `public` por ser identidad) y al producto.
--   * public.cuentas_cliente (tabla existente): solo un índice único aditivo (id, organizacion_id, empresa_id) que habilita la
--     FK compuesta; sin cambios de columnas, RLS ni grants.
--
-- Aislamiento: FK compuestas con `organizacion_id` (una fila no puede apuntar a una cuenta, empresa o producto de otra
-- organización) y con `empresa_id` de la cuenta (los favoritos son por tienda: D-2); `on delete cascade` desde la cuenta, la
-- empresa y el producto (un favorito no frena la baja de nada).
--
-- Acceso: RLS ACTIVADA sin ninguna política y SIN ningún privilegio para `public`, `anon` ni `authenticated`
-- (nada de API): la tabla se lee y escribe únicamente por las RPC `publico.*` (`security definer`), que derivan la cuenta de
-- `private.cuenta_de_tienda`. Quien opera el panel no ve los favoritos del cliente (D-11).
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR; exportar antes los datos):
--   drop table if exists dominio.favoritos_cliente;
--   drop index if exists public.cuentas_cliente_id_org_empresa_uq;

-- Habilita la FK compuesta (cuenta, organización, empresa).
create unique index if not exists cuentas_cliente_id_org_empresa_uq
  on public.cuentas_cliente (id, organizacion_id, empresa_id);

create table if not exists dominio.favoritos_cliente (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  empresa_id uuid not null,
  cuenta_cliente_id uuid not null,
  producto_id uuid not null,
  creado_en timestamptz not null default now(),
  constraint favoritos_cliente_cuenta_producto_uq unique (cuenta_cliente_id, producto_id),
  constraint favoritos_cliente_cuenta_fk
    foreign key (cuenta_cliente_id, organizacion_id, empresa_id)
    references public.cuentas_cliente (id, organizacion_id, empresa_id) on delete cascade,
  constraint favoritos_cliente_empresa_fk
    foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint favoritos_cliente_producto_fk
    foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

-- Lista de «Favoritos» de una cuenta, nuevos primero (cursor por (creado_en, id)).
create index if not exists favoritos_cliente_cuenta_creado_idx
  on dominio.favoritos_cliente (cuenta_cliente_id, creado_en desc, id desc);
-- Apoyo de las FK compuestas (borrado en cascada de producto y de empresa).
create index if not exists favoritos_cliente_producto_idx
  on dominio.favoritos_cliente (producto_id, organizacion_id);
create index if not exists favoritos_cliente_empresa_idx
  on dominio.favoritos_cliente (empresa_id, organizacion_id);

comment on table dominio.favoritos_cliente is
  'MSF-176 (F-CLI-20): productos que una cuenta web guardó como favoritos en su tienda. Sin privilegios de API ni políticas: solo las RPC publico.* (security definer) la leen y escriben. Tope 200 por cuenta (lo impone cambiar_favorito_por_dominio con lock).';

alter table dominio.favoritos_cliente enable row level security;

revoke all on dominio.favoritos_cliente from public, anon, authenticated;
