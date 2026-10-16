-- F-ROL-06 · devolución del Revisor (PR #96): serializar el primer cambio de empresa activa.
--
-- `select ... for update` sobre una fila inexistente no bloquea: dos llamadas concurrentes del
-- primer cambio veían v_anterior nulo y registraban el evento dos veces. Se toma un lock
-- advisory transaccional por usuario antes de leer, así la segunda espera y ve la fila ya creada.
--
-- Sin test de concurrencia: pgTAP corre en una sola transacción y no puede simular dos sesiones;
-- el lock queda cubierto por esta nota y por la revisión de la migración.
--
-- Esquemas (Principio VII): no crea ni altera tablas; solo redefine la función RPC de `public`.
-- Migración aditiva (create or replace, misma firma y mismos grants). Reversión: volver a
-- aplicar la definición de 20261016150000_cambiar_empresa_activa.sql.

create or replace function public.cambiar_empresa_activa(p_empresa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_nombre text;
  v_anterior uuid;
begin
  if v_user is null or (select private.organizacion_id()) is null then
    raise exception 'Se necesita una sesión con organización para cambiar de empresa' using errcode = '42501';
  end if;
  if p_empresa_id is null then
    raise exception 'La empresa es obligatoria' using errcode = '22023';
  end if;
  if p_empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'No tenés acceso a esa empresa' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user::text));

  select a.empresa_id into v_anterior
  from public.usuario_empresa_activa a
  where a.user_id = v_user;

  if v_anterior is not distinct from p_empresa_id then
    return p_empresa_id;
  end if;

  insert into public.usuario_empresa_activa (user_id, empresa_id, updated_at)
  values (v_user, p_empresa_id, now())
  on conflict (user_id) do update
    set empresa_id = excluded.empresa_id, updated_at = excluded.updated_at;

  select e.nombre into v_nombre from dominio.empresas e where e.id = p_empresa_id;
  perform private.registrar_actividad(
    'usuario.empresa_activa_cambiada',
    'Cambió su empresa activa a ' || v_nombre,
    p_empresa_id
  );

  return p_empresa_id;
end;
$$;

revoke execute on function public.cambiar_empresa_activa(uuid) from public, anon;
grant execute on function public.cambiar_empresa_activa(uuid) to authenticated;
