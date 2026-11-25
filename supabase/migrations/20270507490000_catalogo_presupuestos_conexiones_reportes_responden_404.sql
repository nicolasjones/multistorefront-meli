-- Lote 77 (MSF-599, MSF-654 y MSF-655, decimocuarta ola de la convención de códigos de negocio mapeados a 4xx): quince RPC del
-- catálogo de la tienda, presupuestos, fusión de clientes, impresiones y exportación de comprobantes, costos adicionales,
-- conexiones (incluidas las de OAuth), integraciones, reportes y funcionalidades por organización dejan de contestar HTTP 500
-- cuando rechazan por «no existe» (`P0002`). Pasan, con el mismo mensaje de siempre, a `PT404` (HTTP 404). Qué código emite cada
-- función: ver la fila 14 de la tabla de docs/errores-negocio-postgrest.md.
--
-- Funciones: listar_catalogo_tienda, copiar_presupuesto, fusionar_clientes, registrar_impresion, guardar_costo_adicional,
-- dar_baja_costo_adicional, archivo_exportacion_comprobantes, crear_conexion, actualizar_credencial_conexion,
-- iniciar_conexion_oauth, confirmar_conexion_oauth (la de dos argumentos), actualizar_integracion_oauth,
-- establecer_roles_default_reporte, asignar_reporte y habilitar_feature.
--
-- Cada función parte de su definición VIGENTE (la última migración que la define; ninguna nombra `public.clientes`, así que el barrido
-- 20270418000401 no las reescribió) y solo cambia el errcode: mensajes, cuerpo, firma, `security definer`, `search_path` y grants son
-- los mismos (`create or replace` conserva privilegios; no hay drop, grant ni revoke). Los comentarios de `guardar_costo_adicional` y
-- `dar_baja_costo_adicional` nombraban el código viejo y se actualizan.
--
-- Ninguna es llamable por `anon` ni la consume Kestra, un worker o una Edge Function: solo la web, que acepta el código viejo y el
-- nuevo (`P0002` o `PT404`) porque la migración y el despliegue no son simultáneos.
--
-- Quedan con el código anterior a propósito:
--   (a) `guardar_catalogo_tienda` y `guardar_tienda_identidad`: no son ejecutables por `authenticated` (solo `publicar_tienda`, que ya
--       validó la empresa antes), así que su `P0002` no llega a PostgREST;
--   (b) `proveedores_efectivos_de_cliente` y `elegir_proveedor_capacidad_cliente`: contrato propio documentado en
--       specs/20261005-120000-proveedor-elegible-por-capacidad/contracts/rpc.md (prefijo `CLIENTE_DESCONOCIDO:` y resto con `P0001`);
--   (c) `marcar_conexion_oauth_invalida` (solo `service_role`: la llama un proceso del sistema), `aprovisionar_servidor_organizacion`
--       y `entrar_a_organizacion` (soporte y orquestación), por tamaño del lote;
--   (d) las cargas de migración y lotes de importación (`cerrar_carga_migracion`, `aplicar_lote_*`, `informe_conciliacion_migracion`) y
--       `vincular_identificador_externo`, por tamaño del lote;
--   (e) `reintentar_entrega_api` (su `P0002` mezcla «no existe» y «no está agotada»), `confirmar_comprobante` (hint
--       `precios_cambiaron`), la bandera apagada, los topes `54000`, los respaldos `55006`, las que consume una Edge Function por
--       código y las del esquema `publico` llamables por `anon`.
--
-- Migración aditiva (create or replace).
--
-- Reversión: volver a aplicar, en una migración nueva, la definición vigente anterior de cada función (en el cuerpo, `PT404` vuelve a
-- `P0002`, solo en las líneas que esta migración cambia) y restaurar los comentarios previos de los costos adicionales (los de
-- 20270202201001, que citaban `P0002`). Definiciones vigentes anteriores (la última migración que cada función define; las
-- migraciones ya aplicadas no se editan):
--   listar_catalogo_tienda: 20270205110100; copiar_presupuesto: 20270507000100; fusionar_clientes: 20270507300100;
--   registrar_impresion: 20261211130200; guardar_costo_adicional y dar_baja_costo_adicional: 20270202201001;
--   archivo_exportacion_comprobantes: 20261212110300; crear_conexion: 20260915130000; actualizar_credencial_conexion: 20260925210000;
--   iniciar_conexion_oauth y actualizar_integracion_oauth: 20260930160000; confirmar_conexion_oauth(uuid, text): 20260930203338;
--   establecer_roles_default_reporte y asignar_reporte: 20260909140000; habilitar_feature: 20260910130000.

-- listar_catalogo_tienda
create or replace function public.listar_catalogo_tienda(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_borrador jsonb;
  v_resultado jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la tienda de esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;

  select b.catalogo into v_borrador from dominio.tienda_borrador b where b.empresa_id = p_empresa;

  select jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nombre', c.nombre,
               'padre_id', c.padre_id,
               'visible', coalesce(bc.visible, ct.visible, true),
               -- Productos de ESTA tienda asignados directamente a la categoría.
               'productos', (select count(*) from private.catalogo_tienda_efectivo_borrador(p_empresa, v_borrador) x where x.categoria_id = c.id)
             ) order by (c.padre_id is not null), c.posicion, c.id)
        from dominio.categorias c
        left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
        left join jsonb_to_recordset(coalesce(v_borrador->'categorias', '[]'::jsonb)) as bc(id uuid, visible boolean) on bc.id = c.id
       where c.organizacion_id = v_org
    ), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.producto_id,
               'nombre', x.nombre,
               'moneda', x.moneda,
               'precio', x.precio,
               'stock', coalesce(x.stock, 0),
               'visible', x.visible,
               'destacado', x.destacado,
               'efectivo', x.efectivo,
               'motivo', x.motivo
             ) order by lower(x.nombre), x.producto_id)
        from private.catalogo_tienda_efectivo_borrador(p_empresa, v_borrador) x
    ), '[]'::jsonb),
    'resumen', (
      select jsonb_build_object(
               'visibles', count(*) filter (where x.efectivo),
               'destacados', count(*) filter (where x.efectivo and x.destacado))
        from private.catalogo_tienda_efectivo_borrador(p_empresa, v_borrador) x
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

-- copiar_presupuesto
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
  v_ahora timestamptz;
  v_porcentaje numeric;
  v_descuento numeric := 0;
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
    raise exception 'El presupuesto no existe' using errcode = 'PT404';
  end if;
  -- MSF-816 (FR-002, R3c): el instante del precio se toma después del bloqueo del original.
  v_ahora := clock_timestamp();
  if (select private.nivel_ventas_en_empresa(v_o.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede copiar presupuestos de esta tienda' using errcode = '42501';
  end if;

  select e.nombre into v_empresa_nombre
    from dominio.empresas e
   where e.id = v_o.empresa_id and e.organizacion_id = v_org and e.activa;
  if not found then
    raise exception 'La tienda del presupuesto está desactivada' using errcode = '22023', hint = 'empresa_id';
  end if;

  -- MSF-933 (S2): el descuento del cliente rige igual que en `guardar_lineas_comprobante`.
  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
    from dominio.clientes cl
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

    -- MSF-816 (FR-010) y MSF-933 (S2): misma función de precio que `guardar_lineas_comprobante`: con el descuento
    -- del cliente, la lista de precios del cliente (F-CLI-21) y la promoción vigente de la tienda; gana el más bajo,
    -- sin acumular (si gana la promoción o la lista, `descuento_aplicado` es 0).
    select * into v_precio
      from private.precio_linea_venta(v_producto.id, v_o.empresa_id, v_tipo_cliente, v_linea.cantidad, v_descuento, v_ahora, true, v_o.cliente_id);
    if not found then
      raise exception 'No pudimos calcular el precio de «%»', v_linea.descripcion using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := case when v_linea.precio_manual then v_linea.precio_unitario else v_precio.neto_unitario end;
    if v_unitario is null then
      raise exception 'El producto «%» no tiene precio en pesos (falta la cotización del dólar)', v_linea.descripcion
        using errcode = '22023', hint = 'producto_id';
    end if;
    if not v_linea.precio_manual and v_precio.lista_precio_id is not null and v_unitario <= 0 then
      raise exception 'El producto «%» queda sin precio con la lista de precios del cliente (el descuento lo lleva a cero)', v_linea.descripcion
        using errcode = '22023', hint = 'producto_id';
    end if;
    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_unitario * v_linea.cantidad, 2);
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
      descuento_pct, precio_referencia, promocion_id, lista_precio_id, lista_ajuste_pct
    )
    values (
      v_org, v_nuevo.id, v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_linea.cantidad, v_unitario,
      v_precio.escala_usada, v_linea.precio_manual, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva,
      case when v_linea.precio_manual then 0 else v_precio.descuento_aplicado end,
      case when v_linea.precio_manual then null else v_precio.precio_referencia end,
      case when v_linea.precio_manual then null else v_precio.promocion_id end,
      case when v_linea.precio_manual then null else v_precio.lista_precio_id end,
      case when v_linea.precio_manual then null else v_precio.lista_ajuste_pct end
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

-- fusionar_clientes
create or replace function public.fusionar_clientes(
  p_conservar_id uuid,
  p_descartar_id uuid,
  p_cuenta_web_de uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_docs integer;
  v_cuentas integer;
  v_bajas integer := 0;
  v_existen integer;
  v_archivados integer;
  v_act_c integer;
  v_tot_c integer;
  v_act_d integer;
  v_tot_d integer;
  v_gana uuid;
  v_perdedor uuid;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo el Administrador puede fusionar clientes' using errcode = '42501';
  end if;
  if p_conservar_id is null or p_descartar_id is null then
    raise exception 'Elegí los dos clientes a fusionar' using errcode = '22023';
  end if;
  if p_conservar_id = p_descartar_id then
    raise exception 'No se puede fusionar un cliente consigo mismo' using errcode = '22023';
  end if;

  -- FR-011: bloquea ambas filas en orden por id (sin interbloqueos entre dos fusiones cruzadas).
  perform 1 from (
    select c.id from dominio.clientes c
     where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org
     order by c.id for update
  ) bloqueo;

  select count(*), count(*) filter (where c.archivado_en is not null) into v_existen, v_archivados
    from dominio.clientes c
   where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org;
  if v_existen <> 2 then
    raise exception 'Alguno de los clientes no existe' using errcode = 'PT404';
  end if;
  if v_archivados > 0 then
    raise exception 'Alguno de los clientes ya está archivado (¿la fusión ya se hizo?)' using errcode = '22023';
  end if;

  -- FR-009 (D1: un usuario de Auth por cliente): si los dos tienen cuenta web hay que quedarse con UNA persona de
  -- acceso. Con las dos activas debe elegirla quien fusiona; si solo un lado tiene cuentas activas, prevalece esa.
  select count(*) filter (where cc.estado = 'activa'), count(*) into v_act_c, v_tot_c
    from public.cuentas_cliente cc where cc.cliente_id = p_conservar_id;
  select count(*) filter (where cc.estado = 'activa'), count(*) into v_act_d, v_tot_d
    from public.cuentas_cliente cc where cc.cliente_id = p_descartar_id;

  if p_cuenta_web_de is not null and p_cuenta_web_de not in (p_conservar_id, p_descartar_id) then
    raise exception 'La cuenta web elegida debe ser la de uno de los dos clientes' using errcode = '22023';
  end if;

  if v_tot_c > 0 and v_tot_d > 0 then
    if p_cuenta_web_de is not null then
      v_gana := p_cuenta_web_de;
    elsif v_act_c > 0 and v_act_d > 0 then
      raise exception 'Los dos clientes tienen cuenta web activa: elegí cuál se mantiene' using errcode = '22023';
    elsif v_act_d > 0 then
      v_gana := p_descartar_id;
    else
      v_gana := p_conservar_id;
    end if;
    v_perdedor := case when v_gana = p_conservar_id then p_descartar_id else p_conservar_id end;

    -- Opiniones de productos (MSF-467): antes de dar de baja la cuenta no elegida, sus opiniones pasan a la cuenta que se mantiene
    -- DE LA MISMA TIENDA (la FK compuesta exige misma empresa). Si las dos opinaron el mismo producto (única cuenta + producto) se
    -- conserva la MÁS RECIENTE por `actualizada_en` (con empate, la de la cuenta que se mantiene) y la otra se descarta. Una opinión
    -- de una tienda donde la cuenta que se mantiene no tiene cuenta no puede moverse y se va con la cuenta dada de baja.
    -- 1) La de la cuenta que se mantiene es más vieja que la de la baja: se descarta para dejar lugar a la más reciente.
    delete from dominio.opiniones_producto g
     using public.cuentas_cliente cg, public.cuentas_cliente cp, dominio.opiniones_producto p
     where cg.cliente_id = v_gana and cp.cliente_id = v_perdedor
       and cg.empresa_id = cp.empresa_id and cg.organizacion_id = v_org and cp.organizacion_id = v_org
       and g.cuenta_cliente_id = cg.id and p.cuenta_cliente_id = cp.id
       and p.producto_id = g.producto_id and p.actualizada_en > g.actualizada_en;
    -- 2) Las de la baja que siguen chocando (la de la cuenta que se mantiene es igual o más reciente) se descartan.
    delete from dominio.opiniones_producto p
     using public.cuentas_cliente cg, public.cuentas_cliente cp, dominio.opiniones_producto g
     where cg.cliente_id = v_gana and cp.cliente_id = v_perdedor
       and cg.empresa_id = cp.empresa_id and cg.organizacion_id = v_org and cp.organizacion_id = v_org
       and g.cuenta_cliente_id = cg.id and p.cuenta_cliente_id = cp.id
       and p.producto_id = g.producto_id;
    -- 3) El resto se reasigna a la cuenta que se mantiene en la misma tienda.
    update dominio.opiniones_producto p
       set cuenta_cliente_id = cg.id
      from public.cuentas_cliente cp, public.cuentas_cliente cg
     where p.cuenta_cliente_id = cp.id and cp.cliente_id = v_perdedor and cp.organizacion_id = v_org
       and cg.cliente_id = v_gana and cg.empresa_id = cp.empresa_id and cg.organizacion_id = v_org;

    -- Cierre MSF-988 (H-2): los presupuestos de la tienda del cliente que pierde la cuenta web NO pueden quedar huérfanos. Con la FK en `on delete set null
    -- (cuenta_cliente_id)` el `delete` de abajo les dejaría `cuenta_cliente_id` nulo: sus vínculos saldrían del conteo de los topes por cuenta (5 por día y 10
    -- abiertos, FR-057) y de la idempotencia `(cuenta, clave_envio)`, y el cliente fusionado podría gastar el tope COMPLETO dos veces. Antes de dar de baja la cuenta,
    -- sus presupuestos pasan a la cuenta que sobrevive de la MISMA empresa (la FK es compuesta por cuenta, organización y empresa): si en esa empresa no queda
    -- ninguna cuenta, no hay topes que valgan y el vínculo queda sin cuenta (lo admite la columna).
    -- La unicidad `(cuenta_cliente_id, clave_envio)` (la idempotencia de B2) puede CHOCAR al re-apuntar: dos cuentas de la MISMA empresa pueden tener la misma
    -- `clave_envio` (la unicidad de `dominio.tienda_envios (empresa_id, clave_envio)` solo protege 24 h, hasta que la poda borra esas filas). La fila que chocaría
    -- NO se re-apunta: se queda con la cuenta que se da de baja y, al borrarla, queda SIN cuenta (el vínculo no se pierde, pero sale de los topes por cuenta). Es
    -- preferible a que la fusión se caiga con un «duplicate key» y el administrador no pueda fusionar ese par de clientes.
    update dominio.presupuestos_tienda pt
       set cuenta_cliente_id = cg.id
      from public.cuentas_cliente cc, public.cuentas_cliente cg
     where pt.cuenta_cliente_id = cc.id
       and cc.cliente_id = case when v_gana = p_conservar_id then p_descartar_id else p_conservar_id end
       and cc.organizacion_id = v_org
       and cg.cliente_id = v_gana and cg.empresa_id = cc.empresa_id and cg.organizacion_id = v_org
       and not exists (
         select 1
           from dominio.presupuestos_tienda otro
          where otro.cuenta_cliente_id = cg.id
            and otro.clave_envio = pt.clave_envio
            and otro.id <> pt.id
       );

    -- La cuenta no elegida se da de baja (se elimina; el usuario de Auth queda sin uso).
    delete from public.cuentas_cliente cc
     where cc.cliente_id = case when v_gana = p_conservar_id then p_descartar_id else p_conservar_id end;
    get diagnostics v_bajas = row_count;
  end if;

  -- FR-006: todo en esta transacción (si algo falla, no queda nada a medias).
  update dominio.comprobantes_venta cv
     set cliente_id = p_conservar_id
   where cv.cliente_id = p_descartar_id and cv.organizacion_id = v_org;
  get diagnostics v_docs = row_count;

  -- La cuenta web que queda pasa al cliente conservado y la tienda se habilita en él (si no lo estaba).
  insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
  select p_conservar_id, cc.empresa_id, cc.organizacion_id
    from public.cuentas_cliente cc
   where cc.cliente_id = p_descartar_id
  on conflict (cliente_id, empresa_id) do nothing;

  update public.cuentas_cliente cc
     set cliente_id = p_conservar_id
   where cc.cliente_id = p_descartar_id and cc.organizacion_id = v_org;
  get diagnostics v_cuentas = row_count;

  -- Cierre MSF-988 (H-2): el cliente que se descarta deja de ser el de sus presupuestos pedidos desde la tienda y de sus consultas de pedido: se repuntan al conservado
  -- (el vínculo `dominio.presupuestos_tienda` y `dominio.consultas.cliente_id` no quedan apuntando a un cliente archivado).
  update dominio.presupuestos_tienda pt
     set cliente_id = p_conservar_id
   where pt.cliente_id = p_descartar_id and pt.organizacion_id = v_org;
  -- El `update` hace avanzar `updated_at` de esas consultas (trigger `consultas_normalizar`).
  update dominio.consultas q
     set cliente_id = p_conservar_id
   where q.cliente_id = p_descartar_id and q.organizacion_id = v_org;

  -- Campañas: MSF-155 no se entregó y no existe tabla de campañas; no hay nada que reasignar.

  -- FR-007: el descartado se archiva (no se borra) y conserva sus datos de ficha.
  update dominio.clientes c
     set archivado_en = now(), lista_precio_id = null
   where c.id = p_descartar_id and c.organizacion_id = v_org;

  -- FR-008: evento en la misma transacción, con ambos clientes (nombre y Nº; nunca DNI/CUIT).
  perform private.registrar_actividad_fusion_clientes(v_org, (select auth.uid()), p_conservar_id, p_descartar_id);

  return jsonb_build_object(
    'documentos_reasignados', v_docs,
    'cuentas_reasignadas', v_cuentas,
    'campanas_reasignadas', 0, 'cuentas_dadas_de_baja', v_bajas
  );
end;
$$;

-- registrar_impresion
create or replace function public.registrar_impresion(p_documento_id uuid)
returns dominio.comprobante_impresiones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_doc dominio.comprobante_documentos;
  v_numero text;
  v_reimpresion boolean;
  v_imp dominio.comprobante_impresiones;
  v_etiqueta text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar impresiones' using errcode = '42501';
  end if;

  select * into v_doc from dominio.comprobante_documentos d where d.id = p_documento_id and d.organizacion_id = v_org;
  if not found then
    raise exception 'El documento no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_doc.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede imprimir comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_doc.estado <> 'generado' then
    raise exception 'El documento todavía no está listo: no se puede marcar como impreso' using errcode = '22023', hint = 'estado';
  end if;

  -- Serializa las impresiones del mismo documento: dos personas a la vez no pueden ser ambas «la primera».
  perform pg_advisory_xact_lock(hashtextextended('comprobante_impresion:' || v_doc.comprobante_id::text || ':' || v_doc.tipo_documento, 0));

  select exists (
    select 1 from dominio.comprobante_impresiones i
    where i.comprobante_id = v_doc.comprobante_id and i.tipo_documento = v_doc.tipo_documento
  ) into v_reimpresion;

  insert into dominio.comprobante_impresiones
    (organizacion_id, empresa_id, comprobante_id, tipo_documento, documento_id, impreso_por, impreso_en, reimpresion)
  values (v_org, v_doc.empresa_id, v_doc.comprobante_id, v_doc.tipo_documento, v_doc.id, v_actor, clock_timestamp(), v_reimpresion)
  returning * into v_imp;

  select c.numero into v_numero from dominio.comprobantes_venta c where c.id = v_doc.comprobante_id;
  v_etiqueta := case v_doc.tipo_documento when 'factura' then 'la factura' when 'remito' then 'el remito' else 'el presupuesto' end;
  perform private.registrar_actividad(
    case when v_reimpresion then 'comprobante.reimpreso' else 'comprobante.impreso' end,
    format('%s %s %s', case when v_reimpresion then 'Reimprimió' else 'Imprimió' end, v_etiqueta, v_numero),
    v_doc.empresa_id
  );
  return v_imp;
end;
$$;

-- guardar_costo_adicional
create or replace function public.guardar_costo_adicional(
  p_id uuid,
  p_empresa_id uuid,
  p_nombre text,
  p_tipo text,
  p_valor numeric
)
returns dominio.costos_adicionales_canal
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_actual dominio.costos_adicionales_canal;
  v_fila dominio.costos_adicionales_canal;
  v_empresa text;
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede editar los costos adicionales' using errcode = '42501';
  end if;
  if p_empresa_id is null or p_empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'No podés cargar costos para esa empresa' using errcode = '42501';
  end if;
  if v_nombre = '' or char_length(v_nombre) > 80 then
    raise exception 'El nombre es obligatorio y admite hasta 80 caracteres' using errcode = '23514';
  end if;
  if p_tipo is null or p_tipo not in ('porcentaje', 'monto') then
    raise exception 'Elegí si el costo es un porcentaje o un monto por unidad' using errcode = '23514';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'El valor no puede ser negativo' using errcode = '23514';
  end if;
  if p_tipo = 'porcentaje' and p_valor > 100 then
    raise exception 'El porcentaje debe estar entre 0 y 100' using errcode = '23514';
  end if;
  if p_valor <> round(p_valor, 4) then
    raise exception 'El valor admite hasta 4 decimales' using errcode = '23514';
  end if;
  if p_valor >= 1000000000 then
    raise exception 'El valor es demasiado grande' using errcode = '23514';
  end if;

  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa_id;

  begin
    if p_id is null then
      insert into dominio.costos_adicionales_canal (organizacion_id, empresa_id, nombre, tipo, valor)
      values (v_organizacion, p_empresa_id, v_nombre, p_tipo, p_valor)
      returning * into v_fila;
    else
      select * into v_actual from dominio.costos_adicionales_canal c
       where c.id = p_id and c.organizacion_id = v_organizacion and c.activo for update;
      if not found then
        raise exception 'El costo adicional no existe o ya fue dado de baja' using errcode = 'PT404';
      end if;
      if v_actual.empresa_id <> p_empresa_id then
        raise exception 'Un costo no puede cambiar de empresa' using errcode = '23514';
      end if;
      update dominio.costos_adicionales_canal
         set nombre = v_nombre, tipo = p_tipo, valor = p_valor
       where id = p_id
      returning * into v_fila;
    end if;
  exception when unique_violation then
    raise exception 'Ya hay un costo con ese nombre en %', v_empresa using errcode = '23505';
  end;

  perform private.insertar_actividad(
    v_organizacion, (select auth.uid()), 'rentabilidad.costo_guardado',
    format('%s el costo adicional «%s» de %s', case when p_id is null then 'Creó' else 'Editó' end, v_nombre, v_empresa),
    p_empresa_id
  );
  return v_fila;
end;
$$;

-- dar_baja_costo_adicional
create or replace function public.dar_baja_costo_adicional(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_fila dominio.costos_adicionales_canal;
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede editar los costos adicionales' using errcode = '42501';
  end if;
  select * into v_fila from dominio.costos_adicionales_canal c
   where c.id = p_id and c.organizacion_id = v_organizacion for update;
  if not found then
    raise exception 'El costo adicional no existe' using errcode = 'PT404';
  end if;
  if v_fila.empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'No podés editar costos de esa empresa' using errcode = '42501';
  end if;
  -- Idempotente: dar de baja uno ya dado de baja no hace nada.
  if not v_fila.activo then
    return;
  end if;
  update dominio.costos_adicionales_canal set activo = false where id = p_id;
  perform private.insertar_actividad(
    v_organizacion, (select auth.uid()), 'rentabilidad.costo_baja',
    format('Dio de baja el costo adicional «%s»', v_fila.nombre),
    v_fila.empresa_id
  );
end;
$$;

-- archivo_exportacion_comprobantes
create or replace function public.archivo_exportacion_comprobantes(p_ejecucion_id uuid)
returns table (estado text, archivo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := (select private.organizacion_id());
  v_e record;
begin
  if v_uid is null or v_org is null then
    raise exception 'NO_AUTORIZADO: sin sesión de organización' using errcode = '42501';
  end if;
  if not (select private.puede_accion('ventas', 'exportar')) then
    raise exception 'NO_AUTORIZADO: no tenés permiso para exportar' using errcode = '42501';
  end if;

  select e.estado as estado, e.detalle as detalle into v_e
    from public.ejecuciones_worker e
    join public.capacidades_ejecucion cap on cap.id = e.capacidad_id
   where e.id = p_ejecucion_id
     and e.organizacion_id = v_org
     and cap.clave like 'exportar-comprobantes-%'
     and e.detalle->>'actor' = v_uid::text;
  if not found then
    raise exception 'NO_ENCONTRADA: no hay una exportación tuya con ese identificador' using errcode = 'PT404';
  end if;

  estado := v_e.estado;
  archivo := case when v_e.estado = 'exitosa'
    then (v_e.detalle->>'archivo_prefijo') || p_ejecucion_id::text || '.csv' end;
  return next;
end;
$$;

-- crear_conexion
create or replace function public.crear_conexion(
  p_organizacion_id uuid,
  p_sistema_externo text,
  p_credencial text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault_id uuid;
  v_conexion public.conexiones;
begin
  if not (select private.es_administrador_de(p_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  if not exists (select 1 from public.organizaciones o where o.id = p_organizacion_id) then
    raise exception 'La organización % no existe', p_organizacion_id using errcode = 'PT404';
  end if;

  v_vault_id := vault.create_secret(p_credencial);

  insert into public.conexiones (organizacion_id, sistema_externo, credencial_vault_id, created_by)
  values (p_organizacion_id, p_sistema_externo, v_vault_id, (select auth.uid()))
  returning * into v_conexion;

  return jsonb_build_object(
    'id', v_conexion.id,
    'organizacion_id', v_conexion.organizacion_id,
    'sistema_externo', v_conexion.sistema_externo,
    'estado', v_conexion.estado,
    'created_by', v_conexion.created_by,
    'created_at', v_conexion.created_at,
    'updated_at', v_conexion.updated_at
  );
end;
$$;

-- actualizar_credencial_conexion
create or replace function public.actualizar_credencial_conexion(
  p_conexion_id uuid,
  p_nueva_credencial text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_vault_id uuid;
begin
  select c.organizacion_id, c.credencial_vault_id into v_organizacion_id, v_vault_id
  from public.conexiones c where c.id = p_conexion_id;

  if v_organizacion_id is null then
    raise exception 'La conexión % no existe', p_conexion_id using errcode = 'PT404';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  perform vault.update_secret(v_vault_id, p_nueva_credencial);

  -- Una credencial nueva se presume válida, como al crear la conexión: sale
  -- de credencial_invalida para que la próxima ejecución la pruebe (FR-013).
  update public.conexiones
  set estado = case when estado = 'credencial_invalida' then 'activa' else estado end,
      updated_at = clock_timestamp()
  where id = p_conexion_id;
end;
$$;

-- iniciar_conexion_oauth
create or replace function public.iniciar_conexion_oauth(
  p_organizacion_id uuid,
  p_integracion_id uuid
)
returns public.conexiones_oauth
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_habilitada boolean;
  v_row public.conexiones_oauth;
begin
  if not (select private.es_administrador_de(p_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  select habilitada into v_habilitada from public.integraciones_oauth where id = p_integracion_id;

  if v_habilitada is null then
    raise exception 'La integración % no existe', p_integracion_id using errcode = 'PT404';
  end if;

  if not v_habilitada then
    raise exception 'La integración % no está habilitada', p_integracion_id using errcode = '42501';
  end if;

  -- Get-or-create: si ya existe la fila (unique organizacion_id+integracion_id),
  -- la devuelve tal cual (sin tocar estado/created_at) para que el frontend
  -- reutilice el mismo id/connection_id al reautorizar (contracts/conectar-oauth.md #5).
  insert into public.conexiones_oauth (organizacion_id, integracion_id, created_by)
  values (p_organizacion_id, p_integracion_id, (select auth.uid()))
  on conflict (organizacion_id, integracion_id)
    do update set organizacion_id = excluded.organizacion_id
  returning * into v_row;

  return v_row;
end;
$$;

-- confirmar_conexion_oauth
create or replace function public.confirmar_conexion_oauth(p_conexion_id uuid, p_nango_connection_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_estado text;
begin
  select organizacion_id, estado into v_organizacion_id, v_estado
  from public.conexiones_oauth
  where id = p_conexion_id;

  if v_organizacion_id is null then
    raise exception 'La conexión % no existe', p_conexion_id using errcode = 'PT404';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  update public.conexiones_oauth
  set estado = 'activa', nango_connection_id = p_nango_connection_id, updated_at = clock_timestamp()
  where id = p_conexion_id;

  insert into public.eventos_conexion_oauth (conexion_id, tipo, actor)
  values (p_conexion_id, case when v_estado = 'pendiente' then 'creada' else 'reautorizada' end, (select auth.uid()));
end;
$$;

-- actualizar_integracion_oauth
create or replace function public.actualizar_integracion_oauth(p_integracion_id uuid, p_habilitada boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_superadmin()) then
    raise exception 'Requiere superadmin' using errcode = '42501';
  end if;

  update public.integraciones_oauth set habilitada = p_habilitada where id = p_integracion_id;

  if not found then
    raise exception 'La integración % no existe', p_integracion_id using errcode = 'PT404';
  end if;
end;
$$;

-- establecer_roles_default_reporte
create or replace function public.establecer_roles_default_reporte(
  p_reporte_id uuid,
  p_roles_id text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_superadmin()) then
    raise exception 'Solo un superadmin puede modificar el default de un reporte' using errcode = '42501';
  end if;

  if 'administrador' = any(p_roles_id) then
    raise exception 'administrador no se configura: tiene acceso incondicional' using errcode = '22023';
  end if;

  if not exists (select 1 from public.reportes where id = p_reporte_id) then
    raise exception 'El reporte % no existe', p_reporte_id using errcode = 'PT404';
  end if;

  delete from public.reportes_roles_default where reporte_id = p_reporte_id;

  if p_roles_id is not null and array_length(p_roles_id, 1) > 0 then
    insert into public.reportes_roles_default (reporte_id, rol_id)
    select p_reporte_id, rol_id from unnest(p_roles_id) as rol_id;
  end if;

  insert into public.eventos_reportes (reporte_id, actor_user_id, accion, detalle)
  values (
    p_reporte_id,
    (select auth.uid()),
    'default_actualizado',
    jsonb_build_object('roles_default', p_roles_id)
  );
end;
$$;

-- asignar_reporte
create or replace function public.asignar_reporte(
  p_reporte_id uuid,
  p_organizacion_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if not (select private.is_superadmin()) then
    raise exception 'Solo un superadmin puede asignar reportes' using errcode = '42501';
  end if;

  if not exists (select 1 from public.reportes where id = p_reporte_id) then
    raise exception 'El reporte % no existe', p_reporte_id using errcode = 'PT404';
  end if;

  if not exists (select 1 from public.organizaciones where id = p_organizacion_id) then
    raise exception 'La organización % no existe', p_organizacion_id using errcode = 'PT404';
  end if;

  insert into public.reportes_organizaciones (reporte_id, organizacion_id, asignado_por)
  values (p_reporte_id, p_organizacion_id, (select auth.uid()))
  on conflict (reporte_id, organizacion_id) do nothing;

  get diagnostics v_filas = row_count;

  -- Idempotente (Principio III): si ya estaba asignado, no duplica el evento
  -- ni vuelve a disparar la herencia (el trigger es AFTER INSERT, no corre
  -- en un on conflict do nothing sin insert real).
  if v_filas > 0 then
    insert into public.eventos_reportes (reporte_id, organizacion_id, actor_user_id, accion)
    values (p_reporte_id, p_organizacion_id, (select auth.uid()), 'asignado');
  end if;
end;
$$;

-- habilitar_feature
create or replace function public.habilitar_feature(
  p_feature_id text,
  p_organizacion_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if not (select private.is_superadmin()) then
    raise exception 'Solo un superadmin puede habilitar funcionalidades' using errcode = '42501';
  end if;

  if not exists (select 1 from public.features where id = p_feature_id) then
    raise exception 'La funcionalidad % no existe', p_feature_id using errcode = 'PT404';
  end if;

  if not exists (select 1 from public.organizaciones where id = p_organizacion_id) then
    raise exception 'La organización % no existe', p_organizacion_id using errcode = 'PT404';
  end if;

  insert into public.organizaciones_features (feature_id, organizacion_id, habilitado_por)
  values (p_feature_id, p_organizacion_id, (select auth.uid()))
  on conflict (feature_id, organizacion_id) do nothing;

  get diagnostics v_filas = row_count;

  -- Idempotente (Principio III): si ya estaba habilitada, no duplica el evento.
  if v_filas > 0 then
    insert into public.eventos_features (feature_id, organizacion_id, actor_user_id, accion)
    values (p_feature_id, p_organizacion_id, (select auth.uid()), 'habilitada');
  end if;
end;
$$;

-- Los comentarios de los costos adicionales nombraban el código viejo.
comment on function public.guardar_costo_adicional(uuid, uuid, text, text, numeric) is
  'F-REN-08: alta (p_id null) o edición de un costo adicional (solo edición en rentabilidad). 42501, 23514, 23505, PT404.';
comment on function public.dar_baja_costo_adicional(uuid) is
  'F-REN-08: da de baja (activo = false) un costo adicional; idempotente. 42501 sin edición, PT404 si no existe.';
