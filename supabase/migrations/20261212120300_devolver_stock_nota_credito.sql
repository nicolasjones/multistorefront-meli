-- F-VTA-11 (MSF-377, épica MSF-177, FR-044): `private.devolver_stock_nota_credito`, el efecto en stock de una nota de
-- crédito «Devolución de productos».
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.existencias(_deposito)` y `dominio.movimientos_stock`
-- (`dominio`) por `private.aplicar_movimiento_deposito`, con el motivo de sistema «Devolución de cliente».
--
-- Qué hace (FR-044): por cada línea de la nota, una ENTRADA al depósito de origen de la línea (el que descontó la
-- venta). «Devolución de importe» y «Descuento o bonificación» no tocan el stock: la función no hace nada.
-- Una línea «A pedido» solo vuelve al depósito si la entrega ya descontó su reserva (`descontada`): si la mercadería
-- nunca salió (reserva activa o liberada), no hay nada que devolver.
-- Los bloqueos de existencias se toman en el orden (producto, depósito, línea), igual que la venta.
--
-- Seguridad: `security definer`, `search_path = ''`; no ejecutable por `authenticated`: solo la llama
-- `emitir_nota_credito`, una vez por nota y en su misma transacción (todo o nada).
--
-- Migración aditiva. Reversión (migración posterior; las devoluciones hechas no se deshacen solas):
--   drop function private.devolver_stock_nota_credito(uuid);

create or replace function private.devolver_stock_nota_credito(p_nota_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_n dominio.comprobantes_venta;
  v_origen dominio.comprobantes_venta;
  v_linea record;
  v_motivo uuid;
  v_nombre_actor text;
  v_saldo integer;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para devolver stock' using errcode = '42501';
  end if;
  select * into v_n
    from dominio.comprobantes_venta c
   where c.id = p_nota_id and c.organizacion_id = v_org and c.tipo = 'nota_credito';
  if not found then
    raise exception 'La nota de crédito no existe' using errcode = 'P0002';
  end if;
  -- Sin mercadería de vuelta no hay stock que tocar.
  if v_n.nc_tipo <> 'devolucion_productos' then
    return;
  end if;
  select * into v_origen
    from dominio.comprobantes_venta c
   where c.id = v_n.comprobante_origen_id and c.organizacion_id = v_org;

  v_motivo := private.motivo_sistema_movimiento(v_org, 'Devolución de cliente', 'entrada');
  v_nombre_actor := private.nombre_actor_stock(v_actor);

  for v_linea in
    select l.orden, l.producto_id, l.deposito_id, l.cantidad, l.a_pedido
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_n.id and l.organizacion_id = v_org
     order by l.producto_id, l.deposito_id, l.orden
  loop
    if v_linea.a_pedido and not exists (
      select 1 from dominio.reservas_stock r
       where r.organizacion_id = v_org and r.estado = 'descontada'
         and r.referencia = 'comprobante:' || v_n.comprobante_origen_id || ':linea:' || v_linea.orden
    ) then
      continue;
    end if;

    v_saldo := private.aplicar_movimiento_deposito(v_org, v_linea.producto_id, v_linea.deposito_id, v_linea.cantidad, 0, true);
    insert into dominio.movimientos_stock
      (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
       actor_id, actor_nombre, deposito_id)
    values
      (v_org, v_linea.producto_id, 'entrada', v_linea.cantidad, v_linea.cantidad, v_saldo, v_motivo,
       left('Nota de crédito ' || v_n.numero || ' sobre la factura ' || v_origen.numero, 500), current_date,
       v_actor, v_nombre_actor, v_linea.deposito_id);
  end loop;
end;
$$;

revoke execute on function private.devolver_stock_nota_credito(uuid) from public, anon, authenticated;

comment on function private.devolver_stock_nota_credito(uuid) is
  'Entrada al depósito de origen de cada línea de una nota «Devolución de productos»; sin efecto para los otros tipos (F-VTA-11, FR-044). Solo la llama emitir_nota_credito.';
