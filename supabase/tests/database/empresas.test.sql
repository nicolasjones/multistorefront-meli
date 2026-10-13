-- Empresas (spec 20261012-140000-empresas, F-EMP-01): aislamiento por
-- organización, escritura solo con private.puede_escribir(), sin
-- insert/delete para authenticated y 1/2/3 empresas por organización
-- (FR-002, FR-003, SC-005). El fixture corre como postgres (RLS no aplica) y
-- las verificaciones como authenticated vía request.jwt.claims.
begin;

select plan(15);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Tres Empresas'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos Empresas'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Una Empresa');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'miembro1@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com'),
  ('a3000000-0000-0000-0000-000000000001', 'admin3@example.com'),
  ('a9000000-0000-0000-0000-000000000009', 'sin-organizacion@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'miembro'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador'),
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Empresa A1'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Empresa A2'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Empresa A3'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa B1'),
  ('e2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Empresa B2'),
  ('e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Empresa C1');

select ok(
  (select relrowsecurity from pg_class where oid = 'dominio.empresas'::regclass),
  'dominio.empresas tiene RLS habilitada'
);

-- Administrador de la organización con tres empresas.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*) from dominio.empresas)::int, 3, 'el administrador ve las tres empresas de su organización');
select is(
  (select count(*) from dominio.empresas where organizacion_id <> '11111111-1111-1111-1111-111111111111')::int, 0,
  'el administrador no ve empresas de otra organización'
);
select lives_ok(
  $$update dominio.empresas set nombre = 'Empresa A1 editada' where id = 'e1000000-0000-0000-0000-000000000001'$$,
  'el administrador puede editar una empresa de su organización'
);
select is(
  (select nombre from dominio.empresas where id = 'e1000000-0000-0000-0000-000000000001'), 'Empresa A1 editada',
  'la edición del administrador quedó persistida'
);
update dominio.empresas set nombre = 'Hackeada' where id = 'e2000000-0000-0000-0000-000000000001';
select throws_ok(
  $$update dominio.empresas set organizacion_id = '22222222-2222-2222-2222-222222222222' where id = 'e1000000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'el administrador no puede mover una empresa a otra organización'
);
select throws_ok(
  $$insert into dominio.empresas (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Nueva')$$,
  '42501', null,
  'authenticated no puede insertar empresas (crear es F-EMP-03)'
);
select throws_ok(
  $$delete from dominio.empresas where id = 'e1000000-0000-0000-0000-000000000003'$$,
  '42501', null,
  'authenticated no puede borrar empresas'
);

reset role;
select is(
  (select nombre from dominio.empresas where id = 'e2000000-0000-0000-0000-000000000001'), 'Empresa B1',
  'el intento de editar una empresa ajena no afectó ninguna fila'
);

-- Miembro: lee, pero no escribe.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*) from dominio.empresas)::int, 3, 'el miembro lee las empresas de su organización');
update dominio.empresas set nombre = 'Hackeada por miembro' where id = 'e1000000-0000-0000-0000-000000000002';
reset role;
select is(
  (select nombre from dominio.empresas where id = 'e1000000-0000-0000-0000-000000000002'), 'Empresa A2',
  'el miembro no puede editar empresas (puede_escribir)'
);

-- Dos y una empresa por organización: nada asume exactamente dos (SC-005).
select set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from dominio.empresas)::int, 2, 'la organización con dos empresas ve las dos');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from dominio.empresas)::int, 1, 'la organización con una empresa ve la única');
reset role;

-- Sin organización: no ve nada.
select set_config('request.jwt.claims', json_build_object('sub', 'a9000000-0000-0000-0000-000000000009', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from dominio.empresas)::int, 0, 'un usuario sin organización no ve empresas');
reset role;

-- El esquema no limita a dos empresas por organización.
select lives_ok(
  $$insert into dominio.empresas (organizacion_id, nombre) values ('22222222-2222-2222-2222-222222222222', 'Empresa B3'), ('22222222-2222-2222-2222-222222222222', 'Empresa B4')$$,
  'una organización admite más de dos empresas'
);

select * from finish();

rollback;
