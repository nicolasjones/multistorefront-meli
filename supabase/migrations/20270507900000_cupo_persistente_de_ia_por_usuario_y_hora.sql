-- Lote 90 (MSF-867, bug consolidado MSF-727): cupo PERSISTENTE de uso de IA por usuario, funcionalidad y hora.
--
-- Hasta ahora `chat-ia-responder` contaba los mensajes del usuario en `mensajes_chat_ia` (el usuario conserva DELETE sobre sus
-- mensajes: borrarlos reiniciaba el contador) y `preguntar-documentos` usaba un `Map` en memoria del isolate (cada instancia tenía el
-- suyo y se reiniciaba al reciclarse). Ninguno era una cuota real sobre el crédito del proveedor. Esta migración agrega lo que exige
-- base de datos; los chequeos de funcionalidad, conversación, longitud, `max_tokens` y timeout ya estaban en las funciones Edge
-- (lote 25) y la migración no los toca.
--
--   1. `private.ia_cupo_uso (usuario_id, funcionalidad, ventana, usos)`: una fila por usuario, funcionalidad y hora UTC. Clave
--      primaria `(usuario_id, funcionalidad, ventana)`; `usuario_id` referencia `auth.users` con `on delete cascade`. Vive en `private`
--      (PostgREST no la expone), con RLS activado y UNA política que deniega todo a `anon` y `authenticated` (la higiene global exige
--      una política explícita por tabla con RLS; `using (false)` la deja cerrada). Sin privilegios de tabla para nadie salvo el dueño y
--      `select` para `service_role` (soporte); el consumo y la purga las hacen las funciones `security definer`.
--   2. `private.consumir_cupo_ia(p_usuario, p_funcionalidad, p_limite)`: consume UN uso de la hora actual de forma atómica
--      (`insert ... on conflict do update ... where usos < p_limite returning`): dos sesiones simultáneas nunca pasan del tope, porque
--      la segunda espera el candado de la fila y reevalúa el `where` con el valor ya incrementado. Devuelve `se_consumio`,
--      `usos_actuales` y `segundos_hasta_reinicio` (hasta la próxima hora en punto UTC, mínimo 1). `p_limite` nulo o fuera de 1..1000 (el máximo razonable por hora; las funciones Edge
--      vuelven a 30 si el ENV pide más), usuario o funcionalidad vacíos se rechazan con `22023`. `public.consumir_cupo_ia` es su envoltorio invocable por RPC (el patrón de
--      `resolver_politica_ia`: `private` no está expuesto en la API).
--   3. `private.purgar_cupo_ia(p_dias int default 2)`: borra las ventanas anteriores a `p_dias` días (idempotente; devuelve cuántas filas
--      borró; `p_dias < 1` o nulo se rechaza con `22023`). NO está agendada (ni Kestra ni cron): se invoca a mano con
--      `select private.purgar_cupo_ia();` como `service_role` o dueño. Agendarla queda como seguimiento.
--
-- ACL: las tres funciones son `security definer` con `search_path = ''`; `revoke all ... from public, anon, authenticated` y
-- `grant execute` solo a `service_role` (la función pública y las dos privadas).
-- Sin tabla de auditoría de consumo: `ia_interacciones` es la máquina de estados de la IA gobernada (una fila por ejecución, con política,
-- perfil e `idempotency_key`), no la escriben estas dos funciones, guarda estados por ejecución y no un contador atómico por usuario
-- y hora, y no cubre lo rechazado antes de invocar; `ia_cupo_uso` guarda solo los contadores de la hora.
-- El cupo es por usuario y funcionalidad (no por organización) y un uso consumido no se reintegra si el proveedor falla.
--
-- Orden de despliegue: esta migración ANTES que las funciones Edge `chat-ia-responder` y `preguntar-documentos` de este lote. Las
-- funciones nuevas llaman a `public.consumir_cupo_ia` y, si falta o falla, responden 503 (fallan cerrado, nunca gastan crédito).
--
-- Reaplicable: `create ... if not exists`, `create or replace`, `drop policy if exists` antes de crear la política.
--
-- Reversión (migración posterior; los pasos son reales y ordenados). ADVERTENCIA: revertir quita el único cupo persistente por usuario
-- y hora de las funciones de IA. Antes de borrar nada hay que volver a desplegar las versiones ANTERIORES de `chat-ia-responder` y
-- `preguntar-documentos` (las de este lote llaman a `public.consumir_cupo_ia` y, sin ella, responden 503 a todas las consultas). Con
-- las versiones anteriores el tope vuelve a ser el de mejor esfuerzo (mensajes de `mensajes_chat_ia`, que el usuario puede borrar, y un
-- contador en memoria por isolate): vuelve a haber un hueco de gasto de crédito del proveedor sin cuota real.
--   drop function if exists public.consumir_cupo_ia(uuid, text, int);
--   drop function if exists private.purgar_cupo_ia(int);
--   drop function if exists private.consumir_cupo_ia(uuid, text, int);
--   drop table if exists private.ia_cupo_uso;
--   Los contadores acumulados se pierden (solo valen para la hora en curso).

create table if not exists private.ia_cupo_uso (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  funcionalidad text not null,
  ventana timestamptz not null,
  usos integer not null,
  primary key (usuario_id, funcionalidad, ventana),
  constraint ia_cupo_uso_funcionalidad_valida check (btrim(funcionalidad) <> '' and char_length(funcionalidad) <= 64),
  constraint ia_cupo_uso_usos_positivos check (usos >= 1),
  -- La ventana es siempre una hora en punto UTC: dos sesiones con otra zona horaria no parten el contador en dos.
  constraint ia_cupo_uso_ventana_horaria check (ventana = (date_trunc('hour', ventana at time zone 'UTC') at time zone 'UTC'))
);

comment on table private.ia_cupo_uso is
  'Cupo de uso de IA: un contador por usuario, funcionalidad y hora UTC (lote 90, MSF-727). Solo lo toca private.consumir_cupo_ia / purgar_cupo_ia.';

-- Para la purga por antigüedad (la clave primaria ya cubre las búsquedas por usuario).
create index if not exists ia_cupo_uso_ventana_idx on private.ia_cupo_uso (ventana);

alter table private.ia_cupo_uso enable row level security;
revoke all on table private.ia_cupo_uso from public, anon, authenticated;
grant select on table private.ia_cupo_uso to service_role;

drop policy if exists ia_cupo_uso_denegar_todo on private.ia_cupo_uso;
create policy ia_cupo_uso_denegar_todo on private.ia_cupo_uso
  as permissive for all to anon, authenticated
  using (false) with check (false);

create or replace function private.consumir_cupo_ia(p_usuario uuid, p_funcionalidad text, p_limite int)
returns table (se_consumio boolean, usos_actuales integer, segundos_hasta_reinicio integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ventana timestamptz := date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC';
  v_usos integer;
  v_segundos integer;
begin
  if p_usuario is null then
    raise exception 'consumir_cupo_ia: falta el usuario' using errcode = '22023';
  end if;
  if p_funcionalidad is null or btrim(p_funcionalidad) = '' then
    raise exception 'consumir_cupo_ia: falta la funcionalidad' using errcode = '22023';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 1000 then
    raise exception 'consumir_cupo_ia: el límite debe ser un entero entre 1 y 1000' using errcode = '22023';
  end if;

  v_segundos := greatest(1, ceil(extract(epoch from (v_ventana + interval '1 hour' - now())))::integer);

  -- Atómico: la primera consulta de la hora inserta con 1 uso; las siguientes suman 1 SOLO si todavía quedan usos. Con el tope
  -- alcanzado el `where` falla, no se actualiza nada y `returning` no devuelve fila.
  insert into private.ia_cupo_uso as c (usuario_id, funcionalidad, ventana, usos)
  values (p_usuario, p_funcionalidad, v_ventana, 1)
  on conflict (usuario_id, funcionalidad, ventana) do update set usos = c.usos + 1 where c.usos < p_limite
  returning c.usos into v_usos;

  if v_usos is not null then
    return query select true, v_usos, v_segundos;
    return;
  end if;

  select c.usos into v_usos
    from private.ia_cupo_uso c
   where c.usuario_id = p_usuario and c.funcionalidad = p_funcionalidad and c.ventana = v_ventana;
  return query select false, coalesce(v_usos, p_limite), v_segundos;
end;
$$;

comment on function private.consumir_cupo_ia(uuid, text, int) is
  'Consume un uso del cupo horario de IA del usuario y la funcionalidad (atómico). Devuelve se_consumio, usos_actuales y segundos_hasta_reinicio. Solo service_role (vía public.consumir_cupo_ia).';

create or replace function public.consumir_cupo_ia(p_usuario uuid, p_funcionalidad text, p_limite int)
returns table (se_consumio boolean, usos_actuales integer, segundos_hasta_reinicio integer)
language sql
security definer
set search_path = ''
as $$ select * from private.consumir_cupo_ia(p_usuario, p_funcionalidad, p_limite) $$;

comment on function public.consumir_cupo_ia(uuid, text, int) is
  'Envoltorio RPC de private.consumir_cupo_ia (private no está expuesto en la API). Solo lo ejecuta service_role (las funciones Edge de IA).';

create or replace function private.purgar_cupo_ia(p_dias int default 2)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borradas bigint;
begin
  if p_dias is null or p_dias < 1 then
    raise exception 'purgar_cupo_ia: los días deben ser un entero mayor o igual a 1' using errcode = '22023';
  end if;
  delete from private.ia_cupo_uso
   where ventana < (date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC') - make_interval(days => p_dias);
  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

comment on function private.purgar_cupo_ia(int) is
  'Borra las ventanas de cupo de IA con más de p_dias días (idempotente; devuelve cuántas filas borró). Sin agendar: invocar a mano como service_role.';

revoke all on function private.consumir_cupo_ia(uuid, text, int) from public, anon, authenticated;
revoke all on function public.consumir_cupo_ia(uuid, text, int) from public, anon, authenticated;
revoke all on function private.purgar_cupo_ia(int) from public, anon, authenticated;
grant execute on function private.consumir_cupo_ia(uuid, text, int) to service_role;
grant execute on function public.consumir_cupo_ia(uuid, text, int) to service_role;
grant execute on function private.purgar_cupo_ia(int) to service_role;
