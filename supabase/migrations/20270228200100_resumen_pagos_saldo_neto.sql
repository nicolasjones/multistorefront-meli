-- F-VTA-13 / MSF-450 (decisión 8, aprobada 2026-11-12): `public.resumen_pagos` (tarjeta «Saldo pendiente de clientes») usa el MISMO saldo neto que la cuenta
-- corriente y el detalle del comprobante: saldo = round(max(total − cobrado − notas de crédito, 0), 2), con las notas que
-- cuelgan de la factura (`comprobante_origen_id`), del mismo cliente y organización, de tiendas accesibles y que cuentan
-- según `private.comprobante_cuenta_como_facturado` (ni borrador ni anulada). Sin saldo a favor.
-- Afecta `saldo_pendiente` (antes `total − cobros`, sin notas).
-- La forma de la respuesta NO cambia: `create or replace`, mismos grants (revoke public/anon, grant authenticated),
-- `security invoker` y `search_path = ''`.
-- Alcance (comportamiento previo, sin cambios): `saldo_pendiente` suma TODOS los cobros del comprobante (no se filtra por
-- tienda) y solo incluye facturas con al menos un cobro. Los cobros se agrupan una vez por factura y el cálculo de las
-- notas corre una vez por factura.
-- Reversión (en una migración posterior): `create or replace` con la definición de 20270114110100_resumen_pagos.sql.

create or replace function public.resumen_pagos(p_empresa_id uuid default null)
returns table (
  por_conciliar_importe numeric,
  por_conciliar_cantidad bigint,
  conciliado_importe numeric,
  conciliado_cantidad bigint,
  saldo_pendiente numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver el resumen de pagos' using errcode = '42501';
  end if;

  return query
  with pagos as (
    select b.importe, b.aprobado_por is not null as conciliado
      from dominio.cobros_comprobante b
     where b.organizacion_id = (select private.organizacion_id())
       and b.empresa_id in (select private.empresas_accesibles())
       and b.cuenta_cobro_id is not null
       and (p_empresa_id is null or b.empresa_id = p_empresa_id)
  ),
  saldos as (
    select c.id,
           round(greatest(c.total_con_iva - cb.cobrado - nc.importe, 0), 2) as saldo
      from dominio.comprobantes_venta c
      join (
        select b.comprobante_id, sum(b.importe) as cobrado
          from dominio.cobros_comprobante b
         where b.organizacion_id = (select private.organizacion_id())
         group by b.comprobante_id
      ) cb on cb.comprobante_id = c.id
      cross join lateral (
        select coalesce(sum(n.total_con_iva), 0) as importe
          from dominio.comprobantes_venta n
         where n.organizacion_id = c.organizacion_id
           and n.comprobante_origen_id = c.id
           and n.tipo = 'nota_credito'
           and n.cliente_id = c.cliente_id
           and n.empresa_id in (select private.empresas_accesibles())
           and private.comprobante_cuenta_como_facturado(n.tipo, n.estado)
      ) nc
     where c.organizacion_id = (select private.organizacion_id())
       and c.empresa_id in (select private.empresas_accesibles())
       and c.estado not in ('borrador', 'anulada')
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
  )
  select coalesce(sum(p.importe) filter (where not p.conciliado), 0),
         count(*) filter (where not p.conciliado),
         coalesce(sum(p.importe) filter (where p.conciliado), 0),
         count(*) filter (where p.conciliado),
         coalesce((select sum(s.saldo) from saldos s where s.saldo > 0), 0)
    from pagos p;
end;
$$;

revoke execute on function public.resumen_pagos(uuid) from public, anon;
grant execute on function public.resumen_pagos(uuid) to authenticated;

comment on function public.resumen_pagos(uuid) is
  'Tarjetas de la pantalla Pagos (F-VTA-13, FR-024): importe y cantidad por conciliar, importe y cantidad conciliados y saldo pendiente de clientes (neto de notas de crédito, como la cuenta corriente). Solo lectura (RLS de dominio).';

