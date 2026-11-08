-- MSF-396 (revisión retroactiva): el pgTAP de completitud de la exportación total (`toda tabla con organizacion_id de
-- public y dominio está en la lista permitida o en las exclusiones`) falló al integrar `dokploy` en la épica: llegaron
-- dos tablas nuevas con `organizacion_id` que no estaban en ninguna de las dos listas.
--   · dominio.cotizacion_configuracion  → dato de negocio (cómo se carga la cotización del dólar): SE EXPORTA.
--   · dominio.precios_propios_empresa   → dato de negocio (precios propios por empresa): SE EXPORTA.
-- Redefine `private.conjuntos_exportacion_total()` (misma firma y privilegios) con esas dos tablas. La lista de
-- exclusiones no cambia.
--
-- Migración aditiva. Reversión (migración posterior): volver a la definición de
-- `20270217000003_exportacion_total_conjuntos.sql` (sin las dos tablas).

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
