-- F-PRE-12 (MSF-200, épica MSF-114): catálogo de alícuotas de IVA por organización.
-- Esquema (Principio VII): `dominio.alicuotas_iva` es un dato de negocio de cada organización
-- (con qué IVA vende) → `dominio`, nunca `public`. RLS por organización, FK compuestas desde
-- categorías y productos (una fila no cruza organizaciones), `anon` sin privilegios.
--
-- Lectura: toda persona autenticada de la organización (el IVA se muestra junto a precios y
-- categorías; no es un dato sensible). Escritura: ninguna desde la app en esta épica (la
-- administración de alícuotas, con la opción 27 %, queda para una historia posterior).
-- Sembrado: 21 %, 10,5 % y Exento para cada organización, existente (backfill) y nueva
-- (disparador). Idempotente: reintentar no duplica filas.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop trigger organizaciones_sembrar_alicuotas_iva on public.organizaciones;
--   drop function private.sembrar_alicuotas_iva_organizacion();
--   drop function private.sembrar_alicuotas_iva(uuid);
--   drop table dominio.alicuotas_iva;   (solo si ya se revirtieron 20261022140100 y 20261022140200)

create table dominio.alicuotas_iva (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 40),
  -- Porcentaje de IVA. Exento ⇒ 0 (el precio final coincide con el neto).
  porcentaje numeric(5, 2) not null check (porcentaje >= 0 and porcentaje < 100),
  exento boolean not null default false,
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (id, organizacion_id),
  check (not exento or porcentaje = 0)
);

comment on table dominio.alicuotas_iva is
  'F-PRE-12: alícuotas de IVA de cada organización (21 %, 10,5 %, Exento). Sin escritura desde la app en esta épica; sin política DELETE.';

create unique index alicuotas_iva_nombre_uk on dominio.alicuotas_iva (organizacion_id, lower(btrim(nombre)));

alter table dominio.alicuotas_iva enable row level security;

create policy alicuotas_iva_select on dominio.alicuotas_iva
  for select to authenticated
  using (organizacion_id = (select private.organizacion_id()));

grant usage on schema dominio to authenticated;

revoke all on dominio.alicuotas_iva from public, anon, authenticated;
grant select on dominio.alicuotas_iva to authenticated;

-- Siembra idempotente de una organización.
create or replace function private.sembrar_alicuotas_iva(p_organizacion uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into dominio.alicuotas_iva (organizacion_id, nombre, porcentaje, exento)
  values
    (p_organizacion, '21 %', 21, false),
    (p_organizacion, '10,5 %', 10.5, false),
    (p_organizacion, 'Exento', 0, true)
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
$$;

revoke execute on function private.sembrar_alicuotas_iva(uuid) from public, anon, authenticated;

create or replace function private.sembrar_alicuotas_iva_organizacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sembrar_alicuotas_iva(new.id);
  return new;
end;
$$;

revoke execute on function private.sembrar_alicuotas_iva_organizacion() from public, anon, authenticated;

-- Organizaciones existentes.
select private.sembrar_alicuotas_iva(o.id) from public.organizaciones o;

create trigger organizaciones_sembrar_alicuotas_iva
  after insert on public.organizaciones
  for each row execute function private.sembrar_alicuotas_iva_organizacion();
