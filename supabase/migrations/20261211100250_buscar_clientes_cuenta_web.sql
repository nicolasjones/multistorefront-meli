-- F-CLI-05 (MSF-422, épica MSF-237, spec 20261024-051500-cuenta-web-del-cliente): el listado de Clientes muestra
-- la columna «Cuenta web» y filtra «Con cuenta web». FR-014.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla. `public.buscar_clientes` sigue en
-- `public` y ahora lee además `public.cuentas_cliente` (RLS por organización y sección Clientes, security invoker).
--
-- Aditiva en el contrato: se agrega `p_con_cuenta_web boolean default false` al final de la firma y la columna
-- `cuentas_web` (jsonb: [{empresa_id, estado}]) al resultado. Con el parámetro omitido el comportamiento es el previo.
-- También se recrea `exportar_clientes` con `p_con_cuenta_web` al final para que la exportación respete el filtro.
-- Como cambian la firma y el tipo de retorno se recrea la función y se reponen los grants (mismo patrón que
-- 20261021160600_clientes_filtro_por_tienda.sql).
--
-- «Con cuenta web» deja los clientes con cuenta ACTIVA (habilitados en la tienda): en la tienda elegida si
-- `p_empresa_id` viene, y en cualquiera de sus tiendas en la vista combinada.
--
-- Reversión (en una migración posterior, no en este PR):
--   drop function public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean);
--   y recrear `buscar_clientes` como en 20261021160600_clientes_filtro_por_tienda.sql (sin `cuentas_web`).
--   drop function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean);
--   y recrear `exportar_clientes` como en 20261021160600_clientes_filtro_por_tienda.sql (sin el parámetro).

drop function if exists public.buscar_clientes(text, text, boolean, integer, integer, uuid);
create function public.buscar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null,
  p_con_cuenta_web boolean default false
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
  total bigint,
  cuentas_web jsonb
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
         count(*) over () as total,
         -- Cuentas web guardadas (F-CLI-05, FR-014): hereda la RLS de cuentas_cliente.
         coalesce(
           (
             select jsonb_agg(jsonb_build_object('empresa_id', cc.empresa_id, 'estado', cc.estado) order by cc.created_at)
               from public.cuentas_cliente cc
              where cc.cliente_id = c.id
                -- Solo tiendas donde el cliente sigue habilitado: «No habilitado» prevalece (FR-002), como en la ficha.
                and exists (
                  select 1 from public.clientes_empresas ce
                   where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)
           ),
           '[]'::jsonb
         ) as cuentas_web
    from public.clientes c, parametros p
   where c.organizacion_id = (select private.organizacion_id())
     and (p_tipo is null or c.tipo = p_tipo)
     and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
     -- Filtro por tienda (F-CLI-11): solo los clientes habilitados en la elegida.
     and (p_empresa_id is null or exists (
           select 1 from public.clientes_empresas ce
            where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id))
     -- «Con cuenta web» (FR-014): cuenta activa y cliente habilitado en esa tienda.
     and (not coalesce(p_con_cuenta_web, false) or exists (
           select 1 from public.cuentas_cliente cc
            where cc.cliente_id = c.id and cc.estado = 'activa'
              and (p_empresa_id is null or cc.empresa_id = p_empresa_id)
              and exists (
                select 1 from public.clientes_empresas ce
                 where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)))
     and (p.patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || coalesce(c.expreso_preferido, '') || ' ' || c.numero::text) like p.patron)
   order by lower(c.nombre), c.id
   limit (select tamano from parametros)
  offset (select (pagina - 1) * tamano from parametros)
$$;

comment on function public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean) is
  'Listado de clientes paginado y buscable (F-CLI-02) con las tiendas de cada uno (F-CLI-05), filtro por tienda (F-CLI-11) y cuenta web: `cuentas_web` [{empresa_id, estado}] y filtro `p_con_cuenta_web` (cuenta activa y cliente habilitado). RLS por organización y sección. Contrato en docs/clientes.md.';

revoke execute on function public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean) from public, anon;
grant execute on function public.buscar_clientes(text, text, boolean, integer, integer, uuid, boolean) to authenticated;

-- ============================================================================
-- exportar_clientes: suma p_con_cuenta_web para que el archivo coincida con el
-- filtro «Con cuenta web» de la pantalla (el diálogo promete «los filtros
-- actuales»). Aditiva: el parámetro va al final y por omisión conserva el
-- comportamiento anterior. Mismo criterio que buscar_clientes (cuenta activa y
-- cliente habilitado en la tienda elegida o en cualquiera en la vista combinada).
-- ============================================================================

drop function if exists public.exportar_clientes(text, text, boolean, uuid, integer, uuid);
create function public.exportar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_despues_de uuid default null,
  p_limite integer default 1000,
  p_empresa_id uuid default null,
  p_con_cuenta_web boolean default false
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

  v_patron := case when btrim(coalesce(p_texto, '')) = '' then null
    else '%' || replace(replace(replace(lower(btrim(p_texto)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if p_despues_de is null then
    select count(*) into v_total
      from public.clientes c
     where c.organizacion_id = v_org
       and (p_tipo is null or c.tipo = p_tipo)
       and (case when coalesce(p_archivados, false) then c.archivado_en is not null else c.archivado_en is null end)
       and (p_empresa_id is null or exists (
             select 1 from public.clientes_empresas ce
              where ce.cliente_id = c.id and ce.empresa_id = p_empresa_id and ce.organizacion_id = v_org))
       and (not coalesce(p_con_cuenta_web, false) or exists (
             select 1 from public.cuentas_cliente cc
              where cc.cliente_id = c.id and cc.estado = 'activa' and cc.organizacion_id = v_org
                and cc.empresa_id in (select private.empresas_accesibles())
                and (p_empresa_id is null or cc.empresa_id = p_empresa_id)
                and exists (
                  select 1 from public.clientes_empresas ce
                   where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)))
       and (v_patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
            || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
            || c.numero::text) like v_patron);

    if v_total > 50000 then
      raise exception 'La exportación supera las 50000 filas: afiná la búsqueda' using errcode = '54000';
    end if;
  else
    v_total := 0;
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
     and (not coalesce(p_con_cuenta_web, false) or exists (
           select 1 from public.cuentas_cliente cc
            where cc.cliente_id = c.id and cc.estado = 'activa' and cc.organizacion_id = v_org
              and cc.empresa_id in (select private.empresas_accesibles())
              and (p_empresa_id is null or cc.empresa_id = p_empresa_id)
              and exists (
                select 1 from public.clientes_empresas ce
                 where ce.cliente_id = c.id and ce.empresa_id = cc.empresa_id)))
     and (v_patron is null or lower(coalesce(c.nombre, '') || ' ' || coalesce(c.documento, '') || ' ' || coalesce(c.correo, '') || ' '
          || coalesce(c.telefono, '') || ' ' || coalesce(c.celular, '') || ' ' || coalesce(c.localidad, '') || ' '
          || c.numero::text) like v_patron)
     and (p_despues_de is null or (lower(c.nombre), c.id) > (v_nombre_cursor, p_despues_de))
   order by lower(c.nombre), c.id
   limit v_limite;
end;
$$;

comment on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) is
  'Exportación de clientes por lotes (keyset lower(nombre), id). Exige private.puede_accion(clientes, exportar); tope de lote 1000 y total 50000. Filtro por tienda (F-CLI-11) y «Con cuenta web» (F-CLI-05, FR-014). F-CLI-04.';

revoke execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) from public, anon;
grant execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) to authenticated;
