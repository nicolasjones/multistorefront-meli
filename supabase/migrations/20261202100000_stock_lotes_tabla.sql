-- F-STK-10 (MSF-407, épica MSF-131, spec 20261024-120000-stock-lotes-e-inventario, FR-005):
-- lote de stock = remito de entradas cargado de una vez, con número correlativo por organización.
--
-- Esquema (Principio VII): `dominio.lotes_stock` es una entidad del negocio (mercadería que
-- entra al depósito) → `dominio`, nunca `public`. `dominio.movimientos_stock.lote_id` vincula
-- cada movimiento con su lote. El proveedor es TEXTO LIBRE (no referencia dominio.proveedores).
-- RLS por organización; lectura para `lectura`/`edicion` en Stock; sin policies ni privilegios
-- de escritura: solo la escribe la RPC `registrar_lote_stock` (security definer).
-- Solo de agregado: un trigger rechaza update/delete (la cascada de la organización pasa).
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los datos):
--   alter table dominio.movimientos_stock drop column lote_id;   -- cae su FK compuesta
--   drop table dominio.lotes_stock;
--   drop function private.rechazar_cambio_lote_stock();

create table if not exists dominio.lotes_stock (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  numero integer not null check (numero > 0),
  proveedor text check (proveedor is null or length(proveedor) <= 120),
  fecha date not null,
  motivo_id uuid not null,
  clave_idempotencia uuid not null default gen_random_uuid(),
  actor_id uuid,
  actor_nombre text,
  creado_en timestamptz not null default now(),
  foreign key (motivo_id, organizacion_id)
    references dominio.motivos_movimiento (id, organizacion_id),
  unique (id, organizacion_id),
  unique (organizacion_id, numero),
  unique (organizacion_id, clave_idempotencia)
);

comment on table dominio.lotes_stock is
  'Lote de stock (F-STK-10): remito de entradas con número correlativo por organización y proveedor en texto libre. Solo de agregado; lo escribe únicamente registrar_lote_stock.';
comment on column dominio.lotes_stock.clave_idempotencia is
  'Clave generada por el cliente: un reintento o doble clic devuelve el mismo lote sin volver a mover stock.';

alter table dominio.lotes_stock enable row level security;

create policy lotes_stock_select on dominio.lotes_stock
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

create or replace function private.rechazar_cambio_lote_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- El borrado en cascada de la organización (ya inexistente) se deja pasar.
  if tg_op = 'DELETE' and not exists (select 1 from public.organizaciones o where o.id = old.organizacion_id) then
    return old;
  end if;
  raise exception 'Los lotes de stock no se pueden modificar' using errcode = '42501';
end;
$$;

revoke execute on function private.rechazar_cambio_lote_stock() from public, anon, authenticated;

create trigger lotes_stock_inmutable
  before update or delete on dominio.lotes_stock
  for each row execute function private.rechazar_cambio_lote_stock();

revoke all on dominio.lotes_stock from public, anon, authenticated;
grant usage on schema dominio to authenticated;
grant select on dominio.lotes_stock to authenticated;

-- ============================================================================
-- movimientos_stock.lote_id (aditivo, nullable)
-- ============================================================================

alter table dominio.movimientos_stock add column if not exists lote_id uuid;

alter table dominio.movimientos_stock
  add constraint movimientos_stock_lote_fk
  foreign key (lote_id, organizacion_id)
  references dominio.lotes_stock (id, organizacion_id);

create index if not exists movimientos_stock_lote_idx
  on dominio.movimientos_stock (lote_id) where lote_id is not null;

comment on column dominio.movimientos_stock.lote_id is
  'Lote de stock (F-STK-10) al que pertenece la entrada; nulo en los movimientos individuales.';
