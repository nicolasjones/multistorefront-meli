-- F-SVC-10 (MSF-390, épica MSF-217, FR-007, FR-010): `private.mover_stock_reparacion`, el efecto en stock de un
-- repuesto de reparación.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.existencias(_deposito)` y `dominio.movimientos_stock`
-- (`dominio`) por `private.aplicar_movimiento_deposito` (F-STK-14), con el motivo de sistema «Repuesto de
-- reparación» (salida) o «Devolución de repuesto de reparación» (entrada).
--
-- Por qué no `public.registrar_movimiento_stock`: exige `edicion` en Stock y un motivo elegido; el técnico de Service
-- no tiene Stock. Se sigue el camino de las notas de crédito y el despacho: la barrera es la de
-- `aplicar_movimiento_deposito` (serializa por producto, «No hay stock suficiente» `23514` sin rastro).
--
-- Idempotencia: `referencia = 'reparacion:<id>:item:<item>:salida|devolucion'` (índice único parcial del libro).
-- Si la referencia ya existe no mueve nada y devuelve falso. La devuelve al depósito indicado aunque esté inactivo
-- (la mercadería vuelve físicamente ahí). La usan F-SVC-10 (salida) y las historias de devolución y pendiente.
--
-- Seguridad: `security definer`, `search_path = ''`; sin `grant` a `authenticated`.
--
-- Migración aditiva. Reversión (migración posterior; los movimientos hechos no se deshacen solos):
--   drop function private.mover_stock_reparacion(uuid, uuid, uuid, uuid, uuid, integer, text);

create or replace function private.mover_stock_reparacion(
  p_organizacion uuid,
  p_reparacion uuid,
  p_item uuid,
  p_producto uuid,
  p_deposito uuid,
  p_cantidad integer,
  p_sentido text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_referencia text;
  v_salida boolean := p_sentido = 'salida';
  v_motivo uuid;
  v_saldo integer;
  v_codigo text;
begin
  if p_sentido is null or p_sentido not in ('salida', 'entrada') then
    raise exception 'El sentido debe ser salida o entrada' using errcode = '22023';
  end if;
  if p_cantidad is null or p_cantidad < 1 then
    raise exception 'La cantidad debe ser un entero mayor a cero' using errcode = '22023';
  end if;

  v_referencia := format('reparacion:%s:item:%s:%s', p_reparacion, p_item,
    case when v_salida then 'salida' else 'devolucion' end);
  if exists (select 1 from dominio.movimientos_stock m
              where m.organizacion_id = p_organizacion and m.origen = 'service' and m.referencia = v_referencia) then
    return false;
  end if;

  v_motivo := private.motivo_sistema_movimiento(p_organizacion,
    case when v_salida then 'Repuesto de reparación' else 'Devolución de repuesto de reparación' end,
    p_sentido);

  v_saldo := private.aplicar_movimiento_deposito(p_organizacion, p_producto, p_deposito,
    case when v_salida then -p_cantidad else p_cantidad end, 0, true);

  select private.codigo_reparacion(r.numero) into v_codigo
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = p_organizacion;

  insert into dominio.movimientos_stock
    (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
     actor_id, actor_nombre, deposito_id, origen, reparacion_id, referencia)
  values
    (p_organizacion, p_producto, p_sentido, p_cantidad, case when v_salida then -p_cantidad else p_cantidad end,
     v_saldo, v_motivo, left('Reparación ' || coalesce(v_codigo, p_reparacion::text), 500), current_date,
     v_actor, private.nombre_actor_stock(v_actor), p_deposito, 'service', p_reparacion, v_referencia);

  return true;
end;
$$;

revoke execute on function private.mover_stock_reparacion(uuid, uuid, uuid, uuid, uuid, integer, text)
  from public, anon, authenticated;

comment on function private.mover_stock_reparacion(uuid, uuid, uuid, uuid, uuid, integer, text) is
  'F-SVC-10: salida (o devolución) de stock de un repuesto de reparación, idempotente por referencia. Solo la llaman las RPC de ítems.';
