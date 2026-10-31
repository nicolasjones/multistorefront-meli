-- F-SVC-20 (MSF-134, épica MSF-124): `listar_adjuntos_reparacion`.
-- Esquema: sin tablas nuevas (solo lectura de `dominio.reparacion_adjuntos`; Principio VII).
--
-- SECURITY DEFINER de solo lectura. Acepta `lectura` o `edicion` en `service_tecnico` y solo tiendas
-- accesibles (una inaccesible es `P0002`, no revela que existe). Devuelve el nombre visible de quien
-- subió el archivo (nombre y apellido del perfil o un texto neutro), nunca el correo. Más antiguo primero.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_adjuntos_reparacion(uuid);

create or replace function public.listar_adjuntos_reparacion(p_reparacion uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los adjuntos de una reparación' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.reparaciones r
     where r.id = p_reparacion
       and r.organizacion_id = v_org
       and r.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'ruta', a.ruta,
             'nombre_original', a.nombre_original,
             'mime', a.mime,
             'bytes', a.bytes,
             'creado_en', a.creado_en,
             'subido_por', coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre')
           ) order by a.creado_en, a.id)
      from dominio.reparacion_adjuntos a
      left join public.perfiles_usuario p on p.user_id = a.creado_por
     where a.reparacion_id = p_reparacion
       and a.organizacion_id = v_org
  ), '[]'::jsonb);
end;
$$;

comment on function public.listar_adjuntos_reparacion(uuid) is
  'F-SVC-20: adjuntos de una reparación con el nombre visible de quien los subió (nunca el correo). Lectura o edición; solo tiendas accesibles.';

revoke execute on function public.listar_adjuntos_reparacion(uuid) from public, anon;
grant execute on function public.listar_adjuntos_reparacion(uuid) to authenticated;
