-- Alta de empresas (spec 20261015-100000-alta-de-empresas, F-EMP-03, MSF-277;
-- FR-001..FR-005, FR-009, SC-002, SC-003, SC-004). El fixture corre como
-- postgres (RLS no aplica) y las verificaciones como authenticated vía
-- request.jwt.claims.
begin;

select plan(31);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'operador1@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'consulta1@example.com'),
  ('a1000000-0000-0000-0000-000000000004', 'admin-suspendido1@example.com'),
  ('a1000000-0000-0000-0000-000000000005', 'miembro1@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com'),
  ('a3000000-0000-0000-0000-000000000001', 'admin3@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administrador', 'suspendido'),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'miembro', 'activo'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo'),
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Ajena');

-- Administrador activo de la organización Uno.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$select public.crear_empresa('  Tienda Oeste  ', 'e1000000-0000-0000-0000-000000000002')$$,
  'el administrador crea una empresa copiando de otra'
);
select is(
  (select count(*)::int from dominio.empresas where nombre = 'Tienda Oeste' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'la empresa quedó en su organización con el nombre recortado'
);
select is(
  (select activa from dominio.empresas where nombre = 'Tienda Oeste'),
  true, 'la empresa nueva nace con el estado por defecto'
);
select lives_ok($$select public.crear_empresa('Tienda Sur')$$, 'el administrador crea una empresa sin origen');
select lives_ok(
  $$select public.crear_empresa('Tienda Pausada', 'e1000000-0000-0000-0000-000000000001')$$,
  'se puede copiar de cualquier empresa de la organización'
);

-- Nombre vacío o repetido (sin distinguir mayúsculas ni espacios al borde).
select throws_ok($$select public.crear_empresa('')$$, '22023', null, 'nombre vacío rechazado');
select throws_ok($$select public.crear_empresa('   ')$$, '22023', null, 'nombre de solo espacios rechazado');
select throws_ok($$select public.crear_empresa(null)$$, '22023', null, 'nombre nulo rechazado');
select throws_ok($$select public.crear_empresa(repeat('x', 121))$$, '22023', null, 'nombre demasiado largo rechazado');
select throws_ok($$select public.crear_empresa('Tienda Oeste')$$, '23505', null, 'nombre repetido rechazado');
select throws_ok($$select public.crear_empresa('  tienda OESTE ')$$, '23505', null, 'nombre repetido con otras mayúsculas y espacios rechazado');
select throws_ok($$select public.crear_empresa('san javucho', 'e1000000-0000-0000-0000-000000000002')$$, '23505', null, 'repetido de una empresa previa rechazado también con origen');

-- Origen de otra organización o inexistente: rechazado y no crea nada.
select throws_ok(
  $$select public.crear_empresa('Con Origen Ajeno', 'e2000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'un origen de otra organización se rechaza'
);
select throws_ok(
  $$select public.crear_empresa('Con Origen Inexistente', 'e9000000-0000-0000-0000-000000000009')$$,
  '22023', null, 'un origen inexistente se rechaza'
);
select is(
  (select count(*)::int from dominio.empresas where nombre in ('Con Origen Ajeno', 'Con Origen Inexistente')),
  0, 'los rechazos no dejan una empresa a medias'
);

-- Sin INSERT directo: el alta es solo por la RPC (FR-009).
select throws_ok(
  $$insert into dominio.empresas (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Directa')$$,
  '42501', null, 'no existe INSERT directo sobre empresas'
);

reset role;

-- La copia no se ejecuta con otra organización (defensa en profundidad) y es invocable solo por la RPC.
select throws_ok(
  $$select private.copiar_configuracion_empresa('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'la copia rechaza empresas de organizaciones distintas'
);
select lives_ok(
  $$select private.copiar_configuracion_empresa('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001')$$,
  'la copia entre empresas de la misma organización es válida'
);
select is(has_function_privilege('authenticated', 'private.copiar_configuracion_empresa(uuid, uuid)', 'EXECUTE'), false, 'authenticated no ejecuta la copia directamente');

-- Rol sin permiso de escritura: rechazado en la base.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.crear_empresa('Del Operador')$$, '42501', null, 'el operador no puede crear empresas');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.crear_empresa('De Consulta')$$, '42501', null, 'consulta no puede crear empresas');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.crear_empresa('Del Suspendido')$$, '42501', null, 'un administrador suspendido no puede crear empresas');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.crear_empresa('Del Miembro')$$, '42501', null, 'el miembro no puede crear empresas');
reset role;

-- Aislamiento: el mismo nombre en otra organización es válido y no cruza datos.
select set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select public.crear_empresa('Tienda Oeste')$$, 'el mismo nombre en otra organización es válido');
reset role;
select is(
  (select organizacion_id::text from dominio.empresas where nombre = 'Tienda Oeste' and organizacion_id <> '11111111-1111-1111-1111-111111111111'),
  '22222222-2222-2222-2222-222222222222', 'la organización la resolvió el servidor'
);

-- 1/2/3 empresas por organización: el alta no asume cantidad.
select set_config('request.jwt.claims', json_build_object('sub', 'a3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select public.crear_empresa('Primera')$$, 'una organización sin empresas crea la primera');
select lives_ok($$select public.crear_empresa('Segunda', (select id from dominio.empresas where nombre = 'Primera'))$$, 'crea la segunda copiando de la primera');
select lives_ok($$select public.crear_empresa('Tercera')$$, 'crea la tercera');
reset role;
select is((select count(*)::int from dominio.empresas where organizacion_id = '33333333-3333-3333-3333-333333333333'), 3, 'quedan tres empresas en la organización');

-- Ejecutabilidad de la RPC: anon no; authenticated sí.
select is(has_function_privilege('anon', 'public.crear_empresa(text, uuid)', 'EXECUTE'), false, 'anon no ejecuta crear_empresa');
select is(has_function_privilege('authenticated', 'public.crear_empresa(text, uuid)', 'EXECUTE'), true, 'authenticated ejecuta crear_empresa');

select * from finish();
rollback;
