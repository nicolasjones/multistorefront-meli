-- F-PRV-01 (MSF-336, épica MSF-205): alta, edición y estado de proveedor con CUIT.
-- Cubre SC-001: RLS por organización y por nivel de sección (Administrador y
-- Administración escriben; Depósito, Operador, Mostrador y Consulta no), CUIT (válido,
-- inválido, con guiones, duplicado incluso inactivo), conflicto de edición, estado
-- idempotente, eventos de actividad, sin `delete` y `anon` sin ejecución.
-- Vectores de CUIT compartidos con apps/web/src/lib/cuit.test.ts:
--   válidos 20123456786, 30701234568, 33555555550 (dígito 0), 30700000040 (dígito 0);
--   inválidos 20123456785 (dígito), 30700000130 (resto 1: no existe el dígito 10).
begin;

select plan(54);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('d1000000-0000-0000-0000-000000000004', 'mostrador@example.com'),
  ('d1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('d1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Administrador: alta y normalización
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.crear_proveedor('  Proveedor Uno SA  ', '20123456786', ' Ana Pérez ', 'ventas@uno.example.com', '11 5555-0000', 'Calle 1', 'Nota')$$,
  'administrador: crea un proveedor con CUIT válido'
);
select is(
  (select razon_social from dominio.proveedores where cuit = '20123456786'),
  'Proveedor Uno SA', 'la razón social se guarda recortada'
);
select is(
  (select persona_contacto from dominio.proveedores where cuit = '20123456786'),
  'Ana Pérez', 'el contacto se guarda recortado'
);
select is(
  (select organizacion_id from dominio.proveedores where cuit = '20123456786'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'la organización sale de la sesión'
);
select lives_ok(
  $$select public.crear_proveedor('Proveedor Dos SRL', '30-70123456-8')$$,
  'acepta el CUIT con guiones'
);
select is(
  (select cuit from dominio.proveedores where razon_social = 'Proveedor Dos SRL'),
  '30701234568', 'el CUIT se guarda solo con dígitos'
);
select lives_ok(
  $$select public.crear_proveedor('Proveedor Tres SA', ' 33 555.555.55-0 ')$$,
  'acepta espacios y puntos; dígito verificador 0'
);
select is(
  (select cuit from dominio.proveedores where razon_social = 'Proveedor Tres SA'),
  '33555555550', 'espacios y puntos se descartan'
);
select is(
  (select telefono from dominio.proveedores where razon_social = 'Proveedor Dos SRL'),
  null, 'los opcionales vacíos quedan nulos'
);

-- ============================================================================
-- CUIT y datos inválidos
-- ============================================================================

select throws_ok(
  $$select public.crear_proveedor('X', '20123456785')$$,
  '22023', null, 'rechaza un dígito verificador inválido'
);
select throws_ok(
  $$select public.crear_proveedor('X', '30700000130')$$,
  '22023', null, 'rechaza el resto 1 (el dígito 10 no existe)'
);
select throws_ok(
  $$select public.crear_proveedor('X', 'AB123456786')$$,
  '22023', null, 'rechaza letras en el CUIT'
);
select throws_ok(
  $$select public.crear_proveedor('X', '2012345678')$$,
  '22023', null, 'rechaza un CUIT de menos de 11 dígitos'
);
select throws_ok(
  $$select public.crear_proveedor('X', '30700000040', null, 'sin-arroba')$$,
  '22023', null, 'rechaza un correo con formato inválido'
);
select throws_ok(
  $$select public.crear_proveedor('   ', '30700000040')$$,
  '22023', null, 'rechaza una razón social en blanco'
);
select throws_ok(
  $$select public.crear_proveedor('Duplicado', '20-12345678-6')$$,
  '23505', null, 'rechaza un CUIT repetido en la organización (con otro formato)'
);

-- Privilegios por columna y sin borrado.
select throws_ok(
  $$insert into dominio.proveedores (organizacion_id, razon_social, cuit)
    values ('22222222-2222-2222-2222-222222222222', 'Ajeno', '30700000040')$$,
  '42501', null, 'el llamador no puede fijar organizacion_id'
);
select throws_ok(
  $$delete from dominio.proveedores where cuit = '20123456786'$$,
  '42501', null, 'no se puede borrar un proveedor'
);

-- ============================================================================
-- Estado: idempotente, conserva datos, el CUIT sigue ocupado
-- ============================================================================

select lives_ok(
  $$select public.cambiar_estado_proveedor((select id from dominio.proveedores where cuit = '20123456786'), false)$$,
  'administrador: desactiva el proveedor'
);
select is(
  (select activo from dominio.proveedores where cuit = '20123456786'),
  false, 'queda inactivo'
);
select throws_ok(
  $$select public.crear_proveedor('Otro', '20123456786')$$,
  '23505', null, 'el CUIT de un proveedor inactivo sigue ocupado'
);
select lives_ok(
  $$select public.cambiar_estado_proveedor((select id from dominio.proveedores where cuit = '20123456786'), false)$$,
  'repetir el estado no falla'
);
select throws_ok(
  $$select public.cambiar_estado_proveedor((select id from dominio.proveedores where cuit = '20123456786'), null)$$,
  '22023', null, 'el estado es obligatorio'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'proveedor.desactivado'
     and detalle = 'Desactivó el proveedor Proveedor Uno SA'),
  1, 'un solo evento proveedor.desactivado (sin duplicar por idempotencia)'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.cambiar_estado_proveedor((select id from dominio.proveedores where cuit = '20123456786'), true)$$,
  'administrador: reactiva el proveedor'
);
select is(
  (select razon_social || '|' || cuit || '|' || persona_contacto || '|' || correo from dominio.proveedores where cuit = '20123456786'),
  'Proveedor Uno SA|20123456786|Ana Pérez|ventas@uno.example.com', 'desactivar y reactivar conserva los datos'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'proveedor.reactivado'
     and detalle = 'Reactivó el proveedor Proveedor Uno SA'),
  1, 'registra proveedor.reactivado'
);

-- ============================================================================
-- Edición con bloqueo optimista
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.actualizar_proveedor(
      (select id from dominio.proveedores where cuit = '20123456786'),
      '2020-01-01 00:00:00+00', 'Pisado', '20123456786')$$,
  '40001', null, 'un updated_at viejo es conflicto de edición'
);
select is(
  (select razon_social from dominio.proveedores where cuit = '20123456786'),
  'Proveedor Uno SA', 'el conflicto no pisa el cambio'
);
select lives_ok(
  $$select public.actualizar_proveedor(
      (select id from dominio.proveedores where cuit = '20123456786'),
      (select updated_at from dominio.proveedores where cuit = '20123456786'),
      'Proveedor Uno Nuevo SA', '20-12345678-6', 'Ana Pérez', 'ventas@uno.example.com', '11 5555-0000', 'Calle 1', 'Nota')$$,
  'con el updated_at vigente, edita'
);
select is(
  (select razon_social from dominio.proveedores where cuit = '20123456786'),
  'Proveedor Uno Nuevo SA', 'la edición se guarda'
);
select throws_ok(
  $$select public.actualizar_proveedor(
      (select id from dominio.proveedores where cuit = '20123456786'),
      (select updated_at from dominio.proveedores where cuit = '20123456786'),
      'Proveedor Uno Nuevo SA', '20123456785')$$,
  '22023', null, 'editar con un CUIT inválido falla'
);
select throws_ok(
  $$select public.actualizar_proveedor(
      (select id from dominio.proveedores where cuit = '20123456786'),
      (select updated_at from dominio.proveedores where cuit = '20123456786'),
      'Proveedor Uno Nuevo SA', '30701234568')$$,
  '23505', null, 'editar hacia el CUIT de otro proveedor falla'
);
-- Guardar sin cambios: no avanza updated_at ni registra evento.
create temp table t_antes as
  select updated_at from dominio.proveedores where cuit = '20123456786';
grant select on t_antes to authenticated;
select lives_ok(
  $$select public.actualizar_proveedor(
      (select id from dominio.proveedores where cuit = '20123456786'),
      (select updated_at from dominio.proveedores where cuit = '20123456786'),
      'Proveedor Uno Nuevo SA', '20123456786', 'Ana Pérez', 'ventas@uno.example.com', '11 5555-0000', 'Calle 1', 'Nota')$$,
  'guardar sin cambios no falla'
);
select is(
  (select updated_at from dominio.proveedores where cuit = '20123456786'),
  (select updated_at from t_antes), 'sin cambios, updated_at no avanza'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'proveedor.editado'
     and detalle = 'Editó el proveedor Proveedor Uno Nuevo SA'),
  1, 'un solo evento proveedor.editado (guardar sin cambios no duplica)'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'proveedor.creado'
     and detalle in ('Creó el proveedor Proveedor Uno SA', 'Creó el proveedor Proveedor Dos SRL', 'Creó el proveedor Proveedor Tres SA')),
  3, 'registra proveedor.creado por razón social, sin CUIT ni ids'
);

-- ============================================================================
-- Niveles de sección: Administración escribe; el resto no
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000006');
select lives_ok(
  $$select public.crear_proveedor('Proveedor Cuatro SA', '30700000040')$$,
  'administración: crea proveedores'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from dominio.proveedores), 0, 'depósito: no lee proveedores');
select throws_ok(
  $$select public.crear_proveedor('Z', '30700000040')$$,
  '42501', null, 'depósito: no crea'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from dominio.proveedores), 0, 'operador: no lee proveedores (ni CUIT ni contacto)');
select throws_ok(
  $$select public.crear_proveedor('Z', '30700000040')$$,
  '42501', null, 'operador: no crea'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from dominio.proveedores), 0, 'mostrador: no lee proveedores');
select throws_ok(
  $$select public.crear_proveedor('Z', '30700000040')$$,
  '42501', null, 'mostrador: no crea'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.proveedores), 0, 'consulta: no lee proveedores');
select throws_ok(
  $$select public.crear_proveedor('Z', '30700000040')$$,
  '42501', null, 'consulta: no crea'
);

-- Con `lectura` se ve la ficha pero no se escribe.
reset role;
update permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'proveedores';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from dominio.proveedores), 4, 'con lectura: ve los proveedores de su organización');
select throws_ok(
  $$select public.cambiar_estado_proveedor((select id from dominio.proveedores where cuit = '20123456786'), false)$$,
  '42501', null, 'con lectura: no cambia el estado'
);
select throws_ok(
  $$select public.actualizar_proveedor(
      (select id from dominio.proveedores where cuit = '20123456786'),
      (select updated_at from dominio.proveedores where cuit = '20123456786'),
      'Z', '20123456786')$$,
  '42501', null, 'con lectura: no edita'
);

-- ============================================================================
-- Aislamiento por organización
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from dominio.proveedores), 0, 'otra organización: no ve filas ajenas');
select throws_ok(
  $$select public.cambiar_estado_proveedor('00000000-0000-0000-0000-00000000dead', false)$$,
  'P0002', null, 'otra organización: un proveedor inexistente o ajeno no existe para ella'
);
select lives_ok(
  $$select public.crear_proveedor('Proveedor Uno (otra org)', '20123456786')$$,
  'el mismo CUIT es válido en otra organización (único por organización)'
);

-- ============================================================================
-- Sin delete, anon sin privilegios
-- ============================================================================

reset role;
select is(
  (select count(*)::int from pg_policies where schemaname = 'dominio' and tablename = 'proveedores' and cmd in ('DELETE', 'ALL')),
  0, 'sin política delete'
);
select is(
  (has_function_privilege('anon', 'public.crear_proveedor(text,text,text,text,text,text,text)', 'execute')
   or has_function_privilege('anon', 'public.actualizar_proveedor(uuid,timestamptz,text,text,text,text,text,text,text)', 'execute')
   or has_function_privilege('anon', 'public.cambiar_estado_proveedor(uuid,boolean)', 'execute')
   or has_table_privilege('anon', 'dominio.proveedores', 'select')),
  false, 'anon no ejecuta las RPC ni lee la tabla'
);

select * from finish();
rollback;
