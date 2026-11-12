-- F-API-01 (MSF-233) · seguimiento MSF-839 de la revisión del rol CTO: rotación del secreto de firma de una suscripción.
--
-- Hasta ahora, si el secreto de una suscripción se filtraba, la única salida era eliminarla y crearla de nuevo, con corte del
-- servicio. Ahora el Administrador puede ROTAR el secreto con una gracia de 24 h como las claves de API (D-3):
--   · `public.rotar_secreto_suscripcion_api(id)` crea un secreto nuevo en Vault, deja el actual como `secreto_anterior` hasta
--     dentro de 24 h y devuelve el nuevo UNA sola vez;
--   · durante la gracia, `entregar-webhook` firma cada aviso con los DOS secretos (`X-Firma: t=…,v1=<nuevo>,v1=<anterior>`): el
--     receptor acepta el aviso si alguna de las firmas coincide y cambia su secreto sin cortar el servicio;
--   · rotar de nuevo durante la gracia REEMPLAZA al anterior (el anterior de antes deja de valer ya y se borra de Vault);
--   · pasada la gracia, la purga diaria borra el secreto anterior de Vault y lo limpia de la fila;
--   · borrar la suscripción borra los dos secretos (trigger).
-- `api_entrega_para_entregar` devuelve ahora también `secreto_anterior` (nulo si no hay o ya venció). El secreto anterior se lee
-- con una función que devuelve nulo si Vault no lo puede descifrar (por ejemplo tras restaurar la base en otra instancia): un
-- secreto ilegible no tumba la entrega.
--
-- Migración aditiva (dos columnas nuevas con default nulo). Reversión (en una migración posterior):
--   revoke execute on function public.rotar_secreto_suscripcion_api(uuid) from authenticated;
--   drop function public.rotar_secreto_suscripcion_api(uuid);
--   drop function private.api_secreto_o_nulo(uuid);
--   `drop function` de `public.api_entrega_para_entregar(uuid)` y `private.api_entrega_para_entregar(uuid)` (el tipo de retorno
--   cambia: `create or replace` no alcanza) y recrearlas con la definición de 20270224110204_api_suscripciones_entregas.sql
--   (sin `secreto_anterior`) y sus grants a `service_role`, `private.api_borrar_secreto_suscripcion` a la de
--   20270301100000_api_decisiones_abiertas_msf233.sql y `private.purgar_api_llamadas` a la de 20270302100000_api_seguimientos_msf233.sql;
--   alter table public.api_suscripciones drop column secreto_anterior_vault_id, drop column secreto_anterior_vence_en;
--   (antes, borrar de Vault los secretos anteriores que queden).

alter table public.api_suscripciones
  add column if not exists secreto_anterior_vault_id uuid,
  add column if not exists secreto_anterior_vence_en timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'api_suscripciones_secreto_anterior_coherente') then
    alter table public.api_suscripciones
      add constraint api_suscripciones_secreto_anterior_coherente
      check ((secreto_anterior_vault_id is null) = (secreto_anterior_vence_en is null));
  end if;
end $$;

comment on column public.api_suscripciones.secreto_anterior_vault_id is
  'MSF-839: secreto de firma anterior en Vault durante la gracia de 24 h de una rotación. No se otorga a authenticated.';
comment on column public.api_suscripciones.secreto_anterior_vence_en is
  'MSF-839: hasta cuándo vale el secreto anterior (gracia de 24 h). La pantalla lo muestra.';

-- Mismo principio que el resto de las columnas: la referencia a Vault no se otorga; la fecha sí (la pantalla la muestra).
grant select (secreto_anterior_vence_en) on table public.api_suscripciones to authenticated;

-- El secreto anterior es único como el actual: dos suscripciones no pueden compartir un secreto de Vault.
create unique index if not exists api_suscripciones_secreto_anterior_vault_uidx
  on public.api_suscripciones (secreto_anterior_vault_id) where secreto_anterior_vault_id is not null;

-- ============================================================================
-- Lectura tolerante de un secreto de Vault: nulo si no existe o no se puede descifrar.
-- ============================================================================

create or replace function private.api_secreto_o_nulo(p_vault_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secreto text;
begin
  if p_vault_id is null then
    return null;
  end if;
  begin
    select vs.decrypted_secret into v_secreto from vault.decrypted_secrets vs where vs.id = p_vault_id;
  exception when others then
    return null;
  end;
  return v_secreto;
end;
$$;

comment on function private.api_secreto_o_nulo(uuid) is
  'MSF-839: lee un secreto de Vault y devuelve nulo si no existe o no se puede descifrar (por ejemplo tras un restore en otra instancia).';

revoke execute on function private.api_secreto_o_nulo(uuid) from public, anon, authenticated;
grant execute on function private.api_secreto_o_nulo(uuid) to service_role;

-- ============================================================================
-- Rotar el secreto de una suscripción (Administrador de la organización).
-- ============================================================================

create or replace function public.rotar_secreto_suscripcion_api(p_id uuid)
returns table (id uuid, secreto text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_suscripcion public.api_suscripciones;
  v_secreto text;
  v_vault_nuevo uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede rotar el secreto de una suscripción' using errcode = '42501';
  end if;

  -- `for update`: dos rotaciones simultáneas de la misma suscripción se serializan.
  select * into v_suscripcion
    from public.api_suscripciones s
   where s.id = p_id and s.organizacion_id = v_organizacion_id
   for update;
  if not found then
    raise exception 'La suscripción no existe' using errcode = 'P0002';
  end if;

  v_secreto := encode(extensions.gen_random_bytes(32), 'hex');
  v_vault_nuevo := vault.create_secret(v_secreto);

  -- Si ya había un secreto anterior en gracia, este rotación lo REEMPLAZA: el de antes deja de valer ya.
  update public.api_suscripciones s
     set secreto_anterior_vault_id = v_suscripcion.secreto_vault_id,
         secreto_anterior_vence_en = now() + interval '24 hours',
         secreto_vault_id = v_vault_nuevo,
         actualizada_en = now()
   where s.id = p_id;

  if v_suscripcion.secreto_anterior_vault_id is not null then
    delete from vault.secrets where vault.secrets.id = v_suscripcion.secreto_anterior_vault_id;
  end if;

  return query select p_id, v_secreto;
end;
$$;

comment on function public.rotar_secreto_suscripcion_api(uuid) is
  'MSF-839: el Administrador rota el secreto de firma de una suscripción de su organización. El anterior sigue valiendo 24 h (los avisos llevan las dos firmas) y el nuevo se devuelve una sola vez.';

revoke execute on function public.rotar_secreto_suscripcion_api(uuid) from public, anon;
grant execute on function public.rotar_secreto_suscripcion_api(uuid) to authenticated;

-- ============================================================================
-- Borrar la suscripción borra los dos secretos.
-- ============================================================================

create or replace function private.api_borrar_secreto_suscripcion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id in (old.secreto_vault_id, old.secreto_anterior_vault_id);
  return old;
end;
$$;

-- ============================================================================
-- La entrega recibe también el secreto anterior (si sigue en gracia). El tipo de retorno cambia: se recrean las dos funciones.
-- ============================================================================

drop function if exists public.api_entrega_para_entregar(uuid);
drop function if exists private.api_entrega_para_entregar(uuid);

create or replace function private.api_entrega_para_entregar(p_entrega_id uuid)
returns table (url text, evento jsonb, secreto text, secreto_anterior text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select s.url,
    jsonb_build_object(
      'id', ev.id,
      'tipo', ev.tipo,
      'organizacion_id', ev.organizacion_id,
      'ocurrido_en', ev.carga->>'ocurrido_en',
      'datos', ev.carga - 'ocurrido_en'
    ),
    vs.decrypted_secret,
    case when s.secreto_anterior_vence_en > clock_timestamp()
      then private.api_secreto_o_nulo(s.secreto_anterior_vault_id)
    end
    from public.api_entregas d
    join public.api_suscripciones s on s.id = d.suscripcion_id
    join public.cola_eventos ev on ev.id = d.evento_id
    join vault.decrypted_secrets vs on vs.id = s.secreto_vault_id
   where d.id = p_entrega_id and d.estado = 'reclamada' and d.vence_en > clock_timestamp();
end;
$$;

comment on function private.api_entrega_para_entregar(uuid) is
  'F-API-01: devuelve el destino, el evento, el secreto de firma y, durante la gracia de una rotación (MSF-839), el secreto anterior de una entrega RECLAMADA. Solo service_role: los secretos nunca llegan al navegador ni a una entrega ya resuelta.';

revoke execute on function private.api_entrega_para_entregar(uuid) from public, anon, authenticated;
grant execute on function private.api_entrega_para_entregar(uuid) to service_role;

create or replace function public.api_entrega_para_entregar(p_entrega_id uuid)
returns table (url text, evento jsonb, secreto text, secreto_anterior text)
language sql
security definer
set search_path = ''
as $$
  select * from private.api_entrega_para_entregar(p_entrega_id);
$$;

comment on function public.api_entrega_para_entregar(uuid) is
  'F-API-01: destino, evento, secreto de firma y secreto anterior (si sigue en gracia) de una entrega. Solo service_role.';

revoke execute on function public.api_entrega_para_entregar(uuid) from public, anon, authenticated;
grant execute on function public.api_entrega_para_entregar(uuid) to service_role;

-- ============================================================================
-- La purga diaria limpia los secretos anteriores cuya gracia terminó.
-- ============================================================================

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

  -- MSF-839: el secreto anterior de una rotación deja de valer a las 24 h; se limpia la fila y se borra de Vault.
  with vencidas as (
    select s.id, s.secreto_anterior_vault_id as viejo
      from public.api_suscripciones s
     where s.secreto_anterior_vence_en is not null and s.secreto_anterior_vence_en < now()
       for update
  ), limpiadas as (
    update public.api_suscripciones s
       set secreto_anterior_vault_id = null, secreto_anterior_vence_en = null
      from vencidas v
     where s.id = v.id
    returning v.viejo
  )
  delete from vault.secrets where vault.secrets.id in (select viejo from limpiadas);

  return v_borradas;
end;
$$;

revoke execute on function private.purgar_api_llamadas(integer) from public, anon, authenticated;
grant execute on function private.purgar_api_llamadas(integer) to kestra_orquestacion, service_role;
