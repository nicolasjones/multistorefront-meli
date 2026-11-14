-- MSF-176 · Tienda compra y cuentas, historia A «Mi cuenta» (F-CLI-20 · MSF-452), T012. FR-003 a FR-006, FR-014, D-10.
--
-- Esquemas (Principio VII, re-verificado):
--   * publico.mis_compras_por_dominio / mi_compra_por_dominio -> `publico` (superficie de la tienda; `publico` sigue SIN
--     tablas). Leen `dominio.comprobantes_venta` y `dominio.comprobantes_venta_lineas` (existentes, con su RLS de panel) como
--     `security definer`, acotadas por la cuenta de la sesión.
--   * private.estado_publico_comprobante -> `private`: lógica interna sin datos, sin acceso de API.
--   * dominio.comprobantes_venta (tabla existente): solo un índice de apoyo aditivo `(cliente_id, empresa_id, fecha desc,
--     id desc)`; sin cambios de columnas, RLS ni grants.
--
-- Qué ve el cliente (D-10): TODOS sus comprobantes de ESA tienda, de cualquier canal (mostrador, teléfono o tienda online),
-- sin borradores, con estado público simplificado (nunca los estados de cobro ni de despacho), total con IVA y, en el detalle,
-- las líneas (descripción, código, cantidad, precio unitario, subtotal). Lista blanca de campos probada por claves: nunca
-- costos, márgenes, descuento, precio manual, depósito, operador, notas, cliente, organización, forma de pago, envío ni cobros.
--
-- Estado público (FR-004). Presupuesto: `pendiente` (con valido_hasta ≥ hoy o nulo) → pendiente; con valido_hasta < hoy
-- (`private.hoy_argentina()`) → vencido; `aceptado` → aceptado; `anulada` → anulado. Factura en cualquier estado confirmado o
-- posterior (confirmada, cobrado, deuda, en_proceso, armando, incompleto) → confirmada; `anulada` → anulada. Nota de crédito →
-- nota_credito (su importe va con signo negativo).
--
-- Aislamiento (FR-006, amenazas 3.1-3.6): ninguna recibe cliente, cuenta, empresa ni organización; todo sale de
-- `private.cuenta_de_tienda`. El comprobante pedido debe tener el cliente y la empresa de la cuenta; si no, la respuesta es
-- `no_encontrada`, idéntica a la de un id inexistente. El cursor (fecha, id) solo ordena, nunca autoriza.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists publico.mis_compras_por_dominio(text, date, uuid, integer);
--   drop function if exists publico.mi_compra_por_dominio(text, uuid);
--   drop function if exists private.estado_publico_comprobante(text, text, date);
--   drop index if exists dominio.comprobantes_venta_cliente_empresa_fecha_idx;

-- Índice de apoyo del historial: lista por (cliente, tienda) ordenada por fecha e id, nuevos primero.
create index if not exists comprobantes_venta_cliente_empresa_fecha_idx
  on dominio.comprobantes_venta (cliente_id, empresa_id, fecha desc, id desc);

-- ============================================================================
-- Estado público derivado: única definición, para la lista y el detalle
-- ============================================================================
create or replace function private.estado_publico_comprobante(p_tipo text, p_estado text, p_valido_hasta date)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_tipo
    when 'presupuesto' then
      case
        when p_estado = 'anulada' then 'anulado'
        when p_estado = 'pendiente' then
          case when p_valido_hasta is not null and p_valido_hasta < private.hoy_argentina() then 'vencido' else 'pendiente' end
        else 'aceptado'
      end
    when 'factura' then
      case when p_estado = 'anulada' then 'anulada' else 'confirmada' end
    when 'nota_credito' then 'nota_credito'
  end;
$$;

revoke execute on function private.estado_publico_comprobante(text, text, date) from public, anon, authenticated;

comment on function private.estado_publico_comprobante(text, text, date) is
  'MSF-176 (FR-004): estado público simplificado de un comprobante (pendiente|vencido|aceptado|anulado para presupuestos; confirmada|anulada para facturas; nota_credito). Nunca expone cobro ni despacho. Interna.';

-- ============================================================================
-- «Compras y presupuestos»: lista con carga infinita
-- ============================================================================
create or replace function publico.mis_compras_por_dominio(
  host text,
  desde_fecha date default null,
  desde_id uuid default null,
  limite integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_cuenta record;
  v_limite integer := least(greatest(coalesce(limite, 20), 1), 50);
  v_total bigint;
  v_filas jsonb;
  v_siguiente jsonb;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- El cursor (fecha, id) solo ordena (siguientes filas con (fecha, id) < cursor); la consulta siempre filtra por el cliente y
  -- la empresa de la cuenta. Sin borradores. Un cursor a medias (solo uno de sus dos valores) se ignora.
  with base as (
    select c.id, c.numero, c.fecha, c.tipo, c.estado, c.valido_hasta, c.total_con_iva
      from dominio.comprobantes_venta c
     where c.cliente_id = v_cuenta.cliente_id
       and c.empresa_id = v_cuenta.empresa_id
       and c.organizacion_id = v_cuenta.organizacion_id
       and c.estado <> 'borrador'
  ),
  pagina as (
    select b.*
      from base b
     where desde_fecha is null or desde_id is null or (b.fecha, b.id) < (desde_fecha, desde_id)
     order by b.fecha desc, b.id desc
     limit v_limite + 1
  ),
  numerada as (
    select p.*, row_number() over (order by p.fecha desc, p.id desc) as n
      from pagina p
  )
  select (select count(*) from base),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', nu.id,
             'numero', nu.numero,
             'fecha', nu.fecha,
             'tipo', case nu.tipo when 'factura' then 'compra' else nu.tipo end,
             'estado_publico', private.estado_publico_comprobante(nu.tipo, nu.estado, nu.valido_hasta),
             'total_con_iva', case when nu.tipo = 'nota_credito' then -nu.total_con_iva else nu.total_con_iva end
           ) order by nu.n) filter (where nu.n <= v_limite), '[]'::jsonb),
         (select jsonb_build_object('fecha', u.fecha, 'id', u.id)
            from numerada u
           where u.n = v_limite and exists (select 1 from numerada s where s.n = v_limite + 1))
    into v_total, v_filas, v_siguiente
    from numerada nu;

  return jsonb_build_object('estado', 'ok', 'total', v_total, 'filas', v_filas, 'siguiente', v_siguiente);
exception when others then
  raise warning 'mis_compras_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.mis_compras_por_dominio(text, date, uuid, integer) from public, anon;
grant execute on function publico.mis_compras_por_dominio(text, date, uuid, integer) to authenticated;

comment on function publico.mis_compras_por_dominio(text, date, uuid, integer) is
  'MSF-176 (FR-003, FR-004): comprobantes (sin borradores, cualquier canal) del cliente de la cuenta activa en la tienda del host, nuevos primero (fecha desc, id desc), cursor (desde_fecha, desde_id) que solo ordena, límite 1–50. Lista blanca: id, numero, fecha, tipo (compra|presupuesto|nota_credito), estado_publico, total_con_iva (negativo en notas de crédito). siguiente = {fecha, id} o null.';

-- ============================================================================
-- Detalle de un comprobante propio
-- ============================================================================
create or replace function publico.mi_compra_por_dominio(host text, comprobante_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_cuenta record;
  v_c record;
  v_signo integer;
  v_lineas jsonb;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- Del cliente y de la tienda de la cuenta, y sin borradores. Otro cliente, otra tienda, otra organización, un borrador y un
  -- id inexistente (o nulo) dan la MISMA respuesta (IDOR).
  select c.id, c.numero, c.fecha, c.tipo, c.estado, c.valido_hasta, c.total_sin_iva, c.total_con_iva
    into v_c
    from dominio.comprobantes_venta c
   where c.id = comprobante_id
     and c.cliente_id = v_cuenta.cliente_id
     and c.empresa_id = v_cuenta.empresa_id
     and c.organizacion_id = v_cuenta.organizacion_id
     and c.estado <> 'borrador';
  if not found then
    return jsonb_build_object('estado', 'no_encontrada');
  end if;

  v_signo := case when v_c.tipo = 'nota_credito' then -1 else 1 end;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'descripcion', l.descripcion,
             'codigo', l.codigo,
             'cantidad', l.cantidad,
             'precio_unitario', l.precio_unitario,
             'subtotal', l.subtotal_sin_iva
           ) order by l.orden), '[]'::jsonb)
    into v_lineas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_cuenta.organizacion_id;

  return jsonb_build_object(
    'estado', 'ok',
    'numero', v_c.numero,
    'fecha', v_c.fecha,
    'tipo', case v_c.tipo when 'factura' then 'compra' else v_c.tipo end,
    'estado_publico', private.estado_publico_comprobante(v_c.tipo, v_c.estado, v_c.valido_hasta),
    'valido_hasta', case when v_c.tipo = 'presupuesto' then v_c.valido_hasta end,
    'total_sin_iva', v_signo * v_c.total_sin_iva,
    'iva', v_signo * (v_c.total_con_iva - v_c.total_sin_iva),
    'total_con_iva', v_signo * v_c.total_con_iva,
    'lineas', v_lineas
  );
exception when others then
  raise warning 'mi_compra_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.mi_compra_por_dominio(text, uuid) from public, anon;
grant execute on function publico.mi_compra_por_dominio(text, uuid) to authenticated;

comment on function publico.mi_compra_por_dominio(text, uuid) is
  'MSF-176 (FR-005, FR-006): detalle de un comprobante del cliente de la cuenta activa en la tienda del host. Lista blanca: numero, fecha, tipo, estado_publico, valido_hasta, total_sin_iva, iva, total_con_iva, lineas[descripcion, codigo, cantidad, precio_unitario, subtotal]. Otro cliente/tienda/organización, borrador o id inexistente → no_encontrada idéntica (IDOR). Totales negativos en notas de crédito.';
