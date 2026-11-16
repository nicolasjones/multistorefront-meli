-- F-OPS-04 (MSF-300, épica MSF-170): el Administrador del cliente ve los eventos
-- soporte.* de su organización (FR-017, SC-007); otra organización no los ve; el
-- Operador sigue la matriz de permisos de Actividad (lee) y Consulta no. Sin
-- policies nuevas: rige la RLS de registro_actividad. Fixture como postgres.
begin;

select plan(9);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a6000000-0000-0000-0000-000000000001', 'soporte@example.com'),
  ('a6000000-0000-0000-0000-000000000002', 'admin-uno@example.com'),
  ('a6000000-0000-0000-0000-000000000003', 'admin-dos@example.com'),
  ('a6000000-0000-0000-0000-000000000004', 'operador-uno@example.com'),
  ('a6000000-0000-0000-0000-000000000005', 'consulta-uno@example.com');

insert into perfiles_usuario (user_id, nombre, apellido) values
  ('a6000000-0000-0000-0000-000000000001', 'Sofía', 'Soporte');

insert into superadmins (user_id) values ('a6000000-0000-0000-0000-000000000001');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('a6000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('a6000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'administrador'),
  ('a6000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('a6000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'consulta');

-- Soporte entra a Uno, pasa a Dos (cierra Uno) y sale de Dos.
select set_config('request.jwt.claims', json_build_object('sub', 'a6000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.entrar_a_organizacion('11111111-1111-1111-1111-111111111111', 'Reclamo de facturación');
select public.entrar_a_organizacion('22222222-2222-2222-2222-222222222222', 'Otro cliente');
select public.salir_de_organizacion();
reset role;

-- Administrador de Uno.
select set_config('request.jwt.claims', json_build_object('sub', 'a6000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select array_agg(tipo order by tipo) from registro_actividad where tipo like 'soporte.%'),
  array['soporte.ingreso', 'soporte.salida'],
  'el Administrador del cliente ve el ingreso y la salida de soporte (FR-017, SC-007)'
);
select is(
  (select actor_nombre from registro_actividad where tipo = 'soporte.ingreso'),
  'Sofía Soporte', 've quién ingresó'
);
select ok(
  (select detalle like '%Reclamo de facturación%' from registro_actividad where tipo = 'soporte.ingreso'),
  've el motivo del ingreso'
);
select ok(
  (select creado_en is not null from registro_actividad where tipo = 'soporte.ingreso'),
  've cuándo ingresó'
);
select is(
  (select count(*)::int from registro_actividad where detalle like '%Otro cliente%'), 0,
  'no ve el motivo de un ingreso a otra organización'
);
reset role;

-- Administrador de Dos: solo lo suyo.
select set_config('request.jwt.claims', json_build_object('sub', 'a6000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select array_agg(tipo order by tipo) from registro_actividad where tipo like 'soporte.%'),
  array['soporte.ingreso', 'soporte.salida'],
  'el Administrador de Dos ve solo los eventos de soporte de Dos'
);
select is(
  (select count(*)::int from registro_actividad where detalle like '%Reclamo de facturación%'), 0,
  'otra organización no ve los eventos de soporte de Uno (FR-017)'
);
reset role;

-- Operador (lee por la matriz) y Consulta (no).
select set_config('request.jwt.claims', json_build_object('sub', 'a6000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from registro_actividad where tipo like 'soporte.%'), 2, 'el Operador ve los eventos de soporte según la matriz');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'a6000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from registro_actividad where tipo like 'soporte.%'), 0, 'Consulta no ve la actividad, tampoco la de soporte');
reset role;

select * from finish();
rollback;
