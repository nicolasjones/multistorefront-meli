-- F-CLI-11 (MSF-180 fidelidad, spec 20261018-070000-clientes-empresas):
-- filtro de Clientes por tienda/empresa (`{{tFilt}}` del prototipo). El prototipo
-- filtra la pantalla completa: el listado (`rows`) y el ranking (`RKf`) se acotan
-- a los clientes habilitados en la tienda elegida.
--
-- Aditiva: se agrega `p_empresa_id uuid default null` al final de la firma de
-- `buscar_clientes`, `exportar_clientes` y `ranking_clientes`. Con `null` (u
-- omitido) el comportamiento es exactamente el previo: sin filtro por tienda.
-- Como el cambio agrega un parámetro, se recrean las funciones y se reponen los
-- grants (mismo patrón que 20261017120001 y 20261018100100).
--
-- Reversión (en una migración posterior, no en este PR):
--   drop function public.buscar_clientes(text, text, boolean, integer, integer, uuid);
--   drop function public.exportar_clientes(text, text, boolean, uuid, integer, uuid);
--   drop function public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid);
--   y recrear las tres con su firma previa: `buscar_clientes` como en
--   20261018090000_clientes_empresas.sql, `exportar_clientes` como en
--   20261017120001_clientes_expreso_preferido.sql y `ranking_clientes` como en
--   20261018100100_clientes_ranking.sql.

-- ============================================================================
-- buscar_clientes: suma p_empresa_id (filtra por tienda del cliente).
-- `security invoker`: la RLS de `clientes_empresas` (organización + sección
-- Clientes) acota el `exists` igual que acota la columna `empresas`.
-- ============================================================================

drop function if exists public.buscar_clientes(text, text, boolean, integer, integer);
create function public.buscar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null
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
  empresas jsonb,
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
         -- Tiendas del cliente (F-CLI-05): nombre + id, ordenadas por nombre.
         -- Hereda la RLS de clientes_empresas (security invoker).
         coalesce(
           (
             select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre) order by e.nombre)
               from public.clientes_empresas ce
               join dominio.empresas e on e.id = ce.empresa_id
              where ce.cliente_id = c.id
           ),
           '[]'::jsonb
         ) as empresas,
         count(*) over () as total
    from public.clientes c, parametros p
   where c.organizacion_id = (select private.organizacion_id())
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     -- Filtro por tienda (F-CLI-11): solo los clientes habilitados en la elegida.
     and (p_empresa_id is null or exists (
           select 1 from public.clientes_empresas ce
            where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id))
     and (p.patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || coalesce(c.expreso_preferido, '') || ' ' || c.numero::text) like p.patron)
   order by lower(c.nombre), c.id
   limit (select tamano from parametros)
  offset (select (pagina - 1) * tamano from parametros)
$$;

comment on function public.buscar_clientes(text, text, boolean, integer, integer, uuid) is
  'Listado de clientes paginado y buscable (F-CLI-02) con las tiendas de cada uno (F-CLI-05) y filtro por tienda (F-CLI-11). `p_empresa_id` null = sin filtro. RLS por organización y sección. Contrato en docs/clientes.md.';

revoke execute on function public.buscar_clientes(text, text, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.buscar_clientes(text, text, boolean, integer, integer, uuid) to authenticated;

-- ============================================================================
-- exportar_clientes: suma p_empresa_id para que el archivo coincida con los
-- filtros de la pantalla (el diálogo promete «los filtros actuales»).
-- ============================================================================

drop function if exists public.exportar_clientes(text, text, boolean, uuid, integer);
create function public.exportar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_despues_de uuid default null,
  p_limite integer default 1000,
  p_empresa_id uuid default null
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
       and (p_empresa_id is null or exists (
             select 1 from public.clientes_empresas ce
              where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
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
     and (p_empresa_id is null or exists (
           select 1 from public.clientes_empresas ce
            where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
     and (v_patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || c.numero::text) like v_patron)
     and (p_despues_de is null or (lower(c.nombre), c.id) > (v_nombre_cursor, p_despues_de))
   order by lower(c.nombre), c.id
   limit v_limite;
end;
$$;

comment on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid) is
  'Exportación de clientes por lotes (keyset lower(nombre), id). Exige private.puede_accion(clientes, exportar); tope de lote 1000 y total 50000 (el total se calcula solo en el primer lote; cursor inexistente => 40001). Filtro por tienda opcional (F-CLI-11). F-CLI-04.';

revoke execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid) from public, anon;
grant execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid) to authenticated;

-- ============================================================================
-- ranking_clientes: suma p_empresa_id. El prototipo filtra el ranking por la
-- misma tienda elegida, así que el filtro es de pantalla (listado + ranking).
-- `security definer`: el `exists` se acota por `c` (ya de la organización) y
-- explícitamente por `ce.organizacion_id = v_org`.
-- ============================================================================

drop function if exists public.ranking_clientes(date, date, text, boolean, boolean, integer, integer);
create function public.ranking_clientes(
  p_desde date,
  p_hasta date,
  p_tipo text default null,
  p_incluir_consumidor_final boolean default false,
  p_con_iva boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null
)
returns table (
  posicion bigint,
  cliente_id uuid,
  numero integer,
  nombre text,
  tipo text,
  comprobantes bigint,
  facturado numeric,
  participacion numeric,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.organizacion_id();
begin
  if v_org is null or private.nivel_seccion('clientes') not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver el ranking de clientes.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Indicá las fechas Desde y Hasta.' using errcode = '22023';
  end if;
  if p_desde > p_hasta then
    raise exception 'Hasta no puede ser anterior a Desde.' using errcode = '22023';
  end if;
  if p_hasta > (p_desde + interval '5 years')::date then
    raise exception 'El rango máximo es de 5 años.' using errcode = '22023';
  end if;
  if p_tipo is not null and p_tipo not in ('minorista', 'mayorista') then
    raise exception 'Tipo de cliente inválido.' using errcode = '22023';
  end if;
  if p_pagina is null or p_pagina < 1 or p_pagina > 1000000 then
    raise exception 'La página debe estar entre 1 y 1.000.000.' using errcode = '22023';
  end if;
  if p_tamano is null or p_tamano < 1 or p_tamano > 1000 then
    raise exception 'El tamaño de página debe estar entre 1 y 1000.' using errcode = '22023';
  end if;

  return query
  with agregado as (
    select c.id as cid, c.numero as cnumero, c.nombre as cnombre, c.tipo as ctipo,
           count(*) as ncomp,
           sum(case when p_con_iva then v.total_con_iva else v.total_sin_iva end) as total
      from dominio.comprobantes_venta v
      join public.clientes c
        on c.id = v.cliente_id and c.organizacion_id = v.organizacion_id
     where v.organizacion_id = v_org
       and v.fecha between p_desde and p_hasta
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and (p_tipo is null or c.tipo = p_tipo)
       and (coalesce(p_incluir_consumidor_final, false) or not c.es_consumidor_final)
       -- Filtro por tienda (F-CLI-11): solo los clientes habilitados en la elegida.
       and (p_empresa_id is null or exists (
             select 1 from public.clientes_empresas ce
              where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
     group by c.id, c.numero, c.nombre, c.tipo
  ), calculado as (
    select a.*,
           sum(a.total) over () as gran_total,
           count(*) over () as filas,
           row_number() over (order by a.total desc, lower(a.cnombre), a.cnumero) as pos
      from agregado a
  )
  select k.pos, k.cid, k.cnumero, k.cnombre, k.ctipo, k.ncomp, k.total,
         -- Porcentaje (0–100) sin redondear: la pantalla lo muestra con una decimal y
         -- así la suma de todas las filas del ranking es 100 (FR-006).
         case when k.gran_total = 0 then 0::numeric
              else k.total * 100 / k.gran_total end,
         k.filas
    from calculado k
   order by k.pos
   limit p_tamano
  offset (p_pagina - 1) * p_tamano;
end;
$$;

comment on function public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid) is
  'Ranking de clientes por facturación (F-CLI-08) con filtro por tienda opcional (F-CLI-11). security definer: exige sección Clientes en lectura/edición y acota a private.organizacion_id(). Contrato en docs/clientes.md.';

revoke execute on function public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.ranking_clientes(date, date, text, boolean, boolean, integer, integer, uuid) to authenticated;
