-- F-STK-07 (MSF-380, épica MSF-368, spec 20261024-130000-stock-carga-exportacion-y-avisos, T001):
-- `dominio.cargas_iniciales_stock` registra qué producto ya tuvo su carga inicial por planilla.
--
-- Esquema (Principio VII): es un dato del producto (qué mercadería ya tuvo su carga inicial y con qué
-- movimiento) → `dominio`, nunca `public`. Una fila por producto: `unique (organizacion_id, producto_id)`
-- es lo que impide una segunda carga inicial, incluso con dos cargas simultáneas.
-- RLS por organización; lectura para `lectura`/`edicion` en Stock; sin políticas ni privilegios de
-- escritura para `authenticated`: la escribe solo `aplicar_carga_inicial_stock` (security definer).
-- `anon` sin privilegios. Solo de agregado: un trigger rechaza update/delete (la cascada de la
-- organización pasa).
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los datos):
--   drop table dominio.cargas_iniciales_stock;
--   drop function private.rechazar_cambio_carga_inicial_stock();

create table if not exists dominio.cargas_iniciales_stock (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  producto_id uuid not null,
  deposito_id uuid not null,
  movimiento_id uuid not null,
  cantidad integer not null check (cantidad >= 0),
  clave_idempotencia uuid not null,
  actor_id uuid,
  actor_nombre text,
  creado_en timestamptz not null default now(),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id),
  foreign key (deposito_id, organizacion_id)
    references dominio.depositos (id, organizacion_id),
  foreign key (movimiento_id, organizacion_id)
    references dominio.movimientos_stock (id, organizacion_id),
  unique (organizacion_id, producto_id)
);

create index if not exists cargas_iniciales_stock_clave_idx
  on dominio.cargas_iniciales_stock (organizacion_id, clave_idempotencia);

create index if not exists cargas_iniciales_stock_deposito_idx
  on dominio.cargas_iniciales_stock (deposito_id, organizacion_id);
create index if not exists cargas_iniciales_stock_movimiento_idx
  on dominio.cargas_iniciales_stock (movimiento_id, organizacion_id);

comment on table dominio.cargas_iniciales_stock is
  'Carga inicial de stock por planilla (F-STK-07): una fila por producto que ya la tuvo, con su movimiento de ajuste. Solo de agregado; la escribe únicamente aplicar_carga_inicial_stock.';
comment on column dominio.cargas_iniciales_stock.clave_idempotencia is
  'Clave del envío: un reintento o doble clic con la misma clave no vuelve a mover stock.';

alter table dominio.cargas_iniciales_stock enable row level security;

create policy cargas_iniciales_stock_select on dominio.cargas_iniciales_stock
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

create or replace function private.rechazar_cambio_carga_inicial_stock()
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
  raise exception 'Las cargas iniciales de stock no se pueden modificar' using errcode = '42501';
end;
$$;

revoke execute on function private.rechazar_cambio_carga_inicial_stock() from public, anon, authenticated;

create trigger cargas_iniciales_stock_inmutable
  before update or delete on dominio.cargas_iniciales_stock
  for each row execute function private.rechazar_cambio_carga_inicial_stock();

revoke all on dominio.cargas_iniciales_stock from public, anon, authenticated;
grant usage on schema dominio to authenticated;
grant select on dominio.cargas_iniciales_stock to authenticated;
