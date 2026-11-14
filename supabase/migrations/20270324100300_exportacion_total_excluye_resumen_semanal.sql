-- F-REP-08 (MSF-265, spec 20261114-100000-analitica-avanzada-y-resumen-por-correo): `public.resumen_semanal_config` y
-- `public.resumen_semanal_envios` quedan FUERA de la exportación total (pgTAP `exportacion_total`: toda tabla con
-- `organizacion_id` está en la lista permitida o en las exclusiones).
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla; solo se redefine `private.exclusiones_exportacion_total()`
-- (`private`, misma firma y mismos privilegios: `create or replace` los conserva).
--
-- Por qué se excluyen y no se exportan: la configuración es un interruptor de plataforma (activo/pausado) y el registro de
-- envíos es el outbox del correo semanal (estado, intentos, error); ninguno es dato de negocio (ventas, stock, precios).
--
-- Misma definición que 20270320100500 más las dos filas nuevas. Si otra migración posterior a esa redefine la función,
-- esta debe rebasarse sobre ella (la última en aplicarse gana).
--
-- Migración aditiva. Reversión (migración posterior): redefinir la función con el cuerpo de 20270320100500 (sin las dos filas).

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
    ('dominio', 'correo_masivo_pruebas', 'cola interna de avisos o correo'),
    ('dominio', 'faltantes_avisos', 'cola interna de avisos o correo'),
    ('dominio', 'favoritos_cliente', 'preferencias privadas de la cuenta web del cliente (D-11): el operador no las ve, no se exportan'),
    ('dominio', 'importaciones_productos', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('dominio', 'importaciones_productos_filas', 'dato derivado o registro de proceso (no es dato de negocio)'),
    ('dominio', 'reparacion_avisos', 'cola interna de avisos o correo'),
    ('dominio', 'reparacion_enlaces_consulta', 'credenciales, conexiones o accesos de plataforma'),
    ('dominio', 'stock_alertas_avisadas', 'cola interna de avisos o correo'),
    ('dominio', 'stock_avisos_reposicion', 'cola interna de avisos o correo'),
    ('public', 'api_claves', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'api_entregas', 'cola interna de avisos o correo'),
    ('public', 'api_llamadas', 'registro operativo o configuración de plataforma'),
    ('public', 'api_suscripciones', 'credenciales, conexiones o accesos de plataforma'),
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
    ('public', 'resumen_semanal_config', 'registro operativo o configuración de plataforma'),
    ('public', 'resumen_semanal_envios', 'cola interna de avisos o correo'),
    ('public', 'registro_actividad', 'registro operativo o configuración de plataforma'),
    ('public', 'reportes_organizaciones', 'registro operativo o configuración de plataforma'),
    ('public', 'reportes_organizaciones_roles', 'registro operativo o configuración de plataforma'),
    ('public', 'servidores_organizacion', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'solicitudes_acceso', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'superadmin_entradas', 'credenciales, conexiones o accesos de plataforma'),
    ('public', 'superadmin_organizacion_activa', 'credenciales, conexiones o accesos de plataforma')
  ) as v (esquema, tabla, motivo);
$$;
