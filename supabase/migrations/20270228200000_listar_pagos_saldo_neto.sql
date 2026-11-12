-- F-VTA-13 / MSF-450 (decisión 8, aprobada 2026-11-12): `public.listar_pagos` usa el MISMO saldo neto que la cuenta
-- corriente y el detalle del comprobante: saldo = round(max(total − cobrado − notas de crédito, 0), 2), con las notas que
-- cuelgan de la factura (`comprobante_origen_id`), del mismo cliente y organización, de tiendas accesibles y que cuentan
-- según `private.comprobante_cuenta_como_facturado` (ni borrador ni anulada). Sin saldo a favor.
-- Afecta la columna `saldo` y el filtro «Solo con saldo» (antes `total − cobros`, sin notas).
-- La forma de la respuesta NO cambia: `create or replace`, mismos grants (revoke public/anon, grant authenticated),
-- `security invoker` y `search_path = ''`.
-- Estado de la factura (corrección, misma exclusión que `resumen_pagos`): si la factura está `anulada` o en `borrador`
-- el saldo mostrado es 0 y el pago NO entra en «Solo con saldo»; el pago en sí sigue listándose (es un cobro real).
-- Alcance: el `cobrado` suma TODOS los cobros del comprobante, sin filtrar por tienda. `public.saldo_comprobante` los
-- filtra por `empresas_accesibles()`, pero no cambia ningún resultado: el disparador de integridad exige que el cobro sea
-- de la empresa del comprobante y la lista ya exige que esa empresa sea accesible, así que todos los cobros de la factura
-- son de una tienda accesible.
-- Reversión (en una migración posterior): `create or replace` con la definición de 20270114110100_listar_pagos.sql.

create or replace function public.listar_pagos(
  p_empresa_id uuid default null,
  p_cuenta_cobro_id uuid default null,
  p_solo_con_saldo boolean default false,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  fecha timestamptz,
  empresa_id uuid,
  empresa text,
  comprobante_id uuid,
  numero text,
  cliente text,
  cuenta_cobro_id uuid,
  cuenta_cobro text,
  importe numeric,
  aprobado_por text,
  conciliado boolean,
  saldo numeric,
  actualizado_en timestamptz,
  filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los pagos' using errcode = '42501';
  end if;

  return query
  select b.id,
         b.registrado_en,
         b.empresa_id,
         e.nombre,
         b.comprobante_id,
         c.numero,
         cl.nombre,
         b.cuenta_cobro_id,
         cc.nombre,
         b.importe,
         b.aprobado_por_nombre,
         b.aprobado_por is not null,
         sd.saldo,
         b.actualizado_en,
         count(*) over () as filas
    from dominio.cobros_comprobante b
    join dominio.comprobantes_venta c
      on c.id = b.comprobante_id and c.organizacion_id = b.organizacion_id
    join dominio.empresas e
      on e.id = b.empresa_id and e.organizacion_id = b.organizacion_id
    left join public.clientes cl
      on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
    left join dominio.cuentas_cobro cc
      on cc.id = b.cuenta_cobro_id and cc.organizacion_id = b.organizacion_id
    left join lateral (
      select coalesce(sum(b2.importe), 0) as cobrado
        from dominio.cobros_comprobante b2
       where b2.comprobante_id = c.id
         and b2.organizacion_id = b.organizacion_id
    ) s on true
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
    cross join lateral (
      select case when c.estado in ('borrador', 'anulada') then 0::numeric
                  else round(greatest(c.total_con_iva - coalesce(s.cobrado, 0) - nc.importe, 0), 2) end as saldo
    ) sd
   where b.organizacion_id = (select private.organizacion_id())
     and b.empresa_id in (select private.empresas_accesibles())
     and b.cuenta_cobro_id is not null
     and (p_empresa_id is null or b.empresa_id = p_empresa_id)
     and (p_cuenta_cobro_id is null or b.cuenta_cobro_id = p_cuenta_cobro_id)
     and (not coalesce(p_solo_con_saldo, false)
          or sd.saldo > 0)
   order by b.registrado_en desc, b.id desc
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

revoke execute on function public.listar_pagos(uuid, uuid, boolean, integer, integer) from public, anon;
grant execute on function public.listar_pagos(uuid, uuid, boolean, integer, integer) to authenticated;

comment on function public.listar_pagos(uuid, uuid, boolean, integer, integer) is
  'Pagos con cuenta de cobro para la pantalla Pagos (F-VTA-13, FR-023): filtros por empresa y por cuenta, «Solo con saldo», paginación en el servidor y el saldo neto del comprobante (total − cobrado − notas de crédito). Solo lectura (RLS de dominio).';
