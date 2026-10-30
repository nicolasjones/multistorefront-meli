-- F-VTA-13 (MSF-401, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion,
-- FR-023): `public.listar_pagos`, el listado paginado de la pantalla Pagos.
--
-- Esquemas (Principio VII), verificados objeto por objeto:
--   public.listar_pagos      public (nueva RPC)  listado de lectura; vive en `public` como las
--                                                demás RPC de lectura.
--   dominio.cobros_comprobante
--                            dominio (existente) los pagos: solo los que tienen cuenta de cobro.
--   dominio.comprobantes_venta
--                            dominio (existente) la factura pagada: número, total y estado.
--   dominio.empresas         dominio (existente) la tienda del pago.
--   dominio.cuentas_cobro    dominio (existente) la cuenta del pago.
--   public.clientes          public (existente)  el nombre del cliente.
-- Sin tablas nuevas: esta migración no crea ni altera columnas de ninguna tabla.
--
-- Reglas del listado (FR-023):
-- · Solo pagos CON CUENTA DE COBRO: lo que no tiene cuenta (efectivo) no se concilia contra un
--   banco y no aparece en Pagos (decisión 5 de la spec).
-- · `security invoker`: manda la RLS de `dominio.cobros_comprobante` (organización, empresa
--   accesible y `ventas` en lectura o edición). Además el listado repite los filtros de
--   organización y de empresa accesible: una tienda ajena devuelve CERO filas, no un error que
--   delate su existencia.
-- · Filtros: por empresa (`p_empresa_id`), por cuenta de cobro (`p_cuenta_cobro_id`) y «Solo con
--   saldo» (`p_solo_con_saldo`: el comprobante del pago todavía debe saldo).
-- · Paginación en el servidor: `p_pagina`/`p_tamano` (tope de 200 por página) y `filas` con el
--   total del filtro actual, que es el «de N» de la paginación de la pantalla.
-- · Columnas: Fecha, Tienda, Comprobante, Cliente, Cuenta de cobro, Importe, Aprobado por,
--   Conciliado y Saldo del comprobante (el saldo va con el importe del pago, no con el total de
--   la factura: es lo que le queda al cliente).
--
-- Sobre el nombre del cliente: `public.clientes` tiene su propia RLS por sección (Clientes). Un
-- rol con Ventas pero sin Clientes (Depósito) NO ve las filas de `public.clientes`: por eso el
-- JOIN es LEFT y el nombre puede venir vacío. El pago NO se filtra por esto (la fila del pago es
-- de Ventas); lo que no se puede leer, no se muestra.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.listar_pagos(uuid, uuid, boolean, integer, integer);

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
         greatest(c.total_con_iva - coalesce(s.cobrado, 0), 0),
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
   where b.organizacion_id = (select private.organizacion_id())
     and b.empresa_id in (select private.empresas_accesibles())
     and b.cuenta_cobro_id is not null
     and (p_empresa_id is null or b.empresa_id = p_empresa_id)
     and (p_cuenta_cobro_id is null or b.cuenta_cobro_id = p_cuenta_cobro_id)
     and (not coalesce(p_solo_con_saldo, false)
          or greatest(c.total_con_iva - coalesce(s.cobrado, 0), 0) > 0)
   order by b.registrado_en desc, b.id desc
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

revoke execute on function public.listar_pagos(uuid, uuid, boolean, integer, integer) from public, anon;
grant execute on function public.listar_pagos(uuid, uuid, boolean, integer, integer) to authenticated;

comment on function public.listar_pagos(uuid, uuid, boolean, integer, integer) is
  'Pagos con cuenta de cobro para la pantalla Pagos (F-VTA-13, FR-023): filtros por empresa y por cuenta, «Solo con saldo», paginación en el servidor y el saldo del comprobante. Solo lectura (RLS de dominio).';
