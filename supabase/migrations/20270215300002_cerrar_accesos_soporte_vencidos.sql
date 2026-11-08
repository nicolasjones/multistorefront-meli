-- MSF-170 (revisión independiente, hallazgo 4): el vencimiento del acceso de soporte se asienta aunque nadie vuelva.
--
-- Antes, `soporte.vencido` (y la salida en `superadmin_entradas`) solo se escribían si la persona de soporte volvía a
-- llamar entrar/salir o dejaba la pestaña abierta; si cerraba el navegador, el Administrador del cliente veía
-- `soporte.ingreso` pero nunca el cierre (FR-016).
--
-- `private.cerrar_accesos_soporte_vencidos()`: para cada acceso de `superadmin_organizacion_activa` con
-- `vence_en <= now()` registra `soporte.vencido` en la organización visitada, una salida en `superadmin_entradas` y
-- borra el contexto. Idempotente y sin duplicados: el DELETE ... RETURNING toma el contexto una sola vez, y
-- `salir_de_organizacion` / `entrar_a_organizacion` pasan a tomarlo con el mismo bloqueo de fila (antes leían sin
-- bloquear y una corrida concurrente podía duplicar el evento). Solo `workers_orquestacion` / `kestra_orquestacion`
-- (mismo chequeo que `depurar_registro_actividad`). Lo ejecuta el flow de Kestra `cierre-accesos-soporte`.
--
-- Migración aditiva. REVERSIÓN (migración posterior):
--   drop function private.cerrar_accesos_soporte_vencidos();
--   restaurar entrar_a_organizacion / salir_de_organizacion de 20270207100003_acceso_soporte_auditado.sql.

create or replace function private.cerrar_accesos_soporte_vencidos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  r record;
begin
  if not exists (
    select 1 from pg_catalog.pg_roles ro
    where ro.rolname in ('workers_orquestacion', 'kestra_orquestacion')
      and pg_catalog.pg_has_role(session_user, ro.oid, 'member')
  ) then
    raise exception 'Runtime no autorizado para cerrar accesos de soporte' using errcode = '42501';
  end if;

  for r in
    delete from public.superadmin_organizacion_activa a
     where a.vence_en <= pg_catalog.clock_timestamp()
    returning a.user_id, a.organizacion_id, a.vence_en
  loop
    v_total := v_total + 1;
    insert into public.superadmin_entradas (user_id, organizacion_id, entrado_en, accion)
    values (r.user_id, r.organizacion_id, pg_catalog.clock_timestamp(), 'salida');
    perform private.insertar_actividad(
      r.organizacion_id, r.user_id, 'soporte.vencido',
      'El acceso de soporte venció el '
        || pg_catalog.to_char(r.vence_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), null);
  end loop;
  return v_total;
end;
$$;

revoke all on function private.cerrar_accesos_soporte_vencidos() from public, anon, authenticated, service_role;
grant execute on function private.cerrar_accesos_soporte_vencidos() to workers_orquestacion;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function private.cerrar_accesos_soporte_vencidos() to kestra_orquestacion;
  end if;
end;
$$;

comment on function private.cerrar_accesos_soporte_vencidos() is
  'MSF-170: registra soporte.vencido y la salida de cada acceso de soporte vencido y limpia el contexto. Idempotente; solo workers_orquestacion / kestra_orquestacion. Devuelve la cantidad de accesos cerrados.';

-- Salida: toma el contexto con DELETE ... RETURNING (una sola vez aunque corra a la vez que el cierre automático).
create or replace function public.salir_de_organizacion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_ahora timestamptz := clock_timestamp();
begin
  if not private.is_superadmin() then
    raise exception 'Solo un superadmin puede salir de una organización activa' using errcode = '42501';
  end if;

  delete from public.superadmin_organizacion_activa
   where user_id = auth.uid()
  returning organizacion_id, vence_en into v_ctx;

  -- No-op si no tenía ninguna organización activa (o ya la cerró el cierre automático).
  if not found then
    return;
  end if;

  insert into public.superadmin_entradas (user_id, organizacion_id, entrado_en, accion)
  values (auth.uid(), v_ctx.organizacion_id, v_ahora, 'salida');

  if v_ctx.vence_en <= v_ahora then
    perform private.insertar_actividad(
      v_ctx.organizacion_id, auth.uid(), 'soporte.vencido',
      'El acceso de soporte venció el '
        || to_char(v_ctx.vence_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), null);
  else
    perform private.insertar_actividad(
      v_ctx.organizacion_id, auth.uid(), 'soporte.salida', 'La persona de soporte salió de la organización', null);
  end if;
end;
$$;

-- Ingreso: igual que 20270207100003, pero el contexto anterior se lee con FOR UPDATE.
create or replace function public.entrar_a_organizacion(org_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_ahora timestamptz := clock_timestamp();
  v_vence timestamptz := clock_timestamp() + interval '4 hours';
  v_anterior record;
begin
  if not private.is_superadmin() then
    raise exception 'Solo un superadmin puede entrar a una organización' using errcode = '42501';
  end if;

  if v_motivo = '' or length(v_motivo) > 500 then
    raise exception 'El motivo del acceso de soporte es obligatorio (hasta 500 caracteres)' using errcode = '22023';
  end if;

  if not exists (select 1 from public.organizaciones where id = org_id) then
    raise exception 'La organización % no existe', org_id using errcode = 'P0002';
  end if;

  select organizacion_id, vence_en into v_anterior
    from public.superadmin_organizacion_activa
   where user_id = auth.uid()
   for update;

  -- Cierra el acceso anterior (otra organización, o el mismo ya vencido).
  if found and (v_anterior.organizacion_id <> org_id or v_anterior.vence_en <= v_ahora) then
    insert into public.superadmin_entradas (user_id, organizacion_id, entrado_en, accion)
    values (auth.uid(), v_anterior.organizacion_id, v_ahora, 'salida');

    if v_anterior.vence_en <= v_ahora then
      perform private.insertar_actividad(
        v_anterior.organizacion_id, auth.uid(), 'soporte.vencido',
        'El acceso de soporte venció el '
          || to_char(v_anterior.vence_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), null);
    else
      perform private.insertar_actividad(
        v_anterior.organizacion_id, auth.uid(), 'soporte.salida', 'La persona de soporte salió de la organización', null);
    end if;
  end if;

  insert into public.superadmin_organizacion_activa (user_id, organizacion_id, entrado_en, vence_en)
  values (auth.uid(), org_id, v_ahora, v_vence)
  on conflict (user_id) do update
    set organizacion_id = excluded.organizacion_id,
        entrado_en = excluded.entrado_en,
        vence_en = excluded.vence_en;

  insert into public.superadmin_entradas (user_id, organizacion_id, entrado_en, accion, motivo)
  values (auth.uid(), org_id, clock_timestamp(), 'entrada', v_motivo);

  perform private.insertar_actividad(
    org_id, auth.uid(), 'soporte.ingreso',
    'Acceso de soporte hasta '
      || to_char(v_vence at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI')
      || '. Motivo: ' || v_motivo, null);
end;
$$;

