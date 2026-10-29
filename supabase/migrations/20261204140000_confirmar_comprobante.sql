-- F-VTA-07 (MSF-317, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-030…FR-035):
-- `public.confirmar_comprobante`, la confirmación de una factura que descuenta stock por depósito y reserva
-- las líneas «A pedido».
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` (estado y `confirmado_*`),
-- y por el motor de stock (MSF-292) `dominio.existencias(_deposito)`, `dominio.movimientos_stock` y
-- `dominio.reservas_stock` (todas `dominio`) y, por `private.registrar_actividad`, `public.registro_actividad`.
-- Crea una vez por organización el motivo de sistema «Venta de factura» (dato, no tabla).
--
-- Motor de stock: se usa `private.aplicar_movimiento_deposito` (la misma rutina que `registrar_movimiento_stock`,
-- `reservar_stock` y `descontar_reserva`): serializa por producto, bloquea sobre el DISPONIBLE del depósito y
-- mantiene el total = suma por depósito. No se llaman las RPC públicas porque exigen `stock` en `edicion` y un
-- vendedor confirma con `ventas` en `edicion`; la autoridad acá es el permiso de ventas en la empresa del
-- comprobante, y la organización y el actor salen de la sesión, nunca de un argumento.
--
-- Comportamiento:
--   · Solo `factura` en `borrador` con ≥ 1 línea (FR-030). Un presupuesto nunca confirma ni mueve stock (FR-033).
--   · Línea de stock: SALIDA del depósito de la línea por su cantidad, motivo «Venta de factura», nota con el
--     número del comprobante (FR-031). Línea «A pedido»: RESERVA activa en su depósito, SIN descontar, con
--     `referencia = 'comprobante:<id>:linea:<orden>'` para que la entrega (MSF-135) la encuentre (FR-032).
--   · Todo o nada (FR-034): cualquier faltante aborta la transacción entera, con producto y depósito en el
--     mensaje (P0001). Las líneas se recorren por (producto, depósito) para tomar los bloqueos siempre en el
--     mismo orden, y el comprobante se toma `for update`: dos confirmaciones simultáneas no descuentan dos veces
--     ni dejan stock negativo.
--   · Idempotente (FR-035): reintentar sobre una `confirmada` devuelve el comprobante sin tocar el stock.
--     Confirma → estado `confirmada`, `confirmado_en/por`, evento `comprobante.confirmado`.
--
-- Errores: 42501 permiso · P0002 no existe · 22023 dato inválido (presupuesto, sin líneas, depósito inactivo)
-- · 55000 documento cerrado (anulada u otro estado) · P0001 sin stock suficiente.
-- `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
--
-- Migración aditiva. Reversión (migración posterior; las confirmaciones hechas NO se deshacen solas: anular
-- con la nota de crédito de la épica o ajustar el stock a mano):
--   drop function public.confirmar_comprobante(uuid);
--   (el motivo «Venta de factura» es dato: se desactiva, no se borra, si hay movimientos.)

create or replace function public.confirmar_comprobante(p_id uuid)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_linea record;
  v_motivo uuid;
  v_nombre_actor text;
  v_saldo integer;
  v_disponible integer;
  v_lineas integer := 0;
  v_procesadas integer := 0;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para confirmar comprobantes' using errcode = '42501';
  end if;

  -- Serializa las confirmaciones del mismo comprobante: la segunda espera y ve `confirmada`.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede confirmar comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no se confirma: solo las facturas descuentan o reservan stock'
      using errcode = '22023';
  end if;
  -- Idempotencia (FR-035): un reintento no duplica movimientos.
  if v_c.estado = 'confirmada' then
    return v_c;
  end if;
  if v_c.estado <> 'borrador' then
    raise exception 'La factura ya está cerrada y no se puede confirmar' using errcode = '55000';
  end if;

  select count(*)::int into v_lineas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org;
  if v_lineas = 0 then
    raise exception 'La factura no tiene productos: agregá al menos uno para confirmarla' using errcode = '22023';
  end if;

  -- Motivo de sistema, una vez por organización (solo para salidas).
  insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
  values (v_org, 'Venta de factura', '{salida}')
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
  select m.id into v_motivo
    from dominio.motivos_movimiento m
   where m.organizacion_id = v_org and lower(btrim(m.nombre)) = lower('Venta de factura')
     and m.activo and 'salida' = any (m.aplica_a);
  -- Un motivo del mismo nombre creado a mano (inactivo o sin `salida`) no sirve: se falla claro, no se reutiliza mal.
  if v_motivo is null then
    raise exception 'El motivo «Venta de factura» existe pero está inactivo o no aplica a salidas: activalo o corregilo en Motivos de movimiento'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_nombre_actor
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  -- Orden fijo (producto, depósito, línea): los bloqueos de existencias se toman siempre igual.
  for v_linea in
    select l.id, l.orden, l.producto_id, l.deposito_id, l.cantidad, l.a_pedido,
           p.nombre as producto, d.nombre as deposito, d.activo as deposito_activo
      from dominio.comprobantes_venta_lineas l
      join dominio.productos p on p.id = l.producto_id and p.organizacion_id = l.organizacion_id
      join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
     where l.comprobante_id = v_c.id and l.organizacion_id = v_org
     order by l.producto_id, l.deposito_id, l.orden
  loop
    if not v_linea.deposito_activo then
      raise exception 'El depósito % está inactivo: elegí otro para %', v_linea.deposito, v_linea.producto
        using errcode = '22023';
    end if;

    -- Solo el motor de stock captura el faltante: un check de movimientos o reservas es un bug real y se propaga.
    begin
      if v_linea.a_pedido then
        -- «A pedido»: reserva, no descuenta (la entrega la descuenta, MSF-135).
        perform private.aplicar_movimiento_deposito(v_org, v_linea.producto_id, v_linea.deposito_id, 0, v_linea.cantidad, false);
      else
        v_saldo := private.aplicar_movimiento_deposito(
          v_org, v_linea.producto_id, v_linea.deposito_id, -v_linea.cantidad, 0, true);
      end if;
    exception when check_violation then
      -- Faltante: mensaje con producto y depósito; al propagarse revierte la transacción entera (FR-034).
      select greatest(x.cantidad - x.reservado, 0) into v_disponible
        from dominio.existencias_deposito x
       where x.producto_id = v_linea.producto_id and x.deposito_id = v_linea.deposito_id;
      raise exception 'No hay stock suficiente de % en el depósito %: hay % y la factura pide %',
        v_linea.producto, v_linea.deposito, coalesce(v_disponible, 0), v_linea.cantidad
        using errcode = 'P0001', hint = 'stock';
    end;

    if v_linea.a_pedido then
      insert into dominio.reservas_stock
        (organizacion_id, producto_id, deposito_id, cantidad, referencia, responsable_id, responsable_nombre)
      values
        (v_org, v_linea.producto_id, v_linea.deposito_id, v_linea.cantidad,
         'comprobante:' || v_c.id || ':linea:' || v_linea.orden, v_actor, v_nombre_actor);
    else
      insert into dominio.movimientos_stock
        (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
         actor_id, actor_nombre, deposito_id)
      values
        (v_org, v_linea.producto_id, 'salida', v_linea.cantidad, -v_linea.cantidad, v_saldo, v_motivo,
         left('Factura ' || v_c.numero, 500), current_date, v_actor, v_nombre_actor, v_linea.deposito_id);
    end if;
    v_procesadas := v_procesadas + 1;
  end loop;

  -- Defensa: si un join dejó fuera una línea (FK suelta), no se confirma sin mover su stock.
  if v_procesadas <> v_lineas then
    raise exception 'La factura tiene % líneas pero solo se pudieron procesar %: revisá producto y depósito de cada una', v_lineas, v_procesadas
      using errcode = '22023';
  end if;

  update dominio.comprobantes_venta
     set estado = 'confirmada',
         confirmado_en = now(),
         confirmado_por = v_actor,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.confirmado',
    format('Confirmó la factura %s: %s %s', v_fila.numero, v_lineas, case when v_lineas = 1 then 'línea' else 'líneas' end),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

revoke execute on function public.confirmar_comprobante(uuid) from public, anon;
grant execute on function public.confirmar_comprobante(uuid) to authenticated;

comment on function public.confirmar_comprobante(uuid) is
  'Confirma una factura en borrador (F-VTA-07): salida de stock por línea y depósito, reserva de líneas «A pedido», todo o nada e idempotente. Exige ventas en edición en la empresa del comprobante. Contrato en docs/ventas-comprobantes.md.';
