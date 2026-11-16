-- F-CFG-01 (MSF-333, FR-014): alta y renombre de estados de consulta.
-- Solo Administrador (`private.puede_escribir()`). `security invoker`: la RLS de la tabla sigue
-- siendo la autoridad; el chequeo explícito da un error claro (42501) en vez de un vacío.
-- Errores: 42501 sin permiso · 23514 nombre vacío · 23505 nombre repetido (índice único sin
-- distinguir mayúsculas ni espacios en los extremos) · P0002 estado inexistente.
--
-- Migración aditiva. Reversión:
--   drop function public.crear_estado_consulta(text);
--   drop function public.renombrar_estado_consulta(uuid, text);

create or replace function public.crear_estado_consulta(p_nombre text)
returns table (id uuid, nombre text, activo boolean, orden integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo el Administrador puede editar las listas' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre del estado no puede estar vacío' using errcode = '23514';
  end if;

  -- El nuevo estado queda al final del orden.
  return query
    insert into dominio.estados_consulta as e (organizacion_id, nombre, orden)
    values (
      v_org,
      p_nombre,
      coalesce((select max(x.orden) from dominio.estados_consulta x where x.organizacion_id = v_org), 0) + 1
    )
    returning e.id, e.nombre, e.activo, e.orden;
end;
$$;

create or replace function public.renombrar_estado_consulta(p_id uuid, p_nombre text)
returns table (id uuid, nombre text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.puede_escribir()) then
    raise exception 'Solo el Administrador puede editar las listas' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre del estado no puede estar vacío' using errcode = '23514';
  end if;

  return query
    update dominio.estados_consulta as e
       set nombre = p_nombre
     where e.id = p_id
       and e.organizacion_id = (select private.organizacion_id())
    returning e.id, e.nombre;

  if not found then
    raise exception 'El estado no existe' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.crear_estado_consulta(text) from public, anon;
revoke execute on function public.renombrar_estado_consulta(uuid, text) from public, anon;
grant execute on function public.crear_estado_consulta(text) to authenticated;
grant execute on function public.renombrar_estado_consulta(uuid, text) to authenticated;
