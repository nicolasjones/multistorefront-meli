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
--   private.saldo_comprobante         private (existente) el saldo del comprobante (F-VTA-12): se
--                                                   llama; es su único dueño.
--   public.clientes                   public (existente)  se lee para saber si el cliente es de
--                                                   la organización de la sesión.
-- Esta migración NO crea ni altera tablas.
--
-- Reglas del dato:
-- · El saldo de un comprobante NO se recalcula acá: lo trae `private.saldo_comprobante`
--   (F-VTA-12), que es su único dueño (`total con IVA − Σ cobros`, nunca negativo). Si esta
--   función recalculara el saldo, habría dos reglas que pueden divergir; por eso la llama.
--   El estado «Deuda» no se consulta: una factura en «Deuda» no tiene cobros (debe su total
--   completo).
-- · Cuentan las facturas que no están en `borrador`, `anulada` ni `cobrado`: un borrador no se
--   debe, una factura anulada no le debe nada a nadie (mismo criterio que
--   `public.resumen_pagos`) y una «Cobrada» está saldada por definición aunque su cobro no esté
--   en el libro (cobrada en mostrador o anterior al libro de cobros, MSF-195).
-- · Alcance por tienda: solo las tiendas a las que la persona accede
--   (`private.empresas_accesibles()`, como `public.saldo_comprobante`); no ve la deuda de otras.
-- · Los presupuestos no son deuda: no entran. Las notas de crédito NO restan: su efecto en la
--   cuenta corriente es de MSF-195 (hoy no admiten cobros) y esta historia no lo reasigna.
-- · El saldo total es la suma de los saldos listados; la lista trae los comprobantes con saldo
--   del más reciente al más antiguo. Si el cliente no debe nada, la función devuelve la fila de
--   encabezado (saldo 0, 0 comprobantes) sin documentos.
-- · Cada fila trae el `id` del comprobante: el número se repite entre tiendas (el correlativo
--   es por organización, empresa y tipo) y el id es lo que identifica a la fila.
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
-- organización/cliente/fecha, la clave primaria de `dominio.comprobantes_venta` y
-- `cobros_comprobante_comprobante_idx` por comprobante, que es lo que usa
-- `private.saldo_comprobante` por documento).
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.cuenta_corriente_cliente(uuid);

create or replace function public.cuenta_corriente_cliente(p_cliente_id uuid)
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
                        null::numeric, null::numeric, null::numeric;
    return;
  end if;

  -- El encabezado (saldo total y cantidad) se calcula sobre TODOS los comprobantes abiertos y
  -- se repite en cada fila; sin documentos abiertos vuelve solo la fila de encabezado.
  return query
  with abiertos as (
    select v.id, v.numero, v.fecha, v.tipo, v.estado,
           s.total as total_con_iva, s.cobrado, s.saldo
      from dominio.comprobantes_venta v
      cross join lateral private.saldo_comprobante(v.id) s
     where v.organizacion_id = v_org
       and v.cliente_id = p_cliente_id
       and v.tipo = 'factura'
       and v.estado not in ('borrador', 'anulada', 'cobrado')
       and v.empresa_id in (select private.empresas_accesibles())
       and s.saldo > 0
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
         a.saldo
    from encabezado e
    left join abiertos a on true
   order by a.fecha desc nulls last, a.numero desc nulls last, a.id;
end;
$$;

revoke execute on function public.cuenta_corriente_cliente(uuid) from public, anon;
grant execute on function public.cuenta_corriente_cliente(uuid) to authenticated;

comment on function public.cuenta_corriente_cliente(uuid) is
  'Cuenta corriente del cliente (F-CLI-19): saldo total, cantidad de comprobantes abiertos y sus filas (id, número, fecha, estado, total, cobrado y saldo; el saldo sale de private.saldo_comprobante). Solo lectura: la autorización y el aislamiento por organización los resuelve la función en el servidor.';
