-- Lote 56 (MSF-654 y MSF-655, olas de la convención de códigos de negocio mapeados a 4xx): las RPC de comprobantes de
-- venta dejan de contestar HTTP 500 cuando el comprobante no existe (`P0002`) o lo editó otra persona (`40001`).
--   · «no existe / no es de tu organización» pasa de `P0002` a `PT404` (HTTP 404), como `obtener_reparacion` (20270507180500)
--     y `aceptar_presupuesto` (20270507310000). Mismo código y mismo mensaje que antes: sin oráculo de existencia.
--   · «conflicto de edición» (bloqueo optimista por `updated_at`) pasa de `40001` a `PT412` (HTTP 412, precondición
--     fallida). Se usa un código propio y no `PT409` para que el cliente distinga «otra persona lo modificó, recargá» de
--     «el estado no admite la acción» (`PT409`, 20270507310000), que se muestran con textos distintos.
-- Funciones: guardar_comprobante, anular_comprobante, cambiar_estado_comprobante, confirmar_comprobante,
-- guardar_lineas_comprobante, obtener_comprobante, historial_comprobante, transiciones_permitidas_comprobante,
-- cobros_de_comprobante y saldo_comprobante.
--
-- Cada función parte de su definición VIGENTE (indicada sobre ella) y solo cambia el errcode de esos rechazos: mensajes,
-- cuerpo, firma, `security definer`, `search_path` y grants son los mismos (`create or replace` conserva los privilegios
-- y el comentario de la función). Quedan fuera a propósito: `55000` (estado que no admite la acción) y el `40001` con
-- hint `precios_cambiaron` de `confirmar_comprobante`, que es una señal con contrato propio (hint y detail) compartida con
-- `facturar_presupuesto` y el cliente la distingue por hint.
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar la definición vigente indicada sobre cada función
-- (en el cuerpo, `errcode = 'PT404'` vuelve a `'P0002'` y `errcode = 'PT412'` a `'40001'`). El cliente acepta los dos códigos.

-- guardar_comprobante: definición vigente en 20261203100400_comprobantes_rpc.sql
create or replace function public.guardar_comprobante(
  p_id uuid,
  p_cliente_id uuid,
  p_canal text,
  p_fecha date,
  p_valido_hasta date,
  p_forma_pago_id uuid,
  p_envio_id uuid,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para editar comprobantes' using errcode = '42501';
  end if;

  select * into v_actual
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_actual.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_actual.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- Editable: factura en borrador o presupuesto pendiente. Todo lo demás está cerrado (FR-002).
  if not ((v_actual.tipo = 'factura' and v_actual.estado = 'borrador')
       or (v_actual.tipo = 'presupuesto' and v_actual.estado = 'pendiente')) then
    raise exception 'El comprobante ya está cerrado y no se puede modificar' using errcode = '55000';
  end if;
  if p_actualizado_en is distinct from v_actual.updated_at then
    raise exception 'Otra persona modificó este comprobante. Recargalo para ver los cambios' using errcode = 'PT412';
  end if;

  -- El cliente debe ser de la organización; solo se exige que no esté archivado si cambió.
  if p_cliente_id is null
     or not exists (select 1 from dominio.clientes c where c.id = p_cliente_id and c.organizacion_id = v_org)
     or (p_cliente_id is distinct from v_actual.cliente_id and exists (
       select 1 from dominio.clientes c where c.id = p_cliente_id and c.archivado_en is not null
     )) then
    raise exception 'Elegí un cliente o Consumidor final' using errcode = '22023', hint = 'cliente_id';
  end if;
  if p_canal is null or p_canal not in ('mostrador', 'tienda_online', 'telefono_whatsapp') then
    raise exception 'Elegí el canal de venta' using errcode = '22023', hint = 'canal';
  end if;
  if p_fecha is null then
    raise exception 'Indicá la fecha' using errcode = '22023', hint = 'fecha';
  end if;
  if p_valido_hasta is not null and (v_actual.tipo <> 'presupuesto' or p_valido_hasta < p_fecha) then
    raise exception 'La validez solo aplica a presupuestos y no puede ser anterior a la fecha'
      using errcode = '22023', hint = 'valido_hasta';
  end if;
  -- Solo se revalida el catálogo si la elección cambió (una elección vieja ya guardada no bloquea el resto).
  if p_forma_pago_id is distinct from v_actual.forma_pago_id or p_envio_id is distinct from v_actual.envio_id then
    perform private.validar_catalogo_comprobante(
      v_org, v_actual.empresa_id,
      case when p_forma_pago_id is distinct from v_actual.forma_pago_id then p_forma_pago_id end,
      case when p_envio_id is distinct from v_actual.envio_id then p_envio_id end
    );
  end if;

  update dominio.comprobantes_venta
     set cliente_id = p_cliente_id,
         canal = p_canal,
         fecha = p_fecha,
         valido_hasta = p_valido_hasta,
         forma_pago_id = p_forma_pago_id,
         envio_id = p_envio_id,
         updated_at = clock_timestamp()
   where id = p_id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.editado',
    format('Editó %s %s', case v_fila.tipo when 'factura' then 'la factura' else 'el presupuesto' end, v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

-- anular_comprobante: definición vigente en 20270507180000_anular_comprobante_rechaza_entregada_y_con_cobros.sql
create or replace function public.anular_comprobante(
  p_id uuid,
  p_motivo text,
  p_actualizado_en timestamptz
)
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
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para anular comprobantes' using errcode = '42501';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if not (select private.puede_accion_comprobante(v_c.empresa_id, 'anular')) then
    raise exception 'Tu rol no puede anular comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo = 'nota_credito' then
    raise exception 'Una nota de crédito no se anula' using errcode = '22023';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no se anula: solo las facturas confirmadas' using errcode = '22023';
  end if;

  -- Idempotente: el reintento devuelve la anulación ya hecha, sin movimientos ni evento nuevos.
  if v_c.estado = 'anulada' then
    return v_c;
  end if;

  if v_motivo = '' then
    raise exception 'Escribí el motivo de la anulación' using errcode = '22023', hint = 'motivo';
  end if;
  if length(v_motivo) > 300 then
    raise exception 'El motivo de la anulación no puede superar los 300 caracteres' using errcode = '22023', hint = 'motivo';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: no movió stock, no hace falta anularla' using errcode = '55000';
  end if;
  if v_c.estado = 'cobrado' then
    raise exception 'La factura ya está cobrada: corregila con una nota de crédito' using errcode = '55000';
  end if;
  -- MSF-661: una factura ya entregada movió mercadería al cliente: anularla dejaría el stock y el despacho incoherentes.
  if v_c.estado_despacho = 'entregado' then
    raise exception 'La factura ya fue entregada: corregí con nota de crédito o RMA' using errcode = '55000';
  end if;
  -- MSF-600: con cobros registrados (aunque sean parciales, netos de reversiones) la plata cobrada quedaría huérfana.
  if (select s.cobrado from private.saldo_comprobante(v_c.id) s) > 0 then
    raise exception 'La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito' using errcode = '55000';
  end if;
  if exists (
    select 1 from dominio.comprobantes_venta n
     where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito'
  ) then
    raise exception 'La factura ya tiene una nota de crédito: corregila con otra nota de crédito' using errcode = '55000';
  end if;
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = 'PT412';
  end if;

  perform private.revertir_venta_comprobante(v_c.id);

  update dominio.comprobantes_venta
     set estado = 'anulada',
         anulado_en = now(),
         anulado_por = v_actor,
         motivo_anulacion = v_motivo,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.anulado',
    format('Anuló la factura %s: %s', v_fila.numero, v_motivo),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

-- cambiar_estado_comprobante: definición vigente en 20261212100700_cambiar_estado_comprobante.sql
create or replace function public.cambiar_estado_comprobante(
  p_id uuid,
  p_estado text,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_destino text := lower(btrim(coalesce(p_estado, '')));
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_rol text;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para cambiar el estado de un comprobante' using errcode = '42501';
  end if;

  -- «Pendiente» es la etiqueta de `confirmada` en una factura.
  if v_destino = 'pendiente' then
    v_destino := 'confirmada';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  -- La autoridad para mover estados es la matriz de transiciones del rol, no el nivel de `ventas`: Depósito tiene
  -- `ventas` en lectura y aun así pasa Aceptado → Armando. Hace falta ver la sección en la empresa del comprobante.
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede cambiar el estado de los comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no tiene estados de cobro ni de armado: solo las facturas cambian de estado' using errcode = '22023';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de cambiar su estado' using errcode = '55000';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada y ya no admite cambios de estado' using errcode = '55000';
  end if;

  if v_destino not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'El estado "%" no es un estado válido para una factura', p_estado using errcode = '22023';
  end if;

  -- Idempotente: el mismo estado devuelve el actual, sin evento ni escritura.
  if v_c.estado = v_destino then
    return v_c;
  end if;

  if v_destino in ('cobrado', 'deuda') then
    raise exception 'Cobrado y Deuda no se cambian a mano: se actualizan solos con el cobro del comprobante' using errcode = '42501';
  end if;

  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = 'PT412';
  end if;

  v_rol := (select private.rol_actor_en_empresa(v_c.empresa_id));
  if v_rol is null or not exists (
    select 1 from dominio.transiciones_estado_comprobante t
     where t.organizacion_id = v_org and t.tipo = v_c.tipo
       and t.estado_desde = v_c.estado and t.estado_hasta = v_destino and t.rol_id = v_rol
  ) then
    raise exception 'Tu rol (%) no puede pasar la factura de % a %',
      private.etiqueta_rol(v_rol),
      private.etiqueta_estado_comprobante(v_c.estado),
      private.etiqueta_estado_comprobante(v_destino)
      using errcode = '42501';
  end if;

  update dominio.comprobantes_venta
     set estado = v_destino,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.estado_cambiado',
    format('Estado: %s → %s en la factura %s',
      private.etiqueta_estado_comprobante(v_c.estado), private.etiqueta_estado_comprobante(v_destino), v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

-- confirmar_comprobante: definición vigente en 20270310100400_confirmar_comprobante_precios_vigentes.sql
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
    raise exception 'El comprobante no existe' using errcode = 'PT404';
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

  select count(*)::int, (count(*) filter (where not l.sin_stock))::int into v_lineas, v_lineas_stock
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org;
  if v_lineas = 0 then
    raise exception 'La factura no tiene productos: agregá al menos uno para confirmarla' using errcode = '22023';
  end if;

  -- MSF-816 (FR-009): guarda de precios desactualizados. El instante se toma DESPUÉS del `for update` y la guarda corre
  -- antes de tocar costos, stock o estado: el rechazo no deja rastro. Con la bandera `promociones_precio` apagada no
  -- actúa (la función auxiliar devuelve 0). Los mensajes y el `hint` son contrato con la UI (F-2).
  v_ahora := clock_timestamp();
  if (select private.lineas_con_promocion_desactualizada(v_c.id, v_ahora)) > 0 then
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

-- guardar_lineas_comprobante: definición vigente en 20270348000200_ventas_usan_lista_precios.sql
create or replace function public.guardar_lineas_comprobante(
  p_id uuid,
  p_lineas jsonb,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_tipo_cliente text;
  v_descuento numeric := 0;
  v_defecto uuid;
  v_puede_precio boolean;
  v_previas jsonb;
  v_elem jsonb;
  v_orden integer := 0;
  v_base integer := 0;
  v_texto text;
  v_producto dominio.productos;
  v_cantidad integer;
  v_deposito uuid;
  v_manual numeric;
  v_precio record;
  v_ahora timestamptz;
  v_unitario numeric;
  v_porcentaje numeric;
  v_subtotal numeric;
  v_iva numeric;
  v_total_sin numeric := 0;
  v_total_iva numeric := 0;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para editar comprobantes' using errcode = '42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas deben ser una lista' using errcode = '22023', hint = 'lineas';
  end if;
  if jsonb_array_length(p_lineas) > 200 then
    raise exception 'Un comprobante admite hasta 200 líneas' using errcode = '22023', hint = 'lineas';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  -- MSF-816 (FR-002, R3c): el instante del precio se toma DESPUÉS del bloqueo del comprobante (no el `now()` del
  -- inicio de la transacción): una promoción que vence mientras se esperaba el bloqueo no se cobra.
  v_ahora := clock_timestamp();
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar comprobantes de esta tienda' using errcode = '42501';
  end if;
  if not ((v_c.tipo = 'factura' and v_c.estado = 'borrador')
       or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')) then
    raise exception 'El comprobante ya está cerrado y no se puede modificar' using errcode = '55000';
  end if;
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Otra persona modificó este comprobante. Recargalo para ver los cambios' using errcode = 'PT412';
  end if;

  -- F-VTA-32 (MSF-340): el descuento sale de la ficha del cliente en el servidor, nunca del payload.
  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
    from dominio.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_org;
  select d.id into v_defecto
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_c.empresa_id
   where d.organizacion_id = v_org and d.por_defecto and d.activo;
  v_puede_precio := (select private.puede_editar_precio_en_empresa(v_c.empresa_id));

  -- Precios manuales ya guardados: un re-guardado sin permiso no puede perderlos ni cambiarlos.
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', l.producto_id, 'precio', l.precio_unitario)), '[]'::jsonb)
    into v_previas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.precio_manual;

  -- Las líneas sin_stock (de Service) no se editan acá: se conservan y suman a los totales.
  delete from dominio.comprobantes_venta_lineas where comprobante_id = v_c.id and not sin_stock;
  select coalesce(max(l.orden), 0), coalesce(sum(l.subtotal_sin_iva), 0), coalesce(sum(l.iva), 0)
    into v_base, v_total_sin, v_total_iva
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org;

  for v_elem in select e.value from jsonb_array_elements(p_lineas) as e(value) loop
    v_orden := v_orden + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'La línea % no es válida', v_orden using errcode = '22023', hint = 'lineas';
    end if;

    -- Producto: de la organización y activo (FR-011).
    v_texto := v_elem ->> 'producto_id';
    begin
      select * into v_producto
        from dominio.productos p
       where p.id = v_texto::uuid and p.organizacion_id = v_org and p.activo;
    exception when invalid_text_representation then
      raise exception 'La línea % tiene un producto inválido', v_orden using errcode = '22023', hint = 'producto_id';
    end;
    if not found then
      raise exception 'La línea % tiene un producto que no existe o está inactivo', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;

    -- Cantidad entera mayor a cero (FR-011).
    v_texto := v_elem ->> 'cantidad';
    if v_texto is null or v_texto !~ '^[0-9]{1,7}$' or v_texto::integer < 1 then
      raise exception 'La cantidad de la línea % debe ser un entero mayor a cero', v_orden
        using errcode = '22023', hint = 'cantidad';
    end if;
    v_cantidad := v_texto::integer;

    -- Depósito de salida (FR-011, FR-013): de la organización y activo; sin elegir, el principal.
    v_texto := v_elem ->> 'deposito_id';
    if v_texto is null then
      v_deposito := v_defecto;
    else
      begin
        v_deposito := v_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'La línea % tiene un depósito inválido', v_orden using errcode = '22023', hint = 'deposito_id';
      end;
    end if;
    if v_deposito is null or not exists (
      select 1 from dominio.depositos d where d.id = v_deposito and d.organizacion_id = v_org and d.activo
    ) then
      raise exception 'La línea % tiene un depósito que no existe o está inactivo', v_orden
        using errcode = '22023', hint = 'deposito_id';
    end if;
    if not exists (
      select 1 from dominio.depositos_empresas de
       where de.deposito_id = v_deposito and de.empresa_id = v_c.empresa_id and de.organizacion_id = v_org
    ) then
      raise exception 'La línea % tiene un depósito desde el que esta tienda no vende', v_orden
        using errcode = '22023', hint = 'deposito_id';
    end if;

    -- Precio manual (FR-016): número >= 0, solo con permiso o si ya estaba guardado igual.
    v_manual := null;
    if v_elem ? 'precio_manual' and jsonb_typeof(v_elem -> 'precio_manual') <> 'null' then
      if jsonb_typeof(v_elem -> 'precio_manual') <> 'number' then
        raise exception 'El precio de la línea % debe ser un número de cero o más', v_orden
          using errcode = '22023', hint = 'precio_manual';
      end if;
      v_manual := round((v_elem ->> 'precio_manual')::numeric, 2);
      if v_manual < 0 or v_manual >= 1000000000000 then
        raise exception 'El precio de la línea % debe ser un número de cero o más', v_orden
          using errcode = '22023', hint = 'precio_manual';
      end if;
      if not v_puede_precio and not exists (
        select 1 from jsonb_array_elements(v_previas) q
         where (q.value ->> 'producto_id')::uuid = v_producto.id and (q.value ->> 'precio')::numeric = v_manual
      ) then
        raise exception 'Tu rol no puede editar precios' using errcode = '42501', hint = 'precio_manual';
      end if;
    end if;

    -- Precio, escala e IVA (FR-014, FR-015): los calcula el servidor con la función única de precio de línea
    -- (MSF-816): escala/propio/lista con el descuento del cliente, o la promoción vigente de la tienda del
    -- comprobante si es menor (sin acumular). El precio manual manda siempre y no lleva referencia.
    select * into v_precio
      from private.precio_linea_venta(v_producto.id, v_c.empresa_id, v_tipo_cliente, v_cantidad, v_descuento, v_ahora, true, v_c.cliente_id);
    if not found then
      raise exception 'No pudimos calcular el precio de la línea %', v_orden using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := coalesce(v_manual, v_precio.neto_unitario);
    if v_unitario is null then
      raise exception 'El producto de la línea % no tiene precio en pesos (falta la cotización del dólar)', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;
    -- F-CLI-21: una lista con descuento fuerte sobre un producto muy barato puede redondear a cero; la tienda lo marca `sin_precio`
    -- (neto <= 0) y el panel no cobra $0 por esa vía. Solo aplica cuando fijó el precio la lista (no cambia nada sin lista).
    if v_manual is null and v_precio.lista_precio_id is not null and v_unitario <= 0 then
      raise exception 'El producto «%» (línea %) queda sin precio con la lista de precios del cliente (el descuento lo lleva a cero)', v_producto.nombre, v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;
    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_unitario * v_cantidad, 2);
    if v_subtotal >= 1000000000000 then
      raise exception 'El importe de la línea % es demasiado grande', v_orden using errcode = '22023', hint = 'cantidad';
    end if;
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
      descuento_pct, precio_referencia, promocion_id, lista_precio_id, lista_ajuste_pct
    )
    values (
      v_org, v_c.id, v_base + v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_cantidad, v_unitario,
      v_precio.escala_usada, v_manual is not null, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva,
      case when v_manual is null then v_precio.descuento_aplicado else 0 end,
      case when v_manual is null then v_precio.precio_referencia end,
      case when v_manual is null then v_precio.promocion_id end,
      case when v_manual is null then v_precio.lista_precio_id end,
      case when v_manual is null then v_precio.lista_ajuste_pct end
    );

    v_total_sin := v_total_sin + v_subtotal;
    v_total_iva := v_total_iva + v_iva;
  end loop;

  if v_total_sin + v_total_iva >= 1000000000000 then
    raise exception 'El total del comprobante es demasiado grande' using errcode = '22023', hint = 'lineas';
  end if;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin,
         total_con_iva = v_total_sin + v_total_iva,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.editado',
    format('Actualizó las líneas de %s %s', case v_fila.tipo when 'factura' then 'la factura' else 'el presupuesto' end, v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

-- obtener_comprobante: definición vigente en 20270348000200_ventas_usan_lista_precios.sql
CREATE OR REPLACE FUNCTION public.obtener_comprobante(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_nivel text;
  v_resultado jsonb;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  v_nivel := (select private.nivel_ventas_en_empresa(v_c.empresa_id));
  if v_nivel not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', v_c.id,
    'tipo', v_c.tipo,
    'numero', v_c.numero,
    'estado', v_c.estado,
    'empresa_id', v_c.empresa_id,
    'empresa', e.nombre,
    'cliente', jsonb_build_object(
      'id', cl.id,
      'nombre', cl.nombre,
      'documento', cl.documento,
      'direccion', nullif(btrim(concat_ws(', ', nullif(cl.direccion, ''), nullif(cl.localidad, ''), nullif(cl.provincia, ''))), ''),
      'tipo', cl.tipo,
      'es_consumidor_final', cl.es_consumidor_final
    ),
    'canal', v_c.canal,
    'fecha', v_c.fecha,
    'valido_hasta', v_c.valido_hasta,
    'operador_id', v_c.operador_id,
    'operador', case when exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = v_c.id and pt.organizacion_id = v_c.organizacion_id)
                     then 'Tienda online (cliente)'
                     else coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') end,
    'de_tienda', exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = v_c.id and pt.organizacion_id = v_c.organizacion_id),
    'forma_pago_id', v_c.forma_pago_id,
    'envio_id', v_c.envio_id,
    'origen_tipo', v_c.origen_tipo,
    'origen_id', v_c.origen_id,
    'origen_numero', case when v_c.origen_tipo = 'reparacion'
        and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion') then (
      select private.codigo_reparacion(r.numero) from dominio.reparaciones r
       where r.id = v_c.origen_id and r.organizacion_id = v_org) end,
    'lineas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'orden', l.orden,
          'producto_id', l.producto_id,
          'descripcion', l.descripcion,
          'codigo', l.codigo,
          'cantidad', l.cantidad,
          'precio_unitario', l.precio_unitario,
          'escala', l.escala,
          'precio_manual', l.precio_manual,
          'descuento_pct', l.descuento_pct,
          'precio_referencia', l.precio_referencia,
          'lista_ajuste_pct', l.lista_ajuste_pct,
          'lista_nombre', lp.nombre,
          'alicuota_porcentaje', l.alicuota_porcentaje,
          'deposito_id', l.deposito_id,
          'deposito', d.nombre,
          'a_pedido', l.a_pedido,
          'sin_stock', l.sin_stock,
          'stock', coalesce(x.cantidad, 0),
          'reservado', coalesce(x.reservado, 0),
          'subtotal_sin_iva', l.subtotal_sin_iva,
          'iva', l.iva
        )
        order by l.orden
      )
      from dominio.comprobantes_venta_lineas l
      left join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
      left join dominio.listas_precios lp on lp.id = l.lista_precio_id and lp.organizacion_id = l.organizacion_id
      left join dominio.existencias_deposito x
        on x.producto_id = l.producto_id and x.deposito_id = l.deposito_id and x.organizacion_id = l.organizacion_id
      where l.comprobante_id = v_c.id and l.organizacion_id = v_org
    ), '[]'::jsonb),
    'total_sin_iva', v_c.total_sin_iva,
    'iva', v_c.total_con_iva - v_c.total_sin_iva,
    'total_con_iva', v_c.total_con_iva,
    'editable', ((v_c.tipo = 'factura' and v_c.estado = 'borrador') or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')),
    'puede_editar', v_nivel = 'edicion',
    'puede_editar_precio', v_nivel = 'edicion' and (select private.puede_editar_precio_en_empresa(v_c.empresa_id)),
    'updated_at', v_c.updated_at
  )
  into v_resultado
  from dominio.empresas e
  join dominio.clientes cl on cl.id = v_c.cliente_id and cl.organizacion_id = v_org
  left join public.perfiles_usuario p on p.user_id = v_c.operador_id
  where e.id = v_c.empresa_id;

  return v_resultado;
end;
$function$;

-- historial_comprobante: definición vigente en 20261212100900_historial_comprobante.sql
create or replace function public.historial_comprobante(p_id uuid)
returns table (cuando timestamptz, accion text, quien text, empresa_id uuid, empresa text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_patron text;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el historial de un comprobante' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- «factura 0003-00001251» como palabra completa: el número se escapa y no puede seguir otro carácter de número.
  v_patron := v_c.tipo || ' ' || regexp_replace(v_c.numero, '([^A-Za-z0-9])', E'\\\\\\1', 'g') || '([^A-Za-z0-9]|$)';

  return query
  select a.creado_en,
         case when a.tipo = 'comprobante.estado_cambiado'
              then regexp_replace(a.detalle, ' en la factura .*$', '')
              else a.detalle end,
         coalesce(nullif(btrim(a.actor_nombre), ''), case when a.actor_id is null then 'Sistema' else 'Usuario sin nombre' end),
         a.empresa_id,
         e.nombre
    from public.registro_actividad a
    left join dominio.empresas e on e.id = a.empresa_id and e.organizacion_id = a.organizacion_id
   where a.organizacion_id = v_org
     and a.empresa_id = v_c.empresa_id
     and a.tipo like 'comprobante.%'
     and a.detalle ~ v_patron
   order by a.creado_en desc, a.id desc;
end;
$$;

-- transiciones_permitidas_comprobante: definición vigente en 20261212100700_cambiar_estado_comprobante.sql
create or replace function public.transiciones_permitidas_comprobante(p_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_nivel text;
  v_rol text;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver los estados de un comprobante' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  v_nivel := (select private.nivel_ventas_en_empresa(v_c.empresa_id));
  if v_nivel not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;
  -- Un rol sin filas en la matriz (Consulta, Operador) ve todos los chips deshabilitados.
  if v_c.tipo <> 'factura' or v_c.estado in ('borrador', 'anulada') then
    return '{}'::text[];
  end if;
  v_rol := (select private.rol_actor_en_empresa(v_c.empresa_id));
  return coalesce((
    select array_agg(t.estado_hasta order by t.estado_hasta)
      from dominio.transiciones_estado_comprobante t
     where t.organizacion_id = v_org and t.tipo = v_c.tipo and t.estado_desde = v_c.estado
       and t.rol_id = v_rol and t.estado_hasta not in ('cobrado', 'deuda')
  ), '{}'::text[]);
end;
$$;

-- cobros_de_comprobante: definición vigente en 20270507210500_cobros_de_comprobante_estado_reversion.sql
create or replace function public.cobros_de_comprobante(p_comprobante_id uuid)
returns table (
  id uuid,
  fecha timestamptz,
  forma_pago text,
  forma_pago_tipo text,
  cuenta_cobro text,
  cuenta_cobro_banco text,
  cuenta_cobro_titular text,
  importe numeric,
  origen text,
  conciliado boolean,
  aprobado_por text,
  registrado_por text,
  estado_reversion text,
  motivo_reversion text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los cobros del comprobante' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.comprobantes_venta c
     where c.id = p_comprobante_id
       and c.organizacion_id = (select private.organizacion_id())
       and c.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;

  return query
  select b.id,
         b.registrado_en,
         f.nombre,
         f.tipo,
         cc.nombre,
         cc.banco,
         cc.titular,
         b.importe,
         b.origen,
         b.aprobado_por is not null,
         b.aprobado_por_nombre,
         b.registrado_por_nombre,
         case when b.origen = 'reversion' then 'reversion'
              when r.id is not null then 'revertido' end,
         coalesce(b.motivo_reversion, r.motivo_reversion)
    from dominio.cobros_comprobante b
    left join dominio.formas_pago f on f.id = b.forma_pago_id
    left join dominio.cuentas_cobro cc on cc.id = b.cuenta_cobro_id
    left join dominio.cobros_comprobante r on r.revierte_cobro_id = b.id and r.organizacion_id = b.organizacion_id
   where b.comprobante_id = p_comprobante_id
     and b.organizacion_id = (select private.organizacion_id())
     and b.empresa_id in (select private.empresas_accesibles())
   order by b.registrado_en, b.id;
end;
$$;

-- saldo_comprobante: definición vigente en 20270227140000_saldo_comprobante_resta_notas_credito.sql
create or replace function public.saldo_comprobante(p_id uuid)
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
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
end;
$$;
