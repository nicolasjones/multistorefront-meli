-- F-PRE-11 (MSF-439, épica MSF-363, spec 20261104-103000-precios-masivos-y-promociones): precios
-- promocionales por empresa. FR-011, FR-012.
--
-- Esquema (Principio VII, re-verificado): `dominio.promociones_precio` es una entidad de negocio del
-- producto (qué se cobra y a cuánto, por empresa) → `dominio`, nunca `public`.
--
-- Contrato:
--   * `precio_promocional` es un precio FIJO en pesos, SIN IVA: no se mueve con el dólar ni con una
--     actualización masiva. La alícuota y el interruptor «Precios que ve el cliente» se aplican al leer.
--   * Los estados programada / vigente / vencida NO se guardan: se derivan de `desde`/`hasta` y la hora
--     al consultar (sin tarea programada). Solo `anulada_at` es un dato.
--   * No pueden solaparse dos promociones NO anuladas del mismo producto y empresa: lo impone un
--     disparador (no se habilita `btree_gist` para una restricción de exclusión). Contiguas
--     (`hasta` de una = `desde` de la otra) se permiten: el intervalo es [desde, hasta).
--   * Escritura solo por las RPC (`guardar_promocion_precio`, `anular_promocion_precio`); el rol
--     `authenticated` solo lee. Sin DELETE. `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop trigger promociones_precio_solape on dominio.promociones_precio;
--   drop trigger promociones_precio_tocar on dominio.promociones_precio;
--   drop function private.validar_solape_promocion_precio();
--   drop function private.tocar_promocion_precio();
--   drop table dominio.promociones_precio;

create table dominio.promociones_precio (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  producto_id uuid not null,
  -- Sin IVA, en pesos. numeric(14, 2): un valor fuera de rango da 22003.
  precio_promocional numeric(14, 2) not null check (precio_promocional > 0),
  desde timestamptz not null,
  hasta timestamptz not null,
  anulada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promociones_precio_rango check (hasta > desde),
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

comment on table dominio.promociones_precio is
  'Precio promocional fijo (sin IVA, en pesos) de un producto en una empresa, vigente en [desde, hasta) (F-PRE-11). Estados derivados por fecha; solo anulada_at es un dato. Sin política DELETE.';

create index promociones_precio_organizacion_id_idx on dominio.promociones_precio (organizacion_id);
create index promociones_precio_vigencia_idx
  on dominio.promociones_precio (empresa_id, producto_id, desde, hasta);

-- updated_at avanza solo ante un cambio real (bloqueo optimista; repetir lo mismo es idempotente).
create or replace function private.tocar_promocion_precio()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.precio_promocional, new.desde, new.hasta, new.anulada_at)
     is not distinct from (old.precio_promocional, old.desde, old.hasta, old.anulada_at) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.tocar_promocion_precio() from public, anon, authenticated;

create trigger promociones_precio_tocar
  before update on dominio.promociones_precio
  for each row execute function private.tocar_promocion_precio();

-- FR-012: sin solapes entre promociones NO anuladas del mismo producto y empresa. SECURITY DEFINER para
-- ver todas las filas sin depender de RLS; el candado por (empresa, producto) serializa dos altas
-- simultáneas que de otro modo pasarían ambas la verificación.
create or replace function private.validar_solape_promocion_precio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anulada_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.empresa_id::text || ':' || new.producto_id::text, 0));
  if exists (
    select 1
      from dominio.promociones_precio o
     where o.empresa_id = new.empresa_id
       and o.producto_id = new.producto_id
       and o.anulada_at is null
       and o.id <> new.id
       and o.desde < new.hasta
       and o.hasta > new.desde
  ) then
    raise exception 'Ya hay otra promoción de este producto en esta empresa que se solapa con esas fechas'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_solape_promocion_precio() from public, anon, authenticated;

create trigger promociones_precio_solape
  before insert or update on dominio.promociones_precio
  for each row execute function private.validar_solape_promocion_precio();

alter table dominio.promociones_precio enable row level security;

create policy promociones_precio_select on dominio.promociones_precio
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

-- Solo lectura para el rol de la API: se escribe por las RPC (SECURITY DEFINER) que validan permisos.
revoke all on dominio.promociones_precio from public, anon, authenticated;
grant select on dominio.promociones_precio to authenticated;
