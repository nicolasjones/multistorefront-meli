-- F-CLI-19 / F-VTA-12 (MSF-450 ∩ MSF-195): el saldo de un comprobante pasa a RESTAR sus notas de crédito.
--
-- Hallazgo de la revisión independiente de #848: la cuenta corriente restaba las notas, pero `saldo_comprobante`
-- —que alimenta el detalle del comprobante, el tope al registrar un cobro y el importe de un contrarreembolso—
-- seguía siendo `total − cobros`. Una factura de 1.000 con una nota de 300 mostraba 700 en la ficha del cliente,
-- 1.000 en el comprobante y dejaba cobrar 1.000 (el cliente pagaba 300 de más). Ahora hay un solo cálculo.
--
-- Regla (la misma de 20270227110000 y 20270227130000): saldo = round(max(total − cobrado − notas de crédito, 0), 2),
-- con las notas que cuelgan de la factura (`comprobante_origen_id`), del mismo cliente y organización, y que cuentan
-- según `private.comprobante_cuenta_como_facturado` (hoy: ni `borrador` ni `anulada`). Sigue sin haber saldo a favor.
--
-- · `private.saldo_comprobante` y `public.saldo_comprobante` devuelven una columna nueva, `notas_credito`
--   (total, cobrado, notas_credito, saldo). Cambia la forma de la respuesta: se recrean (drop + create). Sus
--   consumidores leen por nombre (`v_saldo.saldo`, `s.cobrado`, la RPC desde la app), no por posición.
-- · Efectos: el tope de `registrar_cobro` es el saldo neto; la factura pasa a «Cobrado» cuando el saldo neto llega a
--   0; el contrarreembolso abre por el saldo neto. Una nota emitida DESPUÉS de cobrar no devuelve plata: el saldo
--   queda en 0 (sin saldo a favor) y el estado no cambia.
-- · `public.cuenta_corriente_cliente` deja de calcular las notas por su cuenta y usa `private.saldo_comprobante`.
-- · `private.saldo_comprobante` sigue siendo VOLÁTIL (ve el cobro recién insertado).
--
-- Reversión (en una migración posterior; incluye `revoke execute on function private.comprobante_cuenta_como_facturado(text, text) from authenticated`): volver a las definiciones de 20270114100100_saldo_y_lectura_cobros.sql
-- (`drop function` + `create` de las dos `saldo_comprobante`) y de 20270227130000 para `cuenta_corriente_cliente`.

-- ============================================================================
-- Regla compartida de «qué nota cuenta»
-- ============================================================================
-- `public.saldo_comprobante` es `security invoker` (manda la RLS de `dominio`) y llama a este predicado, que es una
-- función pura sobre dos textos (no lee datos): se le da execute a `authenticated`, como a `private.organizacion_id()`,
-- `private.empresas_accesibles()` y `private.nivel_seccion()`. Sin esto la lectura fallaba con «permission denied».
grant execute on function private.comprobante_cuenta_como_facturado(text, text) to authenticated;

-- ============================================================================
-- Saldo interno
-- ============================================================================
drop function if exists private.saldo_comprobante(uuid);

create function private.saldo_comprobante(p_id uuid)
returns table (total numeric, cobrado numeric, notas_credito numeric, saldo numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_c record;
  v_total numeric(14, 2);
  v_cobrado numeric(14, 2);
  v_notas numeric(14, 2);
begin
  select c.total_con_iva, c.organizacion_id, c.cliente_id into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  v_total := v_c.total_con_iva;

  select coalesce(sum(b.importe), 0) into v_cobrado
    from dominio.cobros_comprobante b
   where b.comprobante_id = p_id;

  select coalesce(sum(n.total_con_iva), 0) into v_notas
    from dominio.comprobantes_venta n
   where n.organizacion_id = v_c.organizacion_id
     and n.comprobante_origen_id = p_id
     and n.tipo = 'nota_credito'
     and n.cliente_id = v_c.cliente_id
     and private.comprobante_cuenta_como_facturado(n.tipo, n.estado);

  total := v_total;
  cobrado := v_cobrado;
  notas_credito := v_notas;
  saldo := round(greatest(v_total - v_cobrado - v_notas, 0), 2);
  return query select total, cobrado, notas_credito, saldo;
end;
$$;

revoke execute on function private.saldo_comprobante(uuid) from public, anon, authenticated;

comment on function private.saldo_comprobante(uuid) is
  'Saldo del comprobante (total con IVA, cobrado, notas de crédito y saldo = total − cobrado − notas, mínimo 0). Función interna: no la ejecuta authenticated.';

-- ============================================================================
-- Saldo para la pantalla
-- ============================================================================
drop function if exists public.saldo_comprobante(uuid);

create function public.saldo_comprobante(p_id uuid)
returns table (total numeric, cobrado numeric, notas_credito numeric, saldo numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver el saldo del comprobante' using errcode = '42501';
  end if;

  return query
  select c.total_con_iva,
         cb.cobrado,
         nc.importe,
         round(greatest(c.total_con_iva - cb.cobrado - nc.importe, 0), 2)
    from dominio.comprobantes_venta c
    cross join lateral (
      select coalesce(sum(b.importe), 0) as cobrado
        from dominio.cobros_comprobante b
       where b.comprobante_id = c.id
         and b.organizacion_id = c.organizacion_id
         and b.empresa_id in (select private.empresas_accesibles())
    ) cb
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
   where c.id = p_id
     and c.organizacion_id = (select private.organizacion_id())
     and c.empresa_id in (select private.empresas_accesibles());

  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.saldo_comprobante(uuid) from public, anon;
grant execute on function public.saldo_comprobante(uuid) to authenticated;

comment on function public.saldo_comprobante(uuid) is
  'Saldo del comprobante para la pantalla de ventas: total con IVA, cobrado, notas de crédito y saldo (total − cobrado − notas, mínimo 0). Solo lectura (RLS de dominio).';

-- ============================================================================
-- Cuenta corriente: un solo cálculo
-- ============================================================================
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
           s.notas_credito,
           s.saldo
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
