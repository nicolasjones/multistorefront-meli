-- F-CLI-01 (MSF-262, épica MSF-180): alta y edición de clientes.
-- Cubre SC-001, SC-005 y SC-007: permisos por sección (editan / leen / ninguno),
-- aislamiento entre organizaciones, archivar y restaurar con evento de
-- actividad (y sin evento sin sesión), número correlativo, columnas protegidas,
-- unicidad de DNI/CUIT y sin DELETE. Corre como postgres para armar el fixture
-- y como "authenticated" (request.jwt.claims, igual que PostgREST) para verificar.
-- Cada organización nace con su Consumidor final (número 1, F-CLI-03): el primer
-- cliente cargado es el 2. Su inmutabilidad y `escala_de_cliente` se prueban en
-- clientes_tipo_y_consumidor_final.test.sql.
begin;

select plan(40);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('b1000000-0000-0000-0000-000000000004', 'mostrador@example.com'),
  ('b1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('b1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Alta: roles que editan (administrador, administración, mostrador, operador)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into clientes (id, organizacion_id, nombre, documento, correo)
    values ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '  Distribuidora Norte SRL  ', '30-71234567-8', 'norte@example.com')$$,
  'operador: crea un cliente'
);
select is(
  (select nombre from clientes where id = 'c1000000-0000-0000-0000-000000000001'),
  'Distribuidora Norte SRL', 'el nombre se guarda recortado'
);
select is(
  (select numero from clientes where id = 'c1000000-0000-0000-0000-000000000001'),
  2, 'el primer cliente cargado recibe el número 2 (el 1 es el Consumidor final)'
);
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000004');
select lives_ok(
  $$insert into clientes (id, organizacion_id, nombre) values ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cliente de mostrador')$$,
  'mostrador: crea un cliente'
);
reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000006');
select lives_ok(
  $$insert into clientes (id, organizacion_id, nombre) values ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cliente de administración')$$,
  'administración: crea un cliente'
);
reset role;
select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into clientes (id, organizacion_id, nombre) values ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cliente del administrador')$$,
  'administrador: crea un cliente'
);
reset role;

select is(
  (select array_agg(numero order by numero) from clientes where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array[1, 2, 3, 4, 5], 'los números son correlativos y sin saltos (el 1 es el Consumidor final)'
);

-- Nombre vacío o solo espacios: rechazado
select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', '   ')$$,
  '23514', null, 'nombre solo con espacios: rechazado'
);

-- ============================================================================
-- Columnas protegidas
-- ============================================================================

select throws_ok(
  $$insert into clientes (organizacion_id, nombre, numero) values ('11111111-1111-1111-1111-111111111111', 'Con número propio', 99)$$,
  '42501', null, 'el llamador no puede fijar `numero` al insertar'
);
select throws_ok(
  $$update clientes set numero = 50 where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'el llamador no puede cambiar `numero`'
);
select throws_ok(
  $$update clientes set organizacion_id = '22222222-2222-2222-2222-222222222222' where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'el llamador no puede mover el cliente de organización'
);

-- ============================================================================
-- Edición, archivado y restauración con actividad
-- ============================================================================

select lives_ok(
  $$update clientes set localidad = 'Rosario' where id = 'c1000000-0000-0000-0000-000000000001'$$,
  'operador: edita un cliente'
);
select lives_ok(
  $$update clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000001'$$,
  'operador: archiva un cliente'
);
select lives_ok(
  $$update clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000001'$$,
  'archivar un cliente ya archivado es idempotente'
);
select lives_ok(
  $$update clientes set archivado_en = null where id = 'c1000000-0000-0000-0000-000000000001'$$,
  'operador: restaura el cliente'
);
reset role;

select is(
  (select array_agg(tipo order by tipo)
     from registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111'
      and tipo in ('cliente.editado', 'cliente.archivado', 'cliente.restaurado')
      and detalle like '%Nº 2 ·%'),
  array['cliente.archivado', 'cliente.editado', 'cliente.restaurado'],
  'editar, archivar y restaurar dejan un evento cada uno (el archivado repetido no duplica)'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.creado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  4, 'cada alta con sesión deja un evento cliente.creado'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo like 'cliente.%' and (detalle like '%norte@example.com%' or detalle like '%30-71234567-8%' or detalle like '%Rosario%')),
  0, 'el detalle de la actividad no incluye datos de contacto'
);

-- Sin sesión (importación, API): recibe número pero no genera evento
select set_config('request.jwt.claims', '{}', true);
insert into clientes (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Importado sin sesión');
select is(
  (select numero from clientes where id = 'c1000000-0000-0000-0000-000000000005'),
  6, 'una carga sin sesión recibe el siguiente número'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'cliente.creado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  4, 'una carga sin sesión no genera evento de actividad'
);

-- ============================================================================
-- Roles que leen o no tienen acceso
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000003');
select ok((select count(*) from clientes) >= 5, 'consulta: lee los clientes de su organización');
select throws_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Intento de consulta')$$,
  '42501', null, 'consulta: la base rechaza el alta'
);
update clientes set nombre = 'Hackeado por consulta' where id = 'c1000000-0000-0000-0000-000000000001';
select is(
  (select nombre from clientes where id = 'c1000000-0000-0000-0000-000000000001'),
  'Distribuidora Norte SRL', 'consulta: la edición directa no cambia ninguna fila'
);
update clientes set archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000001';
select is(
  (select archivado_en from clientes where id = 'c1000000-0000-0000-0000-000000000001'),
  null, 'consulta: no puede archivar por la API'
);
reset role;

select pg_temp.como('b1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from clientes), 0, 'depósito (sección en ninguno): no lee filas');
select throws_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Intento de depósito')$$,
  '42501', null, 'depósito: la base rechaza el alta'
);
reset role;

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('b2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from clientes where organizacion_id = '11111111-1111-1111-1111-111111111111'), 0, 'otra organización no ve los clientes de la Uno');
update clientes set nombre = 'Cruzado' where id = 'c1000000-0000-0000-0000-000000000001';
select throws_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Alta cruzada')$$,
  '42501', null, 'otra organización no puede dar de alta clientes en la Uno'
);
reset role;
select is(
  (select nombre from clientes where id = 'c1000000-0000-0000-0000-000000000001'),
  'Distribuidora Norte SRL', 'el id manipulado de otra organización no modifica nada'
);

-- ============================================================================
-- DNI/CUIT único por organización (FR-016)
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'Otro', '30712345678')$$,
  '23505', null, 'mismo CUIT con otro formato (sin guiones): rechazado'
);
select throws_ok(
  $$insert into clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'Otro', ' 30.71234567.8 ')$$,
  '23505', null, 'mismo CUIT con puntos y espacios: rechazado'
);
select throws_ok(
  $$update clientes set documento = '30-71234567-8' where id = 'c1000000-0000-0000-0000-000000000002'$$,
  '23505', null, 'editar un cliente con el documento de otro: rechazado'
);
select lives_ok(
  $$insert into clientes (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Distribuidora Norte SRL')$$,
  'el mismo nombre se acepta'
);
select lives_ok(
  $$insert into clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'Sin doc 1', '  '), ('11111111-1111-1111-1111-111111111111', 'Sin doc 2', '')$$,
  'documento vacío múltiple: aceptado (se guarda como nulo)'
);
reset role;

-- Un cliente archivado sigue reservando su documento
update clientes set documento = '20-11111111-2', archivado_en = now() where id = 'c1000000-0000-0000-0000-000000000004';
select pg_temp.como('b1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into clientes (organizacion_id, nombre, documento) values ('11111111-1111-1111-1111-111111111111', 'Choca con archivado', '20111111112')$$,
  '23505', null, 'el documento de un cliente archivado sigue reservado'
);
reset role;

-- Otra organización puede usar el mismo documento
select pg_temp.como('b2000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into clientes (organizacion_id, nombre, documento) values ('22222222-2222-2222-2222-222222222222', 'Misma persona, otra organización', '30-71234567-8')$$,
  'el mismo documento en otra organización: aceptado'
);
reset role;

-- ============================================================================
-- Sin DELETE y sin acceso para anon
-- ============================================================================

select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$delete from clientes where id = 'c1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'ni el administrador puede borrar clientes desde la aplicación'
);
reset role;
select ok(not has_table_privilege('anon', 'public.clientes', 'select'), 'anon no lee clientes');
select ok(not has_table_privilege('anon', 'public.clientes', 'insert'), 'anon no inserta clientes');
select ok(not has_table_privilege('authenticated', 'public.clientes', 'delete'), 'authenticated no tiene DELETE sobre clientes');

select * from finish();
rollback;
