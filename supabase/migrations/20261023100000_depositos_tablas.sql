-- F-STK-14 (MSF-316, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas,
-- FR-001, FR-007, FR-015, D-9): depósitos de mercadería y existencias por depósito.
--
-- Esquema (Principio VII): las tres tablas nuevas son dominio del producto (dónde está la
-- mercadería y cuánta hay) → `dominio`, nunca `public`:
--   dominio.depositos             (nueva)     depósitos de la organización; uno solo por defecto.
--   dominio.depositos_empresas    (nueva)     «Venden desde acá»: qué empresas venden desde cada depósito.
--   dominio.existencias_deposito  (nueva)     cantidad y reservado por producto y depósito.
--   dominio.existencias           (existente) + `reservado` (aditivo); `cantidad` pasa a ser la suma de depósitos.
--   dominio.movimientos_stock     (existente) + `deposito_id`.
--
-- RLS por organización y `private.nivel_seccion('stock')` en las tres tablas. Ninguna admite
-- escritura directa de `authenticated`: las escriben solo las RPC `security definer`
-- (gestión de depósitos en 20261023100100, movimientos en 20261023100200). Sin DELETE: los
-- depósitos se desactivan. `anon` sin privilegios. (La spec prevé políticas insert/update para
-- el Administrador; se elige la vía única por RPC porque las reglas —un solo defecto, no
-- desactivar con unidades— no se pueden expresar en una política de fila.)
--
-- Backfill (D-9): cada organización recibe «Depósito principal» (por defecto, activo) y toda
-- la cantidad actual se asigna a él; los movimientos históricos quedan con ese depósito.
-- El total de cada producto no cambia. Una organización nueva recibe su depósito principal
-- por disparador. Se siembra en TODAS las organizaciones (no solo las que ya tienen
-- existencias) para que `registrar_movimiento_stock` sin depósito siempre tenga un destino.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   alter publication supabase_realtime drop table dominio.existencias_deposito;
--   drop trigger organizaciones_sembrar_deposito_principal on public.organizaciones;
--   drop function private.sembrar_deposito_principal_trigger();
--   drop function private.sembrar_deposito_principal(uuid);
--   alter table dominio.movimientos_stock drop column deposito_id;
--   alter table dominio.existencias drop constraint existencias_reservado_valido,
--     drop column reservado;
--   drop table dominio.existencias_deposito, dominio.depositos_empresas, dominio.depositos;
--   (restaurar antes `registrar_movimiento_stock` de 20261017140100 + 20261017170000.)

-- ============================================================================
-- dominio.depositos (FR-001)
-- ============================================================================

create table dominio.depositos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 80),
  direccion text check (direccion is null or (btrim(direccion) <> '' and length(direccion) <= 200)),
  activo boolean not null default true,
  por_defecto boolean not null default false,
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- El depósito por defecto siempre está activo.
  constraint depositos_defecto_activo check (not por_defecto or activo),
  -- Habilita las FK compuestas de existencias_deposito y movimientos_stock.
  unique (id, organizacion_id)
);

comment on table dominio.depositos is
  'Depósitos de mercadería de la organización (F-STK-14). Exactamente uno activo por defecto; se desactivan, no se borran. Solo los escriben las RPC de gestión.';

-- Nombre único por organización sin distinguir mayúsculas.
create unique index depositos_nombre_uq on dominio.depositos (organizacion_id, lower(btrim(nombre)));
-- A lo sumo un depósito por defecto por organización (la RPC garantiza que siempre haya uno).
create unique index depositos_por_defecto_uq on dominio.depositos (organizacion_id) where por_defecto;

create or replace function private.normalizar_deposito()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  new.direccion := nullif(btrim(coalesce(new.direccion, '')), '');
  if new.nombre = '' then
    raise exception 'El nombre del depósito no puede estar vacío' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_deposito() from public, anon, authenticated;

create trigger depositos_normalizar
  before insert or update on dominio.depositos
  for each row execute function private.normalizar_deposito();

alter table dominio.depositos enable row level security;

create policy depositos_select on dominio.depositos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- dominio.depositos_empresas: «Venden desde acá» (FR-002, FR-005)
-- ============================================================================

create table dominio.depositos_empresas (
  deposito_id uuid not null references dominio.depositos (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deposito_id, empresa_id)
);

comment on table dominio.depositos_empresas is
  'Empresas que venden desde cada depósito (F-STK-14, «Venden desde acá»). Escritura solo por las RPC de gestión de depósitos.';

create index depositos_empresas_empresa_id_idx on dominio.depositos_empresas (empresa_id);
create index depositos_empresas_organizacion_id_idx on dominio.depositos_empresas (organizacion_id);

-- El depósito y la empresa deben ser de la organización de la fila (protege ante cualquier
-- otra vía de escritura además de la RPC).
create or replace function private.validar_deposito_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from dominio.depositos d
    where d.id = new.deposito_id and d.organizacion_id = new.organizacion_id
  ) then
    raise exception 'El depósito no pertenece a la organización' using errcode = '23514';
  end if;
  if not exists (
    select 1 from dominio.empresas e
    where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id
  ) then
    raise exception 'La empresa no pertenece a la organización' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_deposito_empresa() from public, anon, authenticated;

create trigger depositos_empresas_validar
  before insert or update on dominio.depositos_empresas
  for each row execute function private.validar_deposito_empresa();

alter table dominio.depositos_empresas enable row level security;

create policy depositos_empresas_select on dominio.depositos_empresas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- dominio.existencias: + reservado (aditivo). `cantidad` sigue siendo el total único.
-- ============================================================================

alter table dominio.existencias
  add column reservado integer not null default 0;

alter table dominio.existencias
  add constraint existencias_reservado_valido check (reservado >= 0 and reservado <= cantidad);

comment on column dominio.existencias.reservado is
  'Unidades reservadas (F-STK-14/16): suma de existencias_deposito.reservado. Disponible = cantidad − reservado. Lo escriben solo las RPC de stock.';
comment on column dominio.existencias.cantidad is
  'Stock total único del producto: suma de existencias_deposito.cantidad, mantenida en la misma transacción que cada cambio (F-STK-14).';

-- ============================================================================
-- dominio.existencias_deposito (FR-007)
-- ============================================================================

create table dominio.existencias_deposito (
  producto_id uuid not null,
  deposito_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  cantidad integer not null default 0 check (cantidad >= 0),
  reservado integer not null default 0 check (reservado >= 0),
  updated_at timestamptz not null default now(),
  primary key (producto_id, deposito_id),
  constraint existencias_deposito_reservado_valido check (reservado <= cantidad),
  foreign key (producto_id, organizacion_id)
    references dominio.existencias (producto_id, organizacion_id) on delete cascade,
  foreign key (deposito_id, organizacion_id)
    references dominio.depositos (id, organizacion_id)
);

comment on table dominio.existencias_deposito is
  'Cantidad y reservado por producto y depósito (F-STK-14). Solo la escriben las RPC de stock; existencias.cantidad/reservado son las sumas.';

create index existencias_deposito_deposito_idx on dominio.existencias_deposito (deposito_id);
create index existencias_deposito_organizacion_idx on dominio.existencias_deposito (organizacion_id);

alter table dominio.existencias_deposito enable row level security;

create policy existencias_deposito_select on dominio.existencias_deposito
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- dominio.movimientos_stock: + deposito_id
-- ============================================================================

alter table dominio.movimientos_stock
  add column deposito_id uuid;

alter table dominio.movimientos_stock
  add constraint movimientos_stock_deposito_fk
  foreign key (deposito_id, organizacion_id) references dominio.depositos (id, organizacion_id);

create index movimientos_stock_deposito_idx on dominio.movimientos_stock (deposito_id);

comment on column dominio.movimientos_stock.deposito_id is
  'Depósito sobre el que se aplicó el movimiento (F-STK-14). Lo fija registrar_movimiento_stock; los históricos quedaron en el Depósito principal.';

-- ============================================================================
-- «Depósito principal» por organización + backfill (D-9)
-- ============================================================================

create or replace function private.sembrar_deposito_principal(p_organizacion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into dominio.depositos (organizacion_id, nombre, por_defecto, activo)
  values (p_organizacion_id, 'Depósito principal', true, true)
  on conflict do nothing;
$$;

revoke execute on function private.sembrar_deposito_principal(uuid) from public, anon, authenticated;

create or replace function private.sembrar_deposito_principal_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sembrar_deposito_principal(new.id);
  return new;
end;
$$;

revoke execute on function private.sembrar_deposito_principal_trigger() from public, anon, authenticated;

create trigger organizaciones_sembrar_deposito_principal
  after insert on public.organizaciones
  for each row execute function private.sembrar_deposito_principal_trigger();

select private.sembrar_deposito_principal(o.id) from public.organizaciones o;

-- Toda la cantidad actual pasa al depósito por defecto: el total no cambia.
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad)
select e.producto_id, d.id, e.organizacion_id, e.cantidad
  from dominio.existencias e
  join dominio.depositos d on d.organizacion_id = e.organizacion_id and d.por_defecto
 where e.cantidad > 0
on conflict (producto_id, deposito_id) do nothing;

-- Los movimientos históricos quedan con el depósito principal. El libro es inmodificable
-- (disparador de F-STK-03): se lo suspende solo durante esta migración, en una transacción.
alter table dominio.movimientos_stock disable trigger movimientos_stock_inmutable_fila;

update dominio.movimientos_stock m
   set deposito_id = d.id
  from dominio.depositos d
 where d.organizacion_id = m.organizacion_id and d.por_defecto and m.deposito_id is null;

alter table dominio.movimientos_stock enable trigger movimientos_stock_inmutable_fila;

-- ============================================================================
-- Grants: solo lectura para authenticated; anon sin nada
-- ============================================================================

revoke all on dominio.depositos, dominio.depositos_empresas, dominio.existencias_deposito
  from public, anon, authenticated;
grant select on dominio.depositos, dominio.depositos_empresas, dominio.existencias_deposito to authenticated;

-- ============================================================================
-- Realtime de existencias_deposito (idempotente, como 20261018190000)
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'La publicación supabase_realtime no existe: existencias_deposito no se publica.';
  elsif not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'dominio' and tablename = 'existencias_deposito'
  ) then
    alter publication supabase_realtime add table dominio.existencias_deposito;
  end if;
end
$$;
