-- Lote 76 (MSF-599, MSF-654 y MSF-655, decimotercera ola): las RPC de la tienda online, claves y suscripciones de API, documentos e
-- impresiones de comprobantes, presupuestos por correo, importación de productos y vista previa de la fusión de clientes contestan
-- `PT404` (HTTP 404) cuando el dato no existe (antes `P0002`, HTTP 500), con el mismo mensaje de negocio de siempre. Cada afirmación
-- comprueba código y mensaje; hay al menos una por función migrada. Se comprueba también lo que NO cambia: `reintentar_entrega_api`
-- (su `P0002` mezcla «no existe» y «no está agotada») y el comentario actualizado de `obtener_importacion_productos`.
-- Fixture como postgres; verificaciones como «authenticated» con request.jwt.claims, igual que PostgREST.
begin;

select plan(24);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Tienda online (borrador, publicación y versiones)
-- ============================================================================
select throws_ok($$select public.guardar_borrador_tienda('99999999-9999-9999-9999-999999999999', 'identidad', '{}'::jsonb)$$,
  'PT404', 'La empresa no existe', 'guardar_borrador_tienda: una empresa inexistente responde 404');
select throws_ok($$select public.obtener_borrador_tienda('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La empresa no existe', 'obtener_borrador_tienda: una empresa inexistente responde 404');
select throws_ok($$select public.descartar_borrador_tienda('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La empresa no existe', 'descartar_borrador_tienda: una empresa inexistente responde 404');
select throws_ok($$select public.publicar_tienda('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La empresa no existe', 'publicar_tienda: una empresa inexistente responde 404');
select throws_ok($$select public.listar_versiones_tienda('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La empresa no existe', 'listar_versiones_tienda: una empresa inexistente responde 404');
select throws_ok($$select public.restaurar_version_tienda('99999999-9999-9999-9999-999999999999', 1)$$,
  'PT404', 'La empresa no existe', 'restaurar_version_tienda: una empresa inexistente responde 404');
select throws_ok($$select public.restaurar_version_tienda('e1000000-0000-0000-0000-000000000001', 99)$$,
  'PT404', 'La versión no existe', 'restaurar_version_tienda: una versión inexistente responde 404');
select throws_ok($$select public.vista_previa_tienda('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La empresa no existe', 'vista_previa_tienda: una empresa inexistente responde 404');
select throws_ok($$select public.rutas_tienda_sin_referencia('99999999-9999-9999-9999-999999999999', array['logo.png'])$$,
  'PT404', 'La empresa no existe', 'rutas_tienda_sin_referencia: una empresa inexistente responde 404');

-- ============================================================================
-- Claves y suscripciones de API
-- ============================================================================
select throws_ok($$select public.revocar_clave_api('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La clave no existe', 'revocar_clave_api: una clave inexistente responde 404');
select throws_ok($$select * from public.rotar_clave_api('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La clave no existe', 'rotar_clave_api: una clave inexistente responde 404');
select throws_ok($$select public.actualizar_suscripcion_api('99999999-9999-9999-9999-999999999999', false)$$,
  'PT404', 'La suscripción no existe', 'actualizar_suscripcion_api: una suscripción inexistente responde 404');
select throws_ok($$select public.eliminar_suscripcion_api('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La suscripción no existe', 'eliminar_suscripcion_api: una suscripción inexistente responde 404');
select throws_ok($$select * from public.rotar_secreto_suscripcion_api('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La suscripción no existe', 'rotar_secreto_suscripcion_api: una suscripción inexistente responde 404');

-- ============================================================================
-- Documentos e impresiones de comprobantes, presupuestos por correo
-- ============================================================================
select throws_ok($$select * from public.listar_documentos_comprobante('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El comprobante no existe', 'listar_documentos_comprobante: un comprobante inexistente responde 404');
select throws_ok($$select public.obtener_documento_comprobante('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El documento no existe', 'obtener_documento_comprobante: un documento inexistente responde 404');
select throws_ok($$select * from public.ultimas_impresiones_comprobante('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El comprobante no existe', 'ultimas_impresiones_comprobante: un comprobante inexistente responde 404');
select throws_ok($$select public.solicitar_documento_comprobante('99999999-9999-9999-9999-999999999999', 'factura')$$,
  'PT404', 'El comprobante no existe', 'solicitar_documento_comprobante: un comprobante inexistente responde 404');
select throws_ok($$select public.enviar_presupuesto_correo('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El presupuesto no existe', 'enviar_presupuesto_correo: un presupuesto inexistente responde 404');
select throws_ok($$select * from public.listar_envios_correo_presupuesto('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El presupuesto no existe', 'listar_envios_correo_presupuesto: un presupuesto inexistente responde 404');

-- ============================================================================
-- Importación de productos y fusión de clientes
-- ============================================================================
select throws_ok($$select public.obtener_importacion_productos('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La importación no existe', 'obtener_importacion_productos: una importación inexistente responde 404');
select throws_ok($$select * from public.vista_previa_fusion_clientes('99999999-9999-9999-9999-999999999991', '99999999-9999-9999-9999-999999999992')$$,
  'PT404', 'Alguno de los clientes no existe', 'vista_previa_fusion_clientes: clientes inexistentes responden 404');

-- ============================================================================
-- Lo que NO cambia
-- ============================================================================
select throws_ok($$select public.reintentar_entrega_api('99999999-9999-9999-9999-999999999999')$$,
  'P0002', 'La entrega no existe o no está agotada', 'reintentar_entrega_api: sigue con P0002 (mezcla «no existe» y «no está agotada»)');
reset role;
select ok(obj_description('public.obtener_importacion_productos(uuid)'::regprocedure, 'pg_proc') like '%PT404 si no existe.',
  'obtener_importacion_productos: el comentario nombra PT404');

select * from finish();
rollback;
