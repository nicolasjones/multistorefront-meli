-- MSF-202 (revisión independiente, hallazgo 5): `exportar_productos` no recalcula todo el conjunto en cada página
-- y tiene un tope total, igual que `exportar_actividad` (20270214300001).
--
-- Qué corrige respecto de 20270205110210 (inmutable):
--   1. Rendimiento: antes cada página evaluaba TODO el filtro (`count(*) over ()` sobre el conjunto entero) aunque solo
--      devolviera una página. Ahora el filtro se evalúa inline (`not materialized`) y la página lee solo `id > p_desde`
--      con LIMIT por el índice de la clave primaria; el total se calcula solo cuando se pide (`p_con_total`) y siempre
--      en la primera página (`p_desde` nulo), porque el evento `producto.exportado` informa cuántos productos fueron.
--   2. Tope total: 50.000 productos por archivo (`p_entregadas` lleva la cuenta entre páginas). Al llegar al tope
--      `siguiente` es nulo y `recortado` avisa que el filtro tenía más productos (el cliente lo informa).
--
-- Contrato nuevo (reemplaza al de 4 parámetros, que se elimina):
--   p_filtros jsonb, p_columnas text[]   igual que antes
--   p_desde uuid                         cursor: el `siguiente` de la página anterior (nulo en la primera)
--   p_limite integer                     1..1000
--   p_entregadas integer                 productos ya entregados en la corrida (para aplicar el tope)
--   p_con_total boolean                  pide el total real del filtro (siempre se calcula en la primera página)
-- Devuelve { filas, siguiente, total (nulo si no se pidió), tope, recortado (nulo si no hay total) }.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla; función de lectura en `public` (la usa la app) que solo
-- escribe una fila de actividad por `private.registrar_actividad`. `security definer` con `search_path = ''`.
--
-- REVERSIÓN (migración posterior):
--   drop function public.exportar_productos(jsonb, text[], uuid, integer, integer, boolean);
--   y recrear la de 4 parámetros con el cuerpo de 20270205110210.

drop function if exists public.exportar_productos(jsonb, text[], uuid, integer);

create or replace function public.exportar_productos(
  p_filtros jsonb,
  p_columnas text[],
  p_desde uuid default null,
  p_limite integer default 500,
  p_entregadas integer default 0,
  p_con_total boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_tope constant integer := 50000;
  v_filtros jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_todos boolean;
  v_busqueda text;
  v_patron text;
  v_categoria uuid;
  v_empresa uuid;
  v_estado text;
  v_disponibilidad text;
  v_compatible text[];
  v_validas constant text[] := array['sku', 'nombre', 'categoria', 'precio', 'costo', 'stock', 'visible_en', 'estado', 'codigo_barras', 'proveedor'];
  v_filas jsonb;
  v_ultimo uuid;
  v_hay_mas boolean;
  v_total integer;
  v_n integer;
  v_lim integer;
  v_con_total boolean := coalesce(p_con_total, false) or p_desde is null;
  v_columnas text[];
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo el Administrador exporta productos' using errcode = '42501';
  end if;
  if jsonb_typeof(v_filtros) <> 'object' then
    raise exception 'Los filtros deben ser un objeto' using errcode = '22023';
  end if;
  if p_columnas is null or cardinality(p_columnas) = 0
     or exists (select 1 from unnest(p_columnas) c where c is null or c <> all (v_validas)) then
    raise exception 'Columna desconocida o lista de columnas vacía' using errcode = '22023';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 1000 then
    raise exception 'p_limite debe estar entre 1 y 1000' using errcode = '22023';
  end if;
  if p_entregadas is null or p_entregadas < 0 then
    raise exception 'p_entregadas no puede ser negativo' using errcode = '22023';
  end if;
  -- Costo y proveedor son datos de Rentabilidad: sin acceso se rechaza el pedido entero.
  if ('costo' = any (p_columnas) or 'proveedor' = any (p_columnas))
     and (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion') then
    raise exception 'Costo y proveedor requieren acceso a Rentabilidad' using errcode = '42501';
  end if;

  v_columnas := array(select c from unnest(v_validas) c where c = any (p_columnas));
  v_lim := greatest(least(p_limite, v_tope - p_entregadas), 0);
  v_todos := coalesce((v_filtros ->> 'todos')::boolean, false);
  v_busqueda := nullif(btrim(left(coalesce(v_filtros ->> 'busqueda', ''), 80)), '');
  v_patron := case when v_busqueda is null then null
    else '%' || replace(replace(replace(lower(v_busqueda), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_categoria := nullif(v_filtros ->> 'categoria_id', '')::uuid;
  v_empresa := nullif(v_filtros ->> 'empresa_id', '')::uuid;
  v_estado := coalesce(nullif(v_filtros ->> 'estado', ''), 'todos');
  v_disponibilidad := nullif(v_filtros ->> 'disponibilidad', '');
  v_compatible := coalesce(
    array(select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_filtros -> 'compatible', '[]'::jsonb)) x where btrim(x) <> ''),
    '{}'
  );
  if v_estado not in ('todos', 'inactivos') then
    raise exception 'Estado de filtro desconocido' using errcode = '22023';
  end if;

  with filtrados as not materialized (
    select v.id, v.sku, v.nombre, v.categoria_ruta, v.disponibilidad, v.activo, v.codigo_barras, v.empresa_ids,
           p.precio_lista, p.moneda, p.proveedor_id
      from public.v_productos_listado v
      join dominio.productos p on p.id = v.id and p.organizacion_id = v.organizacion_id
     where v.organizacion_id = v_org
       and (v_todos or (
         (v_estado = 'todos' or not v.activo)
         and (v_empresa is null or v_empresa = any (v.empresa_ids))
         and (v_categoria is null or v_categoria = any (v.categoria_ids))
         and (v_disponibilidad is null or v.disponibilidad = v_disponibilidad)
         and (cardinality(v_compatible) = 0
              or exists (select 1 from unnest(p.compatible_con) c where lower(c) = any (v_compatible)))
         and (v_busqueda is null
              or case when v_busqueda ~ '^[0-9]{13}$' then v.codigo_barras = v_busqueda
                 else lower(v.nombre) like v_patron escape '\' or lower(coalesce(v.sku, '')) like v_patron escape '\' end)
       ))
  ),
  -- Una fila de más que el límite: si llega, hay otra página. Solo lee desde el cursor.
  pagina as (
    select f.*, row_number() over (order by f.id) as n
      from filtrados f
     where p_desde is null or f.id > p_desde
     order by f.id
     limit v_lim + 1
  ),
  actual as (select * from pagina where n <= v_lim)
  select
    coalesce(jsonb_agg(
      jsonb_build_object('id', g.id) || (
        select coalesce(jsonb_object_agg(k.clave, k.valor), '{}'::jsonb)
          from (
            select 'sku' as clave, to_jsonb(g.sku) as valor
            union all select 'nombre', to_jsonb(g.nombre)
            union all select 'categoria', to_jsonb(g.categoria_ruta)
            union all select 'precio', jsonb_build_object('monto', g.precio_lista, 'moneda', g.moneda)
            union all select 'costo', jsonb_build_object('monto', (select pc.costo from dominio.producto_costos pc
                                       where pc.producto_id = g.id and pc.organizacion_id = v_org))
            union all select 'stock', to_jsonb(g.disponibilidad)
            union all select 'visible_en', coalesce(
                       (select jsonb_agg(e.nombre order by e.nombre) from dominio.empresas e
                         where e.id = any (g.empresa_ids) and e.organizacion_id = v_org), '[]'::jsonb)
            union all select 'estado', to_jsonb(case when g.activo then 'Activo' else 'Inactivo' end)
            union all select 'codigo_barras', to_jsonb(g.codigo_barras)
            union all select 'proveedor', to_jsonb((select pr.razon_social from dominio.proveedores pr
                                       where pr.id = g.proveedor_id and pr.organizacion_id = v_org))
          ) k
         where k.clave = any (v_columnas)
      ) order by g.id), '[]'::jsonb),
    (select (array_agg(a.id order by a.id desc))[1] from actual a),
    (select count(*) > v_lim from pagina),
    (select count(*)::integer from actual),
    case when v_con_total then (select count(*)::integer from filtrados) end
  into v_filas, v_ultimo, v_hay_mas, v_n, v_total
  from actual g;

  -- La actividad se registra una vez por exportación (primera página); informa lo que se exportará (con tope).
  if p_desde is null then
    perform private.registrar_actividad(
      'producto.exportado',
      format('Exportó %s %s a CSV (columnas: %s)', least(v_total, v_tope),
             case when least(v_total, v_tope) = 1 then 'producto' else 'productos' end, array_to_string(v_columnas, ', '))
    );
  end if;

  return jsonb_build_object(
    'filas', v_filas,
    'siguiente', case when v_hay_mas and p_entregadas + v_n < v_tope then v_ultimo else null end,
    'total', v_total,
    'tope', v_tope,
    'recortado', case when v_con_total then v_total > v_tope else null end
  );
end;
$$;

revoke execute on function public.exportar_productos(jsonb, text[], uuid, integer, integer, boolean) from public, anon;
grant execute on function public.exportar_productos(jsonb, text[], uuid, integer, integer, boolean) to authenticated;

comment on function public.exportar_productos(jsonb, text[], uuid, integer, integer, boolean) is
  'F-CAT-11: filas del listado de productos para exportar a CSV, por páginas de cursor de id sin recalcular el conjunto. El total real solo se calcula en la primera página o con p_con_total. Tope de 50.000 productos por archivo (p_entregadas lleva la cuenta; recortado avisa). Solo Administrador; costo/proveedor exigen Rentabilidad (42501); la primera página registra la actividad producto.exportado sin precios ni costos.';
