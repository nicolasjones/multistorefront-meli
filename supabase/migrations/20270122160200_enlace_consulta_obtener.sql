-- F-SVC-22 (MSF-157, épica MSF-124): `public.obtener_enlace_consulta`.
-- Esquema: sin tablas nuevas (escribe en `dominio.reparacion_enlaces_consulta`; Principio VII).
--
-- SECURITY DEFINER con control explícito: organización de la sesión, `edicion` en `service_tecnico`,
-- reparación de la organización (`P0002` si no existe) y de una tienda accesible (`42501`). Idempotente: devuelve
-- el token existente; si no hay, crea uno de 192 bits (`extensions.gen_random_bytes`, base64url) bajo
-- `on conflict (reparacion_id) do nothing`, de modo que dos llamadas concurrentes devuelven el mismo token.
-- Registra la actividad `reparacion.enlace_generado` solo cuando crea.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.obtener_enlace_consulta(uuid);

create or replace function public.obtener_enlace_consulta(p_reparacion uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
  v_token text;
  v_creado boolean := false;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede generar enlaces de seguimiento' using errcode = '42501';
  end if;

  select * into v_rep
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'No tenés acceso a la tienda de esta reparación' using errcode = '42501';
  end if;

  select e.token into v_token
    from dominio.reparacion_enlaces_consulta e
   where e.reparacion_id = v_rep.id and e.organizacion_id = v_org;

  if v_token is null then
    insert into dominio.reparacion_enlaces_consulta (organizacion_id, reparacion_id, token, creado_por)
    values (
      v_org, v_rep.id,
      translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
      (select auth.uid())
    )
    on conflict (reparacion_id) do nothing
    returning token into v_token;
    v_creado := v_token is not null;

    if v_token is null then
      select e.token into v_token
        from dominio.reparacion_enlaces_consulta e
       where e.reparacion_id = v_rep.id and e.organizacion_id = v_org;
    end if;
  end if;

  if v_creado then
    perform private.registrar_actividad(
      'reparacion.enlace_generado',
      format('Generó el enlace de seguimiento de %s', private.codigo_reparacion(v_rep.numero)),
      v_rep.empresa_id
    );
  end if;

  return jsonb_build_object('token', v_token);
end;
$$;

comment on function public.obtener_enlace_consulta(uuid) is
  'F-SVC-22: token del enlace público de seguimiento de una reparación (idempotente; lo crea si no existe). Solo con edición en Service técnico.';

revoke execute on function public.obtener_enlace_consulta(uuid) from public, anon;
grant execute on function public.obtener_enlace_consulta(uuid) to authenticated;
