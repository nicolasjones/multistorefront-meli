-- MSF-124 (F-SVC-20 y F-SVC-22, integración con la exportación total de MSF-396): las dos tablas nuevas de la épica con
-- `organizacion_id` tienen que estar en la lista permitida o en las exclusiones (el pgTAP de completitud de
-- `exportacion_total.test.sql` lo exige):
--   * `dominio.reparacion_adjuntos` (20270219140100): SE EXPORTA. Es el registro de las fotos y adjuntos de cada reparación
--     (ruta, nombre original, tipo, tamaño, quién y cuándo los subió), dato de negocio de la organización. Los archivos
--     viven en el bucket privado `reparacion-adjuntos` de Storage y NO viajan en esta exportación (solo su registro).
--   * `dominio.reparacion_enlaces_consulta` (20270219160100): SE EXCLUYE. Guarda el token de acceso PÚBLICO a la consulta
--     de estado de cada reparación: es una credencial (quien lo tiene ve el estado sin iniciar sesión), igual que
--     las invitaciones o las conexiones; exportarlo pondría credenciales vigentes dentro de un archivo.
-- Redefine `private.conjuntos_exportacion_total()` y `private.exclusiones_exportacion_total()` (misma firma y privilegios)
-- sobre las definiciones vigentes (`20270218500700` y `20270217300003`).
--
-- Esquemas (Principio VII): sin tablas nuevas; solo funciones de plataforma en `private`. Migración aditiva.
-- Reversión (migración posterior): volver a las definiciones de `20270218500700_exportacion_total_precios_propios_historial.sql`
-- (conjuntos) y `20270217300003_exportacion_total_conjuntos.sql` (exclusiones), sin las dos filas.

create or replace function private.exclusiones_exportacion_total()
returns table (esquema text, tabla text, motivo text)
language sql
immutable
set search_path = ''
as $$
  select v.esquema, v.tabla, v.motivo
  from (values
    ('dominio', 'alertas_inicio', 'cola interna de avisos o correo'),
    ('dominio', 'alertas_inicio_calculos', 'cola interna de avisos o correo'),
    ('dominio', 'comprobante_documentos', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('dominio', 'comprobante_envios_correo', 'cola interna de avisos o correo'),
    ('dominio', 'consultas_avisos', 'cola interna de avisos o correo'),
    ('dominio', 'correo_masivo_pruebas', 'cola interna de avisos o correo'),
    ('dominio', 'faltantes_avisos', 'cola interna de avisos o correo'),
    ('dominio', 'importaciones_productos', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('dominio', 'importaciones_productos_filas', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('dominio', 'reparacion_avisos', 'cola interna de avisos o correo'),
    ('dominio', 'reparacion_enlaces_consulta', 'credenciales, conexiones o accesos de plataforma'),
    ('dominio', 'stock_alertas_avisadas', 'cola interna de avisos o correo'),
    ('dominio', 'stock_avisos_reposicion', 'cola interna de avisos o correo'),
    ('public', 'alertas', 'registro operativo o configuración de plataforma'),
    ('public', 'alertas_monitoreo', 'registro operativo o configuración de plataforma'),
    ('public', 'avisos_pendientes', 'cola interna de avisos o correo'),
    ('public', 'capacidades_ejecucion', 'registro operativo o configuración de plataforma'),
    ('public', 'cola_eventos', 'cola interna de avisos o correo'),
    ('public', 'conexiones', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'conexiones_oauth', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'conversaciones_chat_ia', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('public', 'credenciales_mcp', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'despachos_ejecucion', 'cola interna de avisos o correo'),
    ('public', 'ejecuciones_worker', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_features', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_membresia', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_monitoreo', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_proveedor_capacidad', 'registro operativo o configuración de plataforma'),
    ('public', 'eventos_reportes', 'registro operativo o configuración de plataforma'),
    ('public', 'excepciones_flow_generico', 'registro operativo o configuración de plataforma'),
    ('public', 'fragmentos_indexados', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('public', 'invitaciones_organizacion', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'migracion_cargas', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('public', 'organizaciones_features', 'registro operativo o configuración de plataforma'),
    ('public', 'procesos_masivos', 'registro operativo o configuración de plataforma'),
    ('public', 'procesos_masivos_errores', 'registro operativo o configuración de plataforma'),
    ('public', 'programacion_ejecucion', 'registro operativo o configuración de plataforma'),
    ('public', 'proveedor_capacidad_cliente', 'registro operativo o configuración de plataforma'),
    ('public', 'proveedor_capacidad_organizacion', 'registro operativo o configuración de plataforma'),
    ('public', 'registro_actividad', 'registro operativo o configuración de plataforma'),
    ('public', 'reportes_organizaciones', 'registro operativo o configuración de plataforma'),
    ('public', 'reportes_organizaciones_roles', 'registro operativo o configuración de plataforma'),
    ('public', 'servidores_organizacion', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'solicitudes_acceso', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'superadmin_entradas', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'superadmin_organizacion_activa', 'credenciales, conexiones o accesos de plataforma')
  ) as v (esquema, tabla, motivo);
$$;

create or replace function private.conjuntos_exportacion_total()
returns table (esquema text, tabla text, columnas text[])
language sql
stable
security definer
set search_path = ''
as $$
  select p.esquema, p.tabla, array_agg(a.attname::text order by a.attnum) as columnas
  from (values
    ('public', 'organizaciones'),
    ('dominio', 'alicuotas_iva'),
    ('dominio', 'archivo_ingresos_mercaderia'),
    ('dominio', 'campana_correo_destinatarios'),
    ('dominio', 'campanas_correo'),
    ('dominio', 'cargas_iniciales_stock'),
    ('dominio', 'categorias'),
    ('dominio', 'categorias_empresa'),
    ('dominio', 'categorias_tienda'),
    ('dominio', 'cobros_comprobante'),
    ('dominio', 'comprobante_impresiones'),
    ('dominio', 'comprobantes_venta'),
    ('dominio', 'comprobantes_venta_lineas'),
    ('dominio', 'comprobantes_venta_numeracion'),
    ('dominio', 'consultas'),
    ('dominio', 'consultas_configuracion'),
    ('dominio', 'contactos'),
    ('dominio', 'contrarreembolsos'),
    ('dominio', 'costos_adicionales_canal'),
    ('dominio', 'cotizacion_aplicada'),
    ('dominio', 'cotizacion_configuracion'),
    ('dominio', 'cotizacion_inicial'),
    ('dominio', 'cotizacion_pendiente'),
    ('dominio', 'cotizaciones'),
    ('dominio', 'cuentas_cobro'),
    ('dominio', 'cuentas_cobro_empresas'),
    ('dominio', 'depositos'),
    ('dominio', 'depositos_empresas'),
    ('dominio', 'empresas'),
    ('dominio', 'estados_consulta'),
    ('dominio', 'estados_reparacion'),
    ('dominio', 'existencias'),
    ('dominio', 'existencias_deposito'),
    ('dominio', 'faltantes_venta'),
    ('dominio', 'formas_envio'),
    ('dominio', 'formas_pago'),
    ('dominio', 'historial_cobros'),
    ('dominio', 'historial_comprobantes'),
    ('dominio', 'historial_cotizaciones_dolar'),
    ('dominio', 'ingresos_mercaderia'),
    ('dominio', 'ingresos_mercaderia_lineas'),
    ('dominio', 'intereses_whatsapp'),
    ('dominio', 'lotes_stock'),
    ('dominio', 'modelos_equipo'),
    ('dominio', 'motivos_movimiento'),
    ('dominio', 'movimientos_stock'),
    ('dominio', 'precios_empresa'),
    ('dominio', 'precios_propios_empresa'),
    ('dominio', 'precios_propios_historial'),
    ('dominio', 'producto_costos'),
    ('dominio', 'producto_costos_historial'),
    ('dominio', 'producto_empresa'),
    ('dominio', 'producto_imagenes'),
    ('dominio', 'producto_precios_escala'),
    ('dominio', 'productos'),
    ('dominio', 'productos_tienda'),
    ('dominio', 'proveedores'),
    ('dominio', 'proveedores_contactos'),
    ('dominio', 'proveedores_empresas'),
    ('dominio', 'rentabilidad_config'),
    ('dominio', 'reparacion_adjuntos'),
    ('dominio', 'reparacion_historial'),
    ('dominio', 'reparacion_items'),
    ('dominio', 'reparaciones'),
    ('dominio', 'reservas_stock'),
    ('dominio', 'respuestas_rapidas'),
    ('dominio', 'rma'),
    ('dominio', 'rma_items'),
    ('dominio', 'tienda_analitica'),
    ('dominio', 'tienda_borrador'),
    ('dominio', 'tienda_contenido'),
    ('dominio', 'tienda_envios'),
    ('dominio', 'tienda_identidad'),
    ('dominio', 'tienda_legal_enlaces'),
    ('dominio', 'tienda_paginas'),
    ('dominio', 'tienda_registros_dns'),
    ('dominio', 'tienda_versiones'),
    ('dominio', 'tiendas'),
    ('dominio', 'transiciones_estado_comprobante'),
    ('dominio', 'transportes'),
    ('dominio', 'transportes_empresas'),
    ('public', 'clientes'),
    ('public', 'clientes_empresas'),
    ('public', 'cuentas_cliente'),
    ('public', 'documentos'),
    ('public', 'permisos_rol'),
    ('public', 'permisos_rol_accion'),
    ('public', 'usuarios_empresas'),
    ('public', 'usuarios_organizacion')
  ) as p (esquema, tabla)
  join pg_catalog.pg_namespace n on n.nspname = p.esquema
  join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = p.tabla and c.relkind in ('r', 'p')
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where a.attname !~* '(secret|token|password|passwd|api_?key|vault|credencial|private_key)'
  group by p.esquema, p.tabla
  order by p.esquema, p.tabla;
$$;
