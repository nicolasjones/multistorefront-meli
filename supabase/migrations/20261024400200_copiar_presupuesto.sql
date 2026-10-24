-- F-VTA-08 (MSF-331, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-051): `copiar_presupuesto`.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` y
-- `dominio.comprobantes_venta_lineas` (dominio) y, por `private.registrar_actividad`, `public.registro_actividad`.
--
-- Seguridad: `security definer`, `search_path = ''`; organización y operador salen de la sesión. Lee el original
-- con `ventas` en `lectura` o `edicion` y crea el nuevo solo con `edicion` en su empresa. `revoke ... from
-- public, anon` y `grant execute ... to authenticated` explícitos.
--
-- Qué copia: un presupuesto NUEVO `pendiente` en la empresa de origen, con número correlativo nuevo, mismo
-- cliente, canal, forma de pago y envío, fecha de hoy y el operador que copia. `valido_hasta` conserva la
-- misma duración que el original (días entre su fecha y su validez) contada desde hoy; sin validez, queda sin
-- validez. Las líneas se copian con el precio y la escala RECALCULADOS con la lista vigente
-- (`private.precio_para` + `private.escala_para_linea`), salvo las de precio manual, que conservan el precio
-- (el permiso `editar_precio` lo ejerció quien las fijó, no quien copia). El depósito se conserva si la tienda
-- sigue vendiendo desde él; si no, se usa el principal. Un producto que ya no está activo detiene la copia con
-- un mensaje que lo nombra (no se descarta una línea en silencio). El original no se modifica y no hay
-- reservas ni movimientos de stock (FR-033).
--
-- Errores: 42501 permiso · P0002 no existe · 22023 dato que ya no es copiable (mensaje en castellano).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.copiar_presupuesto(uuid);

create or replace function public.copiar_presupuesto(p_id uuid)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_hoy date := (select private.hoy_argentina());
  v_o dominio.comprobantes_venta;
  v_nuevo dominio.comprobantes_venta;
  v_empresa_nombre text;
  v_tipo_cliente text;
  v_defecto uuid;
  v_linea dominio.comprobantes_venta_lineas;
  v_producto dominio.productos;
  v_precio record;
  v_deposito uuid;
  v_unitario numeric;
  v_escala text;
  v_porcentaje numeric;
  v_subtotal numeric;
  v_iva numeric;
  v_total_sin numeric := 0;
  v_total_iva numeric := 0;
  v_orden integer := 0;
  v_numero integer;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para copiar presupuestos' using errcode = '42501';
  end if;

  -- `for share`: las líneas del original no cambian mientras se copian.
  select * into v_o
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org and c.tipo = 'presupuesto'
   for share;
  if not found or v_o.empresa_id is null then
    raise exception 'El presupuesto no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_o.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede copiar presupuestos de esta tienda' using errcode = '42501';
  end if;

  select e.nombre into v_empresa_nombre
    from dominio.empresas e
   where e.id = v_o.empresa_id and e.organizacion_id = v_org and e.activa;
  if not found then
    raise exception 'La tienda del presupuesto está desactivada' using errcode = '22023', hint = 'empresa_id';
  end if;

  select cl.tipo into v_tipo_cliente
    from public.clientes cl
   where cl.id = v_o.cliente_id and cl.organizacion_id = v_org;
  select d.id into v_defecto
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_o.empresa_id
   where d.organizacion_id = v_org and d.por_defecto and d.activo;

  v_numero := private.siguiente_numero_comprobante(v_o.empresa_id, 'presupuesto');
  insert into dominio.comprobantes_venta (
    organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
    total_sin_iva, total_con_iva, canal, operador_id, valido_hasta, forma_pago_id, envio_id
  )
  values (
    v_org, v_o.empresa_id, v_o.cliente_id, 'presupuesto', lpad(v_numero::text, 8, '0'), v_numero, v_hoy, 'pendiente',
    0, 0, v_o.canal, v_actor,
    case when v_o.valido_hasta is null then null else v_hoy + greatest(v_o.valido_hasta - v_o.fecha, 0) end,
    v_o.forma_pago_id, v_o.envio_id
  )
  returning * into v_nuevo;

  for v_linea in
    select l.* from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_o.id and l.organizacion_id = v_org
     order by l.orden
  loop
    v_orden := v_orden + 1;
    select * into v_producto
      from dominio.productos p
     where p.id = v_linea.producto_id and p.organizacion_id = v_org and p.activo;
    if not found then
      raise exception 'El producto «%» ya no está activo: quitalo del presupuesto original o reactivalo para copiarlo', v_linea.descripcion
        using errcode = '22023', hint = 'producto_id';
    end if;

    v_deposito := v_linea.deposito_id;
    if not exists (
      select 1
        from dominio.depositos d
        join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_o.empresa_id
       where d.id = v_deposito and d.organizacion_id = v_org and d.activo
    ) then
      v_deposito := v_defecto;
    end if;
    if v_deposito is null then
      raise exception 'La tienda no tiene un depósito desde el cual vender' using errcode = '22023', hint = 'deposito_id';
    end if;

    v_escala := private.escala_para_linea(v_tipo_cliente, v_linea.cantidad);
    select * into v_precio from private.precio_para(v_producto.id, v_o.empresa_id, v_escala);
    if not found then
      raise exception 'No pudimos calcular el precio de «%»', v_linea.descripcion using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := case when v_linea.precio_manual then v_linea.precio_unitario else round(v_precio.neto, 2) end;
    if v_unitario is null then
      raise exception 'El producto «%» no tiene precio en pesos (falta la cotización del dólar)', v_linea.descripcion
        using errcode = '22023', hint = 'producto_id';
    end if;
    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_unitario * v_linea.cantidad, 2);
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva
    )
    values (
      v_org, v_nuevo.id, v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_linea.cantidad, v_unitario,
      v_precio.escala_usada, v_linea.precio_manual, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva
    );
    v_total_sin := v_total_sin + v_subtotal;
    v_total_iva := v_total_iva + v_iva;
  end loop;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin,
         total_con_iva = v_total_sin + v_total_iva,
         updated_at = clock_timestamp()
   where id = v_nuevo.id
  returning * into v_nuevo;

  perform private.registrar_actividad(
    'presupuesto.copiado',
    format('Copió el presupuesto %s como %s en %s', v_o.numero, v_nuevo.numero, v_empresa_nombre),
    v_nuevo.empresa_id
  );
  return v_nuevo;
end;
$$;

revoke execute on function public.copiar_presupuesto(uuid) from public, anon;
grant execute on function public.copiar_presupuesto(uuid) to authenticated;

comment on function public.copiar_presupuesto(uuid) is
  'Crea un presupuesto pendiente nuevo con las líneas del original (precios recalculados salvo manual); el original no cambia (F-VTA-08, FR-051). Contrato en docs/ventas-comprobantes.md.';
