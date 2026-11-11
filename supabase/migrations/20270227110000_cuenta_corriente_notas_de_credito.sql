-- F-CLI-19 (MSF-451, épica MSF-450): decisión de Nicolás del 2026-11-11 — las notas de crédito RESTAN de la deuda.
--
-- Antes (20270222100000) la cuenta corriente ignoraba las notas de crédito: una devolución o un descuento no bajaba el
-- «Saldo deudor» del cliente. Ahora cada factura abierta resta lo que tienen emitido sus notas de crédito.
--
-- Reglas:
-- · Se restan las notas de crédito que cuelgan de la factura (`comprobante_origen_id`), del mismo cliente y organización,
--   que no estén en `borrador` ni `anulada`.
-- · Sale por factura: saldo = max(total − cobrado − notas de crédito, 0). No hay saldo a favor (decisión vigente): si las
--   notas y los cobros superan el total, la factura queda en 0 y no aparece.
-- · Una factura anulada ya no figura en la cuenta, así que la nota de crédito que genera la anulación NO se descuenta dos
--   veces: solo cuentan las notas de facturas que siguen abiertas.
-- · Importes redondeados a 2 decimales (saldo de cada factura y saldo total).
-- · `private.saldo_comprobante` (F-VTA-12) NO cambia: sigue siendo `total − cobros`. La cuenta corriente le resta las notas.
--
-- Cambia la forma de la respuesta (columna nueva `notas_credito`, después de `cobrado`), así que se recrea la función.
-- Reversión (en una migración posterior): volver a la definición de 20270222100000_cuenta_corriente_cliente.sql.

drop function if exists public.cuenta_corriente_cliente(uuid);

create function public.cuenta_corriente_cliente(p_cliente_id uuid)
returns table (
  id uuid,
  saldo_total numeric,
  comprobantes bigint,
  numero text,
  fecha date,
  tipo text,
  estado text,
  total_con_iva numeric,
  cobrado numeric,
  notas_credito numeric,
  saldo numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.organizacion_id();
begin
  if v_org is null or private.nivel_seccion('clientes') not in ('lectura', 'edicion') then
    raise exception 'Sin permiso para ver la cuenta corriente del cliente.' using errcode = '42501';
  end if;
  if p_cliente_id is null then
    raise exception 'Indicá el cliente.' using errcode = '22023';
  end if;

  -- Cliente ajeno o inexistente: saldo 0 y sin documentos (no revela si existe).
  if not exists (
    select 1 from public.clientes c where c.id = p_cliente_id and c.organizacion_id = v_org
  ) then
    return query select null::uuid, 0::numeric, 0::bigint, null::text, null::date, null::text, null::text,
                        null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  return query
  with abiertos as (
    select v.id, v.numero, v.fecha, v.tipo, v.estado,
           s.total as total_con_iva, s.cobrado,
           nc.importe as notas_credito,
           round(greatest(s.total - s.cobrado - nc.importe, 0), 2) as saldo
      from dominio.comprobantes_venta v
      cross join lateral private.saldo_comprobante(v.id) s
      cross join lateral (
        select coalesce(sum(n.total_con_iva), 0) as importe
          from dominio.comprobantes_venta n
         where n.organizacion_id = v.organizacion_id
           and n.comprobante_origen_id = v.id
           and n.tipo = 'nota_credito'
           and n.cliente_id = v.cliente_id
           and n.estado not in ('borrador', 'anulada')
      ) nc
     where v.organizacion_id = v_org
       and v.cliente_id = p_cliente_id
       and v.tipo = 'factura'
       and v.estado not in ('borrador', 'anulada', 'cobrado')
       and v.empresa_id in (select private.empresas_accesibles())
       and round(greatest(s.total - s.cobrado - nc.importe, 0), 2) > 0
  ),
  encabezado as (
    select coalesce(sum(a.saldo), 0) as saldo_total, count(*) as comprobantes
      from abiertos a
  )
  select a.id,
         e.saldo_total,
         e.comprobantes,
         a.numero,
         a.fecha,
         a.tipo,
         a.estado,
         a.total_con_iva,
         a.cobrado,
         a.notas_credito,
         a.saldo
    from encabezado e
    left join abiertos a on true
   order by a.fecha desc nulls last, a.numero desc nulls last, a.id;
end;
$$;

revoke execute on function public.cuenta_corriente_cliente(uuid) from public, anon;
grant execute on function public.cuenta_corriente_cliente(uuid) to authenticated;

comment on function public.cuenta_corriente_cliente(uuid) is
  'Cuenta corriente del cliente: facturas abiertas con total, cobrado, notas de crédito y saldo (total − cobrado − notas de crédito, mínimo 0, redondeado a 2 decimales), más el saldo total. Solo tiendas accesibles de la persona.';
