-- Fidelidad UI Clientes (prototipo design/pantallas/Clientes.dc.html): expreso preferido.
-- Aditiva: agrega `public.clientes.expreso_preferido` (nullable; filas existentes quedan NULL) + grants
-- de escritura + lo expone en `buscar_clientes` y `exportar_clientes` (create or replace, misma firma).
-- Esquema: columna en `public.clientes` como el resto de la ficha (misma tabla, mismas policies de fila;
-- grants por columna como 20261016130200). Reversión (en migración posterior, no en este PR):
--   alter table public.clientes drop column expreso_preferido;
--   (y quitarlo de los returns de ambas RPC con create or replace).
alter table public.clientes
  add column if not exists expreso_preferido text;

alter table public.clientes drop constraint if exists clientes_expreso_ck;
alter table public.clientes
  add constraint clientes_expreso_ck check (expreso_preferido is null or (btrim(expreso_preferido) <> '' and length(expreso_preferido) <= 120));

grant insert (expreso_preferido) on public.clientes to authenticated;
grant update (expreso_preferido) on public.clientes to authenticated;

-- buscar_clientes: `create or replace` NO puede cambiar el return type: se dropea y recrea
-- (misma firma; los grants se reponen abajo, como en el archivo original).
drop function if exists public.buscar_clientes(text, text, boolean, integer, integer);
create function public.buscar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  id uuid,
  numero integer,
  nombre text,
  documento text,
  correo text,
  telefono text,
  celular text,
  localidad text,
  expreso_preferido text,
  tipo text,
  es_consumidor_final boolean,
  archivado_en timestamptz,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with parametros as (
    select
      -- Escapa \ % _ para que el texto se busque literal (FR-007).
      case when btrim(coalesce(p_texto, '')) = '' then null
        else '%' || replace(replace(replace(lower(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as patron,
      least(greatest(coalesce(p_tamano, 25), 1), 100) as tamano,
      least(greatest(coalesce(p_pagina, 1), 1), 100000) as pagina
  )
  select c.id, c.numero, c.nombre, c.documento, c.correo, c.telefono, c.celular, c.localidad,
         c.expreso_preferido, c.tipo, c.es_consumidor_final, c.archivado_en,
         count(*) over () as total
    from public.clientes c, parametros p
   where c.organizacion_id = (select private.organizacion_id())
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     and (p.patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || coalesce(c.expreso_preferido, '') || ' ' || c.numero::text) like p.patron)
   order by lower(c.nombre), c.id
   limit (select tamano from parametros)
  offset (select (pagina - 1) * tamano from parametros)
$$;

revoke execute on function public.buscar_clientes(text, text, boolean, integer, integer) from public, anon;
grant execute on function public.buscar_clientes(text, text, boolean, integer, integer) to authenticated;

-- exportar_clientes: idem (drop + create por el cambio de return type).
drop function if exists public.exportar_clientes(text, text, boolean, uuid, integer);
create function public.exportar_clientes(
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
  expreso_preferido text,
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

  -- El total (y el tope) se calcula solo en el primer lote; los siguientes lo devuelven en 0
  -- para no re-escanear el filtro completo en cada lote.
  if p_despues_de is null then
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
  else
    v_total := 0;
    -- El cursor debe existir y ser de la misma organización; si no, error (no un archivo truncado).
    select lower(c.nombre) into v_nombre_cursor
      from public.clientes c where c.id = p_despues_de and c.organizacion_id = v_org;
    if v_nombre_cursor is null then
      raise exception 'El cliente de referencia de la exportación ya no existe: reintentá' using errcode = '40001';
    end if;
  end if;

  return query
  select c.id, c.numero, c.nombre, c.documento, c.tipo, c.correo, c.telefono, c.celular, c.direccion,
         c.codigo_postal, c.localidad, c.provincia, c.expreso_preferido, c.archivado_en, v_total
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
  'Exportación de clientes por lotes (keyset lower(nombre), id). Exige private.puede_accion(clientes, exportar); tope de lote 1000 y total 50000 (el total se calcula solo en el primer lote; cursor inexistente => 40001). F-CLI-04.';

revoke execute on function public.exportar_clientes(text, text, boolean, uuid, integer) from public, anon;
grant execute on function public.exportar_clientes(text, text, boolean, uuid, integer) to authenticated;
