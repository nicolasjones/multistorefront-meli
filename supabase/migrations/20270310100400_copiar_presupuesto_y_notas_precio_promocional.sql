-- MSF-816 (gate MSF-834 · MSF-363 decisión 6): copiar un presupuesto reprecia con la promoción vigente.
--
-- Qué cambia (aditivo, misma firma de la RPC, mismos permisos):
--   * `public.copiar_presupuesto` reprecia cada línea con `private.precio_linea_venta` (con la promoción
--     vigente de la tienda del presupuesto) y guarda el snapshot (`precio_referencia`, `promocion_id`). El precio
--     manual se conserva (quien lo fijó tenía `editar_precio`; quien copia no lo reprecia). Sin descuento del
--     cliente, igual que hoy (hallazgo 3 de la spec: defecto previo con su seguimiento).
--   * `private.copiar_costo_linea_nota` copia además el snapshot del precio a las líneas de las notas de crédito
--     de devolución: la nota devuelve al precio cobrado, con su referencia y su promoción (FR-011).
--
-- Lo que NO cambia: el permiso (editar en la tienda del original), la empresa, el cliente, la validez, el
-- depósito, el producto inactivo (falla nombrándolo), el evento `presupuesto.copiado` y la fórmula del IVA.
--
-- Esquema (Principio VII): sin tablas nuevas ni objetos en `public`. Migración aditiva (`create or replace`,
-- mismas firmas y grants). Reversión (migración posterior): restaurar `public.copiar_presupuesto` con su
-- definición de 20261204150100 y `private.copiar_costo_linea_nota` con la de 20270202201006.

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
  if not found then
    raise exception 'El cliente del presupuesto ya no existe' using errcode = '22023', hint = 'cliente_id';
  end if;
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

    -- MSF-816: reprecia con la función única (con la promoción vigente de la tienda). Sin descuento del cliente,
    -- igual que hoy (hallazgo 3 de la spec: es un defecto previo, con su seguimiento).
    select * into v_precio
      from private.precio_linea_venta(v_producto.id, v_o.empresa_id, v_tipo_cliente, v_linea.cantidad, 0, clock_timestamp(), false);
    if not found then
      raise exception 'No pudimos calcular el precio de «%»', v_linea.descripcion using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := case when v_linea.precio_manual then v_linea.precio_unitario else v_precio.neto_unitario end;
    if v_unitario is null then
      raise exception 'El producto «%» no tiene precio en pesos (falta la cotización del dólar)', v_linea.descripcion
        using errcode = '22023', hint = 'producto_id';
    end if;
    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_unitario * v_linea.cantidad, 2);
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
      precio_referencia, promocion_id
    )
    values (
      v_org, v_nuevo.id, v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_linea.cantidad, v_unitario,
      v_precio.escala_usada, v_linea.precio_manual, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva,
      case when v_linea.precio_manual then null else v_precio.precio_referencia end,
      case when v_linea.precio_manual then null else v_precio.promocion_id end
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
  'Crea un presupuesto pendiente nuevo con las líneas del original (repreciadas salvo manual; MSF-816); el original no cambia (F-VTA-08, FR-051). Contrato en docs/ventas-comprobantes.md.';

-- La nota de crédito devuelve al PRECIO COBRADO: con el snapshot (MSF-816) también hereda la referencia y la
-- promoción de la línea original. Las dos columnas nuevas se copian FUERA del gate del costo (que solo decide
-- el costo) y con su propio gate: solo si la fila nueva las trae nulas. Solo notas de devolución de productos.
create or replace function private.copiar_costo_linea_nota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.costo_unitario is null and new.cotizacion is null then
    select o.costo_unitario, o.cotizacion into new.costo_unitario, new.cotizacion
      from dominio.comprobantes_venta n
      join dominio.comprobantes_venta_lineas o
        on o.comprobante_id = n.comprobante_origen_id and o.organizacion_id = n.organizacion_id and o.orden = new.orden
     where n.id = new.comprobante_id and n.organizacion_id = new.organizacion_id
       and n.tipo = 'nota_credito' and n.nc_tipo = 'devolucion_productos';
  end if;

  if new.precio_referencia is null and new.promocion_id is null then
    select o.precio_referencia, o.promocion_id into new.precio_referencia, new.promocion_id
      from dominio.comprobantes_venta n
      join dominio.comprobantes_venta_lineas o
        on o.comprobante_id = n.comprobante_origen_id and o.organizacion_id = n.organizacion_id and o.orden = new.orden
     where n.id = new.comprobante_id and n.organizacion_id = new.organizacion_id
       and n.tipo = 'nota_credito' and n.nc_tipo = 'devolucion_productos';
  end if;
  return new;
end;
$$;

revoke execute on function private.copiar_costo_linea_nota() from public, anon, authenticated;

comment on function private.copiar_costo_linea_nota() is
  'MSF-816: la línea de una nota de crédito de devolución hereda el costo y el snapshot del precio (precio_referencia, promocion_id) de la línea original.';
