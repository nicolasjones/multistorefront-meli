-- F-PRV-07 (MSF-448, épica MSF-445): costo de línea opcional y evolución del costo por producto.
-- Cubre CA-PRV-07-1 (dos ingresos a distinto costo, con fecha y proveedor), CA-PRV-07-2 (sin costo
-- no es cero), anulado excluido, permisos (Rentabilidad + Proveedores), empresas accesibles,
-- organización de la sesión y `anon` sin acceso. Fechas relativas a la base (sin reloj fijo).
begin;

select plan(17);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'administracion@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Uno', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Dos', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Otra Org', true);

-- «administracion» solo accede a la Tienda Uno.
insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion');

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor Uno', '20123456786', true),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Proveedor Dos', '30701234568', true);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto Uno', 'P-1', 50);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.como_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;

create function pg_temp.ingreso(p_empresa uuid, p_proveedor uuid, p_dias integer, p_comprobante text, p_costo numeric, p_actualizar boolean)
returns void language plpgsql as $$
begin
  perform public.registrar_ingreso_mercaderia(
    p_empresa, p_proveedor, current_date - p_dias, p_comprobante,
    jsonb_build_array(jsonb_build_object('producto_id', 'a1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'costo_unitario_usd', p_costo)),
    p_actualizar
  );
end $$;

-- ============================================================================
-- Administrador: ingresos con y sin costo
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- I1: cd-3, proveedor uno, 10.00, actualiza el costo del producto
select lives_ok(
  $$select pg_temp.ingreso('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 3, 'A-1', 10.00, true)$$,
  'registra un ingreso con costo'
);
select is(
  (select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  10.00::numeric, 'el costo del producto queda en 10,00'
);

-- I3: cd-2, proveedor dos, SIN costo, pidiendo actualizar el costo
select lives_ok(
  $$select pg_temp.ingreso('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 2, 'B-1', null, true)$$,
  'FR-015: registra un ingreso sin costo en la línea'
);
select is(
  (select costo_unitario_usd from dominio.ingresos_mercaderia_lineas l join dominio.ingresos_mercaderia i on i.id = l.ingreso_id where i.comprobante = 'B-1'),
  null::numeric, 'la línea sin costo queda nula (no cero)'
);
select is(
  (select costo from dominio.producto_costos where producto_id = 'a1000000-0000-0000-0000-000000000001'),
  10.00::numeric, 'una línea sin costo no actualiza el costo del producto'
);

-- I2: cd-1, proveedor uno, 12.50
select pg_temp.ingreso('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 1, 'A-2', 12.50, false);
-- I6: cd-6, proveedor dos, 8.00
select pg_temp.ingreso('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 6, 'B-0', 8.00, false);
-- I5: cd-5, proveedor uno, Tienda Dos (el usuario «administracion» no la ve), 7.00
select pg_temp.ingreso('e1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 5, 'A-0', 7.00, false);
-- I4: cd-4, proveedor uno, 99.00 y se anula
select pg_temp.ingreso('e1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 4, 'A-X', 99.00, false);
select public.anular_ingreso_mercaderia((select id from dominio.ingresos_mercaderia where comprobante = 'A-X'), 'Carga equivocada');

select is(
  (select array_agg(costo_unitario_usd order by fecha) from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001')),
  array[8.00, 7.00, 10.00, 12.50]::numeric[],
  'CA-PRV-07-1: dos o más ingresos a distinto costo aparecen ordenados por fecha; sin costo y anulado no figuran'
);
select is(
  (select array_agg(fecha order by fecha) from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001')),
  array[current_date - 6, current_date - 5, current_date - 3, current_date - 1],
  'cada punto trae la fecha del ingreso'
);
select is(
  (select count(*)::int from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001') where costo_unitario_usd = 0 or costo_unitario_usd is null),
  0, 'CA-PRV-07-2: el ingreso sin costo no se cuenta como cero'
);
select is(
  (select count(*)::int from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001') where costo_unitario_usd = 99.00),
  0, 'el ingreso anulado no figura'
);
select is(
  (select array_agg(distinct proveedor_razon_social) from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001')),
  array['Proveedor Dos', 'Proveedor Uno'], 'cada punto trae su proveedor'
);
select is(
  (select array_agg(comprobante order by fecha) from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001')),
  array['A-0', 'A-1', 'A-2'], 'el filtro por proveedor deja solo sus ingresos con comprobante'
);

-- ============================================================================
-- Permisos, empresas accesibles, organización y anon
-- ============================================================================

reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(
  (select array_agg(costo_unitario_usd order by fecha) from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001')),
  array[8.00, 10.00, 12.50]::numeric[],
  'administración (Rentabilidad L + Proveedores E) ve solo los ingresos de sus empresas accesibles'
);

reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select * from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'operador (sin Rentabilidad ni Proveedores) no ve la evolución'
);

reset role;
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001')),
  0, 'otra organización no ve los costos de un producto ajeno'
);

reset role;
select pg_temp.como_anon();
select throws_ok(
  $$select * from public.historial_costos_producto('a1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'anon no puede ejecutar la RPC'
);

reset role;
select is(
  (select has_function_privilege('anon', 'public.historial_costos_producto(uuid, uuid)', 'execute')),
  false, 'anon sin privilegio de ejecución'
);
select is(
  (select has_function_privilege('authenticated', 'public.historial_costos_producto(uuid, uuid)', 'execute')),
  true, 'authenticated con privilegio de ejecución'
);

select * from finish();
rollback;
