-- MSF-611: filtro «Stock bajo» del listado de productos.
-- `public.v_productos_listado` suma `estado_stock` AL FINAL (create or replace conserva las columnas vigentes) con la misma
-- regla que `public.stock_estados` (sobre el disponible: cantidad - reservado). El listado filtra `estado_stock = 'stock_bajo'`
-- en el servidor y `exportar_productos` acepta `p_filtros.stock_bajo` para que «Lo filtrado (N)» baje lo mismo que se ve.
-- Quien no ve el stock (RLS de `dominio.existencias`: sección `stock`) ve `estado_stock` nulo; la pantalla ofrece el filtro solo con acceso a Stock.
-- Esquemas (Principio VII): ninguna tabla nueva; vista de lectura en `public`, security_invoker, sin costo, sin `anon`.
-- Migración aditiva. Reversión (migración posterior): `drop view public.v_productos_listado` (y `drop function public.nombre_norm(public.v_productos_listado)`
-- antes, volviendo a crearla después) seguido de la definición de 20270206100101_catalogo_compatible_filtro.sql con sus `revoke`/`grant`;
-- y volver a aplicar `exportar_productos` de 20270217200001_exportar_productos_cursor.sql.

create or replace view` conserva todas las columnas vigentes y suma `compatible_con` AL FINAL.
-- Sin costo, sin `anon`.
-- REVERSIÓN: `drop index dominio.productos_compatible_con_gin;` y `drop view public.v_productos_listado;`
-- seguido de la definición de 20261022121000_catalogo_listado_codigo_barras.sql (con sus `revoke`/`grant`).
-- Ningún dato se pierde: la columna sigue en `dominio.productos`.

create index if not exists productos_compatible_con_gin on dominio.productos using gin (compatible_con);

create or replace view public.v_productos_listado
with (security_invoker = true) as
select
  p.id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.activo,
  (select i.ruta
     from dominio.producto_imagenes i
    where i.producto_id = p.id and i.organizacion_id = p.organizacion_id
    order by i.posicion
    limit 1) as imagen_ruta,
  p.updated_at,
  coalesce(
    (select array_agg(pe.empresa_id order by pe.empresa_id)
       from dominio.producto_empresa pe
      where pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id),
    '{}'::uuid[]
  ) as empresa_ids,
  p.categoria_id,
  (select case when cp.id is null then c.nombre else cp.nombre || ' > ' || c.nombre end
     from dominio.categorias c
     left join dominio.categorias cp on cp.id = c.padre_id and cp.organizacion_id = c.organizacion_id
    where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ruta,
  (select array_remove(array[c.id, c.padre_id], null)
     from dominio.categorias c
    where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ids,
  -- F-CAT-17: misma regla que private.disponibilidad_producto(uuid), evaluada por lotes.
  coalesce(
    p.disponibilidad_manual,
    case when p.id in (select private.productos_con_stock()) then 'stock' else 'sin_stock' end
  ) as disponibilidad,
  -- F-CAT-14: búsqueda por escaneo (coincidencia exacta de EAN-13 en el servidor).
  p.codigo_barras,
  -- F-CAT-09: valores de «Compatible con» (filtro y etiquetas del listado).
  p.compatible_con,
  -- MSF-611: estado de stock (misma regla que public.stock_estados: sobre el disponible = cantidad - reservado).
  -- Nulo si el producto no tiene existencias o quien consulta no ve el stock (RLS de dominio.existencias).
  (select case
            when e.cantidad - e.reservado <= 0 then 'sin_stock'
            when e.cantidad - e.reservado <= e.minimo then 'stock_bajo'
            else 'disponible'
          end
     from dominio.existencias e
    where e.producto_id = p.id and e.organizacion_id = p.organizacion_id) as estado_stock
from dominio.productos p;

comment on view public.v_productos_listado is
  'F-CAT-01/07/08/17/14/09: listado de productos (id, nombre, SKU, estado, imagen principal, empresa_ids, categoría, disponibilidad, código de barras, compatible_con, estado_stock). security_invoker: rige la RLS de las tablas base. Sin costo. Las historias siguientes agregan columnas al final.';

revoke all on public.v_productos_listado from public, anon;
grant select on public.v_productos_listado to authenticated;

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
  v_stock_bajo boolean;
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
  v_stock_bajo := coalesce((v_filtros ->> 'stock_bajo')::boolean, false);
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
         and (not v_stock_bajo or v.estado_stock = 'stock_bajo')
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
  'F-CAT-11/MSF-611: filas del listado de productos para exportar a CSV, por páginas de cursor de id sin recalcular el conjunto. El total real solo se calcula en la primera página o con p_con_total. Tope de 50.000 productos por archivo (p_entregadas lleva la cuenta; recortado avisa). Solo Administrador; costo/proveedor exigen Rentabilidad (42501); la primera página registra la actividad producto.exportado sin precios ni costos. El filtro stock_bajo deja los productos en estado de stock bajo (como el listado).';
