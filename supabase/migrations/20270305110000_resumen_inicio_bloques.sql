-- F-INI-05 (MSF-821, épica MSF-824, spec 20270305-100000-inicio-tablero-completo, FR-008, FR-009, FR-011):
-- bloques «Resumen por tienda» y «Salidas por depósito» de Inicio. «Qué hacer hoy» ya lo resuelve
-- `alertas_inicio_visibles` (MSF-361) y «Actividad reciente» `public.listar_actividad` (F-AUD-01):
-- no se duplican.
--
-- Esquema (Principio VII): función en `public`; SIN tablas nuevas (lee comprobantes, líneas, movimientos y
-- existencias de `dominio`).
--
-- Criterios (spec, D-2, D-3, D-4, D-5, D-11):
--  * por_tienda: una fila por tienda activa donde el usuario tiene `ventas` ≥ lectura; unidades netas de
--    devoluciones. `ingresos` (con IVA) y `margen_pct` SOLO con `rentabilidad` ≥ lectura: sin ella vuelven
--    null desde la base (no solo se ocultan en pantalla).
--  * margen_pct = margen REAL de lo vendido: Σ signo × (subtotal sin IVA − cantidad × costo guardado en la
--    línea) sobre Σ signo × subtotal sin IVA de las líneas CON costo (las ventas sin costo guardado quedan
--    fuera, no se inventa costo); null si no hay líneas con costo. Es una estimación: el costo es el de la
--    confirmación.
--  * salidas_por_deposito (sección `stock` ≥ lectura): unidades que salieron en el período (movimientos de
--    tipo salida sin traslados) y stock actual, por depósito activo; null sin permiso.
--  * Con p_deposito las unidades e ingresos salen de las líneas de ese depósito.
-- Aislamiento: `SECURITY DEFINER` con organización de la sesión y `private.empresas_accesibles()`; `anon` no
-- ejecuta; un depósito o una empresa ajenos devuelven listas vacías.
--
-- Migración aditiva. Reversión: drop function public.resumen_inicio_bloques(date,date,uuid,uuid);

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
  v_st boolean;
  v_tiendas jsonb := null;
  v_depositos jsonb := null;
  v_deposito_ok boolean := true;
begin
  if v_org is null then
    raise exception 'No hay organización activa' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El rango de fechas no es válido' using errcode = '22023';
  end if;
  if (p_hasta - p_desde) + 1 > 366 then
    raise exception 'El período no puede superar 366 días' using errcode = '22023';
  end if;

  v_rent := (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion');
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
             'ingresos', case when v_rent
                              then coalesce(case when p_deposito is null then h.ingresos else t.ingresos_lineas end, 0) end,
             'margen_pct', case when v_rent and t.base_margen is not null and t.base_margen <> 0
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

comment on function public.resumen_inicio_bloques(date, date, uuid, uuid) is
  'F-INI-05: resumen por tienda (unidades; ingresos y margen estimado solo con rentabilidad) y salidas por depósito (sección stock). Null en el bloque sin permiso.';

revoke execute on function public.resumen_inicio_bloques(date, date, uuid, uuid) from public, anon;
grant execute on function public.resumen_inicio_bloques(date, date, uuid, uuid) to authenticated;
