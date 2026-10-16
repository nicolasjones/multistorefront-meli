-- F-CLI-04 (MSF-318, épica MSF-180): exportación de clientes en servidor (M4, parte 2).
-- Esquema: sin tablas nuevas; `public.exportar_clientes` consulta `public.clientes`
-- (excepción de esquema documentada en el plan, Principio VII).
-- Aditiva. Reversión (en una migración posterior, no en el mismo PR):
--   drop function public.exportar_clientes(text, text, boolean, uuid, integer);
--
-- security definer: exige `private.puede_accion('clientes','exportar')` (que a su vez
-- exige al menos lectura en Clientes) y acota a la organización de
-- `private.organizacion_id()`, nunca a un parámetro del llamador. Error 42501 si no
-- puede exportar. Mismos filtros que `buscar_clientes`; paginación por keyset
-- `(lower(nombre), id)` (sin repetidos ni omisiones aunque se creen clientes durante la
-- descarga). Tope de lote: 1000. Tope total: 50.000 filas (superado → error 54000,
-- «Afiná la búsqueda»). `total` es el de todas las coincidencias, no el del lote.

create or replace function public.exportar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_despues_de uuid default null,
  p_limite integer default 1000
)
returns table (
  id uuid,
  numero integer,
  nombre text,
  documento text,
  tipo text,
  correo text,
  telefono text,
  celular text,
  direccion text,
  codigo_postal text,
  localidad text,
  provincia text,
  archivado_en timestamptz,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_patron text;
  v_limite integer := least(greatest(coalesce(p_limite, 1000), 1), 1000);
  v_total bigint;
  v_nombre_cursor text;
begin
  if not (select private.puede_accion('clientes', 'exportar')) or v_org is null then
    raise exception 'No tenés permiso para exportar clientes' using errcode = '42501';
  end if;

  -- Escapa \ % _ para que el texto se busque literal (igual que buscar_clientes).
  v_patron := case when btrim(coalesce(p_texto, '')) = '' then null
    else '%' || replace(replace(replace(lower(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  select count(*) into v_total
    from public.clientes c
   where c.organizacion_id = v_org
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     and (v_patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || c.numero::text) like v_patron);

  if v_total > 50000 then
    raise exception 'La exportación supera las 50000 filas: afiná la búsqueda' using errcode = '54000';
  end if;

  if p_despues_de is not null then
    -- El cursor debe ser de la misma organización: uno ajeno no devuelve nada.
    select lower(c.nombre) into v_nombre_cursor
      from public.clientes c where c.id = p_despues_de and c.organizacion_id = v_org;
    if v_nombre_cursor is null then
      return;
    end if;
  end if;

  return query
  select c.id, c.numero, c.nombre, c.documento, c.tipo, c.correo, c.telefono, c.celular, c.direccion,
         c.codigo_postal, c.localidad, c.provincia, c.archivado_en, v_total
    from public.clientes c
   where c.organizacion_id = v_org
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     and (v_patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || c.numero::text) like v_patron)
     and (p_despues_de is null or (lower(c.nombre), c.id) > (v_nombre_cursor, p_despues_de))
   order by lower(c.nombre), c.id
   limit v_limite;
end;
$$;

comment on function public.exportar_clientes(text, text, boolean, uuid, integer) is
  'Exportación de clientes por lotes (keyset lower(nombre), id). Exige private.puede_accion(clientes, exportar); tope de lote 1000 y total 50000. F-CLI-04.';

revoke execute on function public.exportar_clientes(text, text, boolean, uuid, integer) from public, anon;
grant execute on function public.exportar_clientes(text, text, boolean, uuid, integer) to authenticated;
