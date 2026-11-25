-- Lote 67 (MSF-599, novena ola de la convención de códigos de negocio mapeados a 4xx): doce RPC de comprobantes de venta,
-- despacho, cobros, contrarreembolsos y envíos en moto dejan de contestar HTTP 500 cuando rechazan por «el estado o la regla
-- de negocio no admite la acción» (`55000`, clase 55) y pasan a `PT409` (HTTP 409), con el mismo mensaje de siempre.
-- Funciones: confirmar_comprobante, anular_comprobante, cambiar_estado_comprobante, guardar_comprobante,
-- guardar_lineas_comprobante, cambiar_estado_despacho, registrar_faltantes_despacho, guardar_envio_comprobante,
-- registrar_cobro, revertir_cobro, marcar_contrarreembolso_cobrado y actualizar_envio_moto (29 rechazos).
--
-- Cada función parte de su definición VIGENTE (indicada sobre ella; ninguna fue reescrita in situ por un barrido
-- posterior: las definiciones de esas migraciones ya usan `dominio.clientes`) y solo cambia el
-- errcode `55000` a `PT409`: mensajes, cuerpo, firma, `security definer`, `search_path` y grants son los mismos
-- (`create or replace` conserva privilegios y comentario; no hay drop, grant ni revoke). Solo `actualizar_envio_moto`
-- menciona el código en su `comment on function`, que se actualiza.
--
-- Ninguna es llamable por `anon` ni la consumen Kestra, workers o Edge Functions: solo la web, que acepta los dos códigos
-- (`55000` y `PT409`) porque la migración y el despliegue no son simultáneos.
--
-- Quedan con `55000` a propósito: (a) los de bandera apagada («desactivada en este entorno»: `guardar_promocion_precio`,
-- listas de precios, newsletter, opiniones, precios masivos), que son una falla de configuración del entorno y no una
-- regla de negocio de la persona; (b) los de contrato propio por `detail` (verificación de dominio de la tienda); (c) los
-- que lanza un auxiliar de `private` (`private.registrar_cobro_interno`, que usan `registrar_cobro` y
-- `marcar_contrarreembolso_cobrado`, `private.marcar_estado_cobro_comprobante`, `private.abrir_contrarreembolso`,
-- `private.aplicar_conciliacion`) y las funciones no migradas (`rendir_envios_moto`, `emitir_nota_credito`, `facturar_presupuesto`,
-- Service, RMA, newsletter, etc.).
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar, en una migración nueva, la definición vigente
-- indicada sobre cada función (en el cuerpo, `errcode = 'PT409'` vuelve a `'55000'`) y restaurar el comentario de
-- `actualizar_envio_moto` desde 20270507360000 (la frase «rechaza un envío rendido o de una factura anulada (55000)»).
-- El cliente acepta los dos códigos.

-- confirmar_comprobante: definición vigente en 20270507340000_comprobantes_responden_4xx.sql (1 rechazo)
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
    raise exception 'La factura ya está cerrada y no se puede confirmar' using errcode = 'PT409';
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

-- anular_comprobante: definición vigente en 20270507340000_comprobantes_responden_4xx.sql (5 rechazos)
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
    raise exception 'La factura está en borrador: no movió stock, no hace falta anularla' using errcode = 'PT409';
  end if;
  if v_c.estado = 'cobrado' then
    raise exception 'La factura ya está cobrada: corregila con una nota de crédito' using errcode = 'PT409';
  end if;
  -- MSF-661: una factura ya entregada movió mercadería al cliente: anularla dejaría el stock y el despacho incoherentes.
  if v_c.estado_despacho = 'entregado' then
    raise exception 'La factura ya fue entregada: corregí con nota de crédito o RMA' using errcode = 'PT409';
  end if;
  -- MSF-600: con cobros registrados (aunque sean parciales, netos de reversiones) la plata cobrada quedaría huérfana.
  if (select s.cobrado from private.saldo_comprobante(v_c.id) s) > 0 then
    raise exception 'La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from dominio.comprobantes_venta n
     where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito'
  ) then
    raise exception 'La factura ya tiene una nota de crédito: corregila con otra nota de crédito' using errcode = 'PT409';
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

-- cambiar_estado_comprobante: definición vigente en 20270507340000_comprobantes_responden_4xx.sql (2 rechazos)
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
    raise exception 'La factura está en borrador: confirmala antes de cambiar su estado' using errcode = 'PT409';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada y ya no admite cambios de estado' using errcode = 'PT409';
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

-- guardar_comprobante: definición vigente en 20270507340000_comprobantes_responden_4xx.sql (1 rechazo)
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
    raise exception 'El comprobante ya está cerrado y no se puede modificar' using errcode = 'PT409';
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

-- guardar_lineas_comprobante: definición vigente en 20270507340000_comprobantes_responden_4xx.sql (1 rechazo)
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
    raise exception 'El comprobante ya está cerrado y no se puede modificar' using errcode = 'PT409';
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

-- cambiar_estado_despacho: definición vigente en 20270507350000_despacho_y_cobros_responden_4xx.sql (3 rechazos)
create or replace function public.cambiar_estado_despacho(
  p_id uuid,
  p_estado text,
  p_responsable_id uuid,
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
  v_destino text := lower(btrim(coalesce(p_estado, '')));
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_funcion text;
  v_rol_responsable text;
  v_nombre_responsable text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para despachar' using errcode = '42501';
  end if;
  if v_destino not in ('armando', 'listo_para_despachar', 'entregado') then
    raise exception 'El estado "%" no es un estado de despacho', p_estado using errcode = '22023';
  end if;
  if p_responsable_id is null then
    raise exception 'Elegí quién responde por este paso del despacho' using errcode = '22023';
  end if;

  -- La fila se toma `for update`: dos despachos simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no entra al despacho: solo las facturas se arman, controlan y entregan' using errcode = '22023';
  end if;
  if v_c.estado not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'Solo las facturas vigentes (no anuladas ni sin confirmar) se despachan' using errcode = 'PT409';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = 'PT409';
  end if;

  -- Permisos: la acción `despachar` en la tienda DEL COMPROBANTE (no en la activa). Sin acceso a esa tienda
  -- la persona no puede avanzar su despacho.
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede despachar comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- Idempotente (FR-003): el estado ya alcanzado devuelve el comprobante sin tocar responsables ni stock.
  if v_c.estado_despacho = v_destino then
    return v_c;
  end if;

  -- Transiciones del Flujo 1.
  if not (
       (v_c.estado_despacho in ('sin_armar', 'incompleto') and v_destino = 'armando')
    or (v_c.estado_despacho = 'armando' and v_destino = 'listo_para_despachar')
    or (v_c.estado_despacho = 'listo_para_despachar' and v_destino = 'entregado')
  ) then
    raise exception 'Una factura % no puede pasar a %',
      private.etiqueta_estado_despacho(v_c.estado_despacho),
      private.etiqueta_estado_despacho(v_destino)
      using errcode = 'PT409';
  end if;

  -- Bloqueo optimista (FR-003).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = 'PT412';
  end if;

  -- Responsable elegible para este paso (FR-004, FR-005, FR-006).
  v_funcion := case v_destino
    when 'armando' then 'armar'
    when 'listo_para_despachar' then 'controlar'
    else 'entregar'
  end;
  v_rol_responsable := (select private.rol_usuario_en_empresa(v_org, p_responsable_id, v_c.empresa_id));
  if v_rol_responsable is null
     or not (select private.responsable_despacho_habilitado(v_org, v_rol_responsable, v_funcion)) then
    raise exception 'Esa persona no puede %s esta factura: elegí a alguien con el rol que corresponde',
      case v_funcion when 'armar' then 'armar' when 'controlar' then 'controlar' else 'entregar' end
      using errcode = '42501';
  end if;
  -- Quien armó no puede controlar, salvo el Administrador (FR-005).
  if v_destino = 'listo_para_despachar'
     and v_c.armo_id is not null
     and v_c.armo_id = p_responsable_id
     and v_rol_responsable <> 'administrador' then
    raise exception 'Quien armó el pedido no puede controlarlo: elegí otra persona' using errcode = '42501';
  end if;

  -- Entregar descuenta las reservas «A pedido» en esta misma transacción (FR-007): si algo falla, no se entrega.
  if v_destino = 'entregado' then
    perform private.descontar_reservas_entrega(v_c.id);
  end if;

  update dominio.comprobantes_venta
     set estado_despacho = v_destino,
         armo_id = case when v_destino = 'armando' then p_responsable_id else armo_id end,
         controlo_id = case when v_destino = 'listo_para_despachar' then p_responsable_id else controlo_id end,
         entrego_id = case when v_destino = 'entregado' then p_responsable_id else entrego_id end,
         entregado_en = case when v_destino = 'entregado' then now() else entregado_en end,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text)
    into v_nombre_responsable
    from auth.users au
    left join public.perfiles_usuario pu on pu.user_id = au.id
   where au.id = p_responsable_id;

  perform private.registrar_actividad(
    'despacho.estado_cambiado',
    format('Despacho: %s → %s en la factura %s (%s)',
      private.etiqueta_estado_despacho(v_c.estado_despacho),
      private.etiqueta_estado_despacho(v_destino),
      v_fila.numero,
      coalesce(v_nombre_responsable, 'sin nombre')),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

-- registrar_faltantes_despacho: definición vigente en 20270507350000_despacho_y_cobros_responden_4xx.sql (3 rechazos)
create or replace function public.registrar_faltantes_despacho(
  p_id uuid,
  p_faltantes jsonb,
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
  v_linea dominio.comprobantes_venta_lineas;
  v_elem jsonb;
  v_texto text;
  v_orden integer;
  v_cantidad integer;
  v_ordenes integer[] := '{}';
  v_detalle text := '';
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar faltantes' using errcode = '42501';
  end if;

  -- La lista de faltantes: al menos una línea.
  if p_faltantes is null or jsonb_typeof(p_faltantes) <> 'array' or jsonb_array_length(p_faltantes) = 0 then
    raise exception 'Elegí al menos una línea faltante' using errcode = '22023';
  end if;
  -- El mismo tope que las líneas del comprobante: nadie registra 200 faltantes de un pedido.
  if jsonb_array_length(p_faltantes) > 200 then
    raise exception 'Una factura admite hasta 200 líneas' using errcode = '22023';
  end if;

  -- La fila se toma `for update`: dos registros simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas registran faltantes' using errcode = '22023';
  end if;
  -- Lista de estados vivos: mantenerla igual a `ESTADOS_DESPACHABLES` (apps/web/src/pages/ventas/comprobante.tsx)
  -- y a `cambiar_estado_despacho`.
  if v_c.estado not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'Solo las facturas vigentes (no anuladas ni sin confirmar) registran faltantes' using errcode = 'PT409';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = 'PT409';
  end if;
  if v_c.estado_despacho not in ('armando', 'incompleto') then
    raise exception 'Los faltantes se registran con la factura en Armando o Incompleto: ahora está en %',
      private.etiqueta_estado_despacho(v_c.estado_despacho)
      using errcode = 'PT409';
  end if;

  -- Permisos: la acción `despachar` de Ventas en la tienda DEL COMPROBANTE (no en la activa).
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede registrar faltantes en esta tienda' using errcode = '42501';
  end if;

  -- Bloqueo optimista (FR-041).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = 'PT412';
  end if;

  for v_elem in select value from jsonb_array_elements(p_faltantes) loop
    -- La línea del faltante: un entero positivo.
    v_texto := btrim(coalesce(v_elem ->> 'linea_orden', ''));
    if v_texto !~ '^[0-9]{1,7}$' then
      raise exception 'La línea del faltante no es válida' using errcode = '22023';
    end if;
    v_orden := v_texto::integer;
    if v_orden = any (v_ordenes) then
      raise exception 'La línea % está repetida: registrale una sola cantidad' , v_orden using errcode = '22023';
    end if;
    v_ordenes := array_append(v_ordenes, v_orden);

    -- La cantidad faltante: un entero positivo.
    v_texto := btrim(coalesce(v_elem ->> 'cantidad', ''));
    if v_texto !~ '^[0-9]{1,7}$' then
      raise exception 'La cantidad faltante de la línea % tiene que ser un número entero', v_orden using errcode = '22023';
    end if;
    v_cantidad := v_texto::integer;

    -- La línea tiene que ser de esta factura (y de esta organización).
    select * into v_linea
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_c.id
       and l.organizacion_id = v_org
       and l.orden = v_orden;
    if not found then
      raise exception 'La línea % no es de esta factura', v_orden using errcode = '22023';
    end if;

    -- La cantidad va entre 1 y lo pedido de la línea (FR-041).
    if v_cantidad < 1 or v_cantidad > v_linea.cantidad then
      raise exception 'La cantidad faltante de la línea % tiene que estar entre 1 y %',
        v_orden, v_linea.cantidad
        using errcode = '22023';
    end if;

    -- Un faltante por línea: si ya hay uno abierto, se actualiza con la cantidad nueva (no se duplica).
    insert into dominio.faltantes_venta
      (organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id,
       cantidad_faltante, estado, registrado_por)
    values
      (v_org, v_c.empresa_id, v_c.id, v_orden, v_linea.producto_id, v_linea.deposito_id,
       v_cantidad, 'abierto', v_actor)
    on conflict (comprobante_id, linea_orden) where estado = 'abierto'
    do update
      set cantidad_faltante = excluded.cantidad_faltante,
          registrado_por = excluded.registrado_por;

    v_detalle := v_detalle
      || case when v_detalle = '' then '' else '; ' end
      || format('línea %s: %s unidades', v_orden, v_cantidad);
  end loop;

  -- La factura queda en Incompleto en la misma transacción (todo o nada).
  update dominio.comprobantes_venta
     set estado_despacho = 'incompleto',
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'despacho.faltante_registrado',
    format('Faltantes en la factura %s: %s', v_fila.numero, v_detalle),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

-- guardar_envio_comprobante: definición vigente en 20270507350000_despacho_y_cobros_responden_4xx.sql (3 rechazos)
create or replace function public.guardar_envio_comprobante(
  p_id uuid,
  p_transporte_id uuid,
  p_guia text,
  p_fecha_envio date,
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
  v_transporte dominio.transportes;
  v_guia text;
  v_fecha date;
  v_detalle text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar el envío' using errcode = '42501';
  end if;

  -- La fila se toma `for update`: dos guardados simultáneos se serializan.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;

  -- Solo las facturas: un presupuesto no se despacha.
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no registra envío: solo las facturas se despachan' using errcode = '22023';
  end if;
  -- Lista de estados vivos: mantenerla igual a `ESTADOS_DESPACHABLES` (apps/web/src/pages/ventas/comprobante.tsx)
  -- y a `cambiar_estado_despacho`.
  if v_c.estado not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'Solo las facturas vigentes (no anuladas ni sin confirmar) registran el envío' using errcode = 'PT409';
  end if;
  if v_c.estado_despacho is null then
    raise exception 'Esta factura todavía no tiene estado de despacho' using errcode = 'PT409';
  end if;
  if v_c.estado_despacho = 'entregado' then
    raise exception 'Esta factura ya fue entregada: no se puede cambiar el envío' using errcode = 'PT409';
  end if;

  -- Permiso: la acción `despachar` o Ventas en `edicion`, en la empresa DEL COMPROBANTE (no en la activa).
  if not (select private.puede_despachar_en_empresa(v_c.empresa_id))
     and (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede registrar el envío de comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- Guía: texto de hasta 100 caracteres; en blanco = sin guía.
  v_guia := nullif(btrim(coalesce(p_guia, '')), '');
  if v_guia is not null and length(v_guia) > 100 then
    raise exception 'La guía no puede tener más de 100 caracteres' using errcode = '22023', hint = 'guia';
  end if;

  -- Fecha de envío: si no viene, la de hoy (la mercadería sale hoy). Es el día de Argentina
  -- (`private.hoy_argentina`), no el del servidor: el servidor corre en UTC y de noche el día cambiaría
  -- tres horas antes que para el cliente (mismo criterio que el resto de las RPC).
  v_fecha := p_fecha_envio;
  if v_fecha is null and p_transporte_id is not null then
    v_fecha := (select private.hoy_argentina());
  end if;

  -- Idempotente: lo mismo que ya está guardado no se vuelve a escribir (ni `updated_at`, ni actividad).
  if v_c.transporte_id is not distinct from p_transporte_id
     and v_c.guia is not distinct from v_guia
     and v_c.fecha_envio is not distinct from v_fecha then
    return v_c;
  end if;

  -- Bloqueo optimista (FR-021).
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = 'PT412';
  end if;

  -- Transporte: de la organización, activo y usado en la empresa del comprobante (FR-021).
  if p_transporte_id is not null then
    select * into v_transporte
      from dominio.transportes t
     where t.id = p_transporte_id and t.organizacion_id = v_org;
    if not found then
      raise exception 'El transporte no existe' using errcode = '22023', hint = 'transporte_id';
    end if;
    if not v_transporte.activa then
      raise exception 'El transporte «%» está desactivado: elegí otro', v_transporte.nombre
        using errcode = '22023', hint = 'transporte_id';
    end if;
    if not exists (
      select 1
        from dominio.transportes_empresas te
       where te.transporte_id = v_transporte.id
         and te.empresa_id = v_c.empresa_id
         and te.organizacion_id = v_org
    ) then
      raise exception 'El transporte «%» no se usa en esta tienda: elegí otro', v_transporte.nombre
        using errcode = '22023', hint = 'transporte_id';
    end if;
  end if;

  update dominio.comprobantes_venta
     set transporte_id = p_transporte_id,
         guia = v_guia,
         fecha_envio = v_fecha,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  v_detalle := case
    when v_fila.transporte_id is null and v_fila.guia is null then 'sin transporte ni guía'
    else trim(
      case
        when v_fila.transporte_id is not null then 'transporte ' || coalesce(v_transporte.nombre, '—')
        else 'sin transporte'
      end ||
      case when v_fila.guia is not null then ', guía ' || v_fila.guia else '' end ||
      case when v_fila.fecha_envio is not null then ', fecha ' || to_char(v_fila.fecha_envio, 'DD/MM/YYYY') else '' end
    )
  end;
  perform private.registrar_actividad(
    'despacho.envio_guardado',
    format('Envío: %s en la factura %s', v_detalle, v_fila.numero),
    v_fila.empresa_id
  );

  return v_fila;
end;
$$;

-- registrar_cobro: definición vigente en 20270507350000_despacho_y_cobros_responden_4xx.sql (2 rechazos)
create or replace function public.registrar_cobro(
  p_comprobante_id uuid,
  p_importe numeric,
  p_forma_pago_id uuid,
  p_cuenta_cobro_id uuid default null,
  p_actualizado_en timestamptz default null
)
returns dominio.cobros_comprobante
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_forma dominio.formas_pago;
  v_cuenta record;
  v_cobro_id uuid;
  v_cobro dominio.cobros_comprobante;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar cobros' using errcode = '42501';
  end if;

  -- ── El importe (FR-003): la base es la autoridad, el `hint` marca el campo ──
  if p_importe is null then
    raise exception 'El importe es obligatorio' using errcode = '22023', hint = 'importe';
  end if;
  if p_importe <= 0 then
    raise exception 'El importe tiene que ser mayor a cero' using errcode = '22023', hint = 'importe';
  end if;
  if round(p_importe, 2) <> p_importe then
    raise exception 'El importe puede tener hasta dos decimales' using errcode = '22023', hint = 'importe';
  end if;
  -- El libro guarda el importe en numeric(14,2): un importe mayor no tiene dónde guardarse y la
  -- base tiraría un error técnico (22003) que la pantalla no sabe explicar. Se rechaza acá, con
  -- el mensaje y el `hint` del campo.
  if p_importe > 999999999999.99 then
    raise exception 'El importe no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'importe';
  end if;

  if p_forma_pago_id is null then
    raise exception 'La forma de pago es obligatoria' using errcode = '22023', hint = 'forma_pago_id';
  end if;

  -- ── El comprobante, con bloqueo de fila: serializa los cobros simultáneos (FR-003) ──
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;

  -- ── El permiso es el de la empresa del comprobante (FR-002) ─────────────────
  if not (select private.puede_registrar_cobro_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede registrar cobros en esta tienda' using errcode = '42501';
  end if;

  -- ── Solo las facturas confirmadas admiten cobros (FR-002) ──────────────────
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas admiten cobros' using errcode = '22023';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de registrar cobros' using errcode = 'PT409';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite cobros' using errcode = 'PT409';
  end if;

  -- ── La forma de pago: de la misma empresa y activa ────────────────────────
  select * into v_forma
    from dominio.formas_pago f
   where f.id = p_forma_pago_id
     and f.organizacion_id = v_org
     and f.empresa_id = v_c.empresa_id;
  if not found then
    raise exception 'La forma de pago no es de la empresa de la factura' using errcode = '22023', hint = 'forma_pago_id';
  end if;
  if not v_forma.activo then
    raise exception 'La forma de pago % está desactivada', v_forma.nombre using errcode = '22023', hint = 'forma_pago_id';
  end if;

  -- ── La cuenta de cobro: la exige la forma y tiene que estar activa y habilitada (FR-002) ──
  if v_forma.exige_cuenta_cobro and p_cuenta_cobro_id is null then
    raise exception 'La forma de pago % exige una cuenta de cobro', v_forma.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
  end if;
  if p_cuenta_cobro_id is not null then
    select c.* into v_cuenta
      from dominio.cuentas_cobro c
     where c.id = p_cuenta_cobro_id and c.organizacion_id = v_org;
    if not found then
      raise exception 'La cuenta de cobro no existe o no es de tu organización' using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
    if not v_cuenta.activa then
      raise exception 'La cuenta de cobro % está marcada «No usar»', v_cuenta.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
    if not exists (
      select 1 from dominio.cuentas_cobro_empresas ce
       where ce.cuenta_id = p_cuenta_cobro_id
         and ce.empresa_id = v_c.empresa_id
         and ce.organizacion_id = v_org
    ) then
      raise exception 'La cuenta de cobro % no está habilitada en esta tienda', v_cuenta.nombre using errcode = '22023', hint = 'cuenta_cobro_id';
    end if;
  end if;

  -- ── El cobro: lo registra la función interna (FR-003, FR-004, FR-006) ────
  begin
    v_cobro_id := private.registrar_cobro_interno(
      v_c.id, p_importe, v_forma.id, p_cuenta_cobro_id, 'manual', v_actor);
  exception when sqlstate 'P0001' then
    -- El tope (el importe supera el saldo): el mensaje nombra el importe y el saldo (FR-003).
    raise exception '%', sqlerrm using errcode = 'P0001', hint = 'importe';
  end;

  select * into v_cobro from dominio.cobros_comprobante where id = v_cobro_id;
  return v_cobro;
end;
$$;

-- revertir_cobro: definición vigente en 20270507350000_despacho_y_cobros_responden_4xx.sql (5 rechazos)
create or replace function public.revertir_cobro(p_cobro_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_comprobante_id uuid;
  v_c dominio.comprobantes_venta;
  v_cobro dominio.cobros_comprobante;
  v_saldo record;
  v_nombre text;
  v_nuevo uuid;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para revertir cobros' using errcode = '42501';
  end if;
  if not (select private.puede_escribir()) then
    raise exception 'Solo el administrador puede revertir un cobro' using errcode = '42501';
  end if;

  -- El comprobante se toma primero (mismo orden que registrar_cobro_interno); el cobro se lee sin bloqueo para saber cuál.
  select b.comprobante_id into v_comprobante_id
    from dominio.cobros_comprobante b
   where b.id = p_cobro_id and b.organizacion_id = v_org;
  if not found then
    raise exception 'El cobro no existe' using errcode = 'PT404';
  end if;

  select * into v_c from dominio.comprobantes_venta c
   where c.id = v_comprobante_id and c.organizacion_id = v_org for update;
  if not found then
    raise exception 'El cobro no existe' using errcode = 'PT404';
  end if;

  select * into v_cobro from dominio.cobros_comprobante b
   where b.id = p_cobro_id and b.organizacion_id = v_org for update;

  if v_motivo = '' then
    raise exception 'Escribí el motivo de la reversión' using errcode = '22023', hint = 'motivo';
  end if;
  if length(v_motivo) > 300 then
    raise exception 'El motivo de la reversión no puede superar los 300 caracteres' using errcode = '22023', hint = 'motivo';
  end if;
  if v_cobro.origen = 'reversion' then
    raise exception 'Un contra-asiento no se revierte' using errcode = 'PT409';
  end if;
  if v_cobro.origen = 'contrarreembolso' then
    raise exception 'El cobro de un contrarreembolso se corrige desde el contrarreembolso' using errcode = 'PT409';
  end if;
  if exists (select 1 from dominio.cobros_comprobante r
              where r.revierte_cobro_id = v_cobro.id and r.organizacion_id = v_org) then
    raise exception 'El cobro ya fue revertido' using errcode = 'PT409';
  end if;
  if v_cobro.aprobado_por is not null then
    raise exception 'El cobro está conciliado: revertí primero la conciliación' using errcode = 'PT409';
  end if;
  if v_c.estado in ('borrador', 'anulada') then
    raise exception 'La factura no está en un estado operativo: no admite revertir cobros' using errcode = 'PT409';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pr.nombre, pr.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pr on pr.user_id = u.id
   where u.id = v_actor;
  if v_nombre is null then
    raise exception 'El usuario que revierte el cobro no existe' using errcode = '22023';
  end if;

  insert into dominio.cobros_comprobante (
    organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, cuenta_cobro_id,
    origen, registrado_por, registrado_por_nombre, revierte_cobro_id, motivo_reversion
  )
  values (
    v_cobro.organizacion_id, v_cobro.empresa_id, v_cobro.comprobante_id, -v_cobro.importe, v_cobro.forma_pago_id,
    v_cobro.cuenta_cobro_id, 'reversion', v_actor, v_nombre, v_cobro.id, v_motivo
  )
  returning id into v_nuevo;

  select * into v_saldo from private.saldo_comprobante(v_c.id);
  if v_saldo.saldo = 0 then
    perform private.marcar_estado_cobro_comprobante(v_c.id, 'cobrado');
  elsif v_c.estado = 'cobrado' then
    perform private.marcar_estado_cobro_comprobante(v_c.id, 'deuda');
  end if;

  perform private.insertar_actividad(
    v_c.organizacion_id,
    v_actor,
    'comprobante.cobro_revertido',
    format('Revirtió el cobro de ARS %s de la factura %s: %s', v_cobro.importe, v_c.numero, v_motivo),
    v_c.empresa_id
  );
  return v_nuevo;
end;
$$;

-- marcar_contrarreembolso_cobrado: definición vigente en 20270507360000_catalogos_envio_y_contrarreembolsos_responden_4xx.sql (1 rechazo)
create or replace function public.marcar_contrarreembolso_cobrado(
  p_id uuid,
  p_actualizado_en timestamptz
)
returns dominio.contrarreembolsos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cr dominio.contrarreembolsos;
  v_c dominio.comprobantes_venta;
  v_forma_pago_id uuid;
  v_cobro_id uuid;
  v_nombre text;
  v_fila dominio.contrarreembolsos;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para cobrar contrarreembolsos' using errcode = '42501';
  end if;

  -- ── El contrarreembolso, con bloqueo de fila: serializa dos «Marcar cobrado» ──
  select * into v_cr
    from dominio.contrarreembolsos cr
   where cr.id = p_id
     and cr.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'El contrarreembolso no existe' using errcode = 'PT404';
  end if;

  -- ── El permiso es el de la EMPRESA del contrarreembolso (FR-041) ───────────
  if not (select private.puede_cobrar_contrarreembolso_en_empresa(v_cr.empresa_id)) then
    raise exception 'Tu rol no puede cobrar contrarreembolsos en esta tienda' using errcode = '42501';
  end if;

  -- ── Idempotente (FR-042): si ya está Cobrado, se devuelve tal cual ─────────
  -- Un doble clic no cobra dos veces: no hay segundo cobro ni segundo evento.
  if v_cr.estado = 'cobrado' then
    return v_cr;
  end if;

  -- ── Bloqueo optimista (FR-042): la versión leída en pantalla tiene que ser la ──
  if p_actualizado_en is null or v_cr.actualizado_en <> p_actualizado_en then
    raise exception 'El contrarreembolso fue modificado por otra persona' using errcode = 'PT412';
  end if;

  -- ── El comprobante (FR-044): un comprobante anulado no se cobra ────────────
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = v_cr.comprobante_id
     and c.organizacion_id = v_org;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;

  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: el contrarreembolso no se puede cobrar' using errcode = 'PT409';
  end if;

  -- ── La forma del cobro: la de la factura si la tiene; si no, la forma ──────
  -- «Contrarreembolso» de la tienda (es la forma con la que el transporte cobra al entregar).
  v_forma_pago_id := v_c.forma_pago_id;
  if v_forma_pago_id is null then
    select f.id into v_forma_pago_id
      from dominio.formas_pago f
     where f.organizacion_id = v_org
       and f.empresa_id = v_cr.empresa_id
       and f.tipo = 'contrarreembolso'
       and f.activo
     order by f.orden, f.nombre
     limit 1;
  end if;
  if v_forma_pago_id is null then
    raise exception 'La factura no tiene forma de pago y la tienda no tiene una forma «Contrarreembolso»: no se puede registrar el cobro'
      using errcode = '22023';
  end if;

  -- ── Quién cobra (foto del nombre: el historial sobrevive a la baja) ────────
  select coalesce(nullif(btrim(concat_ws(' ', pr.nombre, pr.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pr on pr.user_id = u.id
   where u.id = v_actor;
  if v_nombre is null then
    raise exception 'El usuario que cobra el contrarreembolso no existe' using errcode = '22023';
  end if;

  -- ── El cobro en el libro, con origen `contrarreembolso` (FR-042) ───────────
  -- `private.registrar_cobro_interno` valida el tope contra el saldo y aplica Cobrado/Deuda
  -- (FR-003 y FR-004 de F-VTA-12): es la única vía, nadie más mueve el estado.
  v_cobro_id := private.registrar_cobro_interno(
    v_cr.comprobante_id, v_cr.importe, v_forma_pago_id, null, 'contrarreembolso', v_actor);

  -- ── El contrarreembolso pasa a Cobrado ────────────────────────────────────
  update dominio.contrarreembolsos
     set estado = 'cobrado',
         cobrado_por = v_actor,
         cobrado_por_nombre = v_nombre,
         cobrado_en = now(),
         cobro_id = v_cobro_id,
         -- now() es constante en la transacción: sin esto dos cambios en la misma transacción
         -- repetirían actualizado_en y no avanzaría el bloqueo.
         actualizado_en = greatest(clock_timestamp(), v_cr.actualizado_en + interval '1 microsecond')
   where id = v_cr.id
  returning * into v_fila;

  -- ── El evento (FR-043): misma transacción, con el actor, la tienda y la guía ─
  perform private.insertar_actividad(
    v_org,
    v_actor,
    'contrarreembolso.cobrado',
    format('Contrarreembolso de %s cobrado (guía %s) en la factura %s',
      v_cr.importe, v_cr.guia, v_c.numero),
    v_cr.empresa_id
  );

  return v_fila;
end;
$$;

-- actualizar_envio_moto: definición vigente en 20270507360000_catalogos_envio_y_contrarreembolsos_responden_4xx.sql (2 rechazos)
create or replace function public.actualizar_envio_moto(
  p_id uuid,
  p_mensajero text,
  p_guia text,
  p_costo_envio numeric,
  p_abono numeric,
  p_enviado boolean,
  p_actualizado_en timestamptz
)
returns dominio.envios_moto
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_mensajero text := private.normalizar_mensajero(p_mensajero);
  v_guia text := nullif(btrim(coalesce(p_guia, '')), '');
  v_ant dominio.envios_moto;
  v_c dominio.comprobantes_venta;
  v_e dominio.envios_moto;
  v_cambios text[] := array[]::text[];
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para editar envíos en moto' using errcode = '42501';
  end if;

  -- ── Validaciones del pedido (FR-005) ──────────────────────────────────────
  if p_id is null then
    raise exception 'El envío es obligatorio' using errcode = '22023';
  end if;
  if v_mensajero = '' then
    raise exception 'El mensajero es obligatorio' using errcode = '22023', hint = 'mensajero';
  end if;
  if length(v_mensajero) > 100 then
    raise exception 'El mensajero no puede tener más de 100 caracteres' using errcode = '22023', hint = 'mensajero';
  end if;
  if v_guia is not null and length(v_guia) > 100 then
    raise exception 'La guía no puede tener más de 100 caracteres' using errcode = '22023', hint = 'guia';
  end if;
  if p_costo_envio is null or p_costo_envio < 0 then
    raise exception 'El costo de envío tiene que ser cero o mayor' using errcode = '22023', hint = 'costo_envio';
  end if;
  if round(p_costo_envio, 2) <> p_costo_envio then
    raise exception 'El costo de envío puede tener hasta dos decimales' using errcode = '22023', hint = 'costo_envio';
  end if;
  if p_costo_envio > 999999999999.99 then
    raise exception 'El costo de envío no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'costo_envio';
  end if;
  if p_abono is null or p_abono < 0 then
    raise exception 'El importe que abona al recibir tiene que ser cero o mayor' using errcode = '22023', hint = 'abono';
  end if;
  if round(p_abono, 2) <> p_abono then
    raise exception 'El importe que abona al recibir puede tener hasta dos decimales' using errcode = '22023', hint = 'abono';
  end if;
  if p_abono > 999999999999.99 then
    raise exception 'El importe que abona al recibir no puede ser mayor a 999999999999.99' using errcode = '22023', hint = 'abono';
  end if;
  if p_enviado is null then
    raise exception 'Indicá si el envío está enviado' using errcode = '22023', hint = 'enviado';
  end if;

  -- ── El envío: primero se lee sin bloquear y se comprueba el permiso (ver abajo) ──
  select * into v_ant
    from dominio.envios_moto e
   where e.id = p_id
     and e.organizacion_id = v_org;
  if found then
    select * into v_c
      from dominio.comprobantes_venta c
     where c.id = v_ant.comprobante_id
       and c.organizacion_id = v_org;
  end if;

  -- ── El permiso es el de la EMPRESA del comprobante (FR-008), ANTES de cualquier bloqueo ──
  -- Un envío que no existe, de otra organización o de una tienda sin permiso da el MISMO `42501` (no revela existencia).
  if not found or not (select private.puede_registrar_envio_moto_en_empresa(v_c.empresa_id)) then
    raise exception 'Tu rol no puede editar envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- Con permiso se bloquea la fila: serializa dos ediciones y la rendición.
  select * into v_ant
    from dominio.envios_moto e
   where e.id = p_id
     and e.organizacion_id = v_org
     for update;
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = v_ant.comprobante_id
     and c.organizacion_id = v_org;

  -- ── Un envío rendido es de solo lectura (FR-005) ──────────────────────────
  if v_ant.rendido then
    raise exception 'El envío ya está rendido: no se puede editar' using errcode = 'PT409';
  end if;

  -- ── Una factura anulada después de cargar el envío lo bloquea (decisión de Nicolás, 2026-11-12) ──
  if v_c.estado = 'anulada' then
    raise exception 'La factura % fue anulada: el envío en moto ya no se puede editar', v_c.numero
      using errcode = 'PT409';
  end if;

  -- ── Bloqueo optimista (FR-005): la versión leída en pantalla tiene que ser la vigente ──
  if p_actualizado_en is null or v_ant.updated_at <> p_actualizado_en then
    raise exception 'El envío fue modificado por otra persona' using errcode = 'PT412';
  end if;

  -- ── Qué cambió (para el evento) ───────────────────────────────────────────
  if v_ant.mensajero is distinct from v_mensajero then
    v_cambios := v_cambios || format('mensajero %s → %s', v_ant.mensajero, v_mensajero);
  end if;
  if v_ant.guia is distinct from v_guia then
    v_cambios := v_cambios || format('guía %s → %s', coalesce(v_ant.guia, 'sin guía'), coalesce(v_guia, 'sin guía'));
  end if;
  if v_ant.costo_envio is distinct from p_costo_envio then
    v_cambios := v_cambios || format('costo %s → %s', v_ant.costo_envio, p_costo_envio);
  end if;
  if v_ant.abono is distinct from p_abono then
    v_cambios := v_cambios || format('abona %s → %s', v_ant.abono, p_abono);
  end if;
  if v_ant.enviado is distinct from p_enviado then
    v_cambios := v_cambios || format('enviado %s → %s',
      case when v_ant.enviado then 'sí' else 'no' end, case when p_enviado then 'sí' else 'no' end);
  end if;

  -- ── La edición: no toca `rendido` ni `rendido_en` ─────────────────────────
  update dominio.envios_moto e
     set mensajero = v_mensajero,
         guia = v_guia,
         costo_envio = p_costo_envio,
         abono = p_abono,
         enviado = p_enviado,
         -- now() es constante en la transacción: sin esto dos cambios en la misma transacción
         -- repetirían updated_at y no avanzaría el bloqueo.
         updated_at = greatest(clock_timestamp(), v_ant.updated_at + interval '1 microsecond')
   where e.id = v_ant.id
  returning * into v_e;

  -- ── El evento (FR-009): misma transacción, con actor, comprobante, mensajero y cambios ──
  perform private.registrar_actividad(
    'envio_moto.actualizado',
    left(format('Editó el envío en moto de la factura %s (mensajero %s): %s',
      v_c.numero, v_e.mensajero,
      case when cardinality(v_cambios) = 0 then 'sin cambios' else array_to_string(v_cambios, '; ') end), 500),
    v_c.empresa_id
  );

  return v_e;
end;
$$;

comment on function public.actualizar_envio_moto(uuid, text, text, numeric, numeric, boolean, timestamptz) is
  'Edita mensajero, guía, costo, abono y Enviado de un envío en moto (F-VTA-24, FR-005): bloqueo optimista por updated_at (PT412), rechaza un envío rendido o de una factura anulada (PT409) y nunca escribe rendido ni rendido_en. Exige ventas en edición y rol operador o administrador en la empresa del comprobante. Deja el evento envio_moto.actualizado.';
