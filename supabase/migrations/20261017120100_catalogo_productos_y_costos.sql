-- F-CAT-02 (MSF-458, épica MSF-456): tablas del catálogo de productos.
-- Esquema (Principio VII): `dominio.productos` y `dominio.producto_costos` son
-- entidades del negocio del producto → `dominio`, nunca `public`. El costo vive
-- en tabla aparte para poder restringirlo por fila a la sección `rentabilidad`.
--
-- Migración aditiva (tablas, índices, funciones, disparadores y políticas nuevas).
-- Reversión (en una migración posterior, no en este PR; exportar antes los datos):
--   drop trigger productos_normalizar on dominio.productos;
--   drop function private.normalizar_producto();
--   drop table dominio.producto_costos;
--   drop table dominio.productos;

-- ============================================================================
-- dominio.productos (FR-001, FR-002, FR-005)
-- ============================================================================

create table dominio.productos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 200),
  -- El recorte, la unicidad y el autogenerado del SKU llegan en F-CAT-03 (M3).
  sku text check (length(sku) <= 80),
  descripcion text check (length(descripcion) <= 4000),
  compatible_con text[] not null default '{}' check (cardinality(compatible_con) <= 50),
  moneda text not null default 'USD' check (moneda in ('USD', 'ARS')),
  precio_lista numeric(14, 2) not null check (precio_lista > 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Habilita la FK compuesta de producto_costos: el costo no puede apuntar a un
  -- producto de otra organización.
  unique (id, organizacion_id)
);

comment on table dominio.productos is
  'Catálogo de productos de la organización (F-CAT-02). Se desactiva, no se borra: sin política DELETE.';
comment on column dominio.productos.precio_lista is
  'Precio de lista sin IVA, en la moneda indicada. El precio en pesos lo calcula Precios (MSF-114).';

create index productos_org_nombre_idx on dominio.productos (organizacion_id, lower(nombre), id);

-- Normaliza al escribir: la base es la autoridad (también para llamadas directas).
create or replace function private.normalizar_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre del producto no puede estar vacío' using errcode = '23514';
  end if;
  new.sku := nullif(btrim(new.sku), '');
  new.descripcion := nullif(btrim(new.descripcion), '');
  new.compatible_con := coalesce(
    (select array_agg(s.v order by s.o)
       from (select btrim(t.x) as v, min(t.n) as o
               from unnest(new.compatible_con) with ordinality as t(x, n)
              where btrim(t.x) <> '' and length(btrim(t.x)) <= 100
              group by btrim(t.x)) s),
    '{}'
  );
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_producto() from public, anon, authenticated;

create trigger productos_normalizar
  before insert or update on dominio.productos
  for each row execute function private.normalizar_producto();

alter table dominio.productos enable row level security;

create policy productos_select on dominio.productos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

create policy productos_insert on dominio.productos
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

create policy productos_update on dominio.productos
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

-- ============================================================================
-- dominio.producto_costos (FR-003, FR-005): sección `rentabilidad`
-- ============================================================================

create table dominio.producto_costos (
  producto_id uuid primary key,
  organizacion_id uuid not null,
  costo numeric(14, 2) not null check (costo >= 0),
  updated_at timestamptz not null default now(),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

comment on table dominio.producto_costos is
  'Costo del producto, separado para restringirlo a la sección Rentabilidad (F-CAT-02). El Operador no ve ninguna fila.';

-- updated_at al día cuando F-CAT-04 edite el costo.
create or replace function private.tocar_producto_costo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.tocar_producto_costo() from public, anon, authenticated;

create trigger producto_costos_tocar
  before update on dominio.producto_costos
  for each row execute function private.tocar_producto_costo();

alter table dominio.producto_costos enable row level security;

create policy producto_costos_select on dominio.producto_costos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion')
  );

create policy producto_costos_insert on dominio.producto_costos
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) = 'edicion'
  );

create policy producto_costos_update on dominio.producto_costos
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) = 'edicion'
  );

-- ============================================================================
-- Grants: `anon` sin privilegios, sin DELETE para nadie, columnas explícitas.
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.productos, dominio.producto_costos from public, anon, authenticated;

grant select on dominio.productos to authenticated;
grant insert (id, organizacion_id, nombre, sku, descripcion, compatible_con, moneda, precio_lista)
  on dominio.productos to authenticated;
grant update (nombre, sku, descripcion, compatible_con, moneda, precio_lista, activo)
  on dominio.productos to authenticated;

grant select on dominio.producto_costos to authenticated;
grant insert (producto_id, organizacion_id, costo) on dominio.producto_costos to authenticated;
grant update (costo) on dominio.producto_costos to authenticated;
