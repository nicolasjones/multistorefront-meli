-- F-VTA-11 (MSF-377, épica MSF-177, FR-043): `public.emitir_nota_credito`, la nota de crédito asociada a una factura.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` (la nota y `updated_at` de la
-- factura), `dominio.comprobantes_venta_lineas` (líneas de «Devolución de productos»), la numeración
-- (`dominio.comprobantes_venta_numeracion`) y, por `private.registrar_actividad`, `public.registro_actividad`.
--
-- Tipos (`p_tipo`) y `p_lineas`:
--   · `devolucion_productos`: arreglo de `{linea_id, cantidad}` (líneas de LA factura). Cada línea de la nota copia la de
--     la factura con la cantidad devuelta y el MISMO `orden` (así el tope por línea se calcula sin columna nueva).
--     Vuelve la mercadería al depósito de origen (`private.devolver_stock_nota_credito`). `p_concepto` es opcional.
--   · `devolucion_importe` y `descuento`: arreglo con UN elemento `{importe_sin_iva}`; `p_concepto` es obligatorio.
--     No tocan el stock y no llevan líneas. El IVA sale de la proporción IVA/neto de la factura.
--
-- Reglas:
--   · Solo sobre una `factura` confirmada y no anulada (borrador, anulada, presupuesto y nota: 55000 / 22023).
--   · No excede lo aún acreditable: por línea en productos (cantidad facturada − devuelta en notas previas) y por
--     importe en todos (total sin IVA de la factura − notas previas, y lo mismo con IVA) (P0001). Se admiten notas
--     parciales.
--   · Las cantidades e importes de la nota se guardan POSITIVOS; el signo negativo lo aplican las lecturas
--     (`private.signo_comprobante`).
--   · Número correlativo propio por organización y empresa (`private.siguiente_numero_comprobante`); transaccional: si
--     algo falla, el número no se consume.
--   · La factura se toma `for update`: dos notas simultáneas sobre lo mismo no exceden el tope (la segunda ve la
--     primera). También avanza `updated_at` de la factura, para que quien la tenía abierta reciba el conflicto.
--
-- Seguridad: `security definer`, `search_path = ''`; la organización y el actor salen de la sesión. Exige `ventas` en
-- `edicion` y la acción `emitir_nota_credito` EN LA EMPRESA de la factura (`private.puede_accion_comprobante`).
-- `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
--
-- Errores: 42501 permiso · P0002 no existe · 22023 dato inválido · 55000 factura sin estado válido · P0001 tope.
--
-- Migración aditiva. Reversión (migración posterior; las notas emitidas no se deshacen solas):
--   drop function public.emitir_nota_credito(uuid, text, jsonb, text);

create or replace function public.emitir_nota_credito(
  p_factura_id uuid,
  p_tipo text,
  p_lineas jsonb,
  p_concepto text default null
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
    raise exception 'La factura no existe' using errcode = 'P0002';
  end if;
  if not (select private.puede_accion_comprobante(v_c.empresa_id, 'emitir_nota_credito')) then
    raise exception 'Tu rol no puede emitir notas de crédito en esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'La nota de crédito se emite sobre una factura' using errcode = '22023';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de emitir una nota de crédito' using errcode = '55000';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite notas de crédito' using errcode = '55000';
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
        precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva
      )
      values (
        v_org, v_nota.id, v_l.orden, v_l.producto_id, v_l.descripcion, v_l.codigo, v_item.cantidad, v_l.precio_unitario,
        v_l.escala, v_l.precio_manual, v_l.alicuota_id, v_l.alicuota_porcentaje, v_l.deposito_id, v_l.a_pedido, v_sub, v_iva
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
$$;

revoke execute on function public.emitir_nota_credito(uuid, text, jsonb, text) from public, anon;
grant execute on function public.emitir_nota_credito(uuid, text, jsonb, text) to authenticated;

comment on function public.emitir_nota_credito(uuid, text, jsonb, text) is
  'Emite una nota de crédito (Devolución de productos, Devolución de importe o Descuento) asociada a una factura confirmada, sin exceder lo acreditable (F-VTA-11, FR-043/FR-044). Exige ventas en edición y la acción emitir_nota_credito en la empresa de la factura.';
