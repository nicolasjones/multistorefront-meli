-- MSF-816 (gate MSF-834 · MSF-363 decisión 6): no se cobra una cifra que el cliente no vio.
--
-- Qué cambia (aditivo, misma firma de la RPC, mismos permisos):
--   * `private.lineas_con_promocion_desactualizada(comprobante, ahora)` cuenta las líneas cuyo precio ya no
--     es el que guardó el último guardado de líneas: la promoción que aplicaría AHORA es otra (venció, empezó
--     o se anuló) o la misma promoción cambió de precio. Es `security definer` con `search_path = ''` (lee la
--     promoción sin depender del permiso `productos`) y no se le deja ejecutar a `public`, `anon` ni
--     `authenticated`.
--   * `public.confirmar_comprobante` llama a esa guarda DESPUÉS del bloqueo del comprobante y ANTES de tocar
--     costo, stock, reservas o estado: si hay una línea desactualizada, rechaza con `40001` y
--     `hint = 'precios_cambiaron'` y la transacción no deja rastro (FR-009).
--
-- Con la bandera `promociones_precio` APAGADA la guarda no actúa: ni siquiera sobre borradores guardados con la
-- bandera encendida (conservan su precio promocional hasta el próximo guardado; al volver a encenderla, cada
-- borrador abierto con promoción se rechaza una vez y se reprecia — seguimiento operativo S6).
--
-- Lo que NO cambia: el bloqueo optimista, la idempotencia (una factura `confirmada` sale antes de la guarda),
-- el motivo de movimiento, el costo y la cotización por línea, la salida de stock y las reservas, el evento
-- `comprobante.confirmado` y el mensaje de faltante de stock.
--
-- Una línea cuyo precio no se puede calcular hoy (producto desactivado, cotización quitada, permiso perdido)
-- se OMITE de la guarda: no se rechaza la factura por una línea que no se puede repreciar.
-- No se comparan precios de lista: un cambio de lista entre el guardado y la confirmación sigue sin rechazarse,
-- igual que hoy.
--
-- Esquema (Principio VII): sin tablas nuevas ni objetos en `public`; la función auxiliar vive en `private` (no
-- almacena datos). Migración aditiva (`create or replace`, mismas firmas y grants).
-- Reversión (migración posterior): restaurar `public.confirmar_comprobante` con su definición de
-- 20270216400000 y
--   drop function private.lineas_con_promocion_desactualizada(uuid, timestamptz);
-- o, sin migrar, apagar la bandera `promociones_precio`.

-- Líneas cuyo precio de línea ya no es el guardado. Empieza por la bandera: apagada, no cuenta ninguna.
create or replace function private.lineas_con_promocion_desactualizada(p_comprobante uuid, p_ahora timestamptz default now())
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_tipo_cliente text;
  v_descuento numeric := 0;
  v_linea record;
  v_precio record;
  v_desactualizadas integer := 0;
begin
  if not (select private.bandera_activa('promociones_precio')) then
    return 0;
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante and c.organizacion_id = v_org;
  if not found then
    return 0;
  end if;

  -- Tipo de cliente y descuento: los de la ficha del cliente (como en `guardar_lineas_comprobante`).
  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
    from public.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_org;

  for v_linea in
    select l.producto_id, l.cantidad, l.precio_unitario, l.promocion_id, l.precio_manual, l.sin_stock
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = p_comprobante and l.organizacion_id = v_org
  loop
    if v_linea.precio_manual or v_linea.sin_stock or v_linea.producto_id is null then
      continue;
    end if;

    select * into v_precio
      from private.precio_linea_venta(v_linea.producto_id, v_c.empresa_id, v_tipo_cliente, v_linea.cantidad, v_descuento, p_ahora);
    if not found or v_precio.neto_unitario is null then
      -- El precio no se puede calcular hoy: la línea se omite (no se rechaza la factura).
      continue;
    end if;

    if v_precio.promocion_id is distinct from v_linea.promocion_id
       or (v_precio.promocion_id is not null and v_linea.promocion_id is not null
           and abs(v_precio.neto_unitario - v_linea.precio_unitario) > 0.005) then
      v_desactualizadas := v_desactualizadas + 1;
    end if;
  end loop;

  return v_desactualizadas;
end;
$$;

revoke execute on function private.lineas_con_promocion_desactualizada(uuid, timestamptz) from public, anon, authenticated;

comment on function private.lineas_con_promocion_desactualizada(uuid, timestamptz) is
  'MSF-816: cantidad de líneas del comprobante cuyo precio ya no es el guardado (la promoción cambió de efecto). Con la bandera promociones_precio apagada devuelve 0.';

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
  v_lineas_stock integer := 0;
  v_procesadas integer := 0;
  v_ahora timestamptz;
  v_desactualizadas integer;
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

  -- Instante de la promoción vigente, tomado DESPUÉS del bloqueo (R3c de la spec).
  v_ahora := clock_timestamp();
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

  select count(*)::int, (count(*) filter (where not l.sin_stock))::int into v_lineas, v_lineas_stock
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org;
  if v_lineas = 0 then
    raise exception 'La factura no tiene productos: agregá al menos uno para confirmarla' using errcode = '22023';
  end if;

  -- MSF-816 (FR-009): si el efecto de una promoción cambió desde el último guardado (venció, empezó o se editó),
  -- no se cobra una cifra que el cliente no vio: se rechaza ANTES de mover costo, stock o estado, y la
  -- transacción no deja rastro. Con la bandera `promociones_precio` apagada la guarda no actúa.
  v_desactualizadas := (select private.lineas_con_promocion_desactualizada(v_c.id, v_ahora));
  if v_desactualizadas > 0 then
    raise exception 'Los precios de la venta cambiaron (promoción vencida o nueva): revisá el total'
      using errcode = '40001', hint = 'precios_cambiaron';
  end if;

  -- F-REN-09 (FR-007) + MSF-352: costo en pesos y cotización del momento, por línea, con la cotización de la EMPRESA
  -- del comprobante según el alcance (`private.cotizacion_para`: la propia con alcance «empresa», la general si no
  -- tiene fila o el alcance es «sistema»). Una sola cotización por comprobante: la subconsulta nunca devuelve varias filas.
  -- Antes: F-REN-09. Corre una sola vez: un reintento sobre
  -- una `confirmada` ya salió arriba (idempotencia) y nada posterior reescribe estas columnas.
  update dominio.comprobantes_venta_lineas l
     set costo_unitario = private.a_pesos(k.costo, p.moneda, v_org, v_c.empresa_id),
         cotizacion = private.cotizacion_para(v_org, v_c.empresa_id)
    from dominio.productos p
    left join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org
     and p.id = l.producto_id and p.organizacion_id = l.organizacion_id;

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
     where l.comprobante_id = v_c.id and l.organizacion_id = v_org and not l.sin_stock
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
  if v_procesadas <> v_lineas_stock then
    raise exception 'La factura tiene % líneas con stock pero solo se pudieron procesar %: revisá producto y depósito de cada una', v_lineas_stock, v_procesadas
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
  'Confirma una factura en borrador (F-VTA-07, MSF-816): rechaza con 40001 (hint precios_cambiaron) si una promoción cambió desde el último guardado, sin mover nada; guarda costo y cotización por línea (F-REN-09) y saltea las líneas sin stock (F-SVC-13). Contrato en docs/ventas-comprobantes.md.';
