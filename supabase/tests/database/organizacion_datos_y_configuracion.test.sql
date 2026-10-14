-- Datos y configuración de la organización (spec 20261014-140000-administracion-de-usuarios-y-organizacion,
-- F-ORG-03, MSF-253; FR-001, FR-002, FR-004, SC-001, SC-002).
-- Cubre T004 (administrador edita; operador/consulta/suspendido y datos
-- inválidos rechazados) y T005 (aislamiento entre organizaciones y
-- ejecutabilidad por anon). El fixture corre como postgres (RLS no aplica) y
-- las verificaciones como authenticated vía request.jwt.claims.
begin;

select plan(27);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'operador1@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'consulta1@example.com'),
  ('a1000000-0000-0000-0000-000000000004', 'admin-suspendido1@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'administrador', 'suspendido'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

select is(
  (select zona_horaria from organizaciones where id = '11111111-1111-1111-1111-111111111111'),
  'America/Argentina/Buenos_Aires',
  'una organización existente nace con la zona horaria por defecto'
);

-- Administrador activo de la organización Uno.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$select public.actualizar_organizacion('  Org Uno Editada  ', 'America/Montevideo', '11111111-1111-1111-1111-111111111111/logo.png')$$,
  'el administrador edita nombre, zona horaria y logo de su organización'
);
select is((select nombre from organizaciones where id = '11111111-1111-1111-1111-111111111111'), 'Org Uno Editada', 'el nombre quedó normalizado y persistido');
select is((select zona_horaria from organizaciones where id = '11111111-1111-1111-1111-111111111111'), 'America/Montevideo', 'la zona horaria quedó persistida');
select is((select logo_path from organizaciones where id = '11111111-1111-1111-1111-111111111111'), '11111111-1111-1111-1111-111111111111/logo.png', 'el logo quedó persistido');
select is((select count(*) from organizaciones)::int, 1, 'el administrador solo ve su propia organización');
select throws_ok(
  $$update organizaciones set nombre = 'Directo' where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null,
  'no existe UPDATE directo sobre organizaciones: solo por la RPC'
);

-- Datos inválidos: se rechazan y no cambian nada.
select throws_ok($$select public.actualizar_organizacion('   ', 'America/Montevideo', null)$$, '22023', null, 'nombre vacío rechazado');
select throws_ok($$select public.actualizar_organizacion(repeat('x', 121), 'America/Montevideo', null)$$, '22023', null, 'nombre demasiado largo rechazado');
select throws_ok($$select public.actualizar_organizacion('Org', 'Marte/Olimpo', null)$$, '22023', null, 'zona horaria inexistente rechazada');
select throws_ok(
  $$select public.actualizar_organizacion('Org', 'America/Montevideo', '22222222-2222-2222-2222-222222222222/logo.png')$$,
  '22023', null, 'logo bajo el prefijo de otra organización rechazado'
);
select throws_ok(
  $$select public.actualizar_organizacion('Org', 'America/Montevideo', '11111111-1111-1111-1111-111111111111/logo.svg')$$,
  '22023', null, 'logo de tipo no admitido (SVG) rechazado'
);

reset role;
select is(
  (select nombre || '|' || zona_horaria || '|' || logo_path from organizaciones where id = '11111111-1111-1111-1111-111111111111'),
  'Org Uno Editada|America/Montevideo|11111111-1111-1111-1111-111111111111/logo.png',
  'los intentos inválidos no cambiaron nada'
);

-- Quitar el logo: p_logo_path nulo.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select public.actualizar_organizacion('Org Uno Editada', 'America/Montevideo', null)$$, 'el administrador quita el logo');
reset role;
select is((select logo_path from organizaciones where id = '11111111-1111-1111-1111-111111111111'), null, 'el logo quedó en nulo');

-- Operador, consulta y administrador suspendido: rechazados en la base (SC-002).
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.actualizar_organizacion('Hackeada', 'America/Montevideo', null)$$, '42501', null, 'el operador no puede editar la organización');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.actualizar_organizacion('Hackeada', 'America/Montevideo', null)$$, '42501', null, 'consulta no puede editar la organización');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.actualizar_organizacion('Hackeada', 'America/Montevideo', null)$$, '42501', null, 'un administrador suspendido no puede editar la organización');
reset role;

-- Aislamiento: el administrador de Dos edita la suya y no toca la de Uno.
select set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select public.actualizar_organizacion('Org Dos Editada', 'America/Lima', null)$$, 'el administrador de otra organización edita la suya');
reset role;
select is((select nombre from organizaciones where id = '11111111-1111-1111-1111-111111111111'), 'Org Uno Editada', 'la organización Uno no cambió');
select is((select nombre from organizaciones where id = '22222222-2222-2222-2222-222222222222'), 'Org Dos Editada', 'la organización Dos sí cambió');

-- Ejecutabilidad: anon no; authenticated sí.
select is(has_function_privilege('anon', 'public.actualizar_organizacion(text, text, text)', 'EXECUTE'), false, 'anon no ejecuta actualizar_organizacion');
select is(has_function_privilege('authenticated', 'public.actualizar_organizacion(text, text, text)', 'EXECUTE'), true, 'authenticated ejecuta actualizar_organizacion');

-- Bucket de logos y sus políticas.
select is(
  (select public::text || '|' || file_size_limit::text from storage.buckets where id = 'logos-organizacion'),
  'false|1048576',
  'el bucket de logos es privado y tiene tope de tamaño'
);

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('logos-organizacion', '11111111-1111-1111-1111-111111111111/logo.png', 'a1000000-0000-0000-0000-000000000001')$$,
  'el administrador sube un logo bajo el prefijo de su organización'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('logos-organizacion', '22222222-2222-2222-2222-222222222222/logo.png', 'a1000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'el administrador no sube un logo bajo el prefijo de otra organización'
);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('logos-organizacion', '11111111-1111-1111-1111-111111111111/otro.png', 'a1000000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'el operador no sube logos'
);
reset role;

select * from finish();

rollback;
