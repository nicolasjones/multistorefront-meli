-- MSF-667 (lote 38): la pantalla «Revertir cobro» necesita saber, por cada cobro del comprobante, si ya fue revertido
-- (o si es el contra-asiento), para ofrecer el botón solo donde corresponde.
--
-- Esquema (Principio VII): sin tablas ni columnas nuevas. Se redefine `public.cobros_de_comprobante` (definición vigente:
-- 20270114100100) y se agregan al final dos columnas de resultado: `estado_reversion` ('revertido' = tiene contra-asiento;
-- 'reversion' = es el contra-asiento; null = cobro normal, igual que `listar_pagos`) y `motivo_reversion` (el motivo del
-- contra-asiento; en el cobro revertido, el de su contra-asiento). Cambia el tipo de retorno, por eso `drop` + `create`;
-- el único consumidor es el detalle del comprobante (se actualiza en el mismo cambio).
--
-- Seguridad: igual que antes (`security invoker`, sección ventas ≥ lectura, empresa accesible); `revoke … from public, anon`
-- y `grant execute … to authenticated`.
-- Reversión (migración posterior): drop function public.cobros_de_comprobante(uuid) y recrearla con la definición de 20270114100100.

drop function if exists public.cobros_de_comprobante(uuid);

create function public.cobros_de_comprobante(p_comprobante_id uuid)
returns table (
  id uuid,
  fecha timestamptz,
  forma_pago text,
  forma_pago_tipo text,
  cuenta_cobro text,
  cuenta_cobro_banco text,
  cuenta_cobro_titular text,
  importe numeric,
  origen text,
  conciliado boolean,
  aprobado_por text,
  registrado_por text,
  estado_reversion text,
  motivo_reversion text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los cobros del comprobante' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.comprobantes_venta c
     where c.id = p_comprobante_id
       and c.organizacion_id = (select private.organizacion_id())
       and c.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;

  return query
  select b.id,
         b.registrado_en,
         f.nombre,
         f.tipo,
         cc.nombre,
         cc.banco,
         cc.titular,
         b.importe,
         b.origen,
         b.aprobado_por is not null,
         b.aprobado_por_nombre,
         b.registrado_por_nombre,
         case when b.origen = 'reversion' then 'reversion'
              when r.id is not null then 'revertido' end,
         coalesce(b.motivo_reversion, r.motivo_reversion)
    from dominio.cobros_comprobante b
    left join dominio.formas_pago f on f.id = b.forma_pago_id
    left join dominio.cuentas_cobro cc on cc.id = b.cuenta_cobro_id
    left join dominio.cobros_comprobante r on r.revierte_cobro_id = b.id and r.organizacion_id = b.organizacion_id
   where b.comprobante_id = p_comprobante_id
     and b.organizacion_id = (select private.organizacion_id())
     and b.empresa_id in (select private.empresas_accesibles())
   order by b.registrado_en, b.id;
end;
$$;

revoke execute on function public.cobros_de_comprobante(uuid) from public, anon;
grant execute on function public.cobros_de_comprobante(uuid) to authenticated;

comment on function public.cobros_de_comprobante(uuid) is
  'Cobros del comprobante para la pantalla de ventas: fecha, forma de pago, cuenta de cobro, importe, origen, conciliado, quién registró o aprobó y estado_reversion (revertido / reversion / nulo) con el motivo (MSF-667). Solo lectura (RLS de dominio).';
