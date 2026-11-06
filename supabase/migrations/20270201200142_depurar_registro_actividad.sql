-- MSF-259 · F-AUD-02 (épica MSF-170, spec 20261102-100000-auditoria-avanzada-y-soporte, FR-008, FR-009):
-- depuración por retención del registro de actividad (24 meses), como proceso de Sistema.
--
-- Esquema (Principio VII): no crea tablas; solo funciones en `private` y el reemplazo del trigger de
-- inalterabilidad de `public.registro_actividad` (plataforma, `public`).
--
-- Migración aditiva. Reversión (migración posterior; los eventos ya depurados no se recuperan):
--   drop function private.depurar_registro_actividad(timestamptz);
--   restaurar private.bloquear_alteracion_actividad() de 20270201200141_registro_inalterable_antes_despues.sql.

-- La depuración es la segunda y última excepción del trigger: la función marca la transacción con una variable
-- local (set_config con is_local) y la desmarca al terminar. `authenticated` y `anon` no tienen DELETE sobre la
-- tabla, así que no pueden llegar al trigger con la marca puesta.
create or replace function private.bloquear_alteracion_actividad()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('msf.depurando_actividad', true) = 'on' then
      return old;
    end if;
    if not exists (select 1 from public.organizaciones o where o.id = old.organizacion_id) then
      return old;
    end if;
  end if;
  raise exception 'El registro de actividad es inalterable: no se puede % ', lower(tg_op) using errcode = '42501';
end;
$$;

create or replace function private.depurar_registro_actividad(p_hasta timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_corte timestamptz := p_hasta - interval '24 months';
  v_total integer := 0;
  r record;
begin
  -- Solo el rol de Sistema (el de Kestra o un worker de la plataforma), igual que purgar_evidencias_ia.
  if not exists (
    select 1 from pg_catalog.pg_roles ro
    where ro.rolname in ('workers_orquestacion', 'kestra_orquestacion')
      and pg_catalog.pg_has_role(session_user, ro.oid, 'member')
  ) then
    raise exception 'Runtime no autorizado para depurar el registro de actividad' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('msf.depurando_actividad', 'on', true);

  for r in
    with borradas as (
      delete from public.registro_actividad a
      where a.creado_en < v_corte
      returning a.organizacion_id
    )
    select b.organizacion_id, count(*)::integer as cantidad
    from borradas b
    group by b.organizacion_id
  loop
    v_total := v_total + r.cantidad;
    perform private.insertar_actividad(
      r.organizacion_id,
      null,
      'sistema.depurada',
      format('Depuró %s %s con más de 24 meses', r.cantidad, case when r.cantidad = 1 then 'evento' else 'eventos' end)
    );
  end loop;

  perform pg_catalog.set_config('msf.depurando_actividad', 'off', true);
  return v_total;
end;
$$;

revoke all on function private.depurar_registro_actividad(timestamptz) from public, anon, authenticated;
grant execute on function private.depurar_registro_actividad(timestamptz) to workers_orquestacion;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function private.depurar_registro_actividad(timestamptz) to kestra_orquestacion;
  end if;
end;
$$;

comment on function private.depurar_registro_actividad(timestamptz) is
  'F-AUD-02 (FR-008): borra los eventos con más de 24 meses respecto de p_hasta y deja un evento sistema.depurada por organización. Solo workers_orquestacion / kestra_orquestacion; idempotente. Devuelve la cantidad borrada.';
