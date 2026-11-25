-- Lote 74 (MSF-599, MSF-654 y MSF-655, undécima ola de la convención de códigos de negocio mapeados a 4xx): diecisiete RPC de
-- notas de crédito, presupuestos, cotización del dólar, newsletter y Service técnico dejan de contestar HTTP 500 cuando rechazan
-- por «no existe» (`P0002`), conflicto de edición (`40001`) o «el estado o la regla de negocio no admite la acción» (`55000`).
-- Pasan, con el mismo mensaje de siempre, a `PT404` (HTTP 404), `PT412` (HTTP 412) y `PT409` (HTTP 409). Qué código emite cada
-- función: ver la fila 11 de la tabla de docs/errores-negocio-postgrest.md.
--
-- Funciones: emitir_nota_credito, facturar_presupuesto, confirmar_cotizacion, detalle_anulacion_nota_credito,
-- borrar_datos_suscriptor_newsletter, dar_de_baja_suscriptor_newsletter, detalle_newsletter, cancelar_envio_newsletter,
-- descartar_newsletter, enviar_newsletter, guardar_newsletter, actualizar_reparacion, anular_reparacion,
-- cambiar_estado_reparacion, registrar_entrega_reparacion, generar_comprobante_reparacion y reingresar_por_garantia.
--
-- Cada función parte de su definición VIGENTE (la de la base con la décima ola aplicada, que `pg_get_functiondef` devuelve tal
-- cual) y solo cambia el errcode: mensajes, cuerpo, firma, `security definer`, `search_path` y grants son los mismos
-- (`create or replace` conserva privilegios; no hay drop, grant ni revoke). Cinco comentarios mencionaban el código y se
-- actualizan (actualizar_reparacion, cambiar_estado_reparacion, confirmar_cotizacion, descartar_newsletter y guardar_newsletter).
--
-- Ninguna es llamable por `anon` ni la consume Kestra, un worker o una Edge Function: solo la web, que acepta el código viejo
-- y el nuevo (`esCodigoDeConflicto`, `esCodigoDeEstado`, `P0002` o `PT404`) porque la migración y el despliegue no son simultáneos.
--
-- Quedan con el código anterior a propósito:
--   (a) los `55000` de bandera apagada («El newsletter no está habilitado en este entorno») de `guardar_newsletter` y
--       `enviar_newsletter`, y el `55000` de `facturar_presupuesto` «figura como facturado pero no encontramos su factura»
--       (inconsistencia de datos);
--   (b) el `P0002` «La tienda no existe» de `guardar_newsletter`, `guardar_newsletter_configuracion`,
--       `solicitar_prueba_newsletter` y `vista_previa_newsletter`: lo lanza `private.exigir_admin_newsletter` antes de que
--       corra el cuerpo (el chequeo del cuerpo es inalcanzable), así que esas funciones no se tocan salvo `guardar_newsletter`;
--   (c) los `P0002` y `55000` que lanzan auxiliares de `private` (`bloquear_reparacion_para_items`, `bloquear_reparacion_para_adjuntos`,
--       `exigir_admin_newsletter`, `empresa_de_cotizacion`): `agregar_item_reparacion`, `quitar_item_reparacion`,
--       `registrar_adjunto_reparacion` y `quitar_adjunto_reparacion` no se tocan;
--   (d) el flujo de avisos al cliente (`avisar_cliente_reparacion`, `avisar_cliente_whatsapp`, `avisos_de_reparacion`,
--       `obtener_enlace_consulta`, `regenerar_enlace_consulta`), que consume Kestra o la consulta pública;
--   (e) el `40001` con hint `precios_cambiaron`, `previsualizar_cotizacion` y `detalle_campana_correo`, fuera de esta ola.
--
-- Migración aditiva (create or replace).
--
-- Reversión: volver a aplicar, en una migración nueva, la definición vigente anterior de cada función (en el cuerpo, `PT404`
-- vuelve a `P0002`, `PT412` a `40001` y `PT409` a `55000`, solo en las líneas que esta migración cambia) y restaurar los cinco
-- comentarios previos. Definiciones vigentes anteriores (la última migración que cada función define; antes de copiar un cuerpo hay
-- que comprobar que ningún barrido posterior lo reescribió, como el de `public.clientes` a `dominio.clientes`):
--   emitir_nota_credito y facturar_presupuesto: 20270507450000; confirmar_cotizacion: 20270218500200;
--   detalle_anulacion_nota_credito: 20270201200129; borrar_datos_suscriptor_newsletter y dar_de_baja_suscriptor_newsletter:
--   20270420000000; detalle_newsletter, descartar_newsletter y guardar_newsletter: 20270420000100; cancelar_envio_newsletter y
--   enviar_newsletter: 20270420000400; actualizar_reparacion: 20261020110400; anular_reparacion: 20270201200111;
--   cambiar_estado_reparacion: 20261020120100; registrar_entrega_reparacion: 20261020120200; generar_comprobante_reparacion:
--   20270201200130; reingresar_por_garantia: 20270219150200.
-- Comentarios previos: los de esas mismas migraciones, salvo emitir_nota_credito (20261212120400) y facturar_presupuesto
-- (20270507220100), que no cambian. Las migraciones ya aplicadas no se editan.

-- emitir_nota_credito
CREATE OR REPLACE FUNCTION public.emitir_nota_credito(p_factura_id uuid, p_tipo text, p_lineas jsonb, p_concepto text DEFAULT NULL::text)
 RETURNS dominio.comprobantes_venta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_nota dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_concepto text := nullif(btrim(coalesce(p_concepto, '')), '');
  v_items jsonb;
  v_item record;
  v_l dominio.comprobantes_venta_lineas;
  v_prev_cant integer;
  v_prev_sub numeric(14, 2);
  v_prev_iva numeric(14, 2);
  v_sub numeric(14, 2);
  v_iva numeric(14, 2);
  v_total_sin numeric(14, 2) := 0;
  v_total_con numeric(14, 2) := 0;
  v_resta_sin numeric(14, 2);
  v_resta_con numeric(14, 2);
  v_importe numeric(14, 2);
  v_numero integer;
  v_fecha date;
  v_etiqueta text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para emitir notas de crédito' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('devolucion_productos', 'devolucion_importe', 'descuento') then
    raise exception 'Elegí el motivo de la nota de crédito' using errcode = '22023', hint = 'tipo';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0
     or jsonb_array_length(p_lineas) > 500 then
    raise exception 'Indicá qué se acredita en la nota de crédito' using errcode = '22023', hint = 'lineas';
  end if;
  if length(coalesce(v_concepto, '')) > 200 then
    raise exception 'El concepto no puede superar los 200 caracteres' using errcode = '22023', hint = 'concepto';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_factura_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'La factura no existe' using errcode = 'PT404';
  end if;
  if not (select private.puede_accion_comprobante(v_c.empresa_id, 'emitir_nota_credito')) then
    raise exception 'Tu rol no puede emitir notas de crédito en esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'La nota de crédito se emite sobre una factura' using errcode = '22023';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de emitir una nota de crédito' using errcode = 'PT409';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite notas de crédito' using errcode = 'PT409';
  end if;

  -- Lo aún acreditable (sin IVA y con IVA) = factura − notas previas.
  select v_c.total_sin_iva - coalesce(sum(n.total_sin_iva), 0), v_c.total_con_iva - coalesce(sum(n.total_con_iva), 0)
    into v_resta_sin, v_resta_con
    from dominio.comprobantes_venta n
   where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito';

  if p_tipo <> 'devolucion_productos' and v_concepto is null then
    raise exception 'Escribí el concepto de la nota de crédito' using errcode = '22023', hint = 'concepto';
  end if;

  v_numero := private.siguiente_numero_comprobante(v_c.empresa_id, 'nota_credito');
  v_fecha := (select (now() at time zone o.zona_horaria)::date from public.organizaciones o where o.id = v_org);

  insert into dominio.comprobantes_venta (
    organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
    total_sin_iva, total_con_iva, canal, operador_id, confirmado_en, confirmado_por,
    comprobante_origen_id, nc_tipo, nc_concepto
  )
  values (
    v_org, v_c.empresa_id, v_c.cliente_id, 'nota_credito', lpad(v_numero::text, 8, '0'), v_numero,
    coalesce(v_fecha, current_date), 'confirmada', 0, 0, v_c.canal, v_actor, now(), v_actor,
    v_c.id, p_tipo, v_concepto
  )
  returning * into v_nota;

  if p_tipo = 'devolucion_productos' then
    begin
      select jsonb_agg(jsonb_build_object('linea_id', q.linea_id, 'cantidad', q.cantidad) order by q.linea_id)
        into v_items
        from (
          select (e ->> 'linea_id')::uuid as linea_id, sum((e ->> 'cantidad')::integer)::integer as cantidad
            from jsonb_array_elements(p_lineas) e
           group by 1
        ) q;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
      raise exception 'Las líneas de la nota de crédito no son válidas' using errcode = '22023', hint = 'lineas';
    end;

    for v_item in select x.linea_id, x.cantidad from jsonb_to_recordset(v_items) as x(linea_id uuid, cantidad integer)
    loop
      if v_item.linea_id is null or v_item.cantidad is null or v_item.cantidad < 1 then
        raise exception 'Cada línea de la nota necesita el producto y una cantidad de al menos 1' using errcode = '22023', hint = 'lineas';
      end if;
      select * into v_l
        from dominio.comprobantes_venta_lineas l
       where l.id = v_item.linea_id and l.comprobante_id = v_c.id and l.organizacion_id = v_org;
      if not found then
        raise exception 'Una de las líneas no pertenece a la factura' using errcode = '22023', hint = 'lineas';
      end if;

      select coalesce(sum(nl.cantidad), 0), coalesce(sum(nl.subtotal_sin_iva), 0), coalesce(sum(nl.iva), 0)
        into v_prev_cant, v_prev_sub, v_prev_iva
        from dominio.comprobantes_venta_lineas nl
        join dominio.comprobantes_venta n on n.id = nl.comprobante_id and n.organizacion_id = nl.organizacion_id
       where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id
         and n.nc_tipo = 'devolucion_productos' and n.id <> v_nota.id and nl.orden = v_l.orden;

      if v_prev_cant + v_item.cantidad > v_l.cantidad then
        raise exception 'No podés devolver más de lo facturado: de % quedan % por acreditar', v_l.descripcion, v_l.cantidad - v_prev_cant
          using errcode = 'P0001', hint = 'tope';
      end if;

      if v_prev_cant + v_item.cantidad = v_l.cantidad then
        -- Cierra la línea: el resto exacto, sin deriva de redondeo.
        v_sub := v_l.subtotal_sin_iva - v_prev_sub;
        v_iva := v_l.iva - v_prev_iva;
      else
        v_sub := round(v_l.subtotal_sin_iva * v_item.cantidad / v_l.cantidad, 2);
        v_iva := round(v_l.iva * v_item.cantidad / v_l.cantidad, 2);
      end if;

      insert into dominio.comprobantes_venta_lineas (
        organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
        precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva, sin_stock
      )
      values (
        v_org, v_nota.id, v_l.orden, v_l.producto_id, v_l.descripcion, v_l.codigo, v_item.cantidad, v_l.precio_unitario,
        v_l.escala, v_l.precio_manual, v_l.alicuota_id, v_l.alicuota_porcentaje, v_l.deposito_id, v_l.a_pedido, v_sub, v_iva, v_l.sin_stock
      );
      v_total_sin := v_total_sin + v_sub;
      v_total_con := v_total_con + v_sub + v_iva;
    end loop;
  else
    if jsonb_array_length(p_lineas) <> 1 then
      raise exception 'Indicá un solo importe' using errcode = '22023', hint = 'importe';
    end if;
    begin
      v_importe := round((p_lineas -> 0 ->> 'importe_sin_iva')::numeric, 2);
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value or null_value_not_allowed then
      raise exception 'El importe de la nota de crédito no es válido' using errcode = '22023', hint = 'importe';
    end;
    if v_importe is null or v_importe <= 0 then
      raise exception 'El importe de la nota de crédito debe ser mayor a cero' using errcode = '22023', hint = 'importe';
    end if;
    if v_importe > v_resta_sin then
      raise exception 'No podés acreditar más de lo facturado: quedan % por acreditar (sin IVA)', v_resta_sin
        using errcode = 'P0001', hint = 'tope';
    end if;
    v_total_sin := v_importe;
    -- El IVA sale de la proporción de la factura; cerrando lo acreditable, el resto exacto.
    v_total_con := case when v_importe = v_resta_sin then v_resta_con
                        else round(v_importe * v_c.total_con_iva / v_c.total_sin_iva, 2) end;
  end if;

  if v_total_sin <= 0 then
    raise exception 'La nota de crédito no acredita ningún importe' using errcode = '22023';
  end if;
  if v_total_sin > v_resta_sin or v_total_con > v_resta_con then
    raise exception 'No podés acreditar más de lo facturado: quedan % por acreditar (sin IVA)', v_resta_sin
      using errcode = 'P0001', hint = 'tope';
  end if;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin, total_con_iva = v_total_con
   where id = v_nota.id
  returning * into v_fila;

  perform private.devolver_stock_nota_credito(v_fila.id);

  -- La factura cambió (ya no se puede anular): quien la tenía abierta recibe el conflicto de edición.
  update dominio.comprobantes_venta set updated_at = clock_timestamp() where id = v_c.id;

  v_etiqueta := case p_tipo
    when 'devolucion_productos' then 'Devolución de productos'
    when 'devolucion_importe' then 'Devolución de importe'
    else 'Descuento o bonificación' end;
  perform private.registrar_actividad(
    'comprobante.nota_credito_emitida',
    format('Emitió la nota de crédito %s (%s) sobre la factura %s', v_fila.numero, v_etiqueta, v_c.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$function$;

-- facturar_presupuesto
CREATE OR REPLACE FUNCTION public.facturar_presupuesto(p_presupuesto_id uuid)
 RETURNS dominio.comprobantes_venta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_hoy date := (select private.hoy_argentina());
  v_p dominio.comprobantes_venta;
  v_f dominio.comprobantes_venta;
  v_empresa_nombre text;
  v_defecto uuid;
  v_forma_pago uuid;
  v_envio uuid;
  v_numero integer;
  v_lineas integer;
  v_inactivo text;
  v_sin_iva numeric;
  v_iva numeric;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para facturar presupuestos' using errcode = '42501';
  end if;
  if p_presupuesto_id is null then
    raise exception 'Elegí el presupuesto a facturar' using errcode = '22023', hint = 'presupuesto_id';
  end if;

  -- Serializa las conversiones del mismo presupuesto: la segunda espera y ve `convertido`.
  select * into v_p
    from dominio.comprobantes_venta c
   where c.id = p_presupuesto_id and c.organizacion_id = v_org and c.tipo = 'presupuesto'
   for update;
  if not found or v_p.empresa_id is null then
    raise exception 'El presupuesto no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_p.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede facturar presupuestos de esta tienda' using errcode = '42501';
  end if;

  -- Idempotente: un presupuesto ya convertido devuelve su factura, sin crear otra ni auditar de nuevo.
  if v_p.estado = 'convertido' then
    select * into v_f
      from dominio.comprobantes_venta f
     where f.origen_presupuesto_id = v_p.id and f.organizacion_id = v_org;
    if not found then
      raise exception 'El presupuesto figura como facturado pero no encontramos su factura' using errcode = '55000';
    end if;
    return v_f;
  end if;
  if v_p.estado = 'pendiente' then
    raise exception 'Aceptá el presupuesto antes de facturarlo' using errcode = 'PT409';
  end if;
  if v_p.estado <> 'aceptado' then
    raise exception 'Este presupuesto ya no se puede facturar' using errcode = 'PT409';
  end if;
  if v_p.valido_hasta is not null and v_p.valido_hasta < v_hoy then
    raise exception 'El presupuesto está vencido y no se puede facturar' using errcode = 'PT409';
  end if;

  select e.nombre into v_empresa_nombre
    from dominio.empresas e
   where e.id = v_p.empresa_id and e.organizacion_id = v_org and e.activa;
  if not found then
    raise exception 'La tienda del presupuesto está desactivada' using errcode = '22023', hint = 'empresa_id';
  end if;
  if not exists (
    select 1 from dominio.clientes c
     where c.id = v_p.cliente_id and c.organizacion_id = v_org and c.archivado_en is null
  ) then
    raise exception 'El cliente del presupuesto ya no está disponible' using errcode = '22023', hint = 'cliente_id';
  end if;

  select count(*) into v_lineas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_p.id and l.organizacion_id = v_org;
  if v_lineas = 0 then
    raise exception 'El presupuesto no tiene líneas para facturar' using errcode = '22023', hint = 'lineas';
  end if;

  select l.descripcion into v_inactivo
    from dominio.comprobantes_venta_lineas l
    join dominio.productos p on p.id = l.producto_id and p.organizacion_id = v_org
   where l.comprobante_id = v_p.id and l.organizacion_id = v_org and not p.activo
   order by l.orden
   limit 1;
  if v_inactivo is not null then
    raise exception 'El producto «%» ya no está activo: reactivalo para facturar el presupuesto', v_inactivo
      using errcode = '22023', hint = 'producto_id';
  end if;

  select d.id into v_defecto
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_p.empresa_id
   where d.organizacion_id = v_org and d.por_defecto and d.activo;

  -- Forma de pago y de envío: se copian solo si siguen vigentes en la tienda (si no, la factura queda sin elegir).
  v_forma_pago := v_p.forma_pago_id;
  v_envio := v_p.envio_id;
  begin
    perform private.validar_catalogo_comprobante(v_org, v_p.empresa_id, v_forma_pago, null);
  exception when sqlstate '22023' then
    v_forma_pago := null;
  end;
  begin
    perform private.validar_catalogo_comprobante(v_org, v_p.empresa_id, null, v_envio);
  exception when sqlstate '22023' then
    v_envio := null;
  end;

  v_numero := private.siguiente_numero_comprobante(v_p.empresa_id, 'factura');
  insert into dominio.comprobantes_venta (
    organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
    total_sin_iva, total_con_iva, canal, operador_id, forma_pago_id, envio_id, contacto_id, origen_presupuesto_id
  )
  values (
    v_org, v_p.empresa_id, v_p.cliente_id, 'factura', lpad(v_numero::text, 8, '0'), v_numero, v_hoy, 'borrador',
    0, 0, v_p.canal, v_actor, v_forma_pago, v_envio, v_p.contacto_id, v_p.id
  )
  returning * into v_f;

  -- Líneas congeladas: todo se copia tal cual; solo el depósito se reemplaza si la tienda ya no lo usa. El costo y la cotización
  -- los fija la confirmación, como en cualquier factura.
  insert into dominio.comprobantes_venta_lineas (
    organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
    precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
    descuento_pct, sin_stock, precio_referencia, promocion_id, lista_precio_id, lista_ajuste_pct
  )
  select l.organizacion_id, v_f.id, l.orden, l.producto_id, l.descripcion, l.codigo, l.cantidad, l.precio_unitario, l.escala,
         l.precio_manual, l.alicuota_id, l.alicuota_porcentaje,
         case when exists (
           select 1 from dominio.depositos d
             join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_p.empresa_id
            where d.id = l.deposito_id and d.organizacion_id = v_org and d.activo
         ) then l.deposito_id else v_defecto end,
         l.a_pedido, l.subtotal_sin_iva, l.iva,
         l.descuento_pct, l.sin_stock, l.precio_referencia, l.promocion_id, l.lista_precio_id, l.lista_ajuste_pct
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_p.id and l.organizacion_id = v_org
   order by l.orden;

  select coalesce(sum(l.subtotal_sin_iva), 0), coalesce(sum(l.iva), 0) into v_sin_iva, v_iva
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_f.id and l.organizacion_id = v_org;

  update dominio.comprobantes_venta
     set total_sin_iva = v_sin_iva,
         total_con_iva = v_sin_iva + v_iva,
         updated_at = clock_timestamp()
   where id = v_f.id
  returning * into v_f;

  update dominio.comprobantes_venta
     set estado = 'convertido',
         updated_at = clock_timestamp()
   where id = v_p.id;

  perform private.registrar_actividad(
    'presupuesto.facturado',
    format('Facturó el presupuesto %s como la factura %s en %s', v_p.numero, v_f.numero, v_empresa_nombre),
    v_f.empresa_id
  );
  return v_f;
end;
$function$;

-- confirmar_cotizacion
CREATE OR REPLACE FUNCTION public.confirmar_cotizacion(p_empresa uuid DEFAULT NULL::uuid, p_variacion_vista numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_config record;
  v_empresa uuid;
  v_nombre_empresa text;
  v_pendiente dominio.cotizacion_pendiente;
  v_vigente numeric;
  v_variacion numeric;
  v_ultima numeric;
  v_recalcula boolean;
  v_precios integer := 0;
  v_nombre text;
  v_id uuid;
  v_valor_txt text;
  v_donde text := '';
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede confirmar la cotización del dólar' using errcode = '42501';
  end if;
  -- El lock va ANTES de leer la configuración: un guardar_configuracion_cotizacion concurrente (mismo lock) no deja el umbral
  -- ni la confirmación desfasados respecto de lo que se aplica.
  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  select * into v_config from private.cotizacion_config(v_organizacion);
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  select * into v_pendiente from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa and p.expira_en > now()
   for update;
  if not found then
    raise exception 'sin_cotizacion_pendiente' using errcode = 'PT404';
  end if;

  -- Umbral y variación inusual: se miden contra la cotización APLICADA (la que usan los precios), no contra la última
  -- carga registrada; así varias cargas bajo el umbral no acumulan una deriva sin aviso (MSF-352).
  v_vigente := private.cotizacion_para(v_organizacion, v_empresa);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente * v_config.umbral_pct;

  -- Variación inusual: el cliente tiene que mandar la variación que VIO (p_variacion_vista) y debe coincidir con la real
  -- (tolerancia 0,05 puntos: tolera un valor redondeado a 1 decimal). Un booleano no alcanza: si otro usuario aplicó un dólar distinto entre la vista previa y la
  -- confirmación, la variación real pudo pasar de +16 % a +60 % sin que nadie la viera.
  if v_variacion is not null and abs(v_variacion) > v_config.confirmacion_pct then
    if p_variacion_vista is null then
      raise exception 'La variación de la cotización (% %%) supera el % %% configurado: confirmala explícitamente',
        trim_scale(v_variacion)::text, trim_scale(v_config.confirmacion_pct)::text
        using errcode = '22023', hint = 'variacion_inusual';
    elsif abs(v_variacion - p_variacion_vista) > 0.05 then
      raise exception 'El dólar cambió mientras revisabas: revisá de nuevo'
        using errcode = '22023', hint = 'variacion_cambio';
    end if;
  end if;

  -- El historial conserva la carga ANTERIOR (valor_anterior y variacion_pct entre cargas consecutivas, como lo muestra
  -- `listar_cotizaciones`); la decisión de arriba se tomó contra la aplicada.
  v_ultima := private.cotizacion_vigente_para(v_organizacion, v_empresa);

  if v_recalcula then
    select coalesce(sum(u.precios), 0)::integer into v_precios
      from private.precios_usd_por_empresa(v_organizacion) u
     where v_empresa is null or u.empresa_id = v_empresa;
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pf.nombre, pf.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pf on pf.user_id = u.id
   where u.id = coalesce(v_pendiente.cargada_por, v_usuario);
  v_nombre := coalesce(v_nombre, 'Usuario');

  insert into dominio.cotizaciones (
    organizacion_id, empresa_id, valor, valor_anterior, variacion_pct, cargada_por, cargada_por_nombre,
    cargada_en, recalculo_aplicado, precios_recalculados, umbral_pct
  ) values (
    v_organizacion, v_empresa, v_pendiente.valor, v_ultima,
    case when v_ultima is null then null else round((v_pendiente.valor / v_ultima - 1) * 100, 4) end, coalesce(v_pendiente.cargada_por, v_usuario), v_nombre,
    clock_timestamp(), v_recalcula, v_precios, v_config.umbral_pct
  ) returning id into v_id;

  if v_recalcula then
    insert into dominio.cotizacion_aplicada as a (organizacion_id, empresa_id, valor, cotizacion_id, aplicada_en)
    values (v_organizacion, v_empresa, v_pendiente.valor, v_id, now())
    on conflict (organizacion_id, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update
      set valor = excluded.valor, cotizacion_id = excluded.cotizacion_id, aplicada_en = excluded.aplicada_en;
  end if;

  delete from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa;

  if v_empresa is not null then
    select e.nombre into v_nombre_empresa from dominio.empresas e where e.id = v_empresa;
    v_donde := format(' (%s)', v_nombre_empresa);
  end if;
  v_valor_txt := trim_scale(v_pendiente.valor)::text;
  perform private.insertar_actividad(
    v_organizacion, v_usuario, 'cotizacion.cargada',
    format('Confirmó la cotización del dólar: $ %s%s', v_valor_txt, v_donde), v_empresa
  );
  if v_recalcula then
    perform private.insertar_actividad(
      v_organizacion, v_usuario, 'recalculo.aplicado',
      format('Recalculó %s precios con el dólar a $ %s%s', v_precios, v_valor_txt, v_donde), v_empresa
    );
  else
    perform private.insertar_actividad(
      v_organizacion, v_usuario, 'recalculo.omitido',
      format('Registró el dólar a $ %s sin recalcular: la variación es menor al umbral de %s %%%s',
             v_valor_txt, trim_scale(v_config.umbral_pct)::text, v_donde), v_empresa
    );
  end if;

  return jsonb_build_object('id', v_id, 'recalculo_aplicado', v_recalcula, 'precios_recalculados', v_precios);
end;
$function$;

comment on function public.confirmar_cotizacion(p_empresa uuid, p_variacion_vista numeric) is 'F-PRE-03/F-PRE-06: confirma la cotización pendiente (de la organización o de p_empresa) en una transacción: historial (con el umbral usado), cotización aplicada (si la variación alcanza el umbral configurado), eventos. El umbral y la variación se miden contra la cotización aplicada; si |variación| supera la confirmación configurada exige p_variacion_vista (la variación que el usuario vio) y que coincida con la real ±0,05 (22023: hint variacion_inusual si falta, variacion_cambio si difiere). 42501 sin edición; PT404 sin_cotizacion_pendiente (la empresa ajena la rechaza un auxiliar de private con P0002); 22023 falta empresa.';

-- detalle_anulacion_nota_credito
CREATE OR REPLACE FUNCTION public.detalle_anulacion_nota_credito(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_resta numeric(14, 2);
  v_tiene_notas boolean;
  v_operativa boolean;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  select v_c.total_sin_iva - coalesce(sum(n.total_sin_iva), 0), count(*) > 0
    into v_resta, v_tiene_notas
    from dominio.comprobantes_venta n
   where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito';
  v_operativa := v_c.tipo = 'factura' and v_c.estado not in ('borrador', 'anulada');

  return jsonb_build_object(
    'puede_anular', v_operativa and v_c.estado <> 'cobrado' and not v_tiene_notas
      and (select private.puede_accion_comprobante(v_c.empresa_id, 'anular')),
    'puede_emitir_nota_credito', v_operativa and v_resta > 0
      and (select private.puede_accion_comprobante(v_c.empresa_id, 'emitir_nota_credito')),
    'anulacion', case when v_c.anulado_en is null then null else jsonb_build_object(
      'cuando', v_c.anulado_en,
      'quien', coalesce((
        select nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), '')
          from public.perfiles_usuario p where p.user_id = v_c.anulado_por), 'Usuario sin nombre'),
      'motivo', v_c.motivo_anulacion
    ) end,
    'acreditable_sin_iva', case when v_c.tipo = 'factura' then v_resta else 0 end,
    'lineas_acreditables', case when v_c.tipo <> 'factura' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'linea_id', l.id,
        'orden', l.orden,
        'descripcion', l.descripcion,
        'cantidad', l.cantidad,
        'devuelta', d.devuelta,
        'disponible', l.cantidad - d.devuelta,
        'precio_unitario', l.precio_unitario,
        'deposito', dep.nombre
      ) order by l.orden)
      from dominio.comprobantes_venta_lineas l
      left join dominio.depositos dep on dep.id = l.deposito_id and dep.organizacion_id = l.organizacion_id
      cross join lateral (
        select coalesce(sum(nl.cantidad), 0)::integer as devuelta
          from dominio.comprobantes_venta_lineas nl
          join dominio.comprobantes_venta n on n.id = nl.comprobante_id and n.organizacion_id = nl.organizacion_id
         where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id
           and n.nc_tipo = 'devolucion_productos' and nl.orden = l.orden
      ) d
      where l.comprobante_id = v_c.id and l.organizacion_id = v_org
    ), '[]'::jsonb) end,
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id,
        'numero', n.numero,
        'nc_tipo', n.nc_tipo,
        'concepto', n.nc_concepto,
        'fecha', n.fecha,
        'total_sin_iva', n.total_sin_iva,
        'total_con_iva', n.total_con_iva,
        'lineas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'orden', nl.orden,
            'descripcion', nl.descripcion,
            'cantidad', nl.cantidad,
            'precio_unitario', nl.precio_unitario,
            'subtotal_sin_iva', nl.subtotal_sin_iva,
            'iva', nl.iva
          ) order by nl.orden)
          from dominio.comprobantes_venta_lineas nl
          where nl.comprobante_id = n.id and nl.organizacion_id = v_org
        ), '[]'::jsonb)
      ) order by n.numero_entero)
      from dominio.comprobantes_venta n
      where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito'
    ), '[]'::jsonb)
  );
end;
$function$;

-- borrar_datos_suscriptor_newsletter
CREATE OR REPLACE FUNCTION public.borrar_datos_suscriptor_newsletter(p_suscriptor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.newsletter_suscriptores%rowtype;
begin
  select * into v_fila from dominio.newsletter_suscriptores s where s.id = p_suscriptor and s.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El suscriptor no existe' using errcode = 'PT404';
  end if;
  perform private.exigir_admin_newsletter(v_fila.empresa_id);
  -- Envíos pasados: el correo copiado queda `[eliminado]` y lo pendiente se omite; después la FK suelta `suscriptor_id`.
  update dominio.campana_correo_destinatarios d
     set correo = '[eliminado]',
         estado = case when d.estado = 'pendiente' then 'omitido' else d.estado end,
         reclamado_hasta = null
   where d.suscriptor_id = v_fila.id and d.organizacion_id = v_org;
  delete from dominio.newsletter_suscriptores s where s.id = v_fila.id;
  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.datos_borrados', 'Borró los datos de un suscriptor del newsletter', v_fila.empresa_id);
  return jsonb_build_object('ok', true);
end;
$function$;

-- dar_de_baja_suscriptor_newsletter
CREATE OR REPLACE FUNCTION public.dar_de_baja_suscriptor_newsletter(p_suscriptor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.newsletter_suscriptores%rowtype;
begin
  select * into v_fila from dominio.newsletter_suscriptores s where s.id = p_suscriptor and s.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El suscriptor no existe' using errcode = 'PT404';
  end if;
  perform private.exigir_admin_newsletter(v_fila.empresa_id);
  if v_fila.estado <> 'baja' then
    update dominio.newsletter_suscriptores s
       set estado = 'baja', baja_en = now(), confirmacion_hash = null, confirmacion_vence = null, confirmacion_reclamada_hasta = null
     where s.id = v_fila.id;
    -- Lo pendiente de envíos en curso no sale (CA-NL-2).
    update dominio.campana_correo_destinatarios d
       set estado = 'omitido', reclamado_hasta = null
     where d.suscriptor_id = v_fila.id and d.organizacion_id = v_org and d.estado = 'pendiente';
    perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.baja_manual', 'Dio de baja a un suscriptor del newsletter', v_fila.empresa_id);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

-- detalle_newsletter
CREATE OR REPLACE FUNCTION public.detalle_newsletter(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_res jsonb;
begin
  if v_org is null or (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el newsletter' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'id', n.id, 'version', n.version, 'empresa_id', n.empresa_id, 'tienda', e.nombre,
           'nombre_interno', n.nombre_interno, 'asunto', n.asunto, 'mensaje', n.mensaje,
           'incluir_destacados', n.incluir_destacados, 'incluir_promociones', n.incluir_promociones,
           'contenido_enviado', n.contenido_enviado, 'enviada_en', n.enviada_en, 'cancelada_en', n.cancelada_en,
           'creada_en', n.creada_en, 'actualizada_en', n.actualizada_en,
           'estado', case when n.enviada_en is null then 'borrador'
                          when n.cancelada_en is not null then 'cancelada'
                          when t.pendientes > 0 then 'enviando' else 'enviada' end,
           'destinatarios', t.destinatarios, 'enviados', t.enviados, 'fallidos', t.fallidos,
           'omitidos', t.omitidos, 'pendientes', t.pendientes, 'bajas', t.bajas)
    into v_res
    from dominio.newsletters n
    join dominio.empresas e on e.id = n.empresa_id and e.organizacion_id = n.organizacion_id
    cross join lateral (
      select count(d.id)::int as destinatarios,
             (count(d.id) filter (where d.estado = 'enviado'))::int as enviados,
             (count(d.id) filter (where d.estado = 'fallido'))::int as fallidos,
             (count(d.id) filter (where d.estado = 'omitido'))::int as omitidos,
             (count(d.id) filter (where d.estado = 'pendiente'))::int as pendientes,
             (count(d.id) filter (where d.baja_en is not null))::int as bajas
        from dominio.campana_correo_destinatarios d
       where d.campana_id = n.campana_id and d.organizacion_id = n.organizacion_id
    ) t
   where n.id = p_id and n.organizacion_id = v_org and n.empresa_id in (select private.empresas_accesibles());
  if v_res is null then
    raise exception 'El newsletter no existe' using errcode = 'PT404';
  end if;
  return v_res;
end;
$function$;

-- cancelar_envio_newsletter
CREATE OR REPLACE FUNCTION public.cancelar_envio_newsletter(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_n dominio.newsletters%rowtype;
  v_omitidos integer := 0;
begin
  select * into v_n from dominio.newsletters n where n.id = p_id and n.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El newsletter no existe' using errcode = 'PT404';
  end if;
  perform private.exigir_admin_newsletter(v_n.empresa_id);
  if v_n.enviada_en is null then
    raise exception 'El newsletter todavía no se envió' using errcode = 'PT409';
  end if;
  if v_n.cancelada_en is not null then
    return jsonb_build_object('cancelados', 0);
  end if;

  update dominio.campana_correo_destinatarios d
     set estado = 'omitido', error = 'Cancelado', reclamado_hasta = null
   where d.campana_id = v_n.campana_id and d.organizacion_id = v_org and d.estado = 'pendiente'
     and (d.reclamado_hasta is null or d.reclamado_hasta < now());
  get diagnostics v_omitidos = row_count;
  update dominio.newsletters n set cancelada_en = now(), actualizada_en = now() where n.id = v_n.id;

  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.cancelar',
    format('Canceló el envío del newsletter «%s» (%s sin enviar)', left(v_n.asunto, 120), v_omitidos), v_n.empresa_id);
  return jsonb_build_object('cancelados', v_omitidos);
end;
$function$;

-- descartar_newsletter
CREATE OR REPLACE FUNCTION public.descartar_newsletter(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_fila dominio.newsletters%rowtype;
begin
  select * into v_fila from dominio.newsletters n where n.id = p_id and n.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El newsletter no existe' using errcode = 'PT404';
  end if;
  perform private.exigir_admin_newsletter(v_fila.empresa_id);
  if v_fila.enviada_en is not null then
    raise exception 'Un newsletter enviado no se puede descartar' using errcode = 'PT409';
  end if;
  delete from dominio.newsletters n where n.id = p_id;
  return jsonb_build_object('ok', true);
end;
$function$;

comment on function public.descartar_newsletter(p_id uuid) is 'MSF-468 (RF-NL-14): descarta un borrador; Administrador; PT409 si ya se envió.';

-- enviar_newsletter
CREATE OR REPLACE FUNCTION public.enviar_newsletter(p_id uuid, p_version integer, p_clave uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_n dominio.newsletters%rowtype;
  v_campana uuid;
  v_total integer;
  v_bloques jsonb;
begin
  select * into v_n from dominio.newsletters n where n.id = p_id and n.organizacion_id = v_org for update;
  if not found then
    perform private.exigir_admin_newsletter(null);
    raise exception 'El newsletter no existe' using errcode = 'PT404';
  end if;
  perform private.exigir_admin_newsletter(v_n.empresa_id);
  if p_clave is null then
    raise exception 'Falta la clave del envío' using errcode = '22023', hint = 'clave';
  end if;
  if not private.bandera_activa('newsletter') then
    raise exception 'El newsletter no está habilitado en este entorno' using errcode = '55000';
  end if;

  if v_n.enviada_en is not null then
    -- Reintento del mismo pedido: devuelve la misma campaña. Cualquier otra clave sobre un envío cerrado es un error.
    if exists (select 1 from dominio.campanas_correo c where c.id = v_n.campana_id and c.organizacion_id = v_org and c.clave = p_clave) then
      return jsonb_build_object('campana_id', v_n.campana_id,
        'destinatarios', (select count(*)::int from dominio.campana_correo_destinatarios d where d.campana_id = v_n.campana_id and d.organizacion_id = v_org));
    end if;
    raise exception 'Este newsletter ya se envió' using errcode = 'PT409';
  end if;
  if p_version is distinct from v_n.version then
    raise exception 'El borrador cambió: recargá para ver la última versión' using errcode = 'PT412';
  end if;
  if not coalesce((select c.activo from dominio.newsletter_configuracion c where c.empresa_id = v_n.empresa_id and c.organizacion_id = v_org), false) then
    raise exception 'Activá el newsletter de la tienda antes de enviar' using errcode = '22023', hint = 'tienda_apagada';
  end if;
  if not exists (select 1 from dominio.empresas e join dominio.tiendas t on t.empresa_id = e.id and t.organizacion_id = e.organizacion_id
                  where e.id = v_n.empresa_id and e.organizacion_id = v_org and e.activa) then
    raise exception 'La tienda no tiene un dominio activo para armar los enlaces' using errcode = '22023', hint = 'sin_dominio';
  end if;
  if exists (select 1 from dominio.campanas_correo c where c.organizacion_id = v_org and c.clave = p_clave) then
    raise exception 'La clave del envío ya se usó en otra campaña' using errcode = '22023', hint = 'clave';
  end if;

  v_bloques := private.armar_bloques_newsletter(v_n.empresa_id, v_n.incluir_destacados, v_n.incluir_promociones);

  insert into dominio.campanas_correo (organizacion_id, empresa_id, clave, asunto, mensaje, creada_por, tipo, newsletter_id, bloques)
  values (v_org, v_n.empresa_id, p_clave, v_n.asunto, v_n.mensaje, (select auth.uid()), 'newsletter', v_n.id, v_bloques)
  returning id into v_campana;

  -- Foto de los confirmados de ESTA tienda (MSF-967). `for share` hace esperar a una baja o a un borrado simultáneos.
  insert into dominio.campana_correo_destinatarios (organizacion_id, campana_id, suscriptor_id, correo)
  select v_org, v_campana, s.id, s.correo
    from dominio.newsletter_suscriptores s
   where s.organizacion_id = v_org and s.empresa_id = v_n.empresa_id and s.estado = 'confirmado'
   order by s.creado_en, s.id
     for share of s;
  get diagnostics v_total = row_count;
  if v_total = 0 then
    -- Se deshace todo lo escrito arriba (la excepción cancela la función entera).
    raise exception 'Todavía no hay suscriptores confirmados' using errcode = '22023', hint = 'sin_destinatarios';
  end if;

  update dominio.newsletters n
     set contenido_enviado = v_bloques, campana_id = v_campana, enviada_en = now(), version = n.version + 1, actualizada_en = now()
   where n.id = v_n.id;

  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.enviar',
    format('Envió el newsletter «%s» a %s %s', left(v_n.asunto, 120), v_total, case when v_total = 1 then 'suscriptor' else 'suscriptores' end), v_n.empresa_id);
  return jsonb_build_object('campana_id', v_campana, 'destinatarios', v_total);
end;
$function$;

-- guardar_newsletter
CREATE OR REPLACE FUNCTION public.guardar_newsletter(p_id uuid, p_version integer, p_empresa uuid, p_nombre text, p_asunto text, p_mensaje text, p_destacados boolean, p_promociones boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := private.exigir_admin_newsletter(p_empresa);
  v_fila dominio.newsletters%rowtype;
  v_version integer;
begin
  if p_empresa is null then
    raise exception 'La tienda no existe' using errcode = 'P0002';
  end if;
  if not private.bandera_activa('newsletter') then
    raise exception 'El newsletter no está habilitado en este entorno' using errcode = '55000';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' or char_length(p_nombre) > 100 then
    raise exception 'El nombre interno es obligatorio y admite hasta 100 caracteres' using errcode = '22023', hint = 'nombre';
  end if;
  perform private.validar_redaccion_correo_masivo(p_asunto, p_mensaje);
  if p_destacados is null or p_promociones is null then
    raise exception 'Falta indicar las secciones del newsletter' using errcode = '22023';
  end if;

  if p_id is null then
    insert into dominio.newsletters (organizacion_id, empresa_id, nombre_interno, asunto, mensaje, incluir_destacados, incluir_promociones, creada_por)
    values (v_org, p_empresa, btrim(p_nombre), btrim(p_asunto), p_mensaje, p_destacados, p_promociones, (select auth.uid()))
    returning id, version into p_id, v_version;
  else
    select * into v_fila from dominio.newsletters n where n.id = p_id and n.organizacion_id = v_org for update;
    if not found then
      raise exception 'El newsletter no existe' using errcode = 'PT404';
    end if;
    -- Un borrador de una tienda sin acceso no se toca, aunque el destino sea otra.
    perform private.exigir_admin_newsletter(v_fila.empresa_id);
    if v_fila.enviada_en is not null then
      raise exception 'Un newsletter enviado no se puede editar' using errcode = 'PT409';
    end if;
    if p_version is distinct from v_fila.version then
      raise exception 'El borrador cambió: recargá para ver la última versión' using errcode = 'PT412';
    end if;
    update dominio.newsletters n
       set empresa_id = p_empresa, nombre_interno = btrim(p_nombre), asunto = btrim(p_asunto), mensaje = p_mensaje,
           incluir_destacados = p_destacados, incluir_promociones = p_promociones,
           version = n.version + 1, actualizada_en = now()
     where n.id = p_id
    returning version into v_version;
  end if;
  perform private.insertar_actividad(v_org, (select auth.uid()), 'newsletter.guardar', 'Guardó un borrador de newsletter', p_empresa);
  return jsonb_build_object('id', p_id, 'version', v_version);
end;
$function$;

comment on function public.guardar_newsletter(p_id uuid, p_version integer, p_empresa uuid, p_nombre text, p_asunto text, p_mensaje text, p_destacados boolean, p_promociones boolean) is 'MSF-468 (RF-NL-14): crea o actualiza un borrador; Administrador; PT412 si cambió; PT409 si ya se envió; 55000 si la bandera está apagada.';

-- actualizar_reparacion
CREATE OR REPLACE FUNCTION public.actualizar_reparacion(p_id uuid, p_actualizado_en timestamp with time zone, p_cliente_id uuid, p_modelo_id uuid, p_contacto text DEFAULT ''::text, p_numero_serie text DEFAULT NULL::text, p_accesorios text DEFAULT ''::text, p_falla text DEFAULT ''::text, p_costo_mano_obra numeric DEFAULT NULL::numeric, p_costo_repuestos numeric DEFAULT NULL::numeric, p_tecnico_id uuid DEFAULT NULL::uuid, p_ingreso_en date DEFAULT NULL::date, p_entrega_prevista date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
  v_ingreso date;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede editar reparaciones' using errcode = '42501';
  end if;

  -- Serializa ediciones concurrentes de la misma reparación.
  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'No tenés acceso a la tienda de esta reparación' using errcode = '42501';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'La reparación fue modificada por otra persona' using errcode = 'PT412';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación está anulada y no se puede editar' using errcode = 'PT409';
  end if;

  if p_cliente_id is null then
    raise exception 'Elegí el cliente' using errcode = '22023', hint = 'cliente_id';
  end if;
  if p_cliente_id <> v_actual.cliente_id and not exists (
    select 1 from dominio.clientes c
     where c.id = p_cliente_id and c.organizacion_id = v_org and c.archivado_en is null
  ) then
    raise exception 'El cliente no existe o está archivado' using errcode = '22023', hint = 'cliente_id';
  end if;
  if p_modelo_id is null then
    raise exception 'Elegí el modelo' using errcode = '22023', hint = 'modelo_id';
  end if;
  if p_modelo_id <> v_actual.modelo_id and not exists (
    select 1 from dominio.modelos_equipo m
     where m.id = p_modelo_id and m.organizacion_id = v_org and m.activo
  ) then
    raise exception 'El modelo no existe o está desactivado' using errcode = '22023', hint = 'modelo_id';
  end if;
  if p_costo_mano_obra < 0 then
    raise exception 'El costo de mano de obra no puede ser negativo' using errcode = '22023', hint = 'costo_mano_obra';
  end if;
  if p_costo_repuestos < 0 then
    raise exception 'El costo de repuestos no puede ser negativo' using errcode = '22023', hint = 'costo_repuestos';
  end if;
  if (p_costo_mano_obra is not null or p_costo_repuestos is not null)
     and not (select private.puede_accion('service_tecnico', 'ver_costos')) then
    raise exception 'Tu rol no puede cargar costos internos' using errcode = '42501';
  end if;
  if p_tecnico_id is not null and p_tecnico_id is distinct from v_actual.tecnico_id
     and not private.es_tecnico_de_service(p_tecnico_id) then
    raise exception 'El técnico no es válido' using errcode = '22023', hint = 'tecnico_id';
  end if;
  v_ingreso := coalesce(p_ingreso_en, v_actual.ingreso_en);
  if p_entrega_prevista is not null and p_entrega_prevista < v_ingreso then
    raise exception 'La entrega prevista no puede ser anterior al ingreso' using errcode = '22023', hint = 'entrega_prevista';
  end if;

  update dominio.reparaciones
     set cliente_id = p_cliente_id,
         modelo_id = p_modelo_id,
         contacto = coalesce(p_contacto, ''),
         numero_serie = p_numero_serie,
         accesorios = coalesce(p_accesorios, ''),
         falla = coalesce(p_falla, ''),
         costo_mano_obra = coalesce(p_costo_mano_obra, costo_mano_obra),
         costo_repuestos = coalesce(p_costo_repuestos, costo_repuestos),
         tecnico_id = p_tecnico_id,
         ingreso_en = v_ingreso,
         entrega_prevista = p_entrega_prevista
   where id = p_id;

  return private.reparacion_json(p_id);
end;
$function$;

comment on function public.actualizar_reparacion(p_id uuid, p_actualizado_en timestamp with time zone, p_cliente_id uuid, p_modelo_id uuid, p_contacto text, p_numero_serie text, p_accesorios text, p_falla text, p_costo_mano_obra numeric, p_costo_repuestos numeric, p_tecnico_id uuid, p_ingreso_en date, p_entrega_prevista date) is 'F-SVC-02: edita una reparación con bloqueo optimista (PT412); rechaza anuladas (PT409); no cambia número, tienda ni estado; costos solo con ver_costos.';

-- anular_reparacion
CREATE OR REPLACE FUNCTION public.anular_reparacion(p_id uuid, p_motivo text, p_consumidos uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_consumidos uuid[] := coalesce(p_consumidos, '{}');
  v_entregada boolean;
  v_item uuid;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede anular reparaciones' using errcode = '42501';
  end if;

  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'No tenés acceso a la tienda de esta reparación' using errcode = '42501';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación ya está anulada' using errcode = 'PT409';
  end if;
  if v_motivo = '' then
    raise exception 'Indicá el motivo de la anulación' using errcode = '22023', hint = 'motivo';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'Máximo 500 caracteres' using errcode = '22023', hint = 'motivo';
  end if;

  v_entregada := v_actual.entrega_real is not null
    or exists (select 1 from dominio.estados_reparacion s
                where s.id = v_actual.estado_id and s.organizacion_id = v_org and s.cierra);

  -- Los consumidos deben ser repuestos descontados de ESTA reparación (y sin repetir).
  if cardinality(v_consumidos) > 0 and (
       v_entregada
       or (select count(distinct c) from unnest(v_consumidos) c) <> cardinality(v_consumidos)
       or (select count(*) from dominio.reparacion_items i
            where i.reparacion_id = p_id and i.organizacion_id = v_org
              and i.stock_estado = 'descontado' and i.id = any (v_consumidos)) <> cardinality(v_consumidos)) then
    raise exception 'Solo se puede marcar como consumido un repuesto descontado de esta reparación'
      using errcode = '22023', hint = 'consumidos';
  end if;

  update dominio.reparaciones
     set anulada_en = now(), anulada_motivo = v_motivo
   where id = p_id;

  if not v_entregada then
    for v_item in
      select i.id from dominio.reparacion_items i
       where i.reparacion_id = p_id and i.organizacion_id = v_org and i.stock_estado = 'descontado'
       order by i.producto_id, i.id
    loop
      if v_item = any (v_consumidos) then
        update dominio.reparacion_items set stock_estado = 'consumido' where id = v_item;
      else
        perform private.devolver_stock_item_reparacion(v_org, v_item);
      end if;
    end loop;
  end if;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_anterior_id, estado_nuevo_id, nota, usuario_id, creado_en)
  values (v_org, p_id, 'anulacion', v_actual.estado_id, v_actual.estado_id, v_motivo, (select auth.uid()), clock_timestamp());

  return private.reparacion_json(p_id);
end;
$function$;

-- cambiar_estado_reparacion
CREATE OR REPLACE FUNCTION public.cambiar_estado_reparacion(p_id uuid, p_estado_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
  v_cierra_actual boolean;
  v_nuevo dominio.estados_reparacion;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de reparaciones' using errcode = '42501';
  end if;

  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'No tenés acceso a la tienda de esta reparación' using errcode = '42501';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación está anulada y no se puede modificar' using errcode = 'PT409';
  end if;
  select s.cierra into v_cierra_actual
    from dominio.estados_reparacion s
   where s.id = v_actual.estado_id and s.organizacion_id = v_org;
  if v_actual.entrega_real is not null or coalesce(v_cierra_actual, false) then
    raise exception 'La reparación ya fue entregada o cerrada y no admite más cambios de estado' using errcode = 'PT409';
  end if;

  if p_estado_id is null then
    raise exception 'Elegí el estado' using errcode = '22023', hint = 'estado_id';
  end if;
  select * into v_nuevo
    from dominio.estados_reparacion s
   where s.id = p_estado_id and s.organizacion_id = v_org;
  if not found or not v_nuevo.activo then
    raise exception 'El estado no existe o está desactivado' using errcode = '22023', hint = 'estado_id';
  end if;

  -- Idempotente: el estado actual no duplica historial.
  if v_nuevo.id = v_actual.estado_id then
    return private.reparacion_json(p_id);
  end if;
  if v_nuevo.cierra then
    raise exception 'Para cerrar la reparación registrá la entrega' using errcode = '22023', hint = 'estado_id';
  end if;

  update dominio.reparaciones set estado_id = v_nuevo.id where id = p_id;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_anterior_id, estado_nuevo_id, usuario_id, creado_en)
  values (v_org, p_id, 'estado', v_actual.estado_id, v_nuevo.id, (select auth.uid()), clock_timestamp());

  return private.reparacion_json(p_id);
end;
$function$;

comment on function public.cambiar_estado_reparacion(p_id uuid, p_estado_id uuid) is 'F-SVC-03: cambia el estado (activo, de la organización); idempotente; rechaza anuladas y cerradas (PT409) y estados que cierran (van por entrega). Solo con edición en Service técnico.';

-- registrar_entrega_reparacion
CREATE OR REPLACE FUNCTION public.registrar_entrega_reparacion(p_id uuid, p_estado_id uuid, p_entrega_real date, p_entregado_por text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_actual dominio.reparaciones;
  v_cierra_actual boolean;
  v_nuevo dominio.estados_reparacion;
  v_quien text := btrim(coalesce(p_entregado_por, ''));
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede registrar entregas' using errcode = '42501';
  end if;

  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'No tenés acceso a la tienda de esta reparación' using errcode = '42501';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación está anulada y no se puede modificar' using errcode = 'PT409';
  end if;
  select s.cierra into v_cierra_actual
    from dominio.estados_reparacion s
   where s.id = v_actual.estado_id and s.organizacion_id = v_org;
  if v_actual.entrega_real is not null or coalesce(v_cierra_actual, false) then
    raise exception 'La reparación ya fue entregada o cerrada' using errcode = 'PT409';
  end if;

  if p_estado_id is null then
    raise exception 'Elegí el estado' using errcode = '22023', hint = 'estado_id';
  end if;
  select * into v_nuevo
    from dominio.estados_reparacion s
   where s.id = p_estado_id and s.organizacion_id = v_org;
  if not found or not v_nuevo.activo then
    raise exception 'El estado no existe o está desactivado' using errcode = '22023', hint = 'estado_id';
  end if;
  if not v_nuevo.cierra then
    raise exception 'Ese estado no cierra la reparación' using errcode = '22023', hint = 'estado_id';
  end if;
  if p_entrega_real is null then
    raise exception 'Ingresá la fecha de entrega' using errcode = '22023', hint = 'entrega_real';
  end if;
  if p_entrega_real < v_actual.ingreso_en then
    raise exception 'La entrega no puede ser anterior al ingreso' using errcode = '22023', hint = 'entrega_real';
  end if;
  if p_entrega_real > v_hoy then
    raise exception 'La entrega no puede ser una fecha futura' using errcode = '22023', hint = 'entrega_real';
  end if;
  if v_quien = '' then
    raise exception 'Indicá quién retira o recibe el equipo' using errcode = '22023', hint = 'entregado_por';
  end if;
  if length(v_quien) > 200 then
    raise exception 'Máximo 200 caracteres' using errcode = '22023', hint = 'entregado_por';
  end if;

  update dominio.reparaciones
     set estado_id = v_nuevo.id, entrega_real = p_entrega_real, entregado_por = v_quien
   where id = p_id;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_anterior_id, estado_nuevo_id, nota, usuario_id, creado_en)
  values (v_org, p_id, 'entrega', v_actual.estado_id, v_nuevo.id, left('Entregó: ' || v_quien, 500), (select auth.uid()), clock_timestamp());

  return private.reparacion_json(p_id);
end;
$function$;

-- generar_comprobante_reparacion
CREATE OR REPLACE FUNCTION public.generar_comprobante_reparacion(p_reparacion uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rep dominio.reparaciones;
  v_empresa dominio.empresas;
  v_vigente uuid;
  v_nuevo dominio.comprobantes_venta;
  v_item record;
  v_gen_id uuid;
  v_gen_pct numeric;
  v_alicuota_id uuid;
  v_porcentaje numeric;
  v_codigo text;
  v_numero integer;
  v_orden integer := 0;
  v_subtotal numeric;
  v_iva numeric;
  v_total_sin numeric := 0;
  v_total_iva numeric := 0;
begin
  if v_org is null or v_actor is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede generar el comprobante de una reparación' using errcode = '42501';
  end if;
  if p_reparacion is null then
    raise exception 'Indicá la reparación' using errcode = '22023';
  end if;

  -- Serializa a quienes generan sobre la misma reparación: la segunda espera y ve el comprobante.
  select * into v_rep
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = v_org
   for update;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_rep.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede crear comprobantes en la tienda de esta reparación' using errcode = '42501';
  end if;
  if v_rep.anulada_en is not null then
    raise exception 'La reparación está anulada: no se puede generar su comprobante' using errcode = 'PT409';
  end if;

  -- Idempotente: con un comprobante vigente, se devuelve ese.
  select c.id into v_vigente
    from dominio.comprobantes_venta c
   where c.organizacion_id = v_org and c.origen_tipo = 'reparacion' and c.origen_id = v_rep.id
     and c.estado <> 'anulada';
  if found then
    return jsonb_build_object('comprobante_id', v_vigente, 'creado', false);
  end if;

  if not exists (
    select 1 from dominio.reparacion_items i where i.reparacion_id = v_rep.id and i.organizacion_id = v_org
  ) then
    raise exception 'La reparación no tiene ítems: cargá mano de obra o repuestos para generar el comprobante'
      using errcode = '22023';
  end if;
  select * into v_empresa from dominio.empresas e where e.id = v_rep.empresa_id and e.organizacion_id = v_org;
  if not found or not v_empresa.activa then
    raise exception 'La tienda de la reparación está desactivada' using errcode = '22023';
  end if;
  if not exists (
    select 1 from dominio.clientes c
     where c.id = v_rep.cliente_id and c.organizacion_id = v_org and c.archivado_en is null
  ) then
    raise exception 'El cliente de la reparación está archivado: restauralo para generar el comprobante'
      using errcode = '22023';
  end if;

  select g.alicuota_id, g.porcentaje into v_gen_id, v_gen_pct from private.alicuota_general(v_org) g;

  v_numero := private.siguiente_numero_comprobante(v_rep.empresa_id, 'factura');
  begin
    insert into dominio.comprobantes_venta (
      organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
      total_sin_iva, total_con_iva, canal, operador_id, origen_tipo, origen_id
    )
    values (
      v_org, v_rep.empresa_id, v_rep.cliente_id, 'factura', lpad(v_numero::text, 8, '0'), v_numero,
      current_date, 'borrador', 0, 0, 'mostrador', v_actor, 'reparacion', v_rep.id
    )
    returning * into v_nuevo;
  exception when unique_violation then
    -- Respaldo del índice único parcial: otra transacción ganó la carrera.
    select c.id into v_vigente
      from dominio.comprobantes_venta c
     where c.organizacion_id = v_org and c.origen_tipo = 'reparacion' and c.origen_id = v_rep.id
       and c.estado <> 'anulada';
    return jsonb_build_object('comprobante_id', v_vigente, 'creado', false);
  end;

  for v_item in
    select i.descripcion, i.cantidad, i.precio_unitario, i.producto_id, p.sku
      from dominio.reparacion_items i
      left join dominio.productos p on p.id = i.producto_id and p.organizacion_id = i.organizacion_id
     where i.reparacion_id = v_rep.id and i.organizacion_id = v_org
     order by i.creado_en, i.id
  loop
    v_orden := v_orden + 1;
    v_alicuota_id := null;
    v_porcentaje := null;
    if v_item.producto_id is not null then
      select a.alicuota_id, case when a.exento then 0 else a.porcentaje end
        into v_alicuota_id, v_porcentaje
        from private.alicuota_producto(v_item.producto_id) a;
    end if;
    if v_porcentaje is null then
      v_alicuota_id := v_gen_id;
      v_porcentaje := coalesce(v_gen_pct, 0);
    end if;
    v_subtotal := round(v_item.cantidad * v_item.precio_unitario, 2);
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, sin_stock, subtotal_sin_iva, iva
    )
    values (
      v_org, v_nuevo.id, v_orden, null, v_item.descripcion, v_item.sku, v_item.cantidad, v_item.precio_unitario, null,
      false, v_alicuota_id, v_porcentaje, null, false, true, v_subtotal, v_iva
    );
    v_total_sin := v_total_sin + v_subtotal;
    v_total_iva := v_total_iva + v_iva;
  end loop;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin,
         total_con_iva = v_total_sin + v_total_iva,
         updated_at = clock_timestamp()
   where id = v_nuevo.id;

  v_codigo := private.codigo_reparacion(v_rep.numero);
  perform private.registrar_actividad(
    'reparacion.comprobante_generado',
    format('Generó la factura %s de la reparación %s', v_nuevo.numero, v_codigo),
    v_rep.empresa_id
  );
  return jsonb_build_object('comprobante_id', v_nuevo.id, 'creado', true);
end;
$function$;

-- reingresar_por_garantia
CREATE OR REPLACE FUNCTION public.reingresar_por_garantia(p_reparacion_origen uuid, p_falla text, p_tecnico uuid DEFAULT NULL::uuid, p_entrega_prevista date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_origen dominio.reparaciones;
  v_falla text := btrim(coalesce(p_falla, ''));
  v_estado uuid;
  v_numero integer;
  v_id uuid;
  v_codigo_origen text;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede reingresar reparaciones por garantía' using errcode = '42501';
  end if;

  select * into v_origen
    from dominio.reparaciones r
   where r.id = p_reparacion_origen and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_origen.empresa_id) then
    -- Misma respuesta que una reparación inexistente o de otra organización: no se confirma que el id exista.
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  if v_origen.anulada_en is not null then
    raise exception 'La reparación está anulada: no se puede reingresar por garantía' using errcode = 'PT409';
  end if;
  if v_origen.entrega_real is null then
    raise exception 'Solo se puede reingresar por garantía una reparación entregada' using errcode = 'PT409';
  end if;

  if v_falla = '' then
    raise exception 'Describí la falla del reingreso' using errcode = '22023', hint = 'falla';
  end if;
  if length(v_falla) > 1000 then
    raise exception 'Máximo 1000 caracteres' using errcode = '22023', hint = 'falla';
  end if;
  if p_tecnico is not null and not private.es_tecnico_de_service(p_tecnico) then
    raise exception 'El técnico no es válido' using errcode = '22023', hint = 'tecnico';
  end if;
  if p_entrega_prevista is not null and p_entrega_prevista < v_hoy then
    raise exception 'La entrega prevista no puede ser anterior al ingreso' using errcode = '22023', hint = 'entrega_prevista';
  end if;

  select s.id into v_estado
    from dominio.estados_reparacion s
   where s.organizacion_id = v_org and s.activo
   order by s.orden, s.id
   limit 1;
  if v_estado is null then
    raise exception 'No hay estados de reparación activos: activá uno en Estados de reparación' using errcode = '22023';
  end if;

  v_numero := private.siguiente_numero_reparacion(v_origen.empresa_id);
  v_codigo_origen := private.codigo_reparacion(v_origen.numero);

  insert into dominio.reparaciones (
    organizacion_id, empresa_id, numero, cliente_id, contacto, modelo_id, estado_id, numero_serie,
    accesorios, falla, tecnico_id, ingreso_en, entrega_prevista, reparacion_origen_id
  ) values (
    v_org, v_origen.empresa_id, v_numero, v_origen.cliente_id, v_origen.contacto, v_origen.modelo_id,
    v_estado, v_origen.numero_serie, v_origen.accesorios, v_falla, p_tecnico, v_hoy, p_entrega_prevista,
    v_origen.id
  )
  returning id into v_id;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_nuevo_id, nota, usuario_id)
  values (v_org, v_id, 'alta', v_estado, 'Reingreso por garantía de ' || v_codigo_origen, (select auth.uid()));

  perform private.registrar_actividad(
    'reparacion.reingreso_garantia',
    format('Reingresó por garantía %s como %s', v_codigo_origen, private.codigo_reparacion(v_numero)),
    v_origen.empresa_id
  );

  return private.reparacion_json(v_id);
end;
$function$;
