-- MSF-176 · Tienda compra y cuentas, historia B2 (presupuesto desde la tienda), M-1 y M-2 de la revisión de QA y código. FR-061.
--
-- El origen «Tienda online» de un presupuesto se deriva del VÍNCULO real (`dominio.presupuestos_tienda`, que solo escribe `publico.crear_presupuesto_tienda`) y no de
-- `canal = 'tienda_online'` + `operador_id` nulo: cambiar el canal no pierde la etiqueta y un presupuesto de panel con canal tienda_online y operador borrado NO se rotula
-- como de la tienda. Dos funciones, misma firma, mismas columnas y mismos grants (`create or replace`):
--   * `public.obtener_comprobante(id)`: `operador` dice «Tienda online (cliente)» si hay vínculo y suma la clave `de_tienda` (boolean) que usa la ficha (chip «Creado desde la
--     tienda por el cliente» y «Nota del cliente»). Resto del cuerpo idéntico al de `20270310100200` (sin tocar líneas ni totales).
--   * `private.comprobantes_consulta(...)`: la columna `operador` (la usan `listar_comprobantes` y la exportación CSV de comprobantes y presupuestos
--     `private.filas_exportacion_comprobantes`) aplica la misma regla.
-- `public.listar_presupuestos` lo hace en `20270322100500`.
--
-- Esquemas (Principio VII): sin tablas; funciones de lectura. Migración aditiva.
-- Reversión (migración posterior): restaurar `obtener_comprobante` al cuerpo de `20270310100200_lineas_precio_promocional.sql` y `private.comprobantes_consulta` al de
-- `20261212110000_listar_comprobantes.sql`.

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
    raise exception 'El comprobante no existe' using errcode = 'P0002';
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
  join public.clientes cl on cl.id = v_c.cliente_id and cl.organizacion_id = v_org
  left join public.perfiles_usuario p on p.user_id = v_c.operador_id
  where e.id = v_c.empresa_id;

  return v_resultado;
end;
$function$;

CREATE OR REPLACE FUNCTION private.comprobantes_consulta(p_organizacion_id uuid, p_empresas uuid[], p_tipos text[], p_busqueda text, p_estado text, p_pago_id uuid, p_envio_id uuid, p_operador_id uuid, p_empresa_id uuid, p_limite integer, p_desde integer)
 RETURNS TABLE(id uuid, numero text, tipo text, empresa_id uuid, empresa text, fecha date, cliente text, operador_id uuid, operador text, estado text, estado_etiqueta text, forma_pago text, envio text, total numeric, filas bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text;
  v_estado text := nullif(btrim(coalesce(p_estado, '')), '');
  v_hoy date := (select private.hoy_argentina());
begin
  if v_estado is not null and v_estado not in
     ('borrador', 'confirmada', 'pendiente', 'aceptado', 'cobrado', 'en_proceso', 'deuda', 'armando', 'incompleto',
      'anulada', 'vencido', 'convertido') then
    raise exception 'El estado % no existe', v_estado using errcode = '22023', hint = 'estado';
  end if;
  if v_estado = 'confirmada' then v_estado := 'pendiente'; end if;
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(translate(lower(v_texto), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with base as (
    select c.id, c.numero, c.numero_entero, c.tipo, c.empresa_id, e.nombre as empresa, c.fecha,
           cl.nombre as cliente, c.operador_id,
           case when exists (select 1 from dominio.presupuestos_tienda pt where pt.comprobante_id = c.id and pt.organizacion_id = c.organizacion_id)
                then 'Tienda online (cliente)'
                else coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre') end as operador,
           case when c.tipo = 'presupuesto' and c.estado = 'pendiente' and c.valido_hasta is not null
                     and c.valido_hasta < v_hoy then 'vencido' else c.estado end as estado,
           fp.nombre as forma_pago, fe.nombre as envio,
           case when c.tipo = 'nota_credito' then -c.total_con_iva else c.total_con_iva end as total
      from dominio.comprobantes_venta c
      join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id
      join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
      left join public.perfiles_usuario p on p.user_id = c.operador_id
      left join dominio.formas_pago fp on fp.id = c.forma_pago_id and fp.organizacion_id = c.organizacion_id
      left join dominio.formas_envio fe on fe.id = c.envio_id and fe.organizacion_id = c.organizacion_id
     where c.organizacion_id = p_organizacion_id
       and c.empresa_id = any (p_empresas)
       and c.tipo = any (p_tipos)
       and (p_empresa_id is null or c.empresa_id = p_empresa_id)
       and (p_pago_id is null or c.forma_pago_id = p_pago_id)
       and (p_envio_id is null or c.envio_id = p_envio_id)
       and (p_operador_id is null or c.operador_id = p_operador_id)
       and (v_patron is null
            or translate(lower(cl.nombre), 'áéíóúü', 'aeiouu') like v_patron
            or lower(c.numero) like v_patron
            or coalesce(c.numero_entero::text, '') like v_patron)
  )
  select b.id, b.numero, b.tipo, b.empresa_id, b.empresa, b.fecha, b.cliente, b.operador_id, b.operador,
         b.estado, private.etiqueta_estado_comprobante(b.estado), b.forma_pago, b.envio, b.total,
         count(*) over () as filas
    from base b
   where v_estado is null or (case when b.estado = 'confirmada' then 'pendiente' else b.estado end) = v_estado
   order by b.fecha desc, b.numero_entero desc nulls last, b.id
   limit p_limite
  offset p_desde;
end;
$function$;
