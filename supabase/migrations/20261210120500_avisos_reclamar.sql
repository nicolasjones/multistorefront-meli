-- MSF-319 · F-NOT-01 (FR-008, FR-009): reclamo de grupos listos para enviar.
-- Kestra llama `private.reclamar_avisos_listos`: toma los grupos con la ventana vencida sin
-- doble toma (`for update skip locked`), re-verifica preferencia, actividad y acceso (si ya
-- no corresponde, descarta) y marca el grupo `enviando` con un reclamo que vence. Un reclamo
-- vencido (Kestra se cayó a mitad de camino) vuelve a estar disponible.
-- El rol de Kestra es el existente `kestra_orquestacion` (un único rol de servicio para todo
-- Kestra, ver 20260914150000_orquestacion_multi_organizacion.sql): solo recibe EXECUTE sobre
-- las tres funciones de avisos (se concede en 20261210120600), ningún privilegio sobre las tablas.
--
-- Reversión (migración posterior): drop function private.reclamar_avisos_listos(integer);

create or replace function private.reclamar_avisos_listos(p_limite integer default 50)
returns table (grupo_id uuid, destinatario text, tipo text, nombre text, cantidad integer, detalle jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_grupo uuid;
  v_ids uuid[];
  v_user uuid;
  v_organizacion uuid;
  v_tipo text;
  v_seccion text;
  v_nombre text;
  v_email text;
  v_corresponde boolean;
begin
  -- Reclamos vencidos: vuelven a estar disponibles.
  update public.avisos_pendientes a
  set estado = 'pendiente', reclamado_hasta = null
  where a.estado = 'enviando' and a.reclamado_hasta < now();

  for v_grupo in
    select a.grupo_id
    from public.avisos_pendientes a
    where a.estado = 'pendiente'
      and a.ventana_vence_en <= now()
      and (a.proximo_intento is null or a.proximo_intento <= now())
    group by a.grupo_id
    order by min(a.ventana_vence_en)
    limit greatest(coalesce(p_limite, 50), 1)
  loop
    -- Sin doble toma: si otra sesión ya tiene las filas, se saltean.
    select array_agg(l.id) into v_ids
    from (
      select a.id
      from public.avisos_pendientes a
      where a.grupo_id = v_grupo and a.estado = 'pendiente'
      for update skip locked
    ) l;
    if v_ids is null then
      continue;
    end if;

    select a.user_id, a.organizacion_id, a.tipo_aviso
    into v_user, v_organizacion, v_tipo
    from public.avisos_pendientes a where a.id = v_ids[1];

    select t.seccion, t.nombre into v_seccion, v_nombre from public.tipos_aviso t where t.clave = v_tipo;
    select u.email into v_email from auth.users u where u.id = v_user;

    -- FR-009: preferencia encendida, miembro activo y con acceso a la sección.
    v_corresponde :=
      btrim(coalesce(v_email, '')) <> ''
      and coalesce(
        (select p.activo from public.preferencias_aviso p
          where p.user_id = v_user and p.tipo_aviso = v_tipo),
        true
      )
      and exists (
        select 1 from public.usuarios_organizacion m
        where m.user_id = v_user and m.organizacion_id = v_organizacion and m.estado = 'activo'
      )
      and private.nivel_seccion_de_usuario(v_user, v_seccion) <> 'ninguno';

    if not v_corresponde then
      update public.avisos_pendientes a
      set estado = 'descartado', reclamado_hasta = null,
          error = 'Descartado: el aviso ya no corresponde (preferencia apagada, usuario inactivo o sin acceso)'
      where a.id = any (v_ids);
      continue;
    end if;

    update public.avisos_pendientes a
    set estado = 'enviando', reclamado_hasta = now() + interval '10 minutes'
    where a.id = any (v_ids);

    grupo_id := v_grupo;
    destinatario := v_email;
    tipo := v_tipo;
    nombre := v_nombre;
    cantidad := cardinality(v_ids);
    detalle := (
      select jsonb_agg(a.datos order by a.creado_en, a.id)
      from public.avisos_pendientes a where a.id = any (v_ids)
    );
    return next;
  end loop;
end;
$$;

comment on function private.reclamar_avisos_listos(integer) is
  'Reclama (sin doble toma) hasta p_limite grupos con la ventana vencida, re-verificando preferencia, actividad y acceso; los que ya no corresponden se descartan. El reclamo vence a los 10 minutos. Solo el rol de Kestra.';

revoke execute on function private.reclamar_avisos_listos(integer) from public, anon, authenticated;
