-- Lote 78 (MSF-599, MSF-654 y MSF-655, decimoquinta ola): las RPC de las cargas de migración y lotes de importación, la vinculación de
-- identificadores externos, el aprovisionamiento de servidores, el acceso de soporte a organizaciones, las cuentas web de clientes, los
-- depósitos de repuestos, las tiendas de un cliente, el umbral de margen, la exportación de proveedores, la moderación de opiniones,
-- las asignaciones de empresas y el detalle de campañas de correo contestan `PT404` (HTTP 404) cuando el dato no existe y `PT412`
-- (HTTP 412) ante un conflicto de edición (antes `P0002` y `40001`, HTTP 500), con el mismo mensaje de negocio de siempre. Cada
-- afirmación comprueba código y mensaje; hay una por función migrada. Se comprueba también lo que NO cambia: el `55000` de bandera
-- apagada de `moderar_opinion`, y los comentarios actualizados de las tres funciones que nombraban el código viejo.
-- Fixture como postgres; verificaciones como «authenticated» con request.jwt.claims, igual que PostgREST.
begin;

select plan(21);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('d8000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d8000000-0000-0000-0000-000000000002', 'superadmin@example.com'),
  ('d8000000-0000-0000-0000-000000000003', 'cliente-cuenta@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d8000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into superadmins (user_id) values ('d8000000-0000-0000-0000-000000000002');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'SKU-ALFA', 1000, 'ARS', true);
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 910, 'Valeria Sánchez', 'v@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id) values
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000003', 'activa');
insert into dominio.opiniones_producto (id, organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario, estado, motivo_rechazo, moderada_por, moderada_en, creada_en, actualizada_en) values
  ('01000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 4, 'Muy buen producto, lo recomiendo', 'pendiente', null, null, null, '2027-03-10 10:00+00', '2027-03-10 10:00+00');
update public.banderas_plataforma set activa = false where clave = 'tienda_opiniones';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

select pg_temp.como('d8000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Cargas de migración y lotes de importación
-- ============================================================================
select throws_ok($$select public.cerrar_carga_migracion('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La carga no existe en tu organización', 'cerrar_carga_migracion: una carga inexistente responde 404');
select throws_ok($$select public.aplicar_lote_archivo_ingresos('99999999-9999-9999-9999-999999999999', 1, '[]'::jsonb)$$,
  'PT404', 'La carga no existe en tu organización', 'aplicar_lote_archivo_ingresos: una carga inexistente responde 404');
select throws_ok($$select public.aplicar_lote_clientes('99999999-9999-9999-9999-999999999999', 1, '[]'::jsonb)$$,
  'PT404', 'La carga no existe en tu organización', 'aplicar_lote_clientes: una carga inexistente responde 404');
select throws_ok($$select public.aplicar_lote_proveedores('99999999-9999-9999-9999-999999999999', 1, '[]'::jsonb)$$,
  'PT404', 'La carga no existe en tu organización', 'aplicar_lote_proveedores: una carga inexistente responde 404');
select throws_ok($$select public.aplicar_lote_vinculos_proveedor_producto('99999999-9999-9999-9999-999999999999', 1, '[]'::jsonb)$$,
  'PT404', 'La carga no existe en tu organización', 'aplicar_lote_vinculos_proveedor_producto: una carga inexistente responde 404');
select throws_ok($$select public.informe_conciliacion_migracion('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La carga no existe en tu organización', 'informe_conciliacion_migracion: una carga inexistente responde 404');
select throws_ok($$select public.vincular_identificador_externo('99999999-9999-9999-9999-999999999999', 'sistema-prueba', 'ext-001')$$,
  'PT404', 'El cliente 99999999-9999-9999-9999-999999999999 no existe', 'vincular_identificador_externo: un cliente inexistente responde 404');

-- ============================================================================
-- Organizaciones (solo superadmin)
-- ============================================================================
select pg_temp.como('d8000000-0000-0000-0000-000000000002');
select throws_ok($$select * from public.aprovisionar_servidor_organizacion('99999999-9999-9999-9999-999999999999', 'host.example.com', 'deploy', 'clave-ssh')$$,
  'PT404', 'La organización 99999999-9999-9999-9999-999999999999 no existe', 'aprovisionar_servidor_organizacion: una organización inexistente responde 404');
select throws_ok($$select public.entrar_a_organizacion('99999999-9999-9999-9999-999999999999', 'prueba de soporte')$$,
  'PT404', 'La organización 99999999-9999-9999-9999-999999999999 no existe', 'entrar_a_organizacion: una organización inexistente responde 404');

-- ============================================================================
-- Cuentas web, repuestos, tiendas de un cliente, umbral, proveedores, opiniones, asignaciones y campañas
-- ============================================================================
select pg_temp.como('d8000000-0000-0000-0000-000000000001');
select throws_ok($$select public.cambiar_estado_cuenta_cliente('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'suspendida')$$,
  'PT404', 'El cliente no tiene cuenta web en esa tienda', 'cambiar_estado_cuenta_cliente: sin cuenta en esa tienda responde 404');
select throws_ok($$select public.depositos_para_repuesto('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El producto no existe', 'depositos_para_repuesto: un producto inexistente responde 404');
select throws_ok($$select public.guardar_empresas_de_cliente('99999999-9999-9999-9999-999999999999', array['e1000000-0000-0000-0000-000000000001']::uuid[])$$,
  'PT404', 'El cliente no pertenece a tu organización', 'guardar_empresas_de_cliente: un cliente inexistente responde 404');
select throws_ok($$select public.guardar_umbral_margen_bajo(0.1, '2027-03-01 00:00+00')$$,
  'PT412', 'El umbral fue modificado por otra persona', 'guardar_umbral_margen_bajo: un conflicto de edición responde 412');
select throws_ok($$select * from public.exportar_proveedores(null, 'activos', null, '99999999-9999-9999-9999-999999999999', 10)$$,
  'PT412', 'El proveedor de referencia de la exportación ya no existe: reintentá', 'exportar_proveedores: un cursor inexistente responde 412');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000001', 'rechazar', null, '2027-03-01 00:00+00')$$,
  'PT412', 'conflicto', 'moderar_opinion: una fecha vieja responde 412');
select throws_ok($$select public.moderar_opinion('01000000-0000-0000-0000-000000000001', 'aceptar', null, '2027-03-10 10:00+00')$$,
  '55000', 'Las opiniones están desactivadas: no se pueden aceptar', 'moderar_opinion: con la bandera apagada sigue con 55000');
select throws_ok($$select public.asignar_empresas_usuario('99999999-9999-9999-9999-999999999999', '[]'::jsonb)$$,
  'PT404', 'El usuario no pertenece a la organización', 'asignar_empresas_usuario: un usuario inexistente responde 404');
select throws_ok($$select public.detalle_campana_correo('99999999-9999-9999-9999-999999999999', 1, 50)$$,
  'PT404', 'La campaña no existe', 'detalle_campana_correo: una campaña inexistente responde 404');

-- ============================================================================
-- Comentarios que nombraban el código viejo
-- ============================================================================
reset role;
select is(obj_description('public.guardar_umbral_margen_bajo(numeric, timestamptz)'::regprocedure, 'pg_proc'),
  'F-REN-01: guarda el umbral de margen bajo (solo edición en rentabilidad). 42501 sin permiso, 23514 fuera de rango, PT412 conflicto de edición (antes 40001).',
  'el comentario de guardar_umbral_margen_bajo nombra PT412');
select ok(obj_description('public.moderar_opinion(uuid, text, text, timestamptz)'::regprocedure, 'pg_proc') like '%PT412 conflicto, antes 40001%',
  'el comentario de moderar_opinion nombra PT412');
select ok(obj_description('public.exportar_proveedores(text, text, uuid, uuid, integer)'::regprocedure, 'pg_proc') like '%cursor inexistente => PT412%',
  'el comentario de exportar_proveedores nombra PT412');

select * from finish();
rollback;
