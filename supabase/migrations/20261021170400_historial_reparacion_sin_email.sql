-- MSF-303 (devolución del Revisor): historial_reparacion no expone el email de auth.users al rol lectura.
-- Sin nombre ni apellido muestra un texto neutro. Esquema: función en public (plataforma), sin tablas nuevas.
-- Reversión: volver a aplicar la definición de 20261021165000 (coalesce con u.email).

create or replace function public.historial_reparacion(p_id uuid)
returns table (
  id uuid,
  tipo text,
  estado_anterior text,
  estado_nuevo text,
  nota text,
  usuario text,
  creado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el historial' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.reparaciones r
     where r.id = p_id
       and r.organizacion_id = (select private.organizacion_id())
       and r.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  return query
    select h.id, h.tipo, a.nombre, n.nombre, h.nota,
           coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre'),
           h.creado_en
      from dominio.reparacion_historial h
      left join dominio.estados_reparacion a on a.id = h.estado_anterior_id and a.organizacion_id = h.organizacion_id
      left join dominio.estados_reparacion n on n.id = h.estado_nuevo_id and n.organizacion_id = h.organizacion_id
      left join public.perfiles_usuario p on p.user_id = h.usuario_id
     where h.reparacion_id = p_id
       and h.organizacion_id = (select private.organizacion_id())
     order by h.creado_en desc, h.id desc;
end;
$$;

comment on function public.historial_reparacion(uuid) is
  'F-SVC-03: historial de una reparación (tipo, estados por nombre, nota, usuario, fecha), más reciente primero. Requiere lectura o edición y tienda accesible.';

revoke execute on function public.historial_reparacion(uuid) from public, anon;
grant execute on function public.historial_reparacion(uuid) to authenticated;
