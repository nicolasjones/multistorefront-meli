-- MSF-378 · F-NOT-02 (FR-002 a FR-005, FR-010): funciones de la campanita de notificaciones.
-- Esquema `public` (funciones de plataforma). `security definer` + `search_path = ''`: la persona y la
-- organización salen SIEMPRE de la sesión (auth.uid() / private.organizacion_id()), nunca por parámetro.
-- Excluyen avisos `descartado` y tipos cuya sección la persona ya no puede ver.
--
-- Reversión (migración posterior):
--   drop function public.listar_notificaciones(integer, timestamptz, uuid);
--   drop function public.contar_notificaciones_sin_leer();
--   drop function public.marcar_notificaciones_leidas(uuid[]);

create or replace function public.listar_notificaciones(
  p_limite integer default 20,
  p_antes_de timestamptz default null,
  p_antes_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid := private.organizacion_id();
  v_limite integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  v_total integer;
  v_items jsonb;
begin
  if v_user is null or v_org is null then
    return jsonb_build_object('total', 0, 'items', '[]'::jsonb);
  end if;

  -- Evalúa el acceso una vez por tipo, no por fila.
  with visibles as (
    select t.clave
    from public.tipos_aviso t
    where private.nivel_seccion_de_usuario(v_user, t.seccion) <> 'ninguno'
  )
  select
    (select count(*)::int
       from public.avisos_pendientes a
      where a.user_id = v_user and a.organizacion_id = v_org and a.estado <> 'descartado'
        and a.tipo_aviso in (select clave from visibles)),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id, 'tipo_nombre', x.nombre, 'datos', x.datos,
          'creado_en', x.creado_en, 'leido_en', x.leido_en
        ) order by x.creado_en desc, x.id desc)
      from (
        select a.id, t.nombre, a.datos, a.creado_en, a.leido_en
        from public.avisos_pendientes a
        join public.tipos_aviso t on t.clave = a.tipo_aviso
        where a.user_id = v_user and a.organizacion_id = v_org and a.estado <> 'descartado'
          and a.tipo_aviso in (select clave from visibles)
          and (p_antes_de is null or (a.creado_en, a.id) < (p_antes_de, coalesce(p_antes_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
        order by a.creado_en desc, a.id desc
        limit v_limite
      ) x
    ), '[]'::jsonb)
  into v_total, v_items;

  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.contar_notificaciones_sin_leer()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- Mismo criterio que `listar_notificaciones`: el acceso se evalúa una vez por TIPO de aviso (una decena de filas), no
  -- por cada aviso acumulado. Este conteo corre cada 60 s por pestaña abierta.
  with visibles as (
    select t.clave
    from public.tipos_aviso t
    where auth.uid() is not null
      and private.nivel_seccion_de_usuario(auth.uid(), t.seccion) <> 'ninguno'
  )
  select count(*)::int
  from public.avisos_pendientes a
  where auth.uid() is not null
    and a.user_id = auth.uid()
    and a.organizacion_id = private.organizacion_id()
    and a.estado <> 'descartado'
    and a.leido_en is null
    and a.tipo_aviso in (select clave from visibles);
$$;

create or replace function public.marcar_notificaciones_leidas(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marcadas integer;
begin
  if auth.uid() is null then
    return 0;
  end if;

  -- Idempotente: solo toca avisos propios vigentes (mismo filtro de acceso que el conteo) que siguen sin leer (leido_en conserva el primer momento).
  update public.avisos_pendientes a
     set leido_en = now()
   where a.user_id = auth.uid()
     and a.organizacion_id = private.organizacion_id()
     and a.estado <> 'descartado'
     and a.leido_en is null
     and (p_ids is null or a.id = any (p_ids))
     and a.tipo_aviso in (
       select t.clave from public.tipos_aviso t
        where private.nivel_seccion_de_usuario(auth.uid(), t.seccion) <> 'ninguno');
  get diagnostics v_marcadas = row_count;
  return v_marcadas;
end;
$$;

comment on function public.listar_notificaciones(integer, timestamptz, uuid) is
  'Avisos propios de la sesión (sin descartados ni tipos sin acceso vigente), del más nuevo al más viejo, por tandas (cursor compuesto p_antes_de + p_antes_id = (creado_en, id) del último ítem; límite máx. 50) + total.';
comment on function public.contar_notificaciones_sin_leer() is
  'Cantidad de avisos propios sin leer (mismos filtros que listar_notificaciones).';
comment on function public.marcar_notificaciones_leidas(uuid[]) is
  'Marca como leídos los avisos propios indicados (o todos los sin leer si p_ids es nulo). Idempotente; devuelve cuántos marcó.';

revoke all on function public.listar_notificaciones(integer, timestamptz, uuid) from public, anon;
revoke all on function public.contar_notificaciones_sin_leer() from public, anon;
revoke all on function public.marcar_notificaciones_leidas(uuid[]) from public, anon;
grant execute on function public.listar_notificaciones(integer, timestamptz, uuid) to authenticated;
grant execute on function public.contar_notificaciones_sin_leer() to authenticated;
grant execute on function public.marcar_notificaciones_leidas(uuid[]) to authenticated;
