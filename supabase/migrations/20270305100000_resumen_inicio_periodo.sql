-- F-INI-04 (MSF-820, épica MSF-824, spec 20270305-100000-inicio-tablero-completo, FR-001..FR-006):
-- lectura agregada de Inicio: ventas del período (con la variación contra el período anterior),
-- stock de hoy y serie diaria de unidades vendidas y stock al cierre.
--
-- Esquema (Principio VII): función en `public` (RPC de la app). SIN tablas nuevas: lee
-- `dominio.comprobantes_venta`, `comprobantes_venta_lineas`, `existencias`, `existencias_deposito`
-- y `movimientos_stock`. Las vistas `analitica.*` están cerradas al navegador, por eso va una RPC.
--
-- Criterios (spec, decisiones D-2 y D-3):
--  * Venta = `private.comprobante_cuenta_como_facturado` con `private.signo_comprobante`: la nota de
--    crédito RESTA; presupuestos y anuladas no cuentan. Monto con IVA (`total_con_iva`).
--  * Con filtro de depósito el monto sale de las líneas (`subtotal_sin_iva + iva`) porque el depósito
--    es de la línea; las notas de crédito de importe o descuento (sin líneas) no entran en ese caso.
--  * «Tienda» = `empresa_id`: solo ventas y devoluciones son por tienda; el stock es de la organización.
--  * Ventas: solo las empresas donde el usuario tiene `ventas` ≥ lectura (D-11); sin ninguna,
--    `ventas` vuelve null y la pantalla no muestra el bloque. Stock: sección `stock` ≥ lectura.
--
-- Aislamiento: `SECURITY DEFINER` con la autorización adentro, organización de la sesión y
-- `private.empresas_accesibles()`. `anon` no ejecuta. Un depósito o una empresa ajenos no amplían
-- el alcance (devuelven ceros).
--
-- Migración aditiva. Reversión: drop function public.resumen_inicio_periodo(date,date,uuid,uuid);

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
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
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
            and mo.nombre not in ('Devolución de cliente', 'Anulación de factura')), 0))
        from dominio.movimientos_stock m
        join dominio.motivos_movimiento mo on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
       where m.organizacion_id = v_org and m.fecha between p_desde and p_hasta
         and (p_deposito is null or m.deposito_id = p_deposito));
  end if;

  if v_ve or v_st then
    select coalesce(jsonb_agg(jsonb_build_object(
             'dia', d.dia,
             'unidades', case when v_ve then coalesce(u.unidades, 0) end,
             'stock', case when v_st then v_stock_hoy - coalesce(
               (select sum(m.diferencia) from dominio.movimientos_stock m
                 where m.organizacion_id = v_org and m.fecha > d.dia
                   and (p_deposito is null or m.deposito_id = p_deposito)), 0) end
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

comment on function public.resumen_inicio_periodo(date, date, uuid, uuid) is
  'F-INI-04: ventas del período con variación, stock de hoy y serie diaria para Inicio. Ventas solo de las tiendas con ventas ≥ lectura; stock con la sección stock. Null en el bloque sin permiso.';

revoke execute on function public.resumen_inicio_periodo(date, date, uuid, uuid) from public, anon;
grant execute on function public.resumen_inicio_periodo(date, date, uuid, uuid) to authenticated;
