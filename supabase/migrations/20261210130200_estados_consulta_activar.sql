-- F-CFG-01 (MSF-333, FR-015): activar / desactivar un estado de consulta, sin borrarlo.
-- Un estado desactivado no se ofrece en nuevas selecciones y las consultas que ya lo usan no se
-- tocan (no hay FK ni cascada: solo cambia `activo`). Solo Administrador; `security invoker`.
--
-- Migración aditiva. Reversión: drop function public.cambiar_estado_estado_consulta(uuid, boolean);

create or replace function public.cambiar_estado_estado_consulta(p_id uuid, p_activo boolean)
returns table (id uuid, activo boolean)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.puede_escribir()) then
    raise exception 'Solo el Administrador puede editar las listas' using errcode = '42501';
  end if;

  return query
    update dominio.estados_consulta as e
       set activo = coalesce(p_activo, e.activo)
     where e.id = p_id
       and e.organizacion_id = (select private.organizacion_id())
    returning e.id, e.activo;

  if not found then
    raise exception 'El estado no existe' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.cambiar_estado_estado_consulta(uuid, boolean) from public, anon;
grant execute on function public.cambiar_estado_estado_consulta(uuid, boolean) to authenticated;
