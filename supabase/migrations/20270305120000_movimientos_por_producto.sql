-- F-INI-06 (MSF-822, épica MSF-824, spec 20270305-100000-inicio-tablero-completo, FR-012..FR-016):
-- listado «Movimientos por producto» de Inicio: una fila por producto activo con stock inicial, entradas,
-- salidas, ajustes, stock actual, mínimo, ventas, último movimiento y estado; búsqueda, categoría, vistas
-- rápidas y orden en SERVIDOR (el listado llega por páginas con carga infinita, no se puede ordenar en el
-- navegador); `total` en cada fila para el contador.
--
-- Esquema (Principio VII): función en `public`; SIN tablas nuevas (lee `dominio.productos`, `categorias`,
-- `existencias`, `existencias_deposito`, `movimientos_stock` y las líneas de comprobantes).
--
-- Criterios:
--  * Entradas, salidas y ajustes de la LISTA cuentan TODOS los movimientos del período (traslados,
--    devoluciones y anulaciones incluidos), para que cuadre: stock_inicial + entradas − salidas + ajustes =
--    stock_actual cuando el período llega hasta hoy. `stock_inicial` = stock actual − Σ diferencias desde el
--    inicio del período. Salidas se informan en positivo; ajustes con signo.
--  * Con p_deposito todo se mide sobre ese depósito (stock, movimientos y ventas).
--  * ventas = unidades netas de devoluciones (la nota de crédito resta) de las tiendas con `ventas` ≥
--    lectura (y p_empresa si viene); null si el usuario no tiene `ventas` en ninguna.
--  * estado: «alerta» (disponible ≤ mínimo, incluye sin stock) > «quieto» (sin movimientos en el período) >
--    «normal». Vistas: todos | alerta | quieto.
--  * NO expone costo ni margen (no están entre las 12 columnas).
-- Seguridad: `SECURITY DEFINER`; exige la sección `stock` ≥ lectura (42501); organización de la sesión;
-- orden y dirección por LISTA BLANCA (nunca texto libre en el SQL dinámico); `anon` no ejecuta.
--
-- Migración aditiva. Reversión: drop function public.movimientos_por_producto(date,date,uuid,uuid,text,uuid,text,text,text,integer,integer);

create or replace function public.movimientos_por_producto(
  p_desde date,
  p_hasta date,
  p_empresa uuid default null,
  p_deposito uuid default null,
  p_busqueda text default null,
  p_categoria uuid default null,
  p_vista text default 'todos',
  p_orden text default 'nombre',
  p_direccion text default 'asc',
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  producto_id uuid,
  nombre text,
  sku text,
  categoria text,
  stock_inicial bigint,
  entradas bigint,
  salidas bigint,
  ajustes bigint,
  stock_actual bigint,
  minimo integer,
  ventas bigint,
  ultimo_movimiento date,
  estado text,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[];
  v_con_ventas boolean;
  v_orden text;
  v_dir text;
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 100);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_busqueda text := nullif(btrim(coalesce(p_busqueda, '')), '');
begin
  if v_org is null or (select private.nivel_seccion('stock')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los movimientos de stock' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  if (p_hasta - p_desde) + 1 > 366 then
    raise exception 'El período no puede superar 366 días' using errcode = '22023';
  end if;
  if coalesce(p_vista, 'todos') not in ('todos', 'alerta', 'quieto') then
    raise exception 'La vista no es válida' using errcode = '22023';
  end if;
  if p_deposito is not null and not exists (
    select 1 from dominio.depositos d where d.id = p_deposito and d.organizacion_id = v_org
  ) then
    return;
  end if;

  -- Lista blanca de orden: nombre de columna de la consulta final (nunca texto del cliente).
  v_orden := case coalesce(p_orden, 'nombre')
    when 'nombre' then 'lower(r.nombre)'
    when 'sku' then 'lower(r.sku)'
    when 'categoria' then 'lower(r.categoria)'
    when 'stock_inicial' then 'r.stock_inicial'
    when 'entradas' then 'r.entradas'
    when 'salidas' then 'r.salidas'
    when 'ajustes' then 'r.ajustes'
    when 'stock_actual' then 'r.stock_actual'
    when 'minimo' then 'r.minimo'
    when 'ventas' then 'r.ventas'
    when 'ultimo_movimiento' then 'r.ultimo_movimiento'
    when 'estado' then 'r.estado'
    else null
  end;
  if v_orden is null then
    raise exception 'El orden no es válido' using errcode = '22023';
  end if;
  v_dir := case lower(coalesce(p_direccion, 'asc')) when 'asc' then 'asc' when 'desc' then 'desc' else null end;
  if v_dir is null then
    raise exception 'La dirección no es válida' using errcode = '22023';
  end if;

  select coalesce(array_agg(e.id), '{}'::uuid[])
    into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and e.id = any (select private.empresas_accesibles())
     and (p_empresa is null or e.id = p_empresa)
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');
  v_con_ventas := cardinality(v_empresas) > 0;

  return query execute format($q$
    with base as (
      select p.id as producto_id, p.nombre, p.sku, coalesce(c.nombre, 'Sin categoría') as categoria,
             case when $4::uuid is null then ex.cantidad::bigint
                  else coalesce(ed.cantidad, 0)::bigint end as stock_actual,
             case when $4::uuid is null then ex.reservado::bigint
                  else coalesce(ed.reservado, 0)::bigint end as reservado,
             ex.minimo
        from dominio.productos p
        join dominio.existencias ex on ex.producto_id = p.id and ex.organizacion_id = p.organizacion_id
        left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
        left join dominio.existencias_deposito ed
               on ed.producto_id = p.id and ed.organizacion_id = p.organizacion_id and ed.deposito_id = $4::uuid
       where p.organizacion_id = $1 and p.activo
         and ($6::uuid is null or p.categoria_id = $6::uuid)
         and ($5::text is null or p.nombre ilike '%%' || replace(replace(replace($5::text, '\', '\\'), '%%', '\%%'), '_', '\_') || '%%'
              or p.sku ilike '%%' || replace(replace(replace($5::text, '\', '\\'), '%%', '\%%'), '_', '\_') || '%%')
    ),
    mov as (
      select m.producto_id,
             coalesce(sum(m.cantidad) filter (where m.tipo = 'entrada' and m.fecha between $2 and $3), 0)::bigint as entradas,
             coalesce(sum(- m.diferencia) filter (where m.tipo = 'salida' and m.fecha between $2 and $3), 0)::bigint as salidas,
             coalesce(sum(m.diferencia) filter (where m.tipo = 'ajuste' and m.fecha between $2 and $3), 0)::bigint as ajustes,
             coalesce(sum(m.diferencia) filter (where m.fecha >= $2), 0)::bigint as desde_inicio,
             count(*) filter (where m.fecha between $2 and $3) as en_periodo,
             max(m.fecha) as ultimo
        from dominio.movimientos_stock m
       where m.organizacion_id = $1 and ($4::uuid is null or m.deposito_id = $4::uuid)
       group by m.producto_id
    ),
    vta as (
      select l.producto_id, sum(private.signo_comprobante(v.tipo) * l.cantidad)::bigint as ventas
        from dominio.comprobantes_venta v
        join dominio.comprobantes_venta_lineas l on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
       where $7::boolean and v.organizacion_id = $1 and v.empresa_id = any ($8::uuid[])
         and v.fecha between $2 and $3
         and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
         and ($4::uuid is null or l.deposito_id = $4::uuid)
       group by l.producto_id
    ),
    r as (
      select b.producto_id, b.nombre, b.sku, b.categoria,
             (b.stock_actual - coalesce(mo.desde_inicio, 0))::bigint as stock_inicial,
             coalesce(mo.entradas, 0) as entradas, coalesce(mo.salidas, 0) as salidas, coalesce(mo.ajustes, 0) as ajustes,
             b.stock_actual, b.minimo,
             case when $7::boolean then coalesce(vt.ventas, 0) end as ventas,
             mo.ultimo as ultimo_movimiento,
             case when b.stock_actual - b.reservado <= b.minimo then 'alerta'
                  when coalesce(mo.en_periodo, 0) = 0 then 'quieto'
                  else 'normal' end as estado,
             (coalesce(mo.en_periodo, 0) = 0) as sin_movimientos
        from base b
        left join mov mo on mo.producto_id = b.producto_id
        left join vta vt on vt.producto_id = b.producto_id
    ),
    f as (
      select r.* from r
       where ($9::text = 'todos' or ($9::text = 'alerta' and r.estado = 'alerta')
              or ($9::text = 'quieto' and r.sin_movimientos))
    )
    select r.producto_id, r.nombre, r.sku, r.categoria, r.stock_inicial, r.entradas, r.salidas, r.ajustes,
           r.stock_actual, r.minimo, r.ventas, r.ultimo_movimiento, r.estado,
           count(*) over () as total
      from f r
     order by %s %s nulls last, lower(r.nombre), r.producto_id
     limit $10 offset $11
  $q$, v_orden, v_dir)
  using v_org, p_desde, p_hasta, p_deposito, v_busqueda, p_categoria, v_con_ventas, v_empresas,
        coalesce(p_vista, 'todos'), v_tamano, (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.movimientos_por_producto(date, date, uuid, uuid, text, uuid, text, text, text, integer, integer) is
  'F-INI-06: movimientos por producto del período (stock inicial, entradas, salidas, ajustes, stock actual, mínimo, ventas, último movimiento, estado), con búsqueda, categoría, vista rápida y orden en servidor, y total por fila. Sin costos. 42501 sin la sección stock.';

revoke execute on function public.movimientos_por_producto(date, date, uuid, uuid, text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.movimientos_por_producto(date, date, uuid, uuid, text, uuid, text, text, text, integer, integer) to authenticated;
