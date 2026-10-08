-- Regresión de contexto del panel operativo (spec 018-kit-panel-operable).
begin;

select plan(9);

insert into public.organizaciones (id, nombre) values
  ('c9111111-1111-1111-1111-111111111111', 'Estudio Contexto');

insert into auth.users (id, email) values
  ('c9100000-0000-0000-0000-000000000001', 'admin-contexto@example.com'),
  ('c9100000-0000-0000-0000-000000000002', 'miembro-contexto@example.com'),
  ('c9500000-0000-0000-0000-000000000005', 'superadmin-contexto@example.com');

insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('c9100000-0000-0000-0000-000000000001', 'c9111111-1111-1111-1111-111111111111', 'administrador'),
  ('c9100000-0000-0000-0000-000000000002', 'c9111111-1111-1111-1111-111111111111', 'miembro');

insert into public.superadmins (user_id) values
  ('c9500000-0000-0000-0000-000000000005');

select ok(
  not has_function_privilege('anon', 'public.contexto_panel_actual()', 'EXECUTE'),
  'anon no puede resolver el contexto del panel'
);

select ok(
  has_function_privilege('authenticated', 'public.contexto_panel_actual()', 'EXECUTE'),
  'authenticated puede resolver su propio contexto del panel'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select organizacion_nombre from public.contexto_panel_actual()),
  'Estudio Contexto',
  'administrador recibe el nombre de su organización efectiva'
);
select is(
  (select rol_efectivo from public.contexto_panel_actual()),
  'administrador',
  'administrador recibe su rol efectivo'
);
select ok(
  (select puede_escribir from public.contexto_panel_actual()),
  'administrador puede escribir en su organización'
);
select ok(
  not (select es_superadmin from public.contexto_panel_actual()),
  'administrador no recibe privilegio de plataforma'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);

select ok(
  not (select puede_escribir from public.contexto_panel_actual()),
  'miembro no recibe permiso de escritura en la presentación'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9500000-0000-0000-0000-000000000005', 'role', 'authenticated')::text,
  true
);

select ok(
  (select es_superadmin from public.contexto_panel_actual()),
  'superadmin sin organización conserva acceso a Plataforma'
);
select is(
  (select organizacion_id from public.contexto_panel_actual()),
  null::uuid,
  'superadmin sin organización no recibe una organización operable'
);

rollback;
