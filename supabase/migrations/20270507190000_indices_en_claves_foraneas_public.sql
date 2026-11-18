-- MSF-918 (lote 33, higiene de la base): índices en claves foráneas del esquema public sin índice propio.
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
-- Migración aditiva. Reversión (migración posterior): `drop index if exists public.<nombre>;` por cada índice `*_fk_idx` de abajo.
--   Lista completa: select indexname from pg_indexes where schemaname = 'public' and indexname like '%\_fk\_idx' escape '\';

create index if not exists alertas_monitoreo_organizacion_id_fk_idx
  on public.alertas_monitoreo (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists alertas_conexion_id_fk_idx
  on public.alertas (conexion_id);  -- -> conexiones (on delete set null)
create index if not exists api_entregas_suscripcion_id_fk_idx
  on public.api_entregas (suscripcion_id);  -- -> api_suscripciones (on delete cascade)
create index if not exists conexiones_mcp_credencial_id_fk_idx
  on public.conexiones_mcp (credencial_id);  -- -> credenciales_mcp (on delete cascade)
create index if not exists conexiones_oauth_integracion_id_fk_idx
  on public.conexiones_oauth (integracion_id);  -- -> integraciones_oauth (on delete restrict)
create index if not exists conversaciones_chat_ia_organizacion_id_fk_idx
  on public.conversaciones_chat_ia (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists conversaciones_chat_ia_usuario_id_fk_idx
  on public.conversaciones_chat_ia (usuario_id);  -- -> auth.users (on delete cascade)
create index if not exists credenciales_mcp_creada_por_fk_idx
  on public.credenciales_mcp (creada_por);  -- -> auth.users (on delete cascade)
create index if not exists credenciales_mcp_organizacion_id_fk_idx
  on public.credenciales_mcp (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists despachos_ejecucion_organizacion_id_fk_idx
  on public.despachos_ejecucion (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists documentos_organizacion_id_fk_idx
  on public.documentos (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists documentos_subido_por_fk_idx
  on public.documentos (subido_por);  -- -> auth.users (on delete cascade)
create index if not exists ejecuciones_chat_ia_feature_id_fk_idx
  on public.ejecuciones_chat_ia (feature_id);  -- -> features (on delete restrict)
create index if not exists ejecuciones_chat_ia_mensaje_id_fk_idx
  on public.ejecuciones_chat_ia (mensaje_id);  -- -> mensajes_chat_ia (on delete cascade)
create index if not exists ejecuciones_chat_ia_usuario_id_fk_idx
  on public.ejecuciones_chat_ia (usuario_id);  -- -> auth.users (on delete cascade)
create index if not exists ejecuciones_mcp_credencial_id_fk_idx
  on public.ejecuciones_mcp (credencial_id);  -- -> credenciales_mcp (on delete cascade)
create index if not exists ejecuciones_mcp_feature_id_fk_idx
  on public.ejecuciones_mcp (feature_id);  -- -> features (on delete cascade)
create index if not exists ejecuciones_worker_capacidad_id_fk_idx
  on public.ejecuciones_worker (capacidad_id);  -- -> capacidades_ejecucion (on delete cascade)
create index if not exists eventos_features_actor_user_id_fk_idx
  on public.eventos_features (actor_user_id);  -- -> auth.users (on delete cascade)
create index if not exists eventos_features_organizacion_id_fk_idx
  on public.eventos_features (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists eventos_membresia_actor_user_id_fk_idx
  on public.eventos_membresia (actor_user_id);  -- -> auth.users (on delete cascade)
create index if not exists eventos_monitoreo_organizacion_id_fk_idx
  on public.eventos_monitoreo (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists eventos_proveedor_capacidad_cliente_id_fk_idx
  on public.eventos_proveedor_capacidad (cliente_id);  -- -> dominio.clientes (on delete set null)
create index if not exists eventos_reportes_actor_user_id_fk_idx
  on public.eventos_reportes (actor_user_id);  -- -> auth.users (on delete cascade)
create index if not exists eventos_reportes_organizacion_id_fk_idx
  on public.eventos_reportes (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists fragmentos_indexados_version_id_fk_idx
  on public.fragmentos_indexados (version_id);  -- -> versiones_documento (on delete cascade)
create index if not exists ia_interacciones_politica_id_fk_idx
  on public.ia_interacciones (politica_id);  -- -> ia_politicas (on delete restrict)
create index if not exists ia_politicas_contrato_id_fk_idx
  on public.ia_politicas (contrato_id);  -- -> ia_contratos_consumidor (on delete restrict)
create index if not exists invitaciones_organizacion_organizacion_id_fk_idx
  on public.invitaciones_organizacion (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists mensajes_chat_ia_accion_feature_id_fk_idx
  on public.mensajes_chat_ia (accion_feature_id);  -- -> features (on delete set null)
create index if not exists mensajes_chat_ia_conversacion_id_fk_idx
  on public.mensajes_chat_ia (conversacion_id);  -- -> conversaciones_chat_ia (on delete cascade)
create index if not exists organizaciones_features_habilitado_por_fk_idx
  on public.organizaciones_features (habilitado_por);  -- -> auth.users (on delete cascade)
create index if not exists organizaciones_features_organizacion_id_fk_idx
  on public.organizaciones_features (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists procesos_masivos_empresa_id_fk_idx
  on public.procesos_masivos (empresa_id);  -- -> dominio.empresas (on delete cascade)
create index if not exists reportes_organizaciones_asignado_por_fk_idx
  on public.reportes_organizaciones (asignado_por);  -- -> auth.users (on delete cascade)
create index if not exists reportes_organizaciones_organizacion_id_fk_idx
  on public.reportes_organizaciones (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists reportes_creado_por_fk_idx
  on public.reportes (creado_por);  -- -> auth.users (on delete cascade)
create index if not exists solicitudes_acceso_usuario_id_fk_idx
  on public.solicitudes_acceso (usuario_id);  -- -> auth.users (on delete cascade)
create index if not exists superadmin_entradas_user_id_fk_idx
  on public.superadmin_entradas (user_id);  -- -> auth.users (on delete cascade)
create index if not exists superadmin_organizacion_activa_organizacion_id_fk_idx
  on public.superadmin_organizacion_activa (organizacion_id);  -- -> organizaciones (on delete cascade)
create index if not exists versiones_documento_documento_id_fk_idx
  on public.versiones_documento (documento_id);  -- -> documentos (on delete cascade)
create index if not exists versiones_documento_subida_por_fk_idx
  on public.versiones_documento (subida_por);  -- -> auth.users (on delete cascade)
