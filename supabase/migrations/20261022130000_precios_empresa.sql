-- F-PRE-07 (MSF-172, épica MSF-114): regla de precio por empresa.
-- Esquema (Principio VII): `dominio.precios_empresa` es una regla de negocio de cada empresa
-- (tienda): cómo se calcula su precio neto desde el central → `dominio`, nunca `public`.
-- Una fila por empresa; sin fila la empresa equivale a «Igual al central».
--
-- Aislamiento: FK compuesta (empresa_id, organizacion_id) → la regla no puede apuntar a una
-- empresa de otra organización (por eso se suma `unique (id, organizacion_id)` a empresas).
-- Lectura: sección `empresas` ≥ lectura. Escritura: `empresas` = edición. Sin DELETE.
-- `anon` sin privilegios. `updated_at` solo avanza ante un cambio real (bloqueo optimista).
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop trigger precios_empresa_tocar on dominio.precios_empresa;
--   drop function private.tocar_precios_empresa();
--   drop table dominio.precios_empresa;
--   alter table dominio.empresas drop constraint empresas_id_organizacion_key;

alter table dominio.empresas
  add constraint empresas_id_organizacion_key unique (id, organizacion_id);

create table dominio.precios_empresa (
  empresa_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  base text not null default 'central' check (base in ('central', 'central_ajuste')),
  -- Porcentaje sobre el precio central (negativo baja, positivo sube); solo rige con
  -- base `central_ajuste`. numeric(7, 3): un valor fuera de rango da 22003.
  ajuste_pct numeric(7, 3) not null default 0 check (ajuste_pct > -100),
  -- «Al $ 10 más cercano»: único redondeo del lanzamiento.
  redondeo_pesos integer not null default 10 check (redondeo_pesos = 10),
  updated_at timestamptz not null default now(),
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.precios_empresa is
  'Regla de precio neto de cada empresa (F-PRE-07). Sin fila = «Igual al central». Sin política DELETE.';

create index precios_empresa_organizacion_id_idx on dominio.precios_empresa (organizacion_id);

-- updated_at avanza solo ante un cambio real (guardar lo mismo es idempotente).
create or replace function private.tocar_precios_empresa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.base, new.ajuste_pct, new.redondeo_pesos) is not distinct from (old.base, old.ajuste_pct, old.redondeo_pesos) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.tocar_precios_empresa() from public, anon, authenticated;

create trigger precios_empresa_tocar
  before update on dominio.precios_empresa
  for each row execute function private.tocar_precios_empresa();

alter table dominio.precios_empresa enable row level security;

create policy precios_empresa_select on dominio.precios_empresa
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

create policy precios_empresa_insert on dominio.precios_empresa
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) = 'edicion'
  );

create policy precios_empresa_update on dominio.precios_empresa
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) = 'edicion'
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.precios_empresa from public, anon, authenticated;
grant select on dominio.precios_empresa to authenticated;
grant insert (empresa_id, organizacion_id, base, ajuste_pct) on dominio.precios_empresa to authenticated;
grant update (base, ajuste_pct) on dominio.precios_empresa to authenticated;
