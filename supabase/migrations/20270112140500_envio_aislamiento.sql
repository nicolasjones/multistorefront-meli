-- F-VTA-16 (MSF-166, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-020/FR-021):
-- el envío de una factura (transporte, guía y fecha) NO se lee directo de la tabla: la única lectura es la RPC
-- `public.obtener_envio_comprobante`, que resuelve el permiso en la empresa DEL comprobante.
--
-- Por qué hace falta: la RLS de `dominio.comprobantes_venta`
-- (`supabase/migrations/20261021160200_ventas_contrato_comprobantes.sql:46-51`) resuelve organización + sección
-- `ventas` contra la **empresa activa** de la barra superior, no contra la empresa del comprobante. Con
-- `grant select` de tabla y `dominio` expuesto por PostgREST (`SUPABASE_API_SCHEMAS`), una persona con Ventas en
-- lectura en la tienda A leía el envío (transporte, guía y fecha) de un comprobante de la tienda B de la misma
-- organización con solo pasarle el id (BOLA entre tiendas). La RPC de `20270112140400_envio_leer.sql` cerraba la
-- lectura de la APP, pero no la de la TABLA: con la API a la vista, el hueco seguía abierto.
--
-- Qué hace: se saca el privilegio de lectura de TABLA y se concede **por columna**. Las tres columnas del envío
-- (`transporte_id`, `guia`, `fecha_envio`) quedan sin privilegio para `authenticated`: ni la app ni una llamada
-- directa a PostgREST las leen. Las demás columnas de la factura se leen igual que antes, con la misma RLS
-- (organización + sección `ventas`). Es el mismo patrón del repo para esconder columnas sensibles
-- (`public.cola_eventos`, `public.conexiones_oauth`, `public.despachos_ejecucion`).
--
-- Esquema (Principio VII): sin tablas nuevas, sin columnas nuevas y sin cambios de RLS. Solo cambian los
-- privilegios de lectura de `dominio.comprobantes_venta`.
--
-- Lo que NO cambia: la escritura del envío sigue siendo solo de la RPC `security definer`
-- `public.guardar_envio_comprobante` (T014) y el disparador de FR-022 (`private.exigir_envio_al_entregar`, T015)
-- sigue leyendo las columnas del envío como `security definer` (o sea, como dueño de la tabla): el disparador
-- no pierde nada.
--
-- Ojo al agregar columnas: a partir de acá, una columna nueva de `dominio.comprobantes_venta` NO es legible por
-- `authenticated` hasta que una migración la conceda (el privilegio es por columna, no de tabla). Es el lado sano
-- del cambio, y el pgTAP de F-VTA-16 (`supabase/tests/database/envio_transporte.test.sql`) avisa si queda alguna
-- sin conceder.
--
-- Migración aditiva (no toca datos ni columnas). Reversión (en una migración posterior):
--   grant select on table dominio.comprobantes_venta to authenticated;

-- El privilegio de tabla se va: el de columna lo reemplazan los `grant select (...)` de abajo.
revoke select on table dominio.comprobantes_venta from public, anon, authenticated;

-- Las columnas de la factura que `authenticated` puede leer (con la RLS de siempre: organización + sección
-- `ventas`). Las tres del envío NO están: se leen por `public.obtener_envio_comprobante`.
grant select (
  -- Contrato de la venta (F-CLI-08, 20261021160200) y cabecera (F-VTA-01, 20261203100100).
  id, organizacion_id, cliente_id, tipo, numero, fecha, estado,
  total_sin_iva, total_con_iva, creado_en,
  empresa_id, canal, operador_id, valido_hasta, forma_pago_id, envio_id,
  confirmado_en, confirmado_por, numero_entero, updated_at,
  -- Anulación y nota de crédito (F-VTA-11, 20261212120000).
  comprobante_origen_id, nc_tipo, nc_concepto, anulado_en, anulado_por, motivo_anulacion,
  -- Despacho (F-VTA-15, 20270112100100).
  estado_despacho, armo_id, controlo_id, entrego_id, entregado_en
) on table dominio.comprobantes_venta to authenticated;

-- El comentario de la tabla (F-CLI-08) se conserva y se le suma la frontera de lectura del envío.
comment on table dominio.comprobantes_venta is
  'Contrato de datos de venta (F-CLI-08): un documento por fila. Solo lectura para el panel; Ventas (MSF-159/177) escribe y completa el contrato con migraciones aditivas. Las columnas del envío (transporte_id, guia, fecha_envio) no tienen privilegio de lectura para authenticated: se leen por la RPC public.obtener_envio_comprobante, que resuelve el permiso en la empresa del comprobante (F-VTA-16, FR-021).';
