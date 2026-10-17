-- MSF-302 · F-ROL-05 (FR-007, FR-009): RPC que registra el pedido de acceso del día.
--
-- Esquema: función en `public` (RPC de la app); la tabla es
-- `public.solicitudes_acceso` (migración anterior). Valida en el servidor
-- sesión, membresía activa, sección del catálogo y que la persona no tenga ya
-- acceso. Idempotente: un único registro por persona, sección y día.
-- Devuelve `nuevo` (false si ya estaba pedido hoy) y `correo_enviado` para que
-- la Edge Function decida si falta el aviso.
--
-- Migración aditiva. Reversión: drop function public.solicitar_acceso(text);

create or replace function public.solicitar_acceso(p_seccion text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_organizacion uuid;
  v_id uuid;
  v_correo timestamptz;
  v_nuevo boolean;
begin
  if v_usuario is null then
    raise exception 'Se requiere una sesión' using errcode = '42501';
  end if;

  -- Membresía activa propia: un superadmin sin membresía no solicita acceso.
  select u.organizacion_id into v_organizacion
    from public.usuarios_organizacion u
    where u.user_id = v_usuario and u.estado = 'activo';
  if v_organizacion is null then
    raise exception 'No perteneces a una organización activa' using errcode = '42501';
  end if;

  if p_seccion is null or not exists (select 1 from private.matriz_inicial() m where m.seccion = p_seccion) then
    raise exception 'Sección inválida' using errcode = '22023';
  end if;

  if (select private.nivel_seccion(p_seccion)) in ('lectura', 'edicion') then
    raise exception 'Ya tienes acceso a esta sección' using errcode = '22023';
  end if;

  insert into public.solicitudes_acceso (organizacion_id, usuario_id, seccion)
  values (v_organizacion, v_usuario, p_seccion)
  on conflict (organizacion_id, usuario_id, seccion, dia) do nothing
  returning id into v_id;
  v_nuevo := v_id is not null;

  if not v_nuevo then
    select s.id, s.correo_enviado_en into v_id, v_correo
      from public.solicitudes_acceso s
      where s.organizacion_id = v_organizacion and s.usuario_id = v_usuario
        and s.seccion = p_seccion and s.dia = current_date;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'organizacion_id', v_organizacion,
    'nuevo', v_nuevo,
    'correo_enviado', v_correo is not null
  );
end;
$$;

revoke execute on function public.solicitar_acceso(text) from public, anon;
grant execute on function public.solicitar_acceso(text) to authenticated;
