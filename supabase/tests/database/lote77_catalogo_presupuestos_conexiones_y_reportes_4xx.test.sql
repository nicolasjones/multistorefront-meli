-- Lote 77 (MSF-599, MSF-654 y MSF-655, decimocuarta ola): las RPC del catálogo de la tienda, presupuestos, fusión de clientes,
-- impresiones y exportación de comprobantes, costos adicionales, conexiones (incluidas las de OAuth), integraciones, reportes y
-- funcionalidades por organización contestan `PT404` (HTTP 404) cuando el dato no existe (antes `P0002`, HTTP 500), con el mismo
-- mensaje de negocio de siempre. Cada afirmación comprueba código y mensaje; hay al menos una por función migrada. Se comprueba
-- también lo que NO cambia: `proveedores_efectivos_de_cliente` sigue con `P0002` (`aprovisionar_servidor_organizacion` pasó a `PT404` en la ola 15, lote78), y los
-- comentarios de los costos adicionales nombran el código nuevo.
-- Fixture como postgres; verificaciones como «authenticated» con request.jwt.claims, igual que PostgREST.
begin;

select plan(22);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000009', 'superadmin@example.com');
insert into superadmins (user_id) values ('d1000000-0000-0000-0000-000000000009');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into reportes (id, superset_dashboard_uuid, nombre, creado_por, seccion) values
  ('f0000000-0000-0000-0000-000000000001', 'dash-lote77', 'Reporte lote 77', 'd1000000-0000-0000-0000-000000000009', 'ventas');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.como(uuid) to public;

-- ============================================================================
-- Persona administradora de la organización
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select throws_ok($$select public.listar_catalogo_tienda('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La empresa no existe', 'listar_catalogo_tienda: una empresa inexistente responde 404');
select throws_ok($$select public.copiar_presupuesto('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El presupuesto no existe', 'copiar_presupuesto: un presupuesto inexistente responde 404');
select throws_ok($$select public.fusionar_clientes('c1000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000009')$$,
  'PT404', 'Alguno de los clientes no existe', 'fusionar_clientes: un cliente inexistente responde 404');
select throws_ok($$select public.registrar_impresion('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El documento no existe', 'registrar_impresion: un documento inexistente responde 404');
select throws_ok($$select public.guardar_costo_adicional('99999999-9999-9999-9999-999999999999', 'e1000000-0000-0000-0000-000000000001', 'Flete', 'monto', 10)$$,
  'PT404', 'El costo adicional no existe o ya fue dado de baja', 'guardar_costo_adicional: un costo inexistente responde 404');
select throws_ok($$select public.dar_baja_costo_adicional('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'El costo adicional no existe', 'dar_baja_costo_adicional: un costo inexistente responde 404');
select throws_ok($$select * from public.archivo_exportacion_comprobantes('99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'NO_ENCONTRADA: no hay una exportación tuya con ese identificador', 'archivo_exportacion_comprobantes: una exportación inexistente responde 404');
select throws_ok($$select public.actualizar_credencial_conexion('99999999-9999-9999-9999-999999999999', 'nueva')$$,
  'PT404', 'La conexión 99999999-9999-9999-9999-999999999999 no existe', 'actualizar_credencial_conexion: una conexión inexistente responde 404');
select throws_ok($$select public.iniciar_conexion_oauth('11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La integración 99999999-9999-9999-9999-999999999999 no existe', 'iniciar_conexion_oauth: una integración inexistente responde 404');
select throws_ok($$select public.confirmar_conexion_oauth('99999999-9999-9999-9999-999999999999', 'nango-1')$$,
  'PT404', 'La conexión 99999999-9999-9999-9999-999999999999 no existe', 'confirmar_conexion_oauth: una conexión inexistente responde 404');

-- ============================================================================
-- Superadministración de la plataforma
-- ============================================================================
select pg_temp.como('d1000000-0000-0000-0000-000000000009');

select throws_ok($$select public.crear_conexion('99999999-9999-9999-9999-999999999999', 'sistema-x', 'secreto')$$,
  'PT404', 'La organización 99999999-9999-9999-9999-999999999999 no existe', 'crear_conexion: una organización inexistente responde 404');
select throws_ok($$select public.actualizar_integracion_oauth('99999999-9999-9999-9999-999999999999', true)$$,
  'PT404', 'La integración 99999999-9999-9999-9999-999999999999 no existe', 'actualizar_integracion_oauth: una integración inexistente responde 404');
select throws_ok($$select public.establecer_roles_default_reporte('99999999-9999-9999-9999-999999999999', array['operador'])$$,
  'PT404', 'El reporte 99999999-9999-9999-9999-999999999999 no existe', 'establecer_roles_default_reporte: un reporte inexistente responde 404');
select throws_ok($$select public.asignar_reporte('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111')$$,
  'PT404', 'El reporte 99999999-9999-9999-9999-999999999999 no existe', 'asignar_reporte: un reporte inexistente responde 404');
select throws_ok($$select public.asignar_reporte('f0000000-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La organización 99999999-9999-9999-9999-999999999999 no existe', 'asignar_reporte: una organización inexistente responde 404');
select throws_ok($$select public.habilitar_feature('feature-que-no-existe', '11111111-1111-1111-1111-111111111111')$$,
  'PT404', 'La funcionalidad feature-que-no-existe no existe', 'habilitar_feature: una funcionalidad inexistente responde 404');
select throws_ok($$select public.habilitar_feature('feature-que-no-existe', '99999999-9999-9999-9999-999999999999')$$,
  'PT404', 'La funcionalidad feature-que-no-existe no existe', 'habilitar_feature: se valida primero la funcionalidad');

-- ============================================================================
-- Lo que NO cambia
-- ============================================================================
select throws_ok($$select * from public.proveedores_efectivos_de_cliente('99999999-9999-9999-9999-999999999999')$$,
  'P0002', null, 'proveedores_efectivos_de_cliente sigue con P0002 (contrato propio del spec)');

reset role;
select is(obj_description('public.guardar_costo_adicional(uuid, uuid, text, text, numeric)'::regprocedure, 'pg_proc'),
  'F-REN-08: alta (p_id null) o edición de un costo adicional (solo edición en rentabilidad). 42501, 23514, 23505, PT404.',
  'el comentario de guardar_costo_adicional nombra PT404');
select is(obj_description('public.dar_baja_costo_adicional(uuid)'::regprocedure, 'pg_proc'),
  'F-REN-08: da de baja (activo = false) un costo adicional; idempotente. 42501 sin edición, PT404 si no existe.',
  'el comentario de dar_baja_costo_adicional nombra PT404');

-- ACL: ninguna de las migradas es llamable por anon (create or replace conserva privilegios).
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('listar_catalogo_tienda', 'copiar_presupuesto', 'fusionar_clientes', 'registrar_impresion',
                'guardar_costo_adicional', 'dar_baja_costo_adicional', 'archivo_exportacion_comprobantes', 'crear_conexion',
                'actualizar_credencial_conexion', 'iniciar_conexion_oauth', 'confirmar_conexion_oauth', 'actualizar_integracion_oauth',
                'establecer_roles_default_reporte', 'asignar_reporte', 'habilitar_feature')
              and has_function_privilege('anon', p.oid, 'execute')), 0,
  'ninguna de las quince RPC es ejecutable por anon');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('listar_catalogo_tienda', 'copiar_presupuesto', 'fusionar_clientes', 'registrar_impresion',
                'guardar_costo_adicional', 'dar_baja_costo_adicional', 'archivo_exportacion_comprobantes', 'crear_conexion',
                'actualizar_credencial_conexion', 'iniciar_conexion_oauth', 'confirmar_conexion_oauth', 'actualizar_integracion_oauth',
                'establecer_roles_default_reporte', 'asignar_reporte', 'habilitar_feature')
              and p.prosecdef), 15,
  'las quince RPC siguen siendo security definer');

select * from finish();
rollback;
