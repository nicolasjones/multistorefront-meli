-- MSF-369 · F-OPS-03 / MSF-354 · F-IMP-01 (épica MSF-206, revisión independiente QA y Code/Security):
-- retención y rendimiento de los datos de monitoreo y de los procesos masivos.
--
-- Hallazgos que cierra:
--   * ALTO: `eventos_monitoreo` y `alertas_monitoreo` no se purgaban nunca. El flow `monitoreo-salud-tiendas`
--     inserta un evento cada 2 minutos por tienda (~72.000 filas por día con 100 tiendas), `evaluar_monitoreo`
--     filtra por `ocurrido_en` sin un índice con ese prefijo y la vista `estado_tiendas_monitoreo` hacía un
--     `distinct on (clave)` sobre toda la tabla. Ahora hay un índice por `ocurrido_en`, la vista salta de clave en
--     clave por el índice (`fuente, clave, ocurrido_en desc`) en vez de recorrer la tabla, y la función
--     `private.depurar_monitoreo_y_procesos` aplica la retención (eventos 30 días, alertas resueltas 90 días,
--     procesos masivos terminados 180 días con sus errores). La dispara el flow `depuracion-monitoreo` cada día.
--   * MEDIO (SSRF residual): el sondeo de tiendas ahora puede registrar que un dominio «no es sondeable» (su DNS
--     resuelve a una IP no pública) sin contarlo como un fallo de la tienda; para eso `eventos_monitoreo.resultado`
--     admite `no_sondeable` y la vista lo muestra con ese estado.
--
-- Esquemas (Principio VII): todo en `public` (plataforma) y `private`; no hay tablas nuevas.
-- Migración aditiva e idempotente. Reversión (migración posterior):
--   drop function private.depurar_monitoreo_y_procesos(timestamptz);
--   drop index public.eventos_monitoreo_ocurrido_idx;
--   drop index public.alertas_monitoreo_resueltas_idx;
--   alter table public.eventos_monitoreo drop constraint eventos_monitoreo_resultado_valido;  (y volver a
--     crear `eventos_monitoreo_resultado_check` con ('ok', 'fallo') tras borrar los eventos `no_sondeable`)
--   restaurar `registrar_evento_monitoreo` de 20270211100012 y `estado_tiendas_monitoreo` de 20270214200001.

-- ============================================================================
-- Índices
-- ============================================================================

create index if not exists eventos_monitoreo_ocurrido_idx on public.eventos_monitoreo (ocurrido_en);
create index if not exists alertas_monitoreo_resueltas_idx on public.alertas_monitoreo (resuelta_en) where estado = 'resuelta';

-- ============================================================================
-- Resultado `no_sondeable`: el sondeo no pidió la tienda porque su DNS apunta a una red no pública.
-- No es un fallo de la tienda (no suma al umbral ni abre alertas): queda como dato para soporte.
-- ============================================================================

alter table public.eventos_monitoreo drop constraint if exists eventos_monitoreo_resultado_check;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'eventos_monitoreo_resultado_valido' and conrelid = 'public.eventos_monitoreo'::regclass
  ) then
    alter table public.eventos_monitoreo
      add constraint eventos_monitoreo_resultado_valido check (resultado in ('ok', 'fallo', 'no_sondeable'));
  end if;
end $$;

create or replace function public.registrar_evento_monitoreo(
  p_fuente text,
  p_clave text,
  p_resultado text,
  p_motivo text default null,
  p_organizacion_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- postgres / supabase_admin no son superusuarios reales en Supabase: se admiten por nombre (mantenimiento y pgTAP).
  if session_user not in ('kestra_orquestacion', 'postgres', 'supabase_admin')
    and not (select rolsuper from pg_catalog.pg_roles where rolname = session_user) then
    raise exception 'NO_AUTORIZADO: solo kestra_orquestacion registra eventos de monitoreo' using errcode = 'P0001';
  end if;
  if p_fuente not in ('tienda', 'sincronizacion', 'cola', 'aplicacion') then
    raise exception 'FUENTE_INVALIDA: la fuente no es válida' using errcode = 'P0001';
  end if;
  if p_resultado not in ('ok', 'fallo', 'no_sondeable') then
    raise exception 'RESULTADO_INVALIDO: el resultado debe ser ok, fallo o no_sondeable' using errcode = 'P0001';
  end if;
  if p_resultado = 'no_sondeable' and p_fuente <> 'tienda' then
    raise exception 'RESULTADO_INVALIDO: no_sondeable solo aplica a la fuente tienda' using errcode = 'P0001';
  end if;
  if p_clave is null or btrim(p_clave) = '' or length(p_clave) > 200 then
    raise exception 'CLAVE_INVALIDA: la clave es obligatoria (hasta 200 caracteres)' using errcode = 'P0001';
  end if;

  -- clock_timestamp() (no now()): dos eventos de la misma transacción conservan su orden.
  insert into public.eventos_monitoreo (organizacion_id, fuente, clave, resultado, motivo_sanitizado, ocurrido_en)
  values (p_organizacion_id, p_fuente, p_clave, p_resultado,
    case when p_resultado in ('fallo', 'no_sondeable') then private.sanitizar_motivo_monitoreo(p_motivo) end,
    clock_timestamp());
end;
$$;

comment on function public.registrar_evento_monitoreo(text, text, text, text, uuid) is
  'MSF-369: registra un evento ok/fallo/no_sondeable de una fuente (no_sondeable solo para tiendas: no cuenta como fallo). Solo kestra_orquestacion; el motivo se sanitiza en la base.';

revoke all on function public.registrar_evento_monitoreo(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.registrar_evento_monitoreo(text, text, text, text, uuid) to kestra_orquestacion;

-- ============================================================================
-- Vista del estado por tienda: último chequeo de cada tienda SIN recorrer toda la tabla de eventos.
-- La CTE recursiva salta de clave en clave usando el índice (fuente, clave, ocurrido_en desc) y toma el último
-- evento de cada una (el costo depende de la cantidad de tiendas, no de la cantidad de eventos).
-- security_invoker: aplica la RLS de las tablas base (solo superadmin; el resto recibe 0 filas).
-- ============================================================================

create or replace view public.estado_tiendas_monitoreo
with (security_invoker = true) as
with recursive claves as (
  (select min(e.clave) as clave from public.eventos_monitoreo e where e.fuente = 'tienda')
  union all
  select (select min(e.clave) from public.eventos_monitoreo e where e.fuente = 'tienda' and e.clave > c.clave)
  from claves c
  where c.clave is not null
)
select
  u.clave as dominio,
  u.organizacion_id,
  u.ocurrido_en as ultimo_chequeo_at,
  case
    when exists (
      select 1 from public.alertas_monitoreo a where a.fuente = 'tienda' and a.clave = u.clave and a.estado = 'abierta')
      then 'caida'
    when u.resultado = 'ok' then 'operativa'
    when u.resultado = 'no_sondeable' then 'no_sondeable'
    else 'con_fallos'
  end as estado,
  u.motivo_sanitizado as detalle
from claves c
cross join lateral (
  select e.clave, e.organizacion_id, e.ocurrido_en, e.resultado, e.motivo_sanitizado
  from public.eventos_monitoreo e
  where e.fuente = 'tienda' and e.clave = c.clave
  order by e.ocurrido_en desc
  limit 1
) u
where c.clave is not null;

comment on view public.estado_tiendas_monitoreo is
  'MSF-369: último chequeo por tienda (caida / con_fallos / operativa / no_sondeable). Solo superadmin por RLS de las tablas base.';
revoke all on table public.estado_tiendas_monitoreo from public, anon, authenticated;
grant select on table public.estado_tiendas_monitoreo to authenticated;

-- ============================================================================
-- Depuración por retención (como depurar_registro_actividad: la dispara Kestra una vez por día).
--   * eventos_monitoreo con más de 30 días;
--   * alertas_monitoreo RESUELTAS con más de 90 días (las abiertas nunca se borran);
--   * procesos_masivos TERMINADOS con más de 180 días (con sus errores y claves, por cascada).
-- Los procesos abiertos (pendiente / en_curso) nunca se depuran. Idempotente: una segunda corrida no borra más.
-- ============================================================================

create or replace function private.depurar_monitoreo_y_procesos(p_hasta timestamptz default now())
returns table (eventos_borrados integer, alertas_borradas integer, procesos_borrados integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ahora timestamptz := least(p_hasta, pg_catalog.now());
  v_eventos integer;
  v_alertas integer;
  v_procesos integer;
begin
  -- Solo el rol de Kestra (o el dueño en mantenimiento y pgTAP, como en las demás funciones de monitoreo). NO se usa
  -- la pertenencia a `workers_orquestacion`: cada `worker_<org>` es miembro de ese rol (ver 20260915125203) y un
  -- worker de una organización no puede disparar una purga global.
  if session_user not in ('kestra_orquestacion', 'postgres', 'supabase_admin') then
    raise exception 'Runtime no autorizado para depurar el monitoreo y los procesos masivos' using errcode = '42501';
  end if;

  delete from public.eventos_monitoreo m
  where m.ocurrido_en < v_ahora - interval '30 days';
  get diagnostics v_eventos = row_count;

  delete from public.alertas_monitoreo a
  where a.estado = 'resuelta' and a.resuelta_en < v_ahora - interval '90 days';
  get diagnostics v_alertas = row_count;

  delete from public.procesos_masivos p
  where p.estado in ('completado', 'con_errores', 'fallido', 'cancelado')
    and p.finalizado_en < v_ahora - interval '180 days';
  get diagnostics v_procesos = row_count;

  return query select v_eventos, v_alertas, v_procesos;
end;
$$;

comment on function private.depurar_monitoreo_y_procesos(timestamptz) is
  'MSF-369 / MSF-354: borra eventos de monitoreo con más de 30 días, alertas resueltas con más de 90 y procesos masivos terminados con más de 180 (con sus errores). No toca alertas abiertas ni procesos abiertos. Solo kestra_orquestacion (por session_user, no por membresía de workers_orquestacion); idempotente.';

revoke all on function private.depurar_monitoreo_y_procesos(timestamptz) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function private.depurar_monitoreo_y_procesos(timestamptz) to kestra_orquestacion;
  end if;
end;
$$;
