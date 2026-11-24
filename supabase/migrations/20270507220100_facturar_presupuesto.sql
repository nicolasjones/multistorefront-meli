-- Lote 39 (decisión de producto de MSF-668): «Facturar presupuesto». Parte 2: la RPC `public.facturar_presupuesto`.
--
-- Desde un presupuesto ACEPTADO y vigente se genera una factura en BORRADOR con los mismos cliente, tienda, canal, forma de pago,
-- envío y líneas, y el presupuesto pasa a `convertido`. Reglas:
--   * Precios CONGELADOS: las líneas se copian tal cual (precio, escala, descuento, promoción, lista, IVA, subtotales); no se
--     recalcula nada. La factura queda con `origen_presupuesto_id` (ver 20270507220000) y la guarda de precios de la confirmación
--     no la vigila. Los totales de la factura son la suma de las líneas copiadas (idénticos a los del presupuesto).
--   * Permisos: los de crear una factura (`ventas` en `edicion` EN LA EMPRESA del presupuesto). La organización y el actor salen
--     de la sesión. Un presupuesto de otra organización responde igual que uno inexistente (P0002).
--   * Estados: solo `aceptado` (un `pendiente` se acepta antes: 55000), no vencido (`valido_hasta` < hoy en Buenos Aires: 55000),
--     no anulado/otro estado (55000). Un presupuesto ya `convertido` devuelve la MISMA factura sin crear otra ni auditar de nuevo
--     (idempotente: doble clic, reintento de red, segunda sesión). Se toma `for update` sobre el presupuesto; el índice único
--     `comprobantes_venta_origen_presupuesto_uq` es la red de seguridad.
--   * La factura queda en `borrador`: se confirma por el flujo normal (`confirmar_comprobante`, con su control de stock). No toca
--     existencias ni reservas.
--   * Guardas de datos vivos (22023, mensaje de negocio): tienda desactivada, cliente archivado o inexistente, presupuesto sin líneas,
--     producto ya no activo (se nombra). Un depósito que la tienda ya no usa se reemplaza por el principal (como `copiar_presupuesto`).
--     La forma de pago o de envío que ya no existe en la tienda no se copia (queda sin elegir).
--   * Actividad: `presupuesto.facturado` («Facturó el presupuesto N como la factura M en Tienda»).
--
-- Seguridad: `security definer`, `search_path = ''`, objetos calificados; `revoke ... from public, anon` y `grant execute ... to
-- authenticated`. Errores: 42501 sin sesión o sin permiso · P0002 no existe · 22023 dato inválido · 55000 estado que no admite facturar.
--
-- Esquema (Principio VII): sin tablas nuevas; escribe `dominio.comprobantes_venta` y `dominio.comprobantes_venta_lineas` (dominio) y,
-- por `private.registrar_actividad`, `public.registro_actividad`.
-- Migración aditiva. Reversión (migración posterior): drop function public.facturar_presupuesto(uuid);

create or replace function public.facturar_presupuesto(p_presupuesto_id uuid)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
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
    raise exception 'El presupuesto no existe' using errcode = 'P0002';
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
    raise exception 'Aceptá el presupuesto antes de facturarlo' using errcode = '55000';
  end if;
  if v_p.estado <> 'aceptado' then
    raise exception 'Este presupuesto ya no se puede facturar' using errcode = '55000';
  end if;
  if v_p.valido_hasta is not null and v_p.valido_hasta < v_hoy then
    raise exception 'El presupuesto está vencido y no se puede facturar' using errcode = '55000';
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
$$;

revoke execute on function public.facturar_presupuesto(uuid) from public, anon;
grant execute on function public.facturar_presupuesto(uuid) to authenticated;

comment on function public.facturar_presupuesto(uuid) is
  'Crea una factura en borrador desde un presupuesto aceptado y vigente, con los precios del presupuesto congelados, y marca el presupuesto convertido. Idempotente y serializada por presupuesto. Exige ventas en edición en su tienda. Contrato en docs/ventas-comprobantes.md.';
