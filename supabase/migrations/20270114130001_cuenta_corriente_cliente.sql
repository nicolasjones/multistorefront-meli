-- F-CLI-19 (MSF-451, épica MSF-450, spec 20261109-100000-cuenta-corriente-y-saldo-cliente,
-- FR-001…FR-004): la cuenta corriente del cliente —qué documentos tiene abiertos y cuánto debe—
-- en una sola RPC de lectura.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.cuenta_corriente_cliente  public (nueva RPC)  la lectura que alimenta el «Saldo
--                                                   deudor» y la tabla «Cuenta corriente» de la
--                                                   ficha del cliente. Es un mecanismo de
--                                                   plataforma (lo usan el panel y la tienda),
--                                                   no una entidad de negocio.
--   dominio.comprobantes_venta       dominio (existente) los documentos del cliente: se leen.
--   dominio.cobros_comprobante       dominio (existente) el libro de cobros (F-VTA-12): se lee.
--   public.clientes                   public (existente)  se lee para saber si el cliente es de
--                                                   la organización de la sesión.
-- Esta migración NO crea ni altera tablas.
--
-- Reglas del dato:
-- · El saldo de un comprobante es `greatest(total_con_iva − Σ cobros, 0)`: el mismo criterio de
--   `private.saldo_comprobante` (F-VTA-12). El estado «Deuda» no se consulta: una factura en
--   «Deuda» no tiene cobros (debe su total completo) y una «Cobrada» tiene el saldo en 0.
-- · Cuentan las facturas que no están en `borrador` ni `anulada`: un borrador no se debe y una
--   factura anulada no le debe nada a nadie (mismo criterio que `public.resumen_pagos`).
-- · Los presupuestos no son deuda: no entran. Las notas de crédito NO restan: su efecto en la
--   cuenta corriente es de MSF-195 (hoy no admiten cobros) y esta historia no lo reasigna.
-- · El saldo total es la suma de los saldos listados; la lista trae los comprobantes con saldo
--   del más reciente al más antiguo. Si el cliente no debe nada, la función devuelve la fila de
--   encabezado (saldo 0, 0 comprobantes) sin documentos.
--
-- Autorización (Principio I):
-- · `security definer` + `search_path = ''`: la organización sale de `private.organizacion_id()`,
--   nunca de un argumento.
-- · Exige la sección `clientes` en `lectura`/`edicion`: el mismo permiso que la sección
--   «Compras» de la ficha (`public.compras_de_cliente`, F-CLI-10), que ya muestra los
--   comprobantes del cliente. El saldo es un agregado de esos mismos documentos.
-- · Un cliente de otra organización (o inexistente) devuelve saldo 0 y sin documentos: no revela
--   si el cliente existe.
-- · `anon` sin privilegios; `authenticated` puede ejecutarla.
--
-- Índices: los que ya existen bastan (`comprobantes_venta_cliente_fecha_idx` por
-- organización/cliente/fecha y `cobros_comprobante_comprobante_idx` por comprobante).
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.cuenta_corriente_cliente(uuid);

create or replace function public.cuenta_corriente_cliente(p_cliente_id uuid)
returns table (
  saldo_total numeric,
  comprobantes bigint,
  numero text,
  fecha date,
  tipo text,
  estado text,
  total_con_iva numeric,
  cobrado numeric,
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
    return query select 0::numeric, 0::bigint, null::text, null::date, null::text, null::text,
                        null::numeric, null::numeric, null::numeric;
    return;
  end if;

  -- El encabezado (saldo total y cantidad) se calcula sobre TODOS los comprobantes abiertos y
  -- se repite en cada fila; sin documentos abiertos vuelve solo la fila de encabezado.
  return query
  with cuentas as (
    select v.numero, v.fecha, v.tipo, v.estado, v.total_con_iva,
           coalesce(sum(b.importe), 0) as cobrado
      from dominio.comprobantes_venta v
      left join dominio.cobros_comprobante b
        on b.comprobante_id = v.id
       and b.organizacion_id = v.organizacion_id
     where v.organizacion_id = v_org
       and v.cliente_id = p_cliente_id
       and v.tipo = 'factura'
       and v.estado not in ('borrador', 'anulada')
     group by v.id, v.numero, v.fecha, v.tipo, v.estado, v.total_con_iva
  ),
  abiertos as (
    select c.numero, c.fecha, c.tipo, c.estado, c.total_con_iva, c.cobrado,
           greatest(c.total_con_iva - c.cobrado, 0) as saldo
      from cuentas c
     where greatest(c.total_con_iva - c.cobrado, 0) > 0
  ),
  encabezado as (
    select coalesce(sum(a.saldo), 0) as saldo_total, count(*) as comprobantes
      from abiertos a
  )
  select e.saldo_total,
         e.comprobantes,
         a.numero,
         a.fecha,
         a.tipo,
         a.estado,
         a.total_con_iva,
         a.cobrado,
         a.saldo
    from encabezado e
    left join abiertos a on true
   order by a.fecha desc nulls last, a.numero desc nulls last;
end;
$$;

revoke execute on function public.cuenta_corriente_cliente(uuid) from public, anon;
grant execute on function public.cuenta_corriente_cliente(uuid) to authenticated;

comment on function public.cuenta_corriente_cliente(uuid) is
  'Cuenta corriente del cliente (F-CLI-19): saldo total, cantidad de comprobantes abiertos y sus filas (total, cobrado y saldo). Solo lectura: la autorización y el aislamiento por organización los resuelve la función en el servidor.';
