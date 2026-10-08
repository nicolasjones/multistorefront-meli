-- Fixture multi-tenant de la spec 010 (mismo patrón que
-- supabase/tests/database/perfil_usuario.test.sql): dos organizaciones: en
-- la organización A una persona con perfil completo y otra sin completar,
-- más una persona no-administradora y una persona a remover.
begin;

select plan(11);

-- ============================================================================
-- Fixture
-- ============================================================================

insert into public.organizaciones (id, nombre) values
  ('91111111-1111-1111-1111-111111111111', 'Organizacion A'),
  ('92222222-2222-2222-2222-222222222222', 'Organizacion B');

insert into auth.users (id, email) values
  ('91000000-0000-0000-0000-000000000001', 'admin-a@example.com'),
  ('91000000-0000-0000-0000-000000000002', 'companero-a@example.com'),
  ('91000000-0000-0000-0000-000000000003', 'raso-a@example.com'),
  ('91000000-0000-0000-0000-000000000004', 'remover-a@example.com'),
  ('91000000-0000-0000-0000-000000000005', 'incompleto-a@example.com'),
  ('91000000-0000-0000-0000-000000000009', 'superadmin@example.com'),
  ('92000000-0000-0000-0000-000000000001', 'admin-b@example.com');

insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('91000000-0000-0000-0000-000000000001', '91111111-1111-1111-1111-111111111111', 'administrador'),
  ('91000000-0000-0000-0000-000000000002', '91111111-1111-1111-1111-111111111111', 'miembro'),
  ('91000000-0000-0000-0000-000000000003', '91111111-1111-1111-1111-111111111111', 'miembro'),
  ('91000000-0000-0000-0000-000000000004', '91111111-1111-1111-1111-111111111111', 'miembro'),
  ('91000000-0000-0000-0000-000000000005', '91111111-1111-1111-1111-111111111111', 'miembro'),
  ('92000000-0000-0000-0000-000000000001', '92222222-2222-2222-2222-222222222222', 'administrador');

-- '...005' (incompleto-a) no tiene fila acá a propósito — perfil nunca guardado (FR-004).
insert into public.perfiles_usuario (user_id, nombre, apellido) values
  ('91000000-0000-0000-0000-000000000001', 'Ana', 'Admin'),
  ('91000000-0000-0000-0000-000000000002', 'Mia', 'Miembro'),
  ('91000000-0000-0000-0000-000000000003', 'Rosa', 'Raso'),
  ('91000000-0000-0000-0000-000000000004', 'Diego', 'Removido'),
  ('92000000-0000-0000-0000-000000000001', 'Beto', 'Bee');

insert into public.superadmins (user_id) values ('91000000-0000-0000-0000-000000000009');

-- ============================================================================
-- Como administrador de A (Casos 1, 2, 3, 4, 5 de quickstart.md)
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', '91000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Caso 1: recibe nombre/apellido de un compañero con perfil completo.
select is(
  (select nombre from public.listar_miembros_organizacion() where user_id = '91000000-0000-0000-0000-000000000002'),
  'Mia',
  'un administrador de A recibe el nombre de un compañero de A'
);
select is(
  (select apellido from public.listar_miembros_organizacion() where user_id = '91000000-0000-0000-0000-000000000002'),
  'Miembro',
  'un administrador de A recibe el apellido de un compañero de A'
);

-- Caso 2: aislamiento — ninguna fila de la organización B.
select is(
  (select count(*) from public.listar_miembros_organizacion() where user_id = '92000000-0000-0000-0000-000000000001')::int,
  0,
  'el mismo llamador no recibe ninguna fila de la organización B'
);

-- Caso 3: un compañero sin perfil completado aparece igual, con null (no ausente).
select is(
  (select count(*) from public.listar_miembros_organizacion() where user_id = '91000000-0000-0000-0000-000000000005')::int,
  1,
  'un compañero sin perfil completado sigue apareciendo en el listado'
);
select is(
  (select nombre from public.listar_miembros_organizacion() where user_id = '91000000-0000-0000-0000-000000000005'),
  null,
  'nombre es null (no un string vacío) cuando el perfil no está completado'
);
select is(
  (select apellido from public.listar_miembros_organizacion() where user_id = '91000000-0000-0000-0000-000000000005'),
  null,
  'apellido es null cuando el perfil no está completado'
);

-- Caso 4: tras remover_miembro, esa persona deja de aparecer.
select public.remover_miembro('91000000-0000-0000-0000-000000000004');
select is(
  (select count(*) from public.listar_miembros_organizacion() where user_id = '91000000-0000-0000-0000-000000000004')::int,
  0,
  'tras remover_miembro esa persona deja de aparecer en el listado de su antigua organización'
);

-- Caso 5: el select directo a perfiles_usuario sigue sin cambios (self-only).
select is(
  (select count(*) from public.perfiles_usuario)::int,
  1,
  'select directo a perfiles_usuario (sin pasar por la función) sigue devolviendo solo la fila propia'
);
select is(
  (select nombre from public.perfiles_usuario),
  'Ana',
  'la única fila que devuelve el select directo es la del propio llamador'
);

-- Captura el listado del administrador (ya sin la persona removida) para
-- comparar con el del superadmin en el Caso 6.
create temp table listado_admin_a as
  select user_id, rol_id, nombre, apellido from public.listar_miembros_organizacion();

reset role;

-- ============================================================================
-- Caso 7: un miembro no-administrador de A llama la función directo.
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', '91000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*) from public.listar_miembros_organizacion())::int,
  0,
  'un miembro no-administrador que llama la función directo recibe conjunto vacío (el chequeo de rol vive en la función)'
);

reset role;

-- ============================================================================
-- Caso 6: un superadmin con la organización A activa recibe el mismo
-- listado que un administrador de esa organización (FR-006).
-- ============================================================================

select set_config('request.jwt.claims', json_build_object('sub', '91000000-0000-0000-0000-000000000009', 'role', 'authenticated')::text, true);
set local role authenticated;

select public.entrar_a_organizacion('91111111-1111-1111-1111-111111111111');

select is(
  (select array_agg(user_id order by user_id) from public.listar_miembros_organizacion()),
  (select array_agg(user_id order by user_id) from listado_admin_a),
  'un superadmin con la organización A activa recibe el mismo listado (mismos user_id) que un administrador de esa organización'
);

reset role;

select * from finish();

rollback;
