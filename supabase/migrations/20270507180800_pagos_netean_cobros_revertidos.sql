-- MSF-667 (lote 32, MSF-647, hallazgo de QA): los lectores de pagos netean el cobro revertido y su contra-asiento.
--
-- Con `revertir_cobro` (20270507180100) el libro tiene el cobro original (con su cuenta) y un contra-asiento negativo con la
-- misma cuenta. `resumen_pagos` contaba los dos como «por conciliar» (1 → 2) y ninguno se podía conciliar (55000).
-- Parte de las definiciones VIGENTES de la base (20270228200100, 20270228200000 y 20270114110200 respectivamente):
--   · `resumen_pagos`: excluye de «por conciliar» y «conciliado» el cobro revertido y el contra-asiento (importes y cantidades);
--     el saldo pendiente sigue siendo el neto (suma de importes, con el contra-asiento restando).
--   · `listar_pagos`: agrega la columna `estado_reversion` (`'revertido'` para el cobro revertido, `'reversion'` para el
--     contra-asiento, nulo para el resto) para que la pantalla los muestre como revertidos y no los ofrezca a conciliar. Cambia
--     la forma de la respuesta: drop + create (los consumidores leen por nombre).
--   · `cuentas_cobro_mas_usadas`: no cuenta como uso de la cuenta ni al cobro revertido ni a su contra-asiento.
-- Mismos grants (revoke public/anon, grant authenticated), `security invoker`, `search_path = ''`.
--
-- Migración aditiva (create or replace; drop + create solo de listar_pagos por la columna nueva). Reversión: volver a las
-- definiciones de 20270228200100_resumen_pagos_saldo_neto.sql, 20270228200000_listar_pagos_saldo_neto.sql (drop function
-- public.listar_pagos(uuid, uuid, boolean, integer, integer) y recrearla sin la columna) y 20270114110200 /
-- 20270325… para cuentas_cobro_mas_usadas (create or replace sin el filtro de reversión).

CREATE OR REPLACE FUNCTION public.resumen_pagos(p_empresa_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(por_conciliar_importe numeric, por_conciliar_cantidad bigint, conciliado_importe numeric, conciliado_cantidad bigint, saldo_pendiente numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
       -- MSF-667: un cobro revertido y su contra-asiento se netean: no cuentan como «por conciliar» (ni como conciliado).
       and b.origen <> 'reversion'
       and not exists (select 1 from dominio.cobros_comprobante r
                        where r.revierte_cobro_id = b.id and r.organizacion_id = b.organizacion_id)
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
$function$;

revoke execute on function public.resumen_pagos(uuid) from public, anon;
grant execute on function public.resumen_pagos(uuid) to authenticated;

drop function public.listar_pagos(uuid, uuid, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.listar_pagos(p_empresa_id uuid DEFAULT NULL::uuid, p_cuenta_cobro_id uuid DEFAULT NULL::uuid, p_solo_con_saldo boolean DEFAULT false, p_pagina integer DEFAULT 1, p_tamano integer DEFAULT 10)
 RETURNS TABLE(id uuid, fecha timestamp with time zone, empresa_id uuid, empresa text, comprobante_id uuid, numero text, cliente text, cuenta_cobro_id uuid, cuenta_cobro text, importe numeric, aprobado_por text, conciliado boolean,
  estado_reversion text, saldo numeric, actualizado_en timestamp with time zone, filas bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
         case when b.origen = 'reversion' then 'reversion'
              when exists (select 1 from dominio.cobros_comprobante r
                            where r.revierte_cobro_id = b.id and r.organizacion_id = b.organizacion_id) then 'revertido'
         end,
         sd.saldo,
         b.actualizado_en,
         count(*) over () as filas
    from dominio.cobros_comprobante b
    join dominio.comprobantes_venta c
      on c.id = b.comprobante_id and c.organizacion_id = b.organizacion_id
    join dominio.empresas e
      on e.id = b.empresa_id and e.organizacion_id = b.organizacion_id
    left join dominio.clientes cl
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
$function$;

revoke execute on function public.listar_pagos(uuid, uuid, boolean, integer, integer) from public, anon;
grant execute on function public.listar_pagos(uuid, uuid, boolean, integer, integer) to authenticated;

CREATE OR REPLACE FUNCTION public.cuentas_cobro_mas_usadas(p_empresa_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 8)
 RETURNS TABLE(id uuid, nombre text, banco text, activa boolean, usos bigint, total_cuentas bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_limite integer := least(greatest(coalesce(p_limite, 8), 1), 200);
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver las cuentas de cobro' using errcode = '42501';
  end if;

  return query
  with cuentas as (
    select cc.id, cc.nombre, cc.banco, cc.activa
      from dominio.cuentas_cobro cc
     where cc.organizacion_id = (select private.organizacion_id())
       and (p_empresa_id is null or exists (
             select 1
               from dominio.cuentas_cobro_empresas ce
              where ce.cuenta_id = cc.id
                and ce.empresa_id = p_empresa_id
                and ce.organizacion_id = cc.organizacion_id
           ))
  ),
  usos as (
    select b.cuenta_cobro_id as cuenta_id, count(*) as usos
      from dominio.cobros_comprobante b
     where b.organizacion_id = (select private.organizacion_id())
       and b.empresa_id in (select private.empresas_accesibles())
       and b.cuenta_cobro_id is not null
       and (p_empresa_id is null or b.empresa_id = p_empresa_id)
       -- MSF-667: un cobro revertido y su contra-asiento no cuentan como uso de la cuenta.
       and b.origen <> 'reversion'
       and not exists (select 1 from dominio.cobros_comprobante r
                        where r.revierte_cobro_id = b.id and r.organizacion_id = b.organizacion_id)
     group by b.cuenta_cobro_id
  )
  select c.id,
         c.nombre,
         c.banco,
         c.activa,
         coalesce(u.usos, 0),
         (select count(*) from cuentas)
    from cuentas c
    left join usos u on u.cuenta_id = c.id
   order by coalesce(u.usos, 0) desc, lower(c.nombre), c.id
   limit v_limite;
end;
$function$;

revoke execute on function public.cuentas_cobro_mas_usadas(uuid, integer) from public, anon;
grant execute on function public.cuentas_cobro_mas_usadas(uuid, integer) to authenticated;

comment on function public.listar_pagos(uuid, uuid, boolean, integer, integer) is
  'Pagos con cuenta de cobro para la pantalla Pagos (F-VTA-13, FR-023): filtros por empresa y por cuenta, «Solo con saldo», paginación en el servidor, el saldo neto del comprobante y estado_reversion (revertido / reversion / nulo, MSF-667). Solo lectura (RLS de dominio).';
