-- F-PRV-02 (MSF-351, épica MSF-205): listado y búsqueda de proveedores en servidor.
-- Esquema (Principio VII): sin tablas nuevas; `public.listar_proveedores` es una RPC de
-- plataforma que consulta `dominio.proveedores` (entidad del dominio, F-PRV-01). Los dos
-- índices nuevos viven en `dominio`, junto a la tabla.
--
-- security invoker: el llamador hereda la RLS de `dominio.proveedores` (organización y
-- `nivel_seccion('proveedores')` en lectura/edición); sin permiso no vuelven filas.
-- Búsqueda: razón social parcial, sin mayúsculas ni tildes; CUIT con o sin guiones
-- (solo cuando el texto es numérico: «20-1234» busca por CUIT, «Uno 20» no mezcla).
-- La expresión de normalización es la misma del índice GIN para que el planificador lo use.
-- Con una página fuera de rango no vuelven filas (y por lo tanto tampoco el total).
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   drop function public.listar_proveedores(text, text, integer, integer);
--   drop index dominio.proveedores_razon_social_trgm_idx;
--   drop index dominio.proveedores_cuit_trgm_idx;

create extension if not exists pg_trgm with schema extensions;

do $$
declare
  v_esquema text;
begin
  select n.nspname into v_esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if v_esquema is null then
    raise exception 'Falta pg_trgm: no se puede crear el índice de búsqueda de proveedores (FR-010)';
  end if;
  if to_regclass('dominio.proveedores_razon_social_trgm_idx') is null then
    execute format(
      'create index proveedores_razon_social_trgm_idx on dominio.proveedores using gin '
      '((translate(lower(razon_social), ''áéíóúü'', ''aeiouu'')) %I.gin_trgm_ops)',
      v_esquema
    );
  end if;
  if to_regclass('dominio.proveedores_cuit_trgm_idx') is null then
    execute format(
      'create index proveedores_cuit_trgm_idx on dominio.proveedores using gin (cuit %I.gin_trgm_ops)',
      v_esquema
    );
  end if;
end;
$$;

create or replace function public.listar_proveedores(
  p_busqueda text default null,
  p_estado text default 'activos',
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  id uuid,
  razon_social text,
  cuit text,
  correo text,
  telefono text,
  activo boolean,
  total_filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_estado text := coalesce(p_estado, 'activos');
  v_patron text;
  v_patron_cuit text;
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_estado not in ('activos', 'inactivos', 'todos') then
    raise exception 'Estado no válido: usá activos, inactivos o todos' using errcode = '22023';
  end if;

  if v_texto <> '' then
    -- Escapa \ % _ para que el texto se busque literal.
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- Solo un texto numérico (con guiones, puntos o espacios) busca también por CUIT.
    if v_texto ~ '^[0-9][0-9\s.\-]*$' then
      v_patron_cuit := '%' || regexp_replace(v_texto, '[^0-9]', '', 'g') || '%';
    end if;
  end if;

  return query
  select p.id, p.razon_social, p.cuit, p.correo, p.telefono, p.activo,
         count(*) over () as total_filas
    from dominio.proveedores p
   where p.organizacion_id = (select private.organizacion_id())
     and (v_estado = 'todos' or p.activo = (v_estado = 'activos'))
     and (v_patron is null
          or translate(lower(p.razon_social), 'áéíóúü', 'aeiouu') like v_patron
          or (v_patron_cuit is not null and p.cuit like v_patron_cuit))
   order by lower(p.razon_social), p.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_proveedores(text, text, integer, integer) is
  'Listado paginado de proveedores de la organización (F-PRV-02). Rige la RLS de dominio.proveedores.';

revoke execute on function public.listar_proveedores(text, text, integer, integer) from public, anon;
grant execute on function public.listar_proveedores(text, text, integer, integer) to authenticated;
