-- F-GAS-01 (MSF-469): estructura, seguridad y aislamiento de `dominio.gastos` (RF-GAS-1, RF-GAS-5, RF-GAS-15, SC-003).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A'),
  ('22222222-2222-2222-2222-222222222222', 'Organización B');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-a@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion-a@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador-a@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-b@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A1'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda A2'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda B');
-- Administración solo ve la empresa con fila explícita.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion');

insert into dominio.gastos (id, organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos) values
  ('99000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-03-05', 'Alquiler', 'fijo', 1000, 'ARS', 1000),
  ('99000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', '2027-03-05', 'Servicios', 'fijo', 2000, 'ARS', 2000),
  ('99000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001', '2027-03-05', 'Sueldos', 'fijo', 3000, 'ARS', 3000);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Estructura (RF-GAS-1).
select has_table('dominio', 'gastos', 'la tabla vive en dominio');
select ok((select relrowsecurity from pg_class where oid = 'dominio.gastos'::regclass), 'la tabla tiene RLS');
select has_column('dominio', 'gastos', 'importe_pesos', 'guarda el importe en pesos congelado');
select throws_ok($$insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-03-05', 'Alquiler', 'fijo', 0, 'ARS', 0)$$,
  '23514', null, 'importe > 0');
select throws_ok($$insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-03-05', 'Cualquiera', 'fijo', 10, 'ARS', 10)$$,
  '23514', null, 'categoría fuera del catálogo');
select throws_ok($$insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-03-05', 'Alquiler', 'mixto', 10, 'ARS', 10)$$,
  '23514', null, 'tipo de costo fijo o variable');
select throws_ok($$insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-03-05', 'Alquiler', 'fijo', 10, 'USD', 10)$$,
  '23514', null, 'un gasto en USD exige cotización');
select throws_ok($$insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, cotizacion_usada, importe_pesos)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-03-05', 'Alquiler', 'fijo', 10, 'ARS', 5, 10)$$,
  '23514', null, 'un gasto en ARS no lleva cotización');
select throws_ok($$insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos, anulado_en)
  values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '2027-03-05', 'Alquiler', 'fijo', 10, 'ARS', 10, now())$$,
  '23514', null, 'anular exige motivo');
select throws_ok($$insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, importe, moneda, importe_pesos)
  values ('11111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-000000000001', '2027-03-05', 'Alquiler', 'fijo', 10, 'ARS', 10)$$,
  '23503', null, 'la empresa debe ser de la misma organización (FK compuesta)');

-- Privilegios (RF-GAS-5, RF-GAS-15).
select is(has_table_privilege('anon', 'dominio.gastos', 'select'), false, 'anon no lee');
select is(has_table_privilege('authenticated', 'dominio.gastos', 'select'), true, 'authenticated lee (con RLS)');
select is(has_table_privilege('authenticated', 'dominio.gastos', 'insert'), false, 'sin insert directo');
select is(has_table_privilege('authenticated', 'dominio.gastos', 'update'), false, 'sin update directo');
select is(has_table_privilege('authenticated', 'dominio.gastos', 'delete'), false, 'sin delete');
select is((select count(*)::int from pg_policies where schemaname = 'dominio' and tablename = 'gastos' and cmd <> 'SELECT'), 0, 'solo hay política de lectura');
select is(has_function_privilege('anon', 'public.guardar_gasto(uuid, uuid, date, text, text, text, numeric, text, boolean, timestamptz)', 'execute'), false, 'anon no guarda');
select is(has_function_privilege('anon', 'public.listar_gastos(date, date, uuid, text, text, boolean, date, uuid, integer)', 'execute'), false, 'anon no lista');
select is(has_function_privilege('authenticated', 'public.anular_gasto(uuid, text, timestamptz)', 'execute'), true, 'authenticated anula (la RPC valida)');

-- Aislamiento por organización y empresa (SC-003, CA-GAS-8).
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.gastos), 2, 'el administrador de A ve solo los gastos de A');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.gastos), 1, 'el administrador de B ve solo los suyos');
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.gastos), 1, 'Administración ve solo la empresa asignada');
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.gastos), 0, 'un rol sin la sección rentabilidad no ve filas');
reset role;
select throws_ok($$set local role anon; select count(*) from dominio.gastos$$, '42501', null, 'anon sin privilegios');

select * from finish();
rollback;
