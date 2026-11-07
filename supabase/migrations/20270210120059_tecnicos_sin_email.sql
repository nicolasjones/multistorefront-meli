-- F-SVC-02 (devolución del Revisor): `tecnicos_de_service` ya no cae al email de auth.users cuando el
-- técnico no tiene nombre (el spec pide "sin datos personales extra"); usa un texto neutro.
-- Aditiva: solo reemplaza el cuerpo de la función (misma firma y mismos permisos).
-- Reversión: volver a crear la función de 20261020110500_reparaciones_leer.sql.

create or replace function public.tecnicos_de_service()
returns table (user_id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver técnicos' using errcode = '42501';
  end if;
  return query
    select u.user_id,
           coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Técnico sin nombre')
      from public.usuarios_organizacion u
      left join public.perfiles_usuario p on p.user_id = u.user_id
     where u.organizacion_id = (select private.organizacion_id())
       and u.estado = 'activo'
       and private.nivel_de_rol(u.organizacion_id, u.rol_id, 'service_tecnico') = 'edicion'
     order by 2;
end;
$$;

revoke execute on function public.tecnicos_de_service() from public, anon;
grant execute on function public.tecnicos_de_service() to authenticated;
