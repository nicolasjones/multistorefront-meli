-- MSF-918 (lote 33, higiene de la base): índices en claves foráneas del esquema dominio sin índice propio.
-- Sin índice en la columna hija, cada DELETE/UPDATE del padre (y cada cascada, p. ej. la baja de una organización)
-- recorre la tabla hija entera, y los joins por la FK no tienen camino de acceso.
--
-- Criterio (reproducible: `node scripts/verificar-higiene-base.mjs --fk-sin-indice`; detalle en docs/higiene-base-datos.md):
--   SE INDEXA toda FK cuyo conjunto de columnas no sea prefijo de otro índice válido y no parcial de la tabla hija, salvo:
--   * FK a auth.users con `on delete set null` (columnas de autoría: creado_por, actualizado_por...): bajar un usuario es raro
--     (se desactiva, no se borra) y el índice encarece cada escritura de las tablas más activas;
--   * FK a catálogos chicos y casi estáticos (sistemas_externos, ia_perfiles_modelo, capacidades_proveedores,
--     roles_organizacion, alicuotas_iva, estados_reparacion, motivos_movimiento): pocas filas padre, nunca se borran.
--   Ante la presión sobre el almacenamiento (MSF-920) NO se crea ningún índice sobre las columnas que ya cubre otro índice.
-- `concurrently` NO se puede usar: el aplicador corre cada migración dentro de una transacción y `create index concurrently`
--   falla ahí. Se usa `create index if not exists` (toma SHARE sobre la tabla mientras construye: bloquea escrituras, no lecturas).
--   Es aceptable porque estas tablas son de volumen bajo/medio; en un entorno con una tabla de más de ~1M filas, construir antes
--   el mismo índice a mano con `create index concurrently if not exists <mismo nombre>` fuera de la migración: esta queda
--   como no-op.
--
-- Migración aditiva. Reversión (migración posterior): `drop index if exists dominio.<nombre>;` por cada índice `*_fk_idx` de abajo.
--   Lista completa: select indexname from pg_indexes where schemaname = 'dominio' and indexname like '%\_fk\_idx' escape '\';

create index if not exists alertas_inicio_empresa_id_organizacion_id_fk_idx
  on dominio.alertas_inicio (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists archivo_ingresos_mercaderia_carga_id_fk_idx
  on dominio.archivo_ingresos_mercaderia (carga_id);  -- -> migracion_cargas (on delete set null)
create index if not exists campana_correo_destinatarios_organizacion_id_fk_idx
  on dominio.campana_correo_destinatarios (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists campana_correo_destinatarios_suscriptor_id_organizacio_68f20ff2
  on dominio.campana_correo_destinatarios (suscriptor_id, organizacion_id);  -- -> dominio.newsletter_suscriptores (on delete set null)
create index if not exists campanas_correo_newsletter_id_organizacion_id_fk_idx
  on dominio.campanas_correo (newsletter_id, organizacion_id);  -- -> dominio.newsletters (on delete set null)
create index if not exists categorias_empresa_categoria_id_organizacion_id_fk_idx
  on dominio.categorias_empresa (categoria_id, organizacion_id);  -- -> dominio.categorias (on delete cascade)
create index if not exists categorias_empresa_empresa_id_organizacion_id_fk_idx
  on dominio.categorias_empresa (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists categorias_tienda_categoria_id_organizacion_id_fk_idx
  on dominio.categorias_tienda (categoria_id, organizacion_id);  -- -> dominio.categorias (on delete cascade)
create index if not exists categorias_tienda_empresa_id_organizacion_id_fk_idx
  on dominio.categorias_tienda (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists clientes_lista_precio_id_organizacion_id_fk_idx
  on dominio.clientes (lista_precio_id, organizacion_id);  -- -> dominio.listas_precios (on delete no action)
create index if not exists cobros_comprobante_comprobante_id_organizacion_id_fk_idx
  on dominio.cobros_comprobante (comprobante_id, organizacion_id);  -- -> dominio.comprobantes_venta (on delete no action)
create index if not exists cobros_comprobante_cuenta_cobro_id_organizacion_id_fk_idx
  on dominio.cobros_comprobante (cuenta_cobro_id, organizacion_id);  -- -> dominio.cuentas_cobro (on delete no action)
create index if not exists cobros_comprobante_forma_pago_id_organizacion_id_fk_idx
  on dominio.cobros_comprobante (forma_pago_id, organizacion_id);  -- -> dominio.formas_pago (on delete no action)
create index if not exists comprobantes_venta_lineas_comprobante_id_organizacion_id_fk_idx
  on dominio.comprobantes_venta_lineas (comprobante_id, organizacion_id);  -- -> dominio.comprobantes_venta (on delete cascade)
create index if not exists comprobantes_venta_lineas_deposito_id_organizacion_id_fk_idx
  on dominio.comprobantes_venta_lineas (deposito_id, organizacion_id);  -- -> dominio.depositos (on delete no action)
create index if not exists comprobantes_venta_lineas_lista_precio_id_organizacion_edf7154d
  on dominio.comprobantes_venta_lineas (lista_precio_id, organizacion_id);  -- -> dominio.listas_precios (on delete no action)
create index if not exists comprobantes_venta_lineas_producto_id_organizacion_id_fk_idx
  on dominio.comprobantes_venta_lineas (producto_id, organizacion_id);  -- -> dominio.productos (on delete no action)
create index if not exists comprobantes_venta_lineas_promocion_id_organizacion_id_fk_idx
  on dominio.comprobantes_venta_lineas (promocion_id, organizacion_id);  -- -> dominio.promociones_precio (on delete no action)
create index if not exists comprobantes_venta_comprobante_origen_id_organizacion_id_fk_idx
  on dominio.comprobantes_venta (comprobante_origen_id, organizacion_id);  -- -> dominio.comprobantes_venta (on delete no action)
create index if not exists comprobantes_venta_contacto_id_organizacion_id_fk_idx
  on dominio.comprobantes_venta (contacto_id, organizacion_id);  -- -> dominio.contactos (on delete no action)
create index if not exists comprobantes_venta_transporte_id_organizacion_id_fk_idx
  on dominio.comprobantes_venta (transporte_id, organizacion_id);  -- -> dominio.transportes (on delete no action)
create index if not exists consulta_items_consulta_id_organizacion_id_empresa_id_fk_idx
  on dominio.consulta_items (consulta_id, organizacion_id, empresa_id);  -- -> dominio.consultas (on delete cascade)
create index if not exists consulta_items_producto_id_organizacion_id_fk_idx
  on dominio.consulta_items (producto_id, organizacion_id);  -- -> dominio.productos (on delete set null)
create index if not exists consultas_configuracion_empresa_id_organizacion_id_fk_idx
  on dominio.consultas_configuracion (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists consultas_cliente_id_organizacion_id_fk_idx
  on dominio.consultas (cliente_id, organizacion_id);  -- -> dominio.clientes (on delete set null)
create index if not exists consultas_contacto_id_organizacion_id_fk_idx
  on dominio.consultas (contacto_id, organizacion_id);  -- -> dominio.contactos (on delete no action)
create index if not exists consultas_empresa_id_organizacion_id_fk_idx
  on dominio.consultas (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists consultas_producto_id_organizacion_id_fk_idx
  on dominio.consultas (producto_id, organizacion_id);  -- -> dominio.productos (on delete no action)
create index if not exists contactos_empresa_id_organizacion_id_fk_idx
  on dominio.contactos (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists contrarreembolsos_cobro_id_organizacion_id_fk_idx
  on dominio.contrarreembolsos (cobro_id, organizacion_id);  -- -> dominio.cobros_comprobante (on delete no action)
create index if not exists contrarreembolsos_comprobante_id_organizacion_id_fk_idx
  on dominio.contrarreembolsos (comprobante_id, organizacion_id);  -- -> dominio.comprobantes_venta (on delete no action)
create index if not exists contrarreembolsos_transporte_id_organizacion_id_fk_idx
  on dominio.contrarreembolsos (transporte_id, organizacion_id);  -- -> dominio.transportes (on delete no action)
create index if not exists correo_masivo_pruebas_empresa_id_organizacion_id_fk_idx
  on dominio.correo_masivo_pruebas (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists costos_adicionales_canal_empresa_id_fk_idx
  on dominio.costos_adicionales_canal (empresa_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists cotizacion_aplicada_cotizacion_id_fk_idx
  on dominio.cotizacion_aplicada (cotizacion_id);  -- -> dominio.cotizaciones (on delete no action)
create index if not exists cotizacion_aplicada_empresa_id_organizacion_id_fk_idx
  on dominio.cotizacion_aplicada (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists cotizacion_pendiente_empresa_id_organizacion_id_fk_idx
  on dominio.cotizacion_pendiente (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists envios_moto_cobro_id_organizacion_id_fk_idx
  on dominio.envios_moto (cobro_id, organizacion_id);  -- -> dominio.cobros_comprobante (on delete no action)
create index if not exists existencias_deposito_deposito_id_organizacion_id_fk_idx
  on dominio.existencias_deposito (deposito_id, organizacion_id);  -- -> dominio.depositos (on delete no action)
create index if not exists existencias_deposito_producto_id_organizacion_id_fk_idx
  on dominio.existencias_deposito (producto_id, organizacion_id);  -- -> dominio.existencias (on delete cascade)
create index if not exists existencias_variante_deposito_id_organizacion_id_fk_idx
  on dominio.existencias_variante (deposito_id, organizacion_id);  -- -> dominio.depositos (on delete no action)
create index if not exists existencias_variante_variante_id_organizacion_id_fk_idx
  on dominio.existencias_variante (variante_id, organizacion_id);  -- -> dominio.producto_variantes (on delete cascade)
create index if not exists existencias_organizacion_id_fk_idx
  on dominio.existencias (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists faltantes_avisos_cliente_id_organizacion_id_fk_idx
  on dominio.faltantes_avisos (cliente_id, organizacion_id);  -- -> dominio.clientes (on delete cascade)
create index if not exists faltantes_avisos_empresa_id_organizacion_id_fk_idx
  on dominio.faltantes_avisos (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists faltantes_venta_comprobante_id_organizacion_id_fk_idx
  on dominio.faltantes_venta (comprobante_id, organizacion_id);  -- -> dominio.comprobantes_venta (on delete cascade)
create index if not exists faltantes_venta_deposito_id_organizacion_id_fk_idx
  on dominio.faltantes_venta (deposito_id, organizacion_id);  -- -> dominio.depositos (on delete no action)
create index if not exists faltantes_venta_para_avisar_ingreso_id_fk_idx
  on dominio.faltantes_venta (para_avisar_ingreso_id);  -- -> dominio.ingresos_mercaderia (on delete set null)
create index if not exists faltantes_venta_producto_id_organizacion_id_fk_idx
  on dominio.faltantes_venta (producto_id, organizacion_id);  -- -> dominio.productos (on delete no action)
create index if not exists favoritos_cliente_cuenta_cliente_id_organizacion_id_em_8c2ad4c0
  on dominio.favoritos_cliente (cuenta_cliente_id, organizacion_id, empresa_id);  -- -> cuentas_cliente (on delete cascade)
create index if not exists importaciones_productos_filas_importacion_id_organizac_ca0e33be
  on dominio.importaciones_productos_filas (importacion_id, organizacion_id);  -- -> dominio.importaciones_productos (on delete cascade)
create index if not exists ingresos_mercaderia_empresa_id_fk_idx
  on dominio.ingresos_mercaderia (empresa_id);  -- -> dominio.empresas (on delete no action)
create index if not exists intereses_whatsapp_empresa_id_organizacion_id_fk_idx
  on dominio.intereses_whatsapp (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists intereses_whatsapp_producto_id_organizacion_id_fk_idx
  on dominio.intereses_whatsapp (producto_id, organizacion_id);  -- -> dominio.productos (on delete cascade)
create index if not exists movimientos_stock_deposito_id_organizacion_id_fk_idx
  on dominio.movimientos_stock (deposito_id, organizacion_id);  -- -> dominio.depositos (on delete no action)
create index if not exists movimientos_stock_lote_id_organizacion_id_fk_idx
  on dominio.movimientos_stock (lote_id, organizacion_id);  -- -> dominio.lotes_stock (on delete no action)
create index if not exists movimientos_stock_reparacion_id_organizacion_id_fk_idx
  on dominio.movimientos_stock (reparacion_id, organizacion_id);  -- -> dominio.reparaciones (on delete no action)
create index if not exists movimientos_stock_variante_id_organizacion_id_fk_idx
  on dominio.movimientos_stock (variante_id, organizacion_id);  -- -> dominio.producto_variantes (on delete no action)
create index if not exists newsletter_configuracion_empresa_id_organizacion_id_fk_idx
  on dominio.newsletter_configuracion (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists newsletter_configuracion_organizacion_id_fk_idx
  on dominio.newsletter_configuracion (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists newsletters_campana_id_organizacion_id_fk_idx
  on dominio.newsletters (campana_id, organizacion_id);  -- -> dominio.campanas_correo (on delete restrict)
create index if not exists opiniones_producto_cuenta_cliente_id_organizacion_id_e_1f9dcaa4
  on dominio.opiniones_producto (cuenta_cliente_id, organizacion_id, empresa_id);  -- -> cuentas_cliente (on delete cascade)
create index if not exists ordenes_compra_items_orden_id_organizacion_id_fk_idx
  on dominio.ordenes_compra_items (orden_id, organizacion_id);  -- -> dominio.ordenes_compra (on delete cascade)
create index if not exists precios_empresa_empresa_id_organizacion_id_fk_idx
  on dominio.precios_empresa (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists precios_propios_empresa_producto_id_organizacion_id_fk_idx
  on dominio.precios_propios_empresa (producto_id, organizacion_id);  -- -> dominio.productos (on delete cascade)
create index if not exists presupuestos_tienda_comprobante_id_organizacion_id_fk_idx
  on dominio.presupuestos_tienda (comprobante_id, organizacion_id);  -- -> dominio.comprobantes_venta (on delete no action)
create index if not exists presupuestos_tienda_cuenta_cliente_id_organizacion_id__94c7c9aa
  on dominio.presupuestos_tienda (cuenta_cliente_id, organizacion_id, empresa_id);  -- -> cuentas_cliente (on delete cascade)
create index if not exists producto_costos_historial_producto_id_organizacion_id_fk_idx
  on dominio.producto_costos_historial (producto_id, organizacion_id);  -- -> dominio.productos (on delete cascade)
create index if not exists producto_costos_producto_id_organizacion_id_fk_idx
  on dominio.producto_costos (producto_id, organizacion_id);  -- -> dominio.productos (on delete cascade)
create index if not exists producto_empresa_empresa_id_organizacion_id_fk_idx
  on dominio.producto_empresa (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists producto_empresa_producto_id_organizacion_id_fk_idx
  on dominio.producto_empresa (producto_id, organizacion_id);  -- -> dominio.productos (on delete cascade)
create index if not exists producto_precios_escala_producto_id_organizacion_id_fk_idx
  on dominio.producto_precios_escala (producto_id, organizacion_id);  -- -> dominio.productos (on delete cascade)
create index if not exists productos_tienda_empresa_id_organizacion_id_fk_idx
  on dominio.productos_tienda (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists productos_tienda_producto_id_organizacion_id_fk_idx
  on dominio.productos_tienda (producto_id, organizacion_id);  -- -> dominio.productos (on delete cascade)
create index if not exists productos_categoria_id_organizacion_id_fk_idx
  on dominio.productos (categoria_id, organizacion_id);  -- -> dominio.categorias (on delete set null)
create index if not exists promociones_precio_empresa_id_organizacion_id_fk_idx
  on dominio.promociones_precio (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists promociones_precio_producto_id_organizacion_id_fk_idx
  on dominio.promociones_precio (producto_id, organizacion_id);  -- -> dominio.productos (on delete cascade)
create index if not exists reparacion_adjuntos_organizacion_id_fk_idx
  on dominio.reparacion_adjuntos (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists reparacion_adjuntos_reparacion_id_organizacion_id_fk_idx
  on dominio.reparacion_adjuntos (reparacion_id, organizacion_id);  -- -> dominio.reparaciones (on delete no action)
create index if not exists reparacion_enlaces_consulta_organizacion_id_fk_idx
  on dominio.reparacion_enlaces_consulta (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists reparacion_enlaces_consulta_reparacion_id_organizacion_191eaa32
  on dominio.reparacion_enlaces_consulta (reparacion_id, organizacion_id);  -- -> dominio.reparaciones (on delete no action)
create index if not exists reparacion_historial_organizacion_id_fk_idx
  on dominio.reparacion_historial (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists reparacion_historial_reparacion_id_organizacion_id_fk_idx
  on dominio.reparacion_historial (reparacion_id, organizacion_id);  -- -> dominio.reparaciones (on delete no action)
create index if not exists reparacion_items_deposito_id_organizacion_id_fk_idx
  on dominio.reparacion_items (deposito_id, organizacion_id);  -- -> dominio.depositos (on delete no action)
create index if not exists reparacion_items_organizacion_id_fk_idx
  on dominio.reparacion_items (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists reparacion_items_producto_id_organizacion_id_fk_idx
  on dominio.reparacion_items (producto_id, organizacion_id);  -- -> dominio.productos (on delete no action)
create index if not exists reparacion_items_reparacion_id_organizacion_id_fk_idx
  on dominio.reparacion_items (reparacion_id, organizacion_id);  -- -> dominio.reparaciones (on delete no action)
create index if not exists reparaciones_cliente_id_organizacion_id_fk_idx
  on dominio.reparaciones (cliente_id, organizacion_id);  -- -> dominio.clientes (on delete no action)
create index if not exists reparaciones_modelo_id_organizacion_id_fk_idx
  on dominio.reparaciones (modelo_id, organizacion_id);  -- -> dominio.modelos_equipo (on delete no action)
create index if not exists reparaciones_reparacion_origen_id_organizacion_id_fk_idx
  on dominio.reparaciones (reparacion_origen_id, organizacion_id);  -- -> dominio.reparaciones (on delete no action)
create index if not exists reservas_stock_deposito_id_organizacion_id_fk_idx
  on dominio.reservas_stock (deposito_id, organizacion_id);  -- -> dominio.depositos (on delete no action)
create index if not exists reservas_stock_producto_id_organizacion_id_fk_idx
  on dominio.reservas_stock (producto_id, organizacion_id);  -- -> dominio.existencias (on delete cascade)
create index if not exists respuestas_rapidas_empresa_id_organizacion_id_fk_idx
  on dominio.respuestas_rapidas (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists rma_items_comprobante_linea_id_organizacion_id_fk_idx
  on dominio.rma_items (comprobante_linea_id, organizacion_id);  -- -> dominio.comprobantes_venta_lineas (on delete no action)
create index if not exists rma_items_organizacion_id_fk_idx
  on dominio.rma_items (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists rma_items_producto_id_organizacion_id_fk_idx
  on dominio.rma_items (producto_id, organizacion_id);  -- -> dominio.productos (on delete no action)
create index if not exists rma_items_rma_id_organizacion_id_fk_idx
  on dominio.rma_items (rma_id, organizacion_id);  -- -> dominio.rma (on delete cascade)
create index if not exists rma_comprobante_id_organizacion_id_fk_idx
  on dominio.rma (comprobante_id, organizacion_id);  -- -> dominio.comprobantes_venta (on delete no action)
create index if not exists rma_empresa_id_organizacion_id_fk_idx
  on dominio.rma (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete no action)
create index if not exists rma_nota_credito_id_organizacion_id_fk_idx
  on dominio.rma (nota_credito_id, organizacion_id);  -- -> dominio.comprobantes_venta (on delete no action)
create index if not exists stock_alertas_avisadas_producto_id_fk_idx
  on dominio.stock_alertas_avisadas (producto_id);  -- -> dominio.productos (on delete cascade)
create index if not exists tienda_analitica_empresa_id_organizacion_id_fk_idx
  on dominio.tienda_analitica (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists tienda_borrador_empresa_id_organizacion_id_fk_idx
  on dominio.tienda_borrador (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists tienda_contenido_empresa_id_organizacion_id_fk_idx
  on dominio.tienda_contenido (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists tienda_identidad_empresa_id_organizacion_id_fk_idx
  on dominio.tienda_identidad (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists tienda_legal_enlaces_empresa_id_organizacion_id_fk_idx
  on dominio.tienda_legal_enlaces (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists tienda_paginas_empresa_id_organizacion_id_fk_idx
  on dominio.tienda_paginas (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists tienda_registros_dns_empresa_id_organizacion_id_fk_idx
  on dominio.tienda_registros_dns (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists tienda_versiones_empresa_id_organizacion_id_fk_idx
  on dominio.tienda_versiones (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists tiendas_empresa_id_organizacion_id_fk_idx
  on dominio.tiendas (empresa_id, organizacion_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists transportes_empresas_transporte_id_organizacion_id_fk_idx
  on dominio.transportes_empresas (transporte_id, organizacion_id);  -- -> dominio.transportes (on delete cascade)
