-- F-PRE-01 (MSF-115, épica MSF-114): cotización inicial del dólar.
-- Esquema (Principio VII): `dominio.cotizacion_inicial` es un dato de negocio de la
-- organización (el dólar con el que arranca el cálculo de precios) → `dominio`, nunca
-- `public`. Una fila por organización. La carga y el recálculo masivo del dólar son de
-- MSF-116: hasta entonces `private.a_pesos` lee esta tabla (único punto de lectura).
--
-- Sin cotización cargada no se asume ningún valor: un producto en USD no tiene precio en
-- pesos. Escritura: sección `empresas` en edición (Administrador). Sin DELETE.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop function public.fijar_cotizacion_inicial(numeric);
--   drop trigger cotizacion_inicial_tocar on dominio.cotizacion_inicial;
--   drop function private.tocar_cotizacion_inicial();
--   drop table dominio.cotizacion_inicial;

create table dominio.cotizacion_inicial (
  organizacion_id uuid primary key references public.organizaciones (id) on delete cascade,
  valor numeric(14, 4) not null check (valor > 0),
  updated_at timestamptz not null default now()
);

comment on table dominio.cotizacion_inicial is
  'Cotización inicial del dólar en pesos, una por organización (F-PRE-01). Sin fila, USD no se convierte. Sin política DELETE.';

-- updated_at avanza solo ante un cambio real del valor (guardar lo mismo es idempotente).
create or replace function private.tocar_cotizacion_inicial()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.valor is not distinct from old.valor then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.tocar_cotizacion_inicial() from public, anon, authenticated;

create trigger cotizacion_inicial_tocar
  before update on dominio.cotizacion_inicial
  for each row execute function private.tocar_cotizacion_inicial();

alter table dominio.cotizacion_inicial enable row level security;

create policy cotizacion_inicial_select on dominio.cotizacion_inicial
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

create policy cotizacion_inicial_insert on dominio.cotizacion_inicial
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) = 'edicion'
  );

create policy cotizacion_inicial_update on dominio.cotizacion_inicial
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

revoke all on dominio.cotizacion_inicial from public, anon, authenticated;
grant select on dominio.cotizacion_inicial to authenticated;
grant insert (organizacion_id, valor) on dominio.cotizacion_inicial to authenticated;
grant update (valor) on dominio.cotizacion_inicial to authenticated;

-- ============================================================================
-- public.fijar_cotizacion_inicial: SECURITY INVOKER, rigen las políticas del llamador.
-- ============================================================================

create or replace function public.fijar_cotizacion_inicial(p_valor numeric)
returns dominio.cotizacion_inicial
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_fila dominio.cotizacion_inicial;
begin
  if v_organizacion is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar la cotización' using errcode = '42501';
  end if;
  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 4) then
    raise exception 'La cotización debe ser mayor a cero y tener hasta 4 decimales' using errcode = '23514';
  end if;

  insert into dominio.cotizacion_inicial as c (organizacion_id, valor)
  values (v_organizacion, p_valor)
  on conflict (organizacion_id) do update set valor = excluded.valor
  returning * into v_fila;

  return v_fila;
end;
$$;

comment on function public.fijar_cotizacion_inicial(numeric) is
  'F-PRE-01: fija la cotización inicial del dólar de la organización (solo Administrador). 42501 sin permiso, 23514 valor inválido, 22003 fuera de rango.';

revoke execute on function public.fijar_cotizacion_inicial(numeric) from public, anon;
grant execute on function public.fijar_cotizacion_inicial(numeric) to authenticated;
