-- MSF-396 (F-OPS-06, MSF-224, FR-031, FR-035): conjuntos de la exportación total de la organización y funciones
-- de lectura del worker `exportar-organizacion`.
--
-- `private.conjuntos_exportacion_total()` es una LISTA PERMITIDA explícita de tablas (esquema, tabla) con datos de
-- negocio de la organización, en `dominio` y en `public`; las columnas salen del catálogo real y NUNCA incluyen las
-- que parecen secreto (secret, token, password, api key, vault, credencial). `private.exclusiones_exportacion_total()`
-- documenta, con su motivo, qué tablas con `organizacion_id` quedan afuera a propósito (credenciales, colas internas,
-- registros operativos y derivados). La prueba pgTAP `exportacion_total.test.sql` falla si una tabla con
-- `organizacion_id` de `public` o `dominio` no está en ninguna de las dos listas (FR-032).
--
-- Aislamiento (FR-035): `datos_exportacion_total` y `filas_exportacion_total` solo las ejecuta un rol `worker_<org>`
-- (miembro de `workers_orquestacion`) sobre una ejecución EN CURSO de la capacidad `exportar-organizacion-*`; la
-- organización sale de la ejecución, nunca de un parámetro, y el conjunto pedido se valida contra la lista permitida
-- (los identificadores del `format('%I')` salen de esa lista, no del llamante).
--
-- Esquemas (Principio VII): sin tablas nuevas; solo funciones en `private` (ayudantes de plataforma). Re-verificado:
-- ninguna tabla de esta migración. Migración aditiva. Reversión (migración posterior):
--   drop function private.filas_exportacion_total(uuid, text, text, integer, integer);
--   drop function private.datos_exportacion_total(uuid);
--   drop function private.conjuntos_exportacion_total();
--   drop function private.exclusiones_exportacion_total();

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

revoke execute on function private.exclusiones_exportacion_total() from public, anon, authenticated;

comment on function private.exclusiones_exportacion_total() is
  'F-OPS-06 (FR-031): tablas con organizacion_id que la exportación total NO incluye, con su motivo (credenciales, colas internas, registros operativos y derivados).';

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

revoke execute on function private.conjuntos_exportacion_total() from public, anon, authenticated;
grant execute on function private.conjuntos_exportacion_total() to workers_orquestacion;

comment on function private.conjuntos_exportacion_total() is
  'F-OPS-06 (FR-031): lista permitida de conjuntos (esquema, tabla, columnas) de la exportación total. Las columnas salen del catálogo y excluyen las que parecen secretos. Sin datos de ninguna organización.';

-- Autoriza al worker sobre su ejecución en curso y devuelve lo que necesita para exportar.
create or replace function private.datos_exportacion_total(p_ejecucion_id uuid)
returns table (organizacion_id uuid, proceso_id uuid, conjuntos integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e public.ejecuciones_worker;
  v_clave text;
  v_vigente boolean;
  v_proceso uuid;
begin
  -- El dueño de la función (postgres) también puede: en el CI no es superusuario y pgTAP no puede simular
  -- el login del worker (ver datos_exportacion_comprobantes).
  if session_user <> current_user
     and (session_user not like 'worker\_%'
          or not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member')) then
    raise exception 'NO_AUTORIZADO: solo un worker accede a los datos de su exportación' using errcode = 'P0001';
  end if;

  select * into v_e from public.ejecuciones_worker e where e.id = p_ejecucion_id;
  if not found then
    raise exception 'EJECUCION_DESCONOCIDA: %', p_ejecucion_id using errcode = 'P0001';
  end if;
  perform private.autorizar_llamante_ciclo(v_e.organizacion_id);

  select ev.en_curso into v_vigente from private.estado_ejecucion_vigente(p_ejecucion_id) ev;
  if not coalesce(v_vigente, false) then
    raise exception 'EJECUCION_NO_EN_CURSO: %', p_ejecucion_id using errcode = 'P0001';
  end if;
  select cap.clave into v_clave from public.capacidades_ejecucion cap where cap.id = v_e.capacidad_id;
  if v_clave is null or v_clave not like 'exportar-organizacion-%' then
    raise exception 'CONFIGURACION_INVALIDA: la ejecución % no es una exportación total', p_ejecucion_id using errcode = 'P0001';
  end if;

  select p.id into v_proceso
  from public.procesos_masivos p
  where p.ejecucion_id = p_ejecucion_id
    and p.organizacion_id = v_e.organizacion_id
    and p.funcionalidad = 'exportacion_total';
  if v_proceso is null then
    raise exception 'CONFIGURACION_INVALIDA: la ejecución % no tiene su proceso de exportación total', p_ejecucion_id using errcode = 'P0001';
  end if;

  return query
  select v_e.organizacion_id, v_proceso, (select count(*)::integer from private.conjuntos_exportacion_total());
end;
$$;

revoke execute on function private.datos_exportacion_total(uuid) from public, anon, authenticated;
grant execute on function private.datos_exportacion_total(uuid) to workers_orquestacion;

comment on function private.datos_exportacion_total(uuid) is
  'F-OPS-06 (FR-035): organización, proceso masivo y cantidad de conjuntos de una exportación total en curso. Solo workers de la organización dueña, sobre la capacidad exportar-organizacion-*.';

-- Una página de filas de un conjunto, como jsonb (arreglo de objetos), acotada a la organización de la ejecución.
create or replace function private.filas_exportacion_total(
  p_ejecucion_id uuid,
  p_esquema text,
  p_tabla text,
  p_desde integer,
  p_limite integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_d record;
  v_columnas text[];
  v_filtro text;
  v_orden text;
  v_filas jsonb;
begin
  select * into v_d from private.datos_exportacion_total(p_ejecucion_id);
  if p_desde is null or p_desde < 0 or p_limite is null or p_limite < 1 or p_limite > 5000 then
    raise exception 'LOTE_INVALIDO: desde >= 0 y límite entre 1 y 5000' using errcode = '22023';
  end if;

  select c.columnas into v_columnas
  from private.conjuntos_exportacion_total() c
  where c.esquema = p_esquema and c.tabla = p_tabla;
  if v_columnas is null then
    raise exception 'CONJUNTO_DESCONOCIDO: el conjunto pedido no está en la lista de la exportación total' using errcode = '22023';
  end if;

  -- La organización misma se filtra por su `id`; el resto de los conjuntos, por `organizacion_id`.
  v_filtro := case when p_esquema = 'public' and p_tabla = 'organizaciones' then 'id' else 'organizacion_id' end;

  -- Orden estable para paginar con offset: la clave primaria o, sin ella, el orden físico.
  select string_agg(pg_catalog.format('%I', a.attname), ', ' order by k.ord) into v_orden
  from pg_catalog.pg_constraint pc
  cross join lateral pg_catalog.unnest(pc.conkey) with ordinality as k (attnum, ord)
  join pg_catalog.pg_attribute a on a.attrelid = pc.conrelid and a.attnum = k.attnum
  where pc.contype = 'p' and pc.conrelid = pg_catalog.format('%I.%I', p_esquema, p_tabla)::regclass;

  execute pg_catalog.format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select %s from %I.%I where %I = $1 order by %s offset $2 limit $3) t',
    (select string_agg(pg_catalog.format('%I', col), ', ') from pg_catalog.unnest(v_columnas) as col),
    p_esquema, p_tabla, v_filtro, coalesce(v_orden, 'ctid')
  ) into v_filas using v_d.organizacion_id, p_desde, p_limite;

  return v_filas;
end;
$$;

revoke execute on function private.filas_exportacion_total(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function private.filas_exportacion_total(uuid, text, text, integer, integer) to workers_orquestacion;

comment on function private.filas_exportacion_total(uuid, text, text, integer, integer) is
  'F-OPS-06 (FR-035): página de filas (jsonb) de un conjunto de la lista permitida, filtrada por la organización de la ejecución en curso. Lotes de hasta 5000.';
