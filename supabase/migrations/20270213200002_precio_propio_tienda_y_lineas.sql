-- MSF-423 (F-PRE-08, épica MSF-352) · FR-014 / RF-PRE-08-1 / SC-006, corrección hallada en la revisión retroactiva:
-- el precio propio de un producto en una empresa tiene que reemplazar al calculado en TODOS los caminos que
-- entregan un precio, no solo en la vista de Precios. Quedaban fuera:
--   * private.precio_final_publico / precio_final_publico_escala  -> lo que muestra y cobra la tienda pública;
--   * private.precio_para                                        -> las líneas de presupuestos y comprobantes.
--
-- Regla (la misma de 20270213100006): con precio propio, neto = precio propio (sin ajuste ni redondeo de la regla);
-- el IVA de la empresa se aplica encima. La conversión de pesos usa la cotización de la EMPRESA (igual que
-- public.precios_empresa_neto), así la tienda y el panel muestran el mismo número.
-- Escalas por cantidad (x5/x10/x50): un precio de escala cargado a mano sigue mandando (es un precio por cantidad,
-- no el precio base); el precio propio reemplaza al precio base, o sea cuando se usa x1 o cuando la escala no tiene precio.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla; se reemplazan tres funciones de solo lectura.
-- Migración aditiva (create or replace, mismas firmas y grants). Reversión (migración posterior): drop function private.neto_precio_propio(text, numeric, uuid, uuid); restaurar
-- private.precio_final_publico a 20261023150200, private.precio_final_publico_escala a 20261211110000 y
-- private.precio_para a 20261203200300.

-- Neto en pesos de un precio propio, sin depender de la sesión (la tienda la leen visitantes anónimos y clientes sin
-- membresía de la organización): ARS directo; USD × la cotización de la empresa (private.cotizacion_para), a 2 decimales,
-- igual que private.precio_propio_empresa. El aislamiento lo dan los joins producto↔empresa↔organización de quien la llama.
create or replace function private.neto_precio_propio(p_moneda text, p_importe numeric, p_organizacion uuid, p_empresa uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case p_moneda when 'ARS' then p_importe else round(p_importe * private.cotizacion_para(p_organizacion, p_empresa), 2) end;
$$;

revoke execute on function private.neto_precio_propio(text, numeric, uuid, uuid) from public, anon, authenticated;

create or replace function private.precio_final_publico(p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce(r.mostrar_con_iva, false)
             then private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
           else x.neto
         end
    from dominio.productos p
    join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
    join dominio.producto_empresa pe
      on pe.producto_id = p.id and pe.empresa_id = e.id and pe.organizacion_id = p.organizacion_id
    left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
    left join dominio.producto_precios_escala s
      on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = 'x1'
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
    left join dominio.alicuotas_iva al
      on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
    left join dominio.precios_propios_empresa pp
      on pp.producto_id = p.id and pp.empresa_id = e.id and pp.organizacion_id = p.organizacion_id
    cross join lateral (
      select case
               when pp.moneda is not null
                 then private.neto_precio_propio(pp.moneda, pp.importe, p.organizacion_id, e.id)
               else private.aplicar_regla_precio(
                      private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
                      coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
             end as neto
    ) x
   where p.id = p_producto;
$$;

revoke execute on function private.precio_final_publico(uuid, uuid) from public, anon, authenticated;

create or replace function private.precio_final_publico_escala(p_producto uuid, p_empresa uuid, p_escala text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_final numeric;
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;

  select case
           when coalesce(r.mostrar_con_iva, false)
             then private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
           else x.neto
         end
    into v_final
    from dominio.productos p
    join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
    join dominio.producto_empresa pe
      on pe.producto_id = p.id and pe.empresa_id = e.id and pe.organizacion_id = p.organizacion_id
    left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
    left join dominio.producto_precios_escala s
      on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
    left join dominio.alicuotas_iva al
      on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
    left join dominio.precios_propios_empresa pp
      on pp.producto_id = p.id and pp.empresa_id = e.id and pp.organizacion_id = p.organizacion_id
    cross join lateral (
      select case
               when pp.moneda is not null and (p_escala = 'x1' or s.precio is null)
                 then private.neto_precio_propio(pp.moneda, pp.importe, p.organizacion_id, e.id)
               else private.aplicar_regla_precio(
                      private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
                      coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
             end as neto
    ) x
   where p.id = p_producto;

  return v_final;
end;
$$;

revoke execute on function private.precio_final_publico_escala(uuid, uuid, text) from public, anon, authenticated;

create or replace function private.precio_para(p_producto uuid, p_empresa uuid, p_escala text default 'x1')
returns table (
  escala_usada text,
  neto numeric,
  alicuota_id uuid,
  alicuota_nombre text,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  final numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;
  if (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion')
     and (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    return;
  end if;

  return query
  select
    x.usada,
    x.neto,
    al.alicuota_id,
    al.nombre,
    al.porcentaje,
    coalesce(al.exento, false),
    private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  left join dominio.producto_precios_escala s
    on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
  left join lateral private.precio_propio_empresa(p.id, e.id) pp on true
  cross join lateral (
    select
      case when s.precio is not null and p_escala <> 'x1' then p_escala else 'x1' end as usada,
      case
        when pp.moneda is not null and (p_escala = 'x1' or s.precio is null) then pp.neto_ars
        else private.aplicar_regla_precio(
               private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
               coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
      end as neto
  ) x
  left join lateral private.alicuota_producto(p.id) al on true
  where p.id = p_producto;
end;
$$;

revoke execute on function private.precio_para(uuid, uuid, text) from public, anon;
grant execute on function private.precio_para(uuid, uuid, text) to authenticated;
