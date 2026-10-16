-- F-CLI-02 (MSF-282, épica MSF-180): búsqueda de clientes en servidor (M4, parte 1).
-- Esquema: sin tablas nuevas; `public.buscar_clientes` consulta `public.clientes`
-- (excepción de esquema documentada en el plan, Principio VII).
-- Aditiva. Reversión (en una migración posterior, no en el mismo PR):
--   drop function public.buscar_clientes(text, text, boolean, integer, integer);
--
-- security invoker: el llamador hereda la RLS de `clientes` (organización y
-- `nivel_seccion('clientes')`); además se acota a su organización por si un
-- superadmin ve varias. La expresión de búsqueda es la misma del índice GIN
-- `clientes_busqueda_trgm_idx` (M1) para que el planificador lo use.
-- Con una página fuera de rango no vuelven filas (y por lo tanto tampoco el total).

create or replace function public.buscar_clientes(
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
      greatest(coalesce(p_pagina, 1), 1) as pagina
  )
  select c.id, c.numero, c.nombre, c.documento, c.correo, c.telefono, c.celular, c.localidad,
         c.tipo, c.es_consumidor_final, c.archivado_en,
         count(*) over () as total
    from public.clientes c, parametros p
   where c.organizacion_id = (select private.organizacion_id())
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     and (p.patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || c.numero::text) like p.patron)
   order by lower(c.nombre), c.id
   limit (select tamano from parametros)
  offset (select (pagina - 1) * tamano from parametros)
$$;

revoke execute on function public.buscar_clientes(text, text, boolean, integer, integer) from public, anon;
grant execute on function public.buscar_clientes(text, text, boolean, integer, integer) to authenticated;
