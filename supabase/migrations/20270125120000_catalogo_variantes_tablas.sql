-- F-CAT-15 (MSF-408, épica MSF-229), bloque A: variantes de un producto (datos y unicidad). FR-001, FR-002, FR-011.
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.producto_variantes  dominio (tabla nueva)  variante de un producto (color, talle, modelo): entidad de
--                                                      negocio del catálogo, junto a dominio.productos.
--   private.* (funciones)       private                disparadores de normalización y unicidad cruzada.
-- Aísla por organización con RLS y FK compuesta a productos. Sin DELETE: se desactiva (conserva código y movimientos).
-- Sin precio propio: la variante hereda el del producto (Decisión 3).
--
-- Migración aditiva. Reversión (migración posterior, no en este PR; la tabla es dato nuevo):
--   drop trigger productos_unicidad_variantes on dominio.productos;
--   drop function private.unicidad_codigo_producto_vs_variantes();
--   drop table dominio.producto_variantes;   (cascada a existencias_variante, si ya se revirtió el bloque B)
--   drop function private.normalizar_variante();

create table dominio.producto_variantes (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  producto_id uuid not null,
  nombre text not null check (length(nombre) between 1 and 120),
  codigo text not null check (length(codigo) between 1 and 80),
  codigo_barras text check (codigo_barras is null or codigo_barras ~ '^[0-9]{13}$'),
  activa boolean not null default true,
  orden integer not null check (orden >= 1),
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organizacion_id),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

comment on table dominio.producto_variantes is
  'F-CAT-15: variantes de un producto (nombre libre, código y código de barras propios, Activa/Inactiva, orden). Sin precio propio. Sin DELETE: se desactiva. Escritura por public.guardar_variantes_producto.';

create index producto_variantes_producto_idx on dominio.producto_variantes (organizacion_id, producto_id, orden);
-- Unicidad por organización entre variantes (sin distinguir mayúsculas ni espacios extremos, como el SKU).
create unique index producto_variantes_org_codigo_uidx
  on dominio.producto_variantes (organizacion_id, lower(btrim(codigo)));
create unique index producto_variantes_org_codigo_barras_uidx
  on dominio.producto_variantes (organizacion_id, codigo_barras) where codigo_barras is not null;

-- Normaliza y verifica la unicidad contra los productos (la base es la autoridad).
create or replace function private.normalizar_variante()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  new.codigo := btrim(new.codigo);
  new.codigo_barras := nullif(btrim(new.codigo_barras), '');
  if new.nombre = '' then
    raise exception 'La variante necesita un nombre' using errcode = '22023';
  end if;
  if new.codigo = '' then
    raise exception 'La variante necesita un código' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('codigo:' || new.organizacion_id::text || ':' || lower(new.codigo), 0));
  if exists (
    select 1 from dominio.productos p
     where p.organizacion_id = new.organizacion_id and lower(btrim(p.sku)) = lower(new.codigo)
  ) then
    raise exception 'El código "%" ya lo usa un producto', new.codigo
      using errcode = '23505', detail = 'codigo';
  end if;
  if new.codigo_barras is not null then
    perform pg_advisory_xact_lock(hashtextextended('barras:' || new.organizacion_id::text || ':' || new.codigo_barras, 0));
    if exists (
      select 1 from dominio.productos p
       where p.organizacion_id = new.organizacion_id and p.codigo_barras = new.codigo_barras
    ) then
      raise exception 'El código de barras "%" ya lo usa un producto', new.codigo_barras
        using errcode = '23505', detail = 'codigo_barras';
    end if;
  end if;

  if tg_op = 'UPDATE' and (new.nombre, new.codigo, new.codigo_barras, new.activa, new.orden)
       is not distinct from (old.nombre, old.codigo, old.codigo_barras, old.activa, old.orden) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_variante() from public, anon, authenticated;

create trigger producto_variantes_normalizar
  before insert or update on dominio.producto_variantes
  for each row execute function private.normalizar_variante();

-- Sentido inverso: un producto no puede tomar un SKU o un código de barras que ya usa una variante.
create or replace function private.unicidad_codigo_producto_vs_variantes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.sku is not distinct from old.sku
     and new.codigo_barras is not distinct from old.codigo_barras then
    return new;
  end if;

  if new.sku is not null then
    perform pg_advisory_xact_lock(hashtextextended('codigo:' || new.organizacion_id::text || ':' || lower(btrim(new.sku)), 0));
    if exists (
      select 1 from dominio.producto_variantes v
       where v.organizacion_id = new.organizacion_id and lower(btrim(v.codigo)) = lower(btrim(new.sku))
    ) then
      raise exception 'El SKU "%" ya lo usa una variante', new.sku using errcode = '23505';
    end if;
  end if;
  if new.codigo_barras is not null then
    perform pg_advisory_xact_lock(hashtextextended('barras:' || new.organizacion_id::text || ':' || new.codigo_barras, 0));
    if exists (
      select 1 from dominio.producto_variantes v
       where v.organizacion_id = new.organizacion_id and v.codigo_barras = new.codigo_barras
    ) then
      raise exception 'El código de barras "%" ya lo usa una variante', new.codigo_barras using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.unicidad_codigo_producto_vs_variantes() from public, anon, authenticated;

create trigger productos_unicidad_variantes
  before insert or update of sku, codigo_barras on dominio.productos
  for each row execute function private.unicidad_codigo_producto_vs_variantes();

alter table dominio.producto_variantes enable row level security;

create policy producto_variantes_select on dominio.producto_variantes
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

create policy producto_variantes_insert on dominio.producto_variantes
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

create policy producto_variantes_update on dominio.producto_variantes
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

-- Sin DELETE para nadie; sin privilegios para anon.
revoke all on dominio.producto_variantes from public, anon, authenticated;
grant select on dominio.producto_variantes to authenticated;
grant insert (id, organizacion_id, producto_id, nombre, codigo, codigo_barras, activa, orden)
  on dominio.producto_variantes to authenticated;
grant update (nombre, codigo, codigo_barras, activa, orden) on dominio.producto_variantes to authenticated;
