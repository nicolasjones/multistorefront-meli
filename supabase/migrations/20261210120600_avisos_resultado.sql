-- MSF-319 · F-NOT-01 (FR-008, FR-010): resultado del envío (idempotente y con reintentos).
-- `marcar_aviso_enviado` es idempotente: repetirlo no cambia nada. `registrar_fallo_aviso`
-- cuenta el intento y reprograma con espera creciente (1, 2, 4, 8 min); al llegar a
-- `private.max_intentos_aviso()` el grupo queda `fallido` con el error útil.
-- Las tres funciones de avisos que usa Kestra se conceden aquí al rol de servicio
-- `kestra_orquestacion` (EXECUTE solo; ningún privilegio sobre las tablas).
--
-- Reversión (migración posterior): drop function private.marcar_aviso_enviado(uuid);
-- drop function private.registrar_fallo_aviso(uuid, text); drop function private.max_intentos_aviso();

create or replace function private.max_intentos_aviso()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 5;
$$;

create or replace function private.marcar_aviso_enviado(p_grupo_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  -- También desde 'pendiente': si el reclamo venció mientras el correo salía, igual se registra.
  update public.avisos_pendientes a
  set estado = 'enviado', enviado_en = coalesce(a.enviado_en, now()),
      reclamado_hasta = null, error = null
  where a.grupo_id = p_grupo_id and a.estado in ('enviando', 'pendiente');
$$;

create or replace function private.registrar_fallo_aviso(p_grupo_id uuid, p_error text)
returns table (estado text, proximo_intento timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'Error de envío sin detalle'), 500);
begin
  update public.avisos_pendientes a
  set intentos = a.intentos + 1,
      error = v_error,
      reclamado_hasta = null,
      estado = case
        when a.intentos + 1 >= (select private.max_intentos_aviso()) then 'fallido'
        else 'pendiente'
      end,
      proximo_intento = case
        when a.intentos + 1 >= (select private.max_intentos_aviso()) then null
        else now() + make_interval(mins => power(2, a.intentos)::integer)
      end
  where a.grupo_id = p_grupo_id and a.estado = 'enviando';

  return query
  select a.estado, a.proximo_intento
  from public.avisos_pendientes a
  where a.grupo_id = p_grupo_id
  order by a.creado_en, a.id
  limit 1;
end;
$$;

comment on function private.marcar_aviso_enviado(uuid) is
  'Marca el grupo como enviado. Idempotente.';
comment on function private.registrar_fallo_aviso(uuid, text) is
  'Registra un fallo de envío del grupo: cuenta el intento, reprograma con espera creciente o deja fallido con el error útil al agotar private.max_intentos_aviso().';

revoke execute on function
  private.max_intentos_aviso(),
  private.marcar_aviso_enviado(uuid),
  private.registrar_fallo_aviso(uuid, text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function
      private.reclamar_avisos_listos(integer),
      private.marcar_aviso_enviado(uuid),
      private.registrar_fallo_aviso(uuid, text)
      to kestra_orquestacion;
  end if;
end
$$;
