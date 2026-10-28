-- F-VTA-13 (MSF-401, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion,
-- FR-024): `public.resumen_pagos` y `public.cuentas_cobro_mas_usadas`, las lecturas que
-- alimentan las tarjetas de la pantalla Pagos.
--
-- Esquemas (Principio VII), verificados objeto por objeto:
--   public.resumen_pagos          public (nueva RPC)  las tres tarjetas: Por conciliar,
--                                                 Conciliado y Saldo pendiente de clientes.
--   public.cuentas_cobro_mas_usadas
--                                 public (nueva RPC)  la tarjeta Cuentas de cobro (las más usadas).
--   dominio.cobros_comprobante   dominio (existente) los pagos con cuenta de cobro.
--   dominio.comprobantes_venta   dominio (existente) las facturas pagadas: total y estado.
--   dominio.cuentas_cobro        dominio (existente) las cuentas de la organización.
--   dominio.cuentas_cobro_empresas
--                                 dominio (existente) la habilitación de la cuenta por empresa.
-- Sin tablas nuevas: esta migración no crea ni altera columnas de ninguna tabla.
--
-- Reglas (FR-024):
-- · `resumen_pagos(p_empresa_id)`: Por conciliar (importe y cantidad) y Conciliado (importe y
--   cantidad) de los pagos CON CUENTA DE COBRO, y Saldo pendiente de clientes: la suma de los
--   saldos de los comprobantes con pago PARCIAL (los que todavía deben algo).
-- · El saldo pendiente mira TODOS los cobros del comprobante, no solo los que tienen cuenta: lo
--   que el cliente debe no depende de cómo pagó. Los comprobantes anulados o en borrador no
--   cuentan: una factura anulada no le debe nada a nadie.
-- · `cuentas_cobro_mas_usadas(p_empresa_id, p_limite)`: las cuentas de la organización (o de la
--   empresa elegida) ordenadas por usos, con el total de cuentas cargadas para el texto «N
--   cargadas · se muestran las más usadas». Incluye las marcadas «No usar»: conservan su
--   historial y la tarjeta las muestra con esa marca.
-- · Las dos son de LECTURA: `security invoker` (manda la RLS de `dominio`) y filtran por
--   organización y por empresa accesible. Sin permiso de Ventas devuelven `42501`.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.resumen_pagos(uuid);
--   drop function public.cuentas_cobro_mas_usadas(uuid, integer);

-- ============================================================================
-- Las tres tarjetas (FR-024)
-- ============================================================================

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
    select c.id, greatest(c.total_con_iva - coalesce(sum(b.importe), 0), 0) as saldo
      from dominio.comprobantes_venta c
      join dominio.cobros_comprobante b
        on b.comprobante_id = c.id and b.organizacion_id = c.organizacion_id
     where c.organizacion_id = (select private.organizacion_id())
       and c.empresa_id in (select private.empresas_accesibles())
       and c.estado not in ('borrador', 'anulada')
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
     group by c.id, c.total_con_iva
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
  'Tarjetas de la pantalla Pagos (F-VTA-13, FR-024): importe y cantidad por conciliar, importe y cantidad conciliados y saldo pendiente de clientes. Solo lectura (RLS de dominio).';

-- ============================================================================
-- La tarjeta Cuentas de cobro (FR-024)
-- ============================================================================

create or replace function public.cuentas_cobro_mas_usadas(
  p_empresa_id uuid default null,
  p_limite integer default 8
)
returns table (
  id uuid,
  nombre text,
  banco text,
  activa boolean,
  usos bigint,
  total_cuentas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
$$;

revoke execute on function public.cuentas_cobro_mas_usadas(uuid, integer) from public, anon;
grant execute on function public.cuentas_cobro_mas_usadas(uuid, integer) to authenticated;

comment on function public.cuentas_cobro_mas_usadas(uuid, integer) is
  'Tarjeta Cuentas de cobro de la pantalla Pagos (F-VTA-13, FR-024): las cuentas de la organización (o de la empresa elegida) ordenadas por usos, con el total de cuentas cargadas. Solo lectura (RLS de dominio).';
