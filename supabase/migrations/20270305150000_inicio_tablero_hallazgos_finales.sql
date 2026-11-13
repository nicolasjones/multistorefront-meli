-- MSF-824 · hallazgos de la revisión final de Código y Seguridad (informe del 2026-11-13). Migración aditiva:
-- sustituye las funciones con `create or replace` (mismas firmas, mismos grants) y agrega un índice.
--
--  * S-1 (mayor, rendimiento): el índice `movimientos_stock_org_fecha_dia_idx (organizacion_id, fecha)` hacía que
--    `max(fecha)` por producto recorriera todo el libro de movimientos (565 ms por producto sin movimientos con
--    1 M de filas, medido en un Postgres efímero). Se agrega `(organizacion_id, producto_id, fecha desc)` (0,05 ms) y
--    `movimientos_por_producto` calcula `ultimo_movimiento` DESPUÉS del limit (solo para las filas de la página),
--    salvo que se ordene por esa columna.
--  * S-2 (menor): `aplicar_cotizacion` toma primero el advisory lock de la organización (como el resto del módulo)
--    para evitar el deadlock 40P01 con quien confirme, descarte o cambie el alcance a la vez.
--  * S-4 (menor): `resumen_inicio_bloques` evalúa `rentabilidad` con el rol del usuario EN CADA tienda (no solo el de
--    la organización) para ingresos y margen; el superadmin con organización activa conserva el acceso.
--  * S-5 (informativa): fechas infinitas devuelven 22023 en las tres RPC (antes 22008).
--
-- Reversión: drop index dominio.movimientos_stock_org_producto_fecha_idx; y volver a las definiciones de
-- 20270305105000, 20270305110000, 20270305120000 y 20270305140000 (create or replace con su texto original).

create index if not exists movimientos_stock_org_producto_fecha_idx
  on dominio.movimientos_stock (organizacion_id, producto_id, fecha desc);

create or replace function public.resumen_inicio_periodo(
  p_desde date,
  p_hasta date,
  p_empresa uuid default null,
  p_deposito uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[];
  v_dias integer;
  v_ant_desde date;
  v_ant_hasta date;
  v_ventas jsonb := null;
  v_stock jsonb := null;
  v_serie jsonb := '[]'::jsonb;
  v_ve boolean;
  v_st boolean;
  v_stock_hoy bigint := 0;
begin
  if v_org is null then
    raise exception 'No hay organización activa' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta or not isfinite(p_desde) or not isfinite(p_hasta) then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  v_dias := (p_hasta - p_desde) + 1;
  if v_dias > 366 then
    raise exception 'El período no puede superar 366 días' using errcode = '22023';
  end if;
  v_ant_hasta := p_desde - 1;
  v_ant_desde := v_ant_hasta - (v_dias - 1);

  select coalesce(array_agg(e.id), '{}'::uuid[])
    into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and e.id = any (select private.empresas_accesibles())
     and (p_empresa is null or e.id = p_empresa)
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');
  v_ve := cardinality(v_empresas) > 0;
  v_st := (select private.nivel_seccion('stock')) in ('lectura', 'edicion');

  -- Un depósito que no es de la organización no se acepta (cero filas, sin error).
  if p_deposito is not null and not exists (
    select 1 from dominio.depositos d where d.id = p_deposito and d.organizacion_id = v_org
  ) then
    v_ve := false;
    v_st := false;
  end if;

  if v_ve then
    select jsonb_build_object(
      'monto', coalesce(sum(case when v.fecha between p_desde and p_hasta then x.monto end), 0),
      'comprobantes', coalesce(count(*) filter (where v.fecha between p_desde and p_hasta and v.tipo = 'factura'), 0),
      'unidades', coalesce(sum(case when v.fecha between p_desde and p_hasta then x.unidades end), 0),
      'devoluciones_monto', coalesce(sum(case when v.fecha between p_desde and p_hasta and v.tipo = 'nota_credito' then abs(x.monto) end), 0),
      'devoluciones_unidades', coalesce(sum(case when v.fecha between p_desde and p_hasta and v.tipo = 'nota_credito' then abs(x.unidades) end), 0),
      'anterior_monto', coalesce(sum(case when v.fecha between v_ant_desde and v_ant_hasta then x.monto end), 0),
      'anterior_comprobantes', coalesce(count(*) filter (where v.fecha between v_ant_desde and v_ant_hasta and v.tipo = 'factura'), 0)
    )
      into v_ventas
      from dominio.comprobantes_venta v
      cross join lateral (
        select
          case when p_deposito is null
            then private.signo_comprobante(v.tipo) * v.total_con_iva
            else coalesce((select sum(private.signo_comprobante(v.tipo) * (l.subtotal_sin_iva + l.iva))
                             from dominio.comprobantes_venta_lineas l
                            where l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
                              and l.deposito_id = p_deposito), 0)
          end as monto,
          coalesce((select sum(private.signo_comprobante(v.tipo) * l.cantidad)
                      from dominio.comprobantes_venta_lineas l
                     where l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
                       and (p_deposito is null or l.deposito_id = p_deposito)), 0) as unidades
      ) x
     where v.organizacion_id = v_org
       and v.empresa_id = any (v_empresas)
       and v.fecha between v_ant_desde and p_hasta
       and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
       and (p_deposito is null or exists (
         select 1 from dominio.comprobantes_venta_lineas l
          where l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id and l.deposito_id = p_deposito));

    v_ventas := v_ventas || jsonb_build_object(
      'ticket_promedio',
      case when (v_ventas ->> 'comprobantes')::numeric > 0
        then round((v_ventas ->> 'monto')::numeric / (v_ventas ->> 'comprobantes')::numeric, 2) end);
  end if;

  if v_st then
    if p_deposito is null then
      select jsonb_build_object(
        'unidades', coalesce(sum(e.cantidad), 0),
        'reservado', coalesce(sum(e.reservado), 0),
        'disponible', coalesce(sum(e.cantidad - e.reservado), 0),
        'sin_stock', count(*) filter (where e.cantidad - e.reservado <= 0),
        'stock_bajo', count(*) filter (where e.cantidad - e.reservado > 0 and e.cantidad - e.reservado <= e.minimo)
      ), coalesce(sum(e.cantidad), 0)
        into v_stock, v_stock_hoy
        from dominio.existencias e
        join dominio.productos p on p.id = e.producto_id and p.organizacion_id = e.organizacion_id
       where e.organizacion_id = v_org and p.activo;
    else
      select jsonb_build_object(
        'unidades', coalesce(sum(d.cantidad), 0),
        'reservado', coalesce(sum(d.reservado), 0),
        'disponible', coalesce(sum(d.cantidad - d.reservado), 0),
        'sin_stock', count(*) filter (where d.cantidad - d.reservado <= 0),
        'stock_bajo', count(*) filter (where d.cantidad - d.reservado > 0 and d.cantidad - d.reservado <= e.minimo)
      ), coalesce(sum(d.cantidad), 0)
        into v_stock, v_stock_hoy
        from dominio.existencias_deposito d
        join dominio.existencias e on e.producto_id = d.producto_id and e.organizacion_id = d.organizacion_id
        join dominio.productos p on p.id = d.producto_id and p.organizacion_id = d.organizacion_id
       where d.organizacion_id = v_org and d.deposito_id = p_deposito and p.activo;
    end if;

    v_stock := v_stock || (
      select jsonb_build_object(
        'ajustes', count(*) filter (where m.tipo = 'ajuste'),
        'entradas_unidades', coalesce(sum(m.cantidad) filter (
          where m.tipo = 'entrada' and m.traslado_id is null
            and lower(btrim(mo.nombre)) not in ('devolución de cliente', 'anulación de factura')), 0))
        from dominio.movimientos_stock m
        join dominio.motivos_movimiento mo on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
        join dominio.productos pa on pa.id = m.producto_id and pa.organizacion_id = m.organizacion_id and pa.activo
       where m.organizacion_id = v_org and m.fecha between p_desde and p_hasta
         and (p_deposito is null or m.deposito_id = p_deposito));
  end if;

  if v_ve or v_st then
    -- Una sola pasada sobre los movimientos de PRODUCTOS ACTIVOS (los mismos que suman el stock de hoy) desde el
    -- inicio del período, agrupados por día: el stock al cierre de un día es el de hoy menos lo movido DESPUÉS.
    -- Usa el índice (organizacion_id, fecha) de esta migración; el costo es de los días del rango, no de todo el
    -- historial por cada día.
    with mv as (
      select m.fecha, sum(m.diferencia) as dif
        from dominio.movimientos_stock m
        join dominio.productos p on p.id = m.producto_id and p.organizacion_id = m.organizacion_id
       where v_st and m.organizacion_id = v_org and m.fecha > p_desde and p.activo
         and (p_deposito is null or m.deposito_id = p_deposito)
       group by m.fecha
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'dia', d.dia,
             'unidades', case when v_ve then coalesce(u.unidades, 0) end,
             'stock', case when v_st then v_stock_hoy - coalesce((select sum(mv.dif) from mv where mv.fecha > d.dia), 0) end
           ) order by d.dia), '[]'::jsonb)
      into v_serie
      from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') as g(ts)
      cross join lateral (select g.ts::date as dia) d
      left join lateral (
        select sum(private.signo_comprobante(v.tipo) * l.cantidad) as unidades
          from dominio.comprobantes_venta v
          join dominio.comprobantes_venta_lineas l on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
         where v_ve and v.organizacion_id = v_org and v.fecha = d.dia
           and v.empresa_id = any (v_empresas)
           and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
           and (p_deposito is null or l.deposito_id = p_deposito)
      ) u on true;
  end if;

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'anterior_desde', v_ant_desde, 'anterior_hasta', v_ant_hasta,
    'ventas', v_ventas, 'stock', v_stock, 'serie', v_serie);
end;
$$;

create or replace function public.resumen_inicio_bloques(
  p_desde date,
  p_hasta date,
  p_empresa uuid default null,
  p_deposito uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[];
  v_rent boolean;
  v_super boolean;
  v_st boolean;
  v_tiendas jsonb := null;
  v_depositos jsonb := null;
  v_deposito_ok boolean := true;
begin
  if v_org is null then
    raise exception 'No hay organización activa' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta or not isfinite(p_desde) or not isfinite(p_hasta) then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  if (p_hasta - p_desde) + 1 > 366 then
    raise exception 'El período no puede superar 366 días' using errcode = '22023';
  end if;

  v_rent := (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion');
  v_super := (select private.is_superadmin());
  v_st := (select private.nivel_seccion('stock')) in ('lectura', 'edicion');
  if p_deposito is not null and not exists (
    select 1 from dominio.depositos d where d.id = p_deposito and d.organizacion_id = v_org
  ) then
    v_deposito_ok := false;
  end if;

  select coalesce(array_agg(e.id), '{}'::uuid[])
    into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and e.activa
     and e.id = any (select private.empresas_accesibles())
     and (p_empresa is null or e.id = p_empresa)
     and (select private.nivel_ventas_en_empresa(e.id)) in ('lectura', 'edicion');

  if cardinality(v_empresas) > 0 and v_deposito_ok then
    select coalesce(jsonb_agg(jsonb_build_object(
             'empresa_id', e.id,
             'nombre', e.nombre,
             'unidades', coalesce(t.unidades, 0),
             'ingresos', case when (v_rent and (v_super or (select private.nivel_de_rol(v_org, private.rol_en_empresa(e.id), 'rentabilidad')) in ('lectura', 'edicion')))
                              then coalesce(case when p_deposito is null then h.ingresos else t.ingresos_lineas end, 0) end,
             'margen_pct', case when (v_rent and (v_super or (select private.nivel_de_rol(v_org, private.rol_en_empresa(e.id), 'rentabilidad')) in ('lectura', 'edicion'))) and t.base_margen is not null and t.base_margen <> 0
                                then round(t.margen / t.base_margen * 100, 1) end
           ) order by lower(e.nombre), e.id), '[]'::jsonb)
      into v_tiendas
      from dominio.empresas e
      left join (
        select v.empresa_id,
               sum(private.signo_comprobante(v.tipo) * l.cantidad) as unidades,
               sum(private.signo_comprobante(v.tipo) * (l.subtotal_sin_iva + l.iva)) as ingresos_lineas,
               sum(case when l.costo_unitario is not null
                        then private.signo_comprobante(v.tipo) * (l.subtotal_sin_iva - l.cantidad * l.costo_unitario) end) as margen,
               sum(case when l.costo_unitario is not null
                        then private.signo_comprobante(v.tipo) * l.subtotal_sin_iva end) as base_margen
          from dominio.comprobantes_venta v
          join dominio.comprobantes_venta_lineas l
            on l.comprobante_id = v.id and l.organizacion_id = v.organizacion_id
         where v.organizacion_id = v_org
           and v.empresa_id = any (v_empresas)
           and v.fecha between p_desde and p_hasta
           and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
           and (p_deposito is null or l.deposito_id = p_deposito)
         group by v.empresa_id
      ) t on t.empresa_id = e.id
      left join (
        select v.empresa_id, sum(private.signo_comprobante(v.tipo) * v.total_con_iva) as ingresos
          from dominio.comprobantes_venta v
         where v.organizacion_id = v_org
           and v.empresa_id = any (v_empresas)
           and v.fecha between p_desde and p_hasta
           and private.comprobante_cuenta_como_facturado(v.tipo, v.estado)
         group by v.empresa_id
      ) h on h.empresa_id = e.id
     where e.id = any (v_empresas);
  elsif cardinality(v_empresas) > 0 then
    v_tiendas := '[]'::jsonb;
  end if;

  if v_st then
    select coalesce(jsonb_agg(jsonb_build_object(
             'deposito_id', d.id,
             'nombre', d.nombre,
             'salidas', coalesce(s.salidas, 0),
             'stock_actual', coalesce(x.stock, 0)
           ) order by d.por_defecto desc, lower(d.nombre), d.id), '[]'::jsonb)
      into v_depositos
      from dominio.depositos d
      left join (
        select m.deposito_id, sum(- m.diferencia) as salidas
          from dominio.movimientos_stock m
         where m.organizacion_id = v_org and m.tipo = 'salida' and m.traslado_id is null
           and m.fecha between p_desde and p_hasta
         group by m.deposito_id
      ) s on s.deposito_id = d.id
      left join (
        select ed.deposito_id, sum(ed.cantidad) as stock
          from dominio.existencias_deposito ed
          join dominio.productos p on p.id = ed.producto_id and p.organizacion_id = ed.organizacion_id
         where ed.organizacion_id = v_org and p.activo
         group by ed.deposito_id
      ) x on x.deposito_id = d.id
     where d.organizacion_id = v_org and d.activo
       and (p_deposito is null or d.id = p_deposito);
  end if;

  return jsonb_build_object('por_tienda', v_tiendas, 'salidas_por_deposito', v_depositos);
end;
$$;

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
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
  v_busqueda text := nullif(left(btrim(coalesce(p_busqueda, '')), 100), '');
begin
  if v_org is null or (select private.nivel_seccion('stock')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los movimientos de stock' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta or not isfinite(p_desde) or not isfinite(p_hasta) then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  if (p_hasta - p_desde) + 1 > 366 then
    raise exception 'El período no puede superar 366 días' using errcode = '22023';
  end if;
  if coalesce(p_vista, 'todos') not in ('todos', 'alerta', 'quieto') then
    raise exception 'La vista no es válida' using errcode = '22023';
  end if;
  -- Una tienda que el usuario no puede ver no se distingue de una inexistente (lista vacía), para no revelar
  -- qué productos tiene asignados una tienda ajena de su organización.
  if p_empresa is not null and not (p_empresa = any (select private.empresas_accesibles())) then
    return;
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
    when 'estado' then $q$case r.estado when 'alerta' then 0 when 'quieto' then 1 else 2 end$q$
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
         and ($12::uuid is null or exists (
               select 1 from dominio.producto_empresa pe
                where pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id and pe.empresa_id = $12::uuid))
         and ($5::text is null or p.nombre ilike '%%' || replace(replace(replace($5::text, '\', '\\'), '%%', '\%%'), '_', '\_') || '%%'
              or p.sku ilike '%%' || replace(replace(replace($5::text, '\', '\\'), '%%', '\%%'), '_', '\_') || '%%')
    ),
    mov as (
      select m.producto_id,
             coalesce(sum(m.diferencia) filter (where m.tipo = 'entrada' and m.fecha between $2 and $3), 0)::bigint as entradas,
             coalesce(sum(- m.diferencia) filter (where m.tipo = 'salida' and m.fecha between $2 and $3), 0)::bigint as salidas,
             coalesce(sum(m.diferencia) filter (where m.tipo = 'ajuste' and m.fecha between $2 and $3), 0)::bigint as ajustes,
             coalesce(sum(m.diferencia) filter (where m.fecha >= $2), 0)::bigint as desde_inicio,
             count(*) filter (where m.fecha between $2 and $3) as en_periodo,
             count(*) as total_mov
        from dominio.movimientos_stock m
       where m.organizacion_id = $1 and m.fecha >= $2
         and ($4::uuid is null or m.deposito_id = $4::uuid)
         and m.producto_id in (select b0.producto_id from base b0)
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
             case when $13::boolean then (select max(m2.fecha) from dominio.movimientos_stock m2
               where m2.organizacion_id = $1 and m2.producto_id = b.producto_id
                 and ($4::uuid is null or m2.deposito_id = $4::uuid)) end as ultimo_movimiento,
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
           r.stock_actual, r.minimo, r.ventas,
           coalesce(r.ultimo_movimiento, (select max(m3.fecha) from dominio.movimientos_stock m3
               where m3.organizacion_id = $1 and m3.producto_id = r.producto_id
                 and ($4::uuid is null or m3.deposito_id = $4::uuid))) as ultimo_movimiento,
           r.estado,
           count(*) over () as total
      from f r
     order by %s %s nulls last, lower(r.nombre), r.producto_id
     limit $10 offset $11
  $q$, v_orden, v_dir)
  using v_org, p_desde, p_hasta, p_deposito, v_busqueda, p_categoria, v_con_ventas, v_empresas,
        coalesce(p_vista, 'todos'), v_tamano, (v_pagina - 1) * v_tamano, p_empresa, (coalesce(p_orden, 'nombre') = 'ultimo_movimiento');
end;
$$;

create or replace function public.aplicar_cotizacion(
  p_valor numeric,
  p_empresa uuid default null,
  p_variacion_vista numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Mismo orden de locks que `confirmar_cotizacion`, `descartar_cotizacion` y el cambio de alcance: primero el
  -- advisory de la organización y recién después la fila de la pendiente. Es reentrante en la misma transacción
  -- (`confirmar_cotizacion` lo vuelve a tomar). Sin esto, dos administradores a la vez podían dar deadlock (40P01).
  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || coalesce((select private.organizacion_id())::text, ''), 0));
  perform public.cargar_cotizacion(p_valor, p_empresa);
  return public.confirmar_cotizacion(p_empresa, p_variacion_vista);
end;
$$;
