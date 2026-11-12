-- F-API-01 (MSF-233) · seguimientos MSF-836, MSF-837 y MSF-838 de la revisión del rol CTO.
--
-- 836 · Retención de los avisos: `public.cola_eventos` y `public.api_entregas` crecían sin cota (un evento por movimiento de
--       stock y por cambio de precio). La purga diaria existente (`private.purgar_api_llamadas`, la dispara el flow
--       `purgar-api-llamadas`) también borra los eventos TERMINADOS (`completada` o `agotada`) más viejos que la retención
--       y sin ninguna entrega viva (`pendiente` o `reclamada`); sus entregas terminadas se van con ellos (on delete cascade).
--       Corre de a lotes de 50 000 para que la primera purga de un historial grande no sea una sola transacción enorme.
--       No se deja de encolar eventos de organizaciones sin suscripción: `cola_eventos` es una outbox genérica y otro
--       consumidor futuro (MSF-123) necesita esos eventos.
-- 837 · Salud de las entregas: `private.api_entregas_salud` cuenta lo que el flow de entregas usa para avisar a soporte.
-- 838 · Reintento manual: `public.reintentar_entrega_api` devuelve una entrega `agotada` a la cola, con sus 5 intentos de nuevo
--       (el Administrador de la organización, desde «Entregas recientes»).
--
-- Migración aditiva. Reversión (en una migración posterior):
--   revoke execute on function public.reintentar_entrega_api(uuid) from authenticated;
--   drop function public.reintentar_entrega_api(uuid);
--   drop function private.api_entregas_salud(integer, integer);
--   drop index if exists public.cola_eventos_terminados_idx;
--   y volver `private.purgar_api_llamadas` a la definición de 20270301100000_api_decisiones_abiertas_msf233.sql.

-- Los eventos terminados se buscan por fecha: sin este índice la purga recorre toda la cola.
create index if not exists cola_eventos_terminados_idx
  on public.cola_eventos (updated_at)
  where estado in ('completada', 'agotada');

create or replace function private.purgar_api_llamadas(p_retencion_dias integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borradas integer;
begin
  if p_retencion_dias is null or p_retencion_dias < 1 or p_retencion_dias > 3650 then
    raise exception 'RETENCION_INVALIDA' using errcode = '22023';
  end if;

  -- Una reserva de límite (102) que sigue así pasados 5 minutos es una llamada
  -- cuya función murió antes de completarla: se deja como error del servidor.
  update public.api_llamadas
     set estado_http = 500
   where public.api_llamadas.estado_http = 102
     and public.api_llamadas.creada_en < now() - interval '5 minutes';

  delete from public.api_llamadas
   where creada_en < now() - make_interval(days => p_retencion_dias);

  get diagnostics v_borradas = row_count;

  -- Las claves revocadas o vencidas hace más de la retención no se acumulan. Las llamadas viejas quedan con `clave_id`
  -- nulo (on delete set null) y se purgan por su propia retención.
  delete from public.api_claves
   where (public.api_claves.revocada_en is not null and public.api_claves.revocada_en < now() - make_interval(days => p_retencion_dias))
      or (public.api_claves.vence_en is not null and public.api_claves.vence_en < now() - make_interval(days => p_retencion_dias));

  -- MSF-836: eventos terminados y sin entregas vivas. `api_entregas.evento_id` es on delete cascade: las entregas terminadas
  -- del evento se borran con él; una entrega `pendiente` o `reclamada` lo protege.
  delete from public.cola_eventos
   where public.cola_eventos.id in (
     select e.id
       from public.cola_eventos e
      where e.estado in ('completada', 'agotada')
        and e.updated_at < now() - make_interval(days => p_retencion_dias)
        and not exists (
          select 1 from public.api_entregas d
           where d.evento_id = e.id and d.estado in ('pendiente', 'reclamada')
        )
      order by e.updated_at
      limit 50000
   );

  return v_borradas;
end;
$$;

revoke execute on function private.purgar_api_llamadas(integer) from public, anon, authenticated;
grant execute on function private.purgar_api_llamadas(integer) to kestra_orquestacion, service_role;

-- ============================================================================
-- 837 · Salud de las entregas (la usa el flow `entregar-webhooks-api`).
-- ============================================================================

create or replace function private.api_entregas_salud(p_ventana_min integer default 60, p_atraso_min integer default 30)
returns table (agotadas bigint, entregas_atrasadas bigint, eventos_atrasados bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_ventana_min is null or p_ventana_min < 1 or p_ventana_min > 10080
     or p_atraso_min is null or p_atraso_min < 1 or p_atraso_min > 10080 then
    raise exception 'PARAMETRO_INVALIDO' using errcode = '22023';
  end if;

  return query
  select
    -- entregas que se agotaron en la ventana (el destino no respondió en los 5 intentos)
    (select count(*) from public.api_entregas d
      where d.estado = 'agotada' and d.actualizada_en >= now() - make_interval(mins => p_ventana_min)),
    -- entregas listas para enviarse hace más de `p_atraso_min` minutos y que nadie reclamó: el pipeline no avanza
    (select count(*) from public.api_entregas d
      where d.estado = 'pendiente' and d.proximo_intento_en < now() - make_interval(mins => p_atraso_min)),
    -- eventos de la API sin repartir hace más de `p_atraso_min` minutos
    (select count(*) from public.cola_eventos e
      where e.estado = 'pendiente'
        and e.tipo in ('stock.actualizado', 'precio.actualizado', 'venta.registrada')
        and e.proximo_intento_en < now() - make_interval(mins => p_atraso_min));
end;
$$;

comment on function private.api_entregas_salud(integer, integer) is
  'MSF-837: cuenta entregas agotadas en la ventana y entregas o eventos atrasados. Solo kestra_orquestacion y service_role: el flow entregar-webhooks-api avisa a soporte con esto.';

revoke execute on function private.api_entregas_salud(integer, integer) from public, anon, authenticated;
grant execute on function private.api_entregas_salud(integer, integer) to kestra_orquestacion, service_role;

-- ============================================================================
-- 838 · Reintento manual de una entrega agotada.
-- ============================================================================

create or replace function public.reintentar_entrega_api(p_entrega_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede reintentar entregas de avisos' using errcode = '42501';
  end if;

  -- Solo una entrega AGOTADA de la organización de quien llama vuelve a la cola, con sus 5 intentos otra vez. El último
  -- error se conserva para que se vea qué falló antes. Si la suscripción está pausada, la entrega espera a que se reanude.
  update public.api_entregas
     set estado = 'pendiente',
         intentos = 0,
         proximo_intento_en = now(),
         actualizada_en = now()
   where public.api_entregas.id = p_entrega_id
     and public.api_entregas.organizacion_id = v_organizacion_id
     and public.api_entregas.estado = 'agotada';

  if not found then
    raise exception 'La entrega no existe o no está agotada' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.reintentar_entrega_api(uuid) is
  'MSF-838: el Administrador devuelve una entrega agotada de su organización a la cola (5 intentos de nuevo).';

revoke execute on function public.reintentar_entrega_api(uuid) from public, anon;
grant execute on function public.reintentar_entrega_api(uuid) to authenticated;
