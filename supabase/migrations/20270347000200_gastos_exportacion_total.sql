-- F-GAS-01 (MSF-469, RF-GAS-17): `dominio.gastos` (20270347000000) tiene `organizacion_id`; el pgTAP de completitud de `exportacion_total.test.sql`
-- exige que esté en la lista permitida o en las exclusiones. Es dato de negocio de la organización: SE EXPORTA.
-- Redefine `private.conjuntos_exportacion_total()` (misma firma y privilegios) sobre la definición vigente (`20270342000300`, que ya incluye
-- órdenes de compra, listas de precios, opiniones y newsletter con su filtro de `confirmacion_hash`) copiándola COMPLETA y sumando solo la fila
-- `('dominio', 'gastos')`. La lista de exclusiones no cambia.
-- Si otra migración posterior a `20270342000300` la redefine, esta debe rebasarse sobre ella (la última en aplicarse gana y las filas
-- que no copie se pierden: es lo que hizo fallar `exportacion_total.test.sql` al partir de una versión anterior).
--
-- Esquemas (Principio VII): sin tablas nuevas; solo una función de plataforma en `private`. Migración aditiva.
-- Reversión (migración posterior): volver a la definición de `20270342000300_exportacion_total_newsletter.sql` (sin la fila de gastos).

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
    ('dominio', 'actualizaciones_precio'),
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
    ('dominio', 'consulta_items'),
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
    ('dominio', 'envios_moto'),
    ('dominio', 'estados_consulta'),
    ('dominio', 'estados_reparacion'),
    ('dominio', 'existencias'),
    ('dominio', 'existencias_deposito'),
    ('dominio', 'faltantes_venta'),
    ('dominio', 'formas_envio'),
    ('dominio', 'formas_pago'),
    ('dominio', 'gastos'),
    ('dominio', 'existencias_variante'),
    ('dominio', 'historial_cobros'),
    ('dominio', 'historial_comprobantes'),
    ('dominio', 'historial_cotizaciones_dolar'),
    ('dominio', 'ingresos_mercaderia'),
    ('dominio', 'ingresos_mercaderia_lineas'),
    ('dominio', 'intereses_whatsapp'),
    ('dominio', 'listas_precios'),
    ('dominio', 'lotes_stock'),
    ('dominio', 'modelos_equipo'),
    ('dominio', 'motivos_movimiento'),
    ('dominio', 'movimientos_stock'),
    ('dominio', 'newsletter_configuracion'),
    ('dominio', 'newsletter_suscriptores'),
    ('dominio', 'opiniones_producto'),
    ('dominio', 'ordenes_compra'),
    ('dominio', 'ordenes_compra_items'),
    ('dominio', 'precios_empresa'),
    ('dominio', 'precios_propios_empresa'),
    ('dominio', 'precios_propios_historial'),
    ('dominio', 'presupuestos_tienda'),
    ('dominio', 'producto_costos'),
    ('dominio', 'producto_costos_historial'),
    ('dominio', 'producto_empresa'),
    ('dominio', 'producto_imagenes'),
    ('dominio', 'producto_precios_escala'),
    ('dominio', 'producto_relacionados'),
    ('dominio', 'producto_variantes'),
    ('dominio', 'productos'),
    ('dominio', 'productos_tienda'),
    ('dominio', 'promociones_precio'),
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
    -- MSF-468 (RF-NL-23): el SHA-256 del token de confirmación no sale en el volcado.
    and not (p.tabla = 'newsletter_suscriptores' and a.attname = 'confirmacion_hash')
  group by p.esquema, p.tabla
  order by p.esquema, p.tabla;
$$;
