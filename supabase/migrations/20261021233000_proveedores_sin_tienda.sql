-- Proveedores: el filtro por tienda incluye a los que no tienen «Compra para».
--
-- Hasta ahora, `listar_proveedores(p_empresa_id)` dejaba SOLO los proveedores con una fila
-- en `dominio.proveedores_empresas` para esa tienda. Un proveedor sin «Compra para» (dato
-- informativo, opcional) desaparecía al filtrar por la empresa activa, incluso recién creado.
--
-- Decisión: los proveedores SIN tiendas asignadas son transversales y se muestran en el
-- filtro de CUALQUIER tienda de la organización ("todavía no definimos para qué tienda
-- compramos"). Los que SÍ tienen tiendas siguen apareciendo solo en las suyas. Un
-- `p_empresa_id` de otra organización no habilita nada: sigue devolviendo 0 filas.
--
-- Migración aditiva: `create or replace` de la misma firma (sin cambios de tipo ni grants).
-- Camino de reversión: volver a crear la función con el filtro anterior
-- (`and (p_empresa_id is null or exists (... pf.empresa_id = p_empresa_id))`).

create or replace function public.listar_proveedores(
  p_busqueda text default null,
  p_estado text default 'activos',
  p_pagina integer default 1,
  p_tamano integer default 25,
  p_empresa_id uuid default null
)
returns table (
  id uuid,
  razon_social text,
  cuit text,
  correo text,
  telefono text,
  activo boolean,
  empresas jsonb,
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
         coalesce(
           (
             select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre) order by e.nombre)
               from dominio.proveedores_empresas pe
               join dominio.empresas e on e.id = pe.empresa_id
              where pe.proveedor_id = p.id
           ),
           '[]'::jsonb
         ) as empresas,
         count(*) over () as total_filas
    from dominio.proveedores p
   where p.organizacion_id = (select private.organizacion_id())
     and (v_estado = 'todos' or p.activo = (v_estado = 'activos'))
     and (v_patron is null
          or translate(lower(p.razon_social), 'áéíóúü', 'aeiouu') like v_patron
          or (v_patron_cuit is not null and p.cuit like v_patron_cuit))
     and (
       p_empresa_id is null
       or (
         -- La tienda pedida tiene que ser de la organización: un id ajeno sigue dando 0 filas.
         exists (
           select 1 from dominio.empresas e
            where e.id = p_empresa_id
              and e.organizacion_id = (select private.organizacion_id())
         )
         and (
           -- Sin «Compra para»: transversal a todas las tiendas de la organización.
           not exists (
             select 1 from dominio.proveedores_empresas pe
              where pe.proveedor_id = p.id
           )
           -- Con tiendas: solo aparece en las que tiene asignadas.
           or exists (
             select 1 from dominio.proveedores_empresas pf
              where pf.proveedor_id = p.id and pf.empresa_id = p_empresa_id
           )
         )
       )
     )
   order by lower(p.razon_social), p.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_proveedores(text, text, integer, integer, uuid) is
  'Listado paginado de proveedores de la organización (F-PRV-02) con sus tiendas «Compra para» y filtro opcional por tienda (MSF-524). Un proveedor sin tiendas asignadas se muestra en el filtro de cualquier tienda de la organización. Rige la RLS de dominio.proveedores.';

revoke execute on function public.listar_proveedores(text, text, integer, integer, uuid) from public, anon;
grant execute on function public.listar_proveedores(text, text, integer, integer, uuid) to authenticated;
