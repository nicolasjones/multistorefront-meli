-- F-STK-02 (MSF-153, épica MSF-136, spec 20261017-120000-stock-movimientos,
-- FR-001, FR-004, FR-005, FR-007): existencias, libro de movimientos y motivos.
--
-- Esquema (Principio VII): las tres tablas son dominio del producto (cantidad,
-- libro de movimientos y catálogo de motivos de stock) → `dominio`, nunca `public`.
-- RLS por organización y por `private.nivel_seccion('stock')`. `existencias` y
-- `movimientos_stock` NO tienen políticas ni privilegios de escritura: solo las
-- escribe la RPC `public.registrar_movimiento_stock` (migración siguiente).
-- `motivos_movimiento` lo escribe solo el Administrador (`private.puede_escribir()`);
-- no se borra, se desactiva. `anon` no recibe ningún privilegio.
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los datos):
--   drop trigger organizaciones_sembrar_motivos_movimiento on public.organizaciones;
--   drop function private.sembrar_motivos_movimiento_trigger();
--   drop function private.sembrar_motivos_movimiento(uuid);
--   drop trigger productos_crear_existencias on dominio.productos;
--   drop function private.crear_existencias_producto();
--   drop table dominio.movimientos_stock, dominio.motivos_movimiento, dominio.existencias;

-- ============================================================================
-- dominio.existencias (FR-001): una fila por producto, stock único por organización
-- ============================================================================

create table dominio.existencias (
  producto_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  cantidad integer not null default 0,
  ultimo_movimiento_en timestamptz,
  updated_at timestamptz not null default now(),
  -- La existencia no puede apuntar a un producto de otra organización.
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade,
  -- Habilita la FK compuesta de movimientos_stock.
  unique (producto_id, organizacion_id)
);

comment on table dominio.existencias is
  'Cantidad vigente de cada producto (F-STK-02). Stock único por organización. Solo la escriben las RPC de stock.';

alter table dominio.existencias enable row level security;

create policy existencias_select on dominio.existencias
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- dominio.motivos_movimiento (FR-007)
-- ============================================================================

create table dominio.motivos_movimiento (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 80),
  aplica_a text[] not null default '{entrada,salida,ajuste}'
    check (cardinality(aplica_a) >= 1 and aplica_a <@ array['entrada', 'salida', 'ajuste']::text[]),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (id, organizacion_id)
);

comment on table dominio.motivos_movimiento is
  'Motivos de los movimientos de stock (F-STK-02). Los edita solo el Administrador; se desactivan, no se borran.';

create unique index motivos_movimiento_nombre_uq
  on dominio.motivos_movimiento (organizacion_id, lower(btrim(nombre)));

create or replace function private.normalizar_motivo_movimiento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre del motivo no puede estar vacío' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_motivo_movimiento() from public, anon, authenticated;

create trigger motivos_movimiento_normalizar
  before insert or update on dominio.motivos_movimiento
  for each row execute function private.normalizar_motivo_movimiento();

alter table dominio.motivos_movimiento enable row level security;

create policy motivos_movimiento_select on dominio.motivos_movimiento
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

create policy motivos_movimiento_insert on dominio.motivos_movimiento
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_escribir())
  );

create policy motivos_movimiento_update on dominio.motivos_movimiento
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_escribir())
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_escribir())
  );

-- ============================================================================
-- dominio.movimientos_stock (FR-002, FR-004): libro de solo agregado
-- ============================================================================

create table dominio.movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  producto_id uuid not null,
  tipo text not null check (tipo in ('entrada', 'salida', 'ajuste')),
  -- Lo informado: unidades de la entrada/salida, o el stock contado del ajuste.
  cantidad integer not null check (cantidad >= 0),
  -- Cambio con signo sobre la cantidad vigente.
  diferencia integer not null,
  -- Cantidad resultante tras el movimiento.
  saldo integer not null check (saldo >= 0),
  motivo_id uuid not null,
  nota text check (length(nota) <= 500),
  fecha date not null,
  -- Sin FK a auth.users: el historial sobrevive a la cuenta (igual que registro_actividad).
  actor_id uuid,
  actor_nombre text,
  creado_en timestamptz not null default now(),
  foreign key (producto_id, organizacion_id)
    references dominio.existencias (producto_id, organizacion_id),
  foreign key (motivo_id, organizacion_id)
    references dominio.motivos_movimiento (id, organizacion_id)
);

comment on table dominio.movimientos_stock is
  'Libro de movimientos de stock (F-STK-02). Solo de agregado: lo escribe únicamente registrar_movimiento_stock.';

create index movimientos_stock_org_fecha_idx
  on dominio.movimientos_stock (organizacion_id, creado_en desc, id);
create index movimientos_stock_org_producto_fecha_idx
  on dominio.movimientos_stock (organizacion_id, producto_id, creado_en desc, id);

alter table dominio.movimientos_stock enable row level security;

create policy movimientos_stock_select on dominio.movimientos_stock
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- Existencias en 0 al crear un producto (FR-001) + relleno de los existentes
-- ============================================================================

create or replace function private.crear_existencias_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into dominio.existencias (producto_id, organizacion_id)
  values (new.id, new.organizacion_id)
  on conflict (producto_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.crear_existencias_producto() from public, anon, authenticated;

create trigger productos_crear_existencias
  after insert on dominio.productos
  for each row execute function private.crear_existencias_producto();

insert into dominio.existencias (producto_id, organizacion_id)
select p.id, p.organizacion_id from dominio.productos p
on conflict (producto_id) do nothing;

-- ============================================================================
-- Motivos iniciales por organización (FR-007) + relleno
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
    (p_organizacion_id, 'Rotura o pérdida', '{salida,ajuste}')
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
$$;

revoke execute on function private.sembrar_motivos_movimiento(uuid) from public, anon, authenticated;

create or replace function private.sembrar_motivos_movimiento_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sembrar_motivos_movimiento(new.id);
  return new;
end;
$$;

revoke execute on function private.sembrar_motivos_movimiento_trigger() from public, anon, authenticated;

create trigger organizaciones_sembrar_motivos_movimiento
  after insert on public.organizaciones
  for each row execute function private.sembrar_motivos_movimiento_trigger();

select private.sembrar_motivos_movimiento(o.id) from public.organizaciones o;

-- ============================================================================
-- Grants: solo lectura para authenticated; motivos con escritura acotada a columnas
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.existencias, dominio.movimientos_stock, dominio.motivos_movimiento
  from public, anon, authenticated;

grant select on dominio.existencias, dominio.movimientos_stock, dominio.motivos_movimiento to authenticated;
grant insert (organizacion_id, nombre, aplica_a) on dominio.motivos_movimiento to authenticated;
grant update (nombre, aplica_a, activo) on dominio.motivos_movimiento to authenticated;
