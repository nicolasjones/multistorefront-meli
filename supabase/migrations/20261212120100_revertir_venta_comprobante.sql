-- F-VTA-11 (MSF-377, épica MSF-177, FR-041): `private.revertir_venta_comprobante`, la reversión de lo que movió una
-- factura confirmada, y dos ayudas compartidas con la nota de crédito (motivo de sistema y nombre del actor).
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.existencias(_deposito)`, `dominio.movimientos_stock`,
-- `dominio.reservas_stock` y `dominio.motivos_movimiento` (todas `dominio`), por el motor de stock
-- `private.aplicar_movimiento_deposito` (la misma rutina que usó `confirmar_comprobante`).
--
-- Qué revierte (FR-041), localizando lo que dejó `confirmar_comprobante` por las LÍNEAS del comprobante:
--   · línea de stock: una ENTRADA al MISMO depósito por la cantidad de la salida, motivo de sistema «Anulación de
--     factura» (la salida de la confirmación no guarda referencia: se reconstruye desde la línea, que no cambia
--     después de confirmar);
--   · línea «A pedido» con reserva ACTIVA (`referencia = 'comprobante:<id>:linea:<orden>'`): se LIBERA (el reservado
--     vuelve, la cantidad no cambia);
--   · línea «A pedido» con reserva ya DESCONTADA por la entrega (MSF-135): la mercadería salió, vuelve con una entrada;
--   · reserva ya liberada o inexistente: nada.
-- Todo o nada (la transacción de la RPC que la llama) e idempotente: si la factura ya tiene `anulado_en`, no hace nada
-- (los bloqueos `for update` de la factura y del producto impiden la doble reversión). Los bloqueos de existencias se
-- toman siempre en el orden (producto, depósito, línea), igual que la confirmación.
--
-- Seguridad: `security definer`, `search_path = ''`; la organización y el actor salen de la sesión. No ejecutable por
-- `authenticated`: solo la llama `anular_comprobante`.
--
-- Migración aditiva. Reversión (migración posterior; las anulaciones hechas no se deshacen solas):
--   drop function private.revertir_venta_comprobante(uuid);
--   drop function private.nombre_actor_stock(uuid);
--   drop function private.motivo_sistema_movimiento(uuid, text, text);

-- Motivo de sistema de stock, una vez por organización (dato, no tabla). Falla claro si existe uno del mismo nombre
-- inactivo o que no aplica al tipo pedido.
create or replace function private.motivo_sistema_movimiento(p_organizacion_id uuid, p_nombre text, p_aplica text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
  values (p_organizacion_id, p_nombre, array[p_aplica])
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
  select m.id into v_id
    from dominio.motivos_movimiento m
   where m.organizacion_id = p_organizacion_id and lower(btrim(m.nombre)) = lower(p_nombre)
     and m.activo and p_aplica = any (m.aplica_a);
  if v_id is null then
    raise exception 'El motivo «%» existe pero está inactivo o no aplica a %: activalo o corregilo en Motivos de movimiento',
      p_nombre, case p_aplica when 'entrada' then 'entradas' else 'salidas' end
      using errcode = '22023';
  end if;
  return v_id;
end;
$$;

revoke execute on function private.motivo_sistema_movimiento(uuid, text, text) from public, anon, authenticated;

create or replace function private.nombre_actor_stock(p_actor uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = p_actor;
$$;

revoke execute on function private.nombre_actor_stock(uuid) from public, anon, authenticated;

create or replace function private.revertir_venta_comprobante(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_linea record;
  v_reserva dominio.reservas_stock;
  v_motivo uuid;
  v_nombre_actor text;
  v_saldo integer;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para revertir una venta' using errcode = '42501';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.tipo <> 'factura' then
    raise exception 'La factura no existe' using errcode = 'P0002';
  end if;
  -- Idempotente: una factura ya anulada no se revierte dos veces.
  if v_c.anulado_en is not null then
    return;
  end if;

  v_motivo := private.motivo_sistema_movimiento(v_org, 'Anulación de factura', 'entrada');
  v_nombre_actor := private.nombre_actor_stock(v_actor);

  for v_linea in
    select l.orden, l.producto_id, l.deposito_id, l.cantidad, l.a_pedido
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_c.id and l.organizacion_id = v_org
     order by l.producto_id, l.deposito_id, l.orden
  loop
    v_reserva := null;
    if v_linea.a_pedido then
      -- Mismo orden de bloqueos que liberar_reserva: primero el producto, después la reserva.
      perform 1 from dominio.existencias e
       where e.producto_id = v_linea.producto_id and e.organizacion_id = v_org
       for update;
      select r.* into v_reserva
        from dominio.reservas_stock r
       where r.organizacion_id = v_org
         and r.referencia = 'comprobante:' || v_c.id || ':linea:' || v_linea.orden
       for update;
      -- Sin reserva, o ya liberada: la línea no movió stock que devolver.
      if not found or v_reserva.estado = 'liberada' then
        continue;
      end if;
    end if;

    if v_linea.a_pedido and v_reserva.estado = 'activa' then
      -- «A pedido» vigente: se libera el reservado; la cantidad no cambia.
      perform private.aplicar_movimiento_deposito(v_org, v_reserva.producto_id, v_reserva.deposito_id, 0, -v_reserva.cantidad, false);
      update dominio.reservas_stock
         set estado = 'liberada', resuelto_en = now(), updated_at = now()
       where id = v_reserva.id;
    else
      -- Salida de la confirmación (o reserva ya descontada por la entrega): vuelve al MISMO depósito.
      v_saldo := private.aplicar_movimiento_deposito(v_org, v_linea.producto_id, v_linea.deposito_id, v_linea.cantidad, 0, true);
      insert into dominio.movimientos_stock
        (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
         actor_id, actor_nombre, deposito_id)
      values
        (v_org, v_linea.producto_id, 'entrada', v_linea.cantidad, v_linea.cantidad, v_saldo, v_motivo,
         left('Anulación de la factura ' || v_c.numero, 500), current_date, v_actor, v_nombre_actor, v_linea.deposito_id);
    end if;
  end loop;
end;
$$;

revoke execute on function private.revertir_venta_comprobante(uuid) from public, anon, authenticated;

comment on function private.revertir_venta_comprobante(uuid) is
  'Revierte lo que movió una factura confirmada: entrada al mismo depósito por cada salida y liberación de las reservas «A pedido» (F-VTA-11, FR-041). Todo o nada, idempotente. Solo la llama anular_comprobante.';
