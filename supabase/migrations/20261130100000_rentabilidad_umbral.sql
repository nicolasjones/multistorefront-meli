-- F-REN-01 (MSF-204, épica MSF-120): umbral de margen bajo por organización.
-- Esquema (Principio VII): `dominio.rentabilidad_config` es una regla de negocio de la organización
-- (cuándo un margen es «bajo») → `dominio`, nunca `public`. Las RPC son superficie de ejecución
-- (no almacenan datos) → `public`, `security invoker`.
--
-- Sin fila rige el valor por defecto 0,10 (10 %). Una fila por organización.
-- Lectura: sección `rentabilidad` ≥ lectura. Escritura: `rentabilidad` = edición. Sin DELETE.
-- `anon` sin privilegios. `updated_at` avanza solo ante un cambio real (bloqueo optimista).
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop function public.guardar_umbral_margen_bajo(numeric, timestamptz);
--   drop function public.leer_umbral_margen_bajo();
--   drop trigger rentabilidad_config_tocar on dominio.rentabilidad_config;
--   drop function private.tocar_rentabilidad_config();
--   drop table dominio.rentabilidad_config;

create table dominio.rentabilidad_config (
  organizacion_id uuid primary key references public.organizaciones (id) on delete cascade,
  umbral_margen_bajo numeric(5, 4) not null default 0.10
    check (umbral_margen_bajo > 0 and umbral_margen_bajo <= 1),
  updated_at timestamptz not null default now()
);

comment on table dominio.rentabilidad_config is
  'Configuración de Rentabilidad por organización (F-REN-01). Sin fila rige el umbral 0,10. Sin política DELETE.';
comment on column dominio.rentabilidad_config.umbral_margen_bajo is
  'Fracción (0 < valor ≤ 1): un margen % por debajo es «bajo». 0,10 = 10 %.';

-- updated_at avanza solo ante un cambio real (guardar lo mismo es idempotente).
create or replace function private.tocar_rentabilidad_config()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.umbral_margen_bajo is not distinct from old.umbral_margen_bajo then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.tocar_rentabilidad_config() from public, anon, authenticated;

create trigger rentabilidad_config_tocar
  before update on dominio.rentabilidad_config
  for each row execute function private.tocar_rentabilidad_config();

alter table dominio.rentabilidad_config enable row level security;

create policy rentabilidad_config_select on dominio.rentabilidad_config
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion')
  );

create policy rentabilidad_config_insert on dominio.rentabilidad_config
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) = 'edicion'
  );

create policy rentabilidad_config_update on dominio.rentabilidad_config
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) = 'edicion'
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.rentabilidad_config from public, anon, authenticated;
grant select on dominio.rentabilidad_config to authenticated;
grant insert (organizacion_id, umbral_margen_bajo) on dominio.rentabilidad_config to authenticated;
grant update (umbral_margen_bajo) on dominio.rentabilidad_config to authenticated;

-- Umbral vigente de la organización de la sesión (0,10 si nunca se guardó).
create or replace function public.leer_umbral_margen_bajo()
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver Rentabilidad' using errcode = '42501';
  end if;
  return coalesce(
    (select c.umbral_margen_bajo from dominio.rentabilidad_config c where c.organizacion_id = v_organizacion),
    0.10
  );
end;
$$;

comment on function public.leer_umbral_margen_bajo() is
  'F-REN-01: umbral de margen bajo de la organización (fracción; 0,10 por defecto). 42501 sin la sección rentabilidad.';

-- Guarda el umbral (solo edición). Devuelve el updated_at vigente. Sin fila previa se crea con
-- p_updated_at null; con fila, p_updated_at debe ser el leído (40001 si otra persona lo cambió).
create or replace function public.guardar_umbral_margen_bajo(
  p_umbral numeric,
  p_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actual dominio.rentabilidad_config;
  v_fila dominio.rentabilidad_config;
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede editar el umbral de margen' using errcode = '42501';
  end if;
  if p_umbral is null or p_umbral <= 0 or p_umbral > 1 or p_umbral <> round(p_umbral, 4) then
    raise exception 'El umbral debe ser mayor a 0 %% y hasta 100 %%, con hasta 2 decimales' using errcode = '23514';
  end if;

  select * into v_actual from dominio.rentabilidad_config c
   where c.organizacion_id = v_organizacion for update;

  if not found then
    if p_updated_at is not null then
      raise exception 'El umbral fue modificado por otra persona' using errcode = '40001';
    end if;
    begin
      insert into dominio.rentabilidad_config (organizacion_id, umbral_margen_bajo)
      values (v_organizacion, p_umbral)
      returning * into v_fila;
    exception when unique_violation then
      raise exception 'El umbral fue modificado por otra persona' using errcode = '40001';
    end;
    return v_fila.updated_at;
  end if;

  -- Idempotente: lo pedido ya está guardado.
  if v_actual.umbral_margen_bajo = p_umbral then
    return v_actual.updated_at;
  end if;
  if p_updated_at is null or v_actual.updated_at <> p_updated_at then
    raise exception 'El umbral fue modificado por otra persona' using errcode = '40001';
  end if;

  update dominio.rentabilidad_config
     set umbral_margen_bajo = p_umbral
   where organizacion_id = v_organizacion
  returning * into v_fila;
  return v_fila.updated_at;
end;
$$;

comment on function public.guardar_umbral_margen_bajo(numeric, timestamptz) is
  'F-REN-01: guarda el umbral de margen bajo (solo edición en rentabilidad). 42501 sin permiso, 23514 fuera de rango, 40001 conflicto de edición.';

revoke execute on function public.leer_umbral_margen_bajo() from public, anon;
revoke execute on function public.guardar_umbral_margen_bajo(numeric, timestamptz) from public, anon;
grant execute on function public.leer_umbral_margen_bajo() to authenticated;
grant execute on function public.guardar_umbral_margen_bajo(numeric, timestamptz) to authenticated;
