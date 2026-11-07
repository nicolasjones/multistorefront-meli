-- F-CAT-11 (MSF-382, épica MSF-202, spec 20270125-100000-catalogo-compatibilidad-y-planillas): exportar el
-- listado de productos a CSV. FR-206, FR-208.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla. `public.exportar_productos` es una
-- función de SOLO LECTURA en `public` (la usa la app) sobre `public.v_productos_listado` y las tablas de
-- `dominio` (`productos`, `producto_costos`, `proveedores`); lo único que escribe es una fila de actividad en
-- `public.registro_actividad`, por `private.registrar_actividad`.
--
-- Seguridad: `security definer` (necesita registrar actividad, que `authenticated` no puede insertar). Por eso
-- NO delega en RLS: exige Administrador de la organización de la sesión (`private.es_administrador_de`), acota
-- TODA lectura a esa organización y rechaza con `42501` las columnas `costo` y `proveedor` si el usuario no tiene
-- acceso a Rentabilidad. `anon` y `public` no ejecutan.
--
-- Paginación estable por cursor de id (`p_desde`): orden fijo por `id`; la primera página (`p_desde` nulo)
-- registra la actividad `producto.exportado` (quién, cuántos productos, qué columnas; nunca precios ni costos).
--
-- Migración aditiva. REVERSIÓN (migración posterior):
--   drop function public.exportar_productos(jsonb, text[], uuid, integer);

create or replace function public.exportar_productos(
  p_filtros jsonb,
  p_columnas text[],
  p_desde uuid default null,
  p_limite integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
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
  -- Costo y proveedor son datos de Rentabilidad: sin acceso se rechaza el pedido entero.
  if ('costo' = any (p_columnas) or 'proveedor' = any (p_columnas))
     and (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion') then
    raise exception 'Costo y proveedor requieren acceso a Rentabilidad' using errcode = '42501';
  end if;

  v_columnas := array(select c from unnest(v_validas) c where c = any (p_columnas));
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

  with filtrados as (
    select v.id, v.sku, v.nombre, v.categoria_ruta, v.disponibilidad, v.activo, v.codigo_barras, v.empresa_ids,
           p.precio_lista, p.moneda, p.proveedor_id,
           count(*) over () as total
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
  -- Una fila de más que el límite: si llega, hay otra página.
  pagina as (
    select f.*, row_number() over (order by f.id) as n
      from filtrados f
     where p_desde is null or f.id > p_desde
     order by f.id
     limit p_limite + 1
  ),
  actual as (select * from pagina where n <= p_limite)
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
    (select max(a.id::text)::uuid from actual a),
    (select count(*) > p_limite from pagina),
    coalesce((select max(f.total) from filtrados f), 0)
  into v_filas, v_ultimo, v_hay_mas, v_total
  from actual g;

  if p_desde is null then
    perform private.registrar_actividad(
      'producto.exportado',
      format('Exportó %s %s a CSV (columnas: %s)', v_total, case when v_total = 1 then 'producto' else 'productos' end, array_to_string(v_columnas, ', '))
    );
  end if;

  return jsonb_build_object(
    'filas', v_filas,
    'siguiente', case when v_hay_mas then v_ultimo else null end,
    'total', v_total
  );
end;
$$;

revoke execute on function public.exportar_productos(jsonb, text[], uuid, integer) from public, anon;
grant execute on function public.exportar_productos(jsonb, text[], uuid, integer) to authenticated;

comment on function public.exportar_productos(jsonb, text[], uuid, integer) is
  'F-CAT-11: filas del listado de productos para exportar a CSV, por páginas de cursor de id. Solo Administrador; costo/proveedor exigen Rentabilidad (42501); la primera página registra la actividad producto.exportado sin precios ni costos.';
