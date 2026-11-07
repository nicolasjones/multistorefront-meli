-- F-OPS-04 · Acceso de soporte auditado (spec 20261102-100000-auditoria-avanzada-y-soporte, US3).
-- Esquema: todo en `public` (plataforma, Principio VII): superadmin_entradas y
-- superadmin_organizacion_activa ya existen; no se crean tablas.
--
-- Qué hace (aditiva salvo el reemplazo declarado de entrar_a_organizacion):
--   * superadmin_entradas.motivo y superadmin_organizacion_activa.vence_en.
--   * private.superadmin_contexto_vigente: el contexto del superadmin SIN los vencidos.
--     Todo helper que leía la tabla pasa a leer la vista (FR-015).
--   * entrar_a_organizacion(uuid, text): motivo obligatorio (BREAKING, FR-014).
--   * ingreso / salida / vencimiento quedan en superadmin_entradas y como
--     soporte.* en el historial de la organización visitada (FR-016).
--
-- REVERSIÓN (los eventos ya escritos se conservan):
--   1. Restaurar los helpers leyendo la tabla: en cada función que mencione
--      private.superadmin_contexto_vigente, volver a public.superadmin_organizacion_activa.
--   2. drop function public.entrar_a_organizacion(uuid, text);
--      recrear public.entrar_a_organizacion(org_id uuid) (versión de 20260908221453)
--      y restaurar salir_de_organizacion() de esa misma migración.
--   3. drop view private.superadmin_contexto_vigente;
--      alter table public.superadmin_organizacion_activa drop column vence_en;
--      alter table public.superadmin_entradas drop column motivo;

-- ============================================================================
-- Columnas (FR-014, FR-015)
-- ============================================================================

alter table public.superadmin_entradas
  add column if not exists motivo text
    check (motivo is null or (btrim(motivo) <> '' and length(motivo) <= 500));

comment on column public.superadmin_entradas.motivo is
  'Motivo declarado por la persona de soporte al ingresar (F-OPS-04). Las filas anteriores quedan en null.';

alter table public.superadmin_organizacion_activa
  add column if not exists vence_en timestamptz;

-- Los contextos que ya estaban activos reciben un vencimiento.
update public.superadmin_organizacion_activa
   set vence_en = now() + interval '4 hours'
 where vence_en is null;

alter table public.superadmin_organizacion_activa
  alter column vence_en set default (now() + interval '4 hours'),
  alter column vence_en set not null;

comment on column public.superadmin_organizacion_activa.vence_en is
  'Hasta cuándo vale el acceso de soporte (F-OPS-04, FR-015). Vencido, ningún helper lo resuelve.';

-- ============================================================================
-- Contexto vigente (FR-015)
-- ============================================================================

-- security_invoker: rige la RLS de la tabla base (cada superadmin ve solo su fila);
-- las funciones security definer la leen como su dueño.
create or replace view private.superadmin_contexto_vigente
  with (security_invoker = true) as
  select user_id, organizacion_id, entrado_en, vence_en
    from public.superadmin_organizacion_activa
   where vence_en > now();

revoke all on private.superadmin_contexto_vigente from public, anon;
grant select on private.superadmin_contexto_vigente to authenticated;

comment on view private.superadmin_contexto_vigente is
  'superadmin_organizacion_activa sin los accesos de soporte vencidos. Todo helper que resuelva la organización del superadmin lee esta vista, no la tabla (F-OPS-04, FR-015).';

-- Reescribe, a partir de su definición vigente, cada función que lee el contexto
-- (organizacion_id, puede_escribir, nivel_seccion, puede_accion*, rol_id, ...).
-- entrar/salir se reescriben a mano más abajo: necesitan ver también los vencidos.
do $$
declare
  f record;
  v_def text;
  v_nuevo text;
begin
  for f in
    select p.oid, n.nspname, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.prokind = 'f'
       and n.nspname in ('public', 'private', 'dominio')
       and p.proname not in ('entrar_a_organizacion', 'salir_de_organizacion')
       and p.prosrc ~ 'superadmin_organizacion_activa'
  loop
    v_def := pg_get_functiondef(f.oid);
    v_nuevo := regexp_replace(v_def, '(public\.)?superadmin_organizacion_activa', 'private.superadmin_contexto_vigente', 'g');
    execute v_nuevo;
    raise notice 'vigencia de soporte aplicada a %.%', f.nspname, f.proname;
  end loop;
end;
$$;

-- ============================================================================
-- Ingreso con motivo (FR-014, FR-016)
-- ============================================================================

drop function if exists public.entrar_a_organizacion(uuid);

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
   where user_id = auth.uid();

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

comment on function public.entrar_a_organizacion(uuid, text) is
  'Contrato: specs/20261102-100000-auditoria-avanzada-y-soporte/contracts/auditoria-avanzada-y-soporte.md. Reemplaza a entrar_a_organizacion(uuid): el motivo es obligatorio, el acceso vence a las 4 h y queda registrado en superadmin_entradas y en la actividad de la organización.';

revoke execute on function public.entrar_a_organizacion(uuid, text) from public, anon;
grant execute on function public.entrar_a_organizacion(uuid, text) to authenticated;

-- ============================================================================
-- Salida (FR-016): lee la tabla, no la vista, para distinguir salida de vencimiento.
-- ============================================================================

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

  select organizacion_id, vence_en into v_ctx
    from public.superadmin_organizacion_activa
   where user_id = auth.uid();

  -- No-op si no tenía ninguna organización activa.
  if not found then
    return;
  end if;

  delete from public.superadmin_organizacion_activa where user_id = auth.uid();

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

revoke execute on function public.salir_de_organizacion() from public, anon;
grant execute on function public.salir_de_organizacion() to authenticated;
