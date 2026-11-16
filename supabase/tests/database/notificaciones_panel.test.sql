-- MSF-378 · F-NOT-02 (SC-001; FR-001–FR-005, FR-010): campanita de notificaciones.
-- El fixture corre como postgres (RLS no aplica); las verificaciones, como authenticated vía
-- request.jwt.claims. Dos organizaciones y avisos propios, ajenos, descartados y de una sección sin acceso.
begin;

select plan(23);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'admin1@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'admin1b@example.com'),
  ('a2000000-0000-0000-0000-000000000001', 'admin2@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Un tipo de una sección que ningún rol tiene: simula perder el acceso a la sección.
insert into public.tipos_aviso (clave, nombre, seccion) values
  ('tipo_sin_acceso', 'Tipo sin acceso', 'seccion_inexistente');

-- Avisos de la persona 1 (3 vigentes, 1 descartado, 1 sin acceso) + ajenos.
insert into public.avisos_pendientes (id, organizacion_id, user_id, tipo_aviso, grupo_id, datos, estado, creado_en) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"cliente":"Ana"}', 'pendiente', now() - interval '3 hours'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"cliente":"Beto"}', 'enviado', now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"cliente":"Cami"}', 'pendiente', now() - interval '1 hour'),
  ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"cliente":"Descartado"}', 'descartado', now()),
  ('b0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
   'tipo_sin_acceso', gen_random_uuid(), '{}', 'pendiente', now()),
  ('b0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002',
   'consulta_nueva', gen_random_uuid(), '{"cliente":"Ajeno misma org"}', 'pendiente', now()),
  ('b0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001',
   'consulta_nueva', gen_random_uuid(), '{"cliente":"Otra org"}', 'pendiente', now());

-- FR-001: columna y avisos existentes sin leer.
select has_column('public', 'avisos_pendientes', 'leido_en', 'avisos_pendientes tiene leido_en');
select is(
  (select count(*)::int from public.avisos_pendientes where leido_en is not null), 0,
  'los avisos existentes quedan sin leer'
);

-- anon no ejecuta ninguna función (FR-010).
set local role anon;
select throws_ok($$select public.listar_notificaciones()$$, '42501', null, 'anon no lista notificaciones');
select throws_ok($$select public.contar_notificaciones_sin_leer()$$, '42501', null, 'anon no cuenta notificaciones');
select throws_ok($$select public.marcar_notificaciones_leidas()$$, '42501', null, 'anon no marca notificaciones');
reset role;

-- Persona 1 de la organización 1.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select public.contar_notificaciones_sin_leer()), 3,
  'cuenta solo avisos propios, sin descartados ni de secciones sin acceso'
);
select is(
  (public.listar_notificaciones()->>'total')::int, 3,
  'el total coincide con los avisos vigentes propios'
);
select is(
  (select jsonb_array_length(public.listar_notificaciones()->'items')), 3,
  'lista tres avisos'
);
select is(
  (public.listar_notificaciones()->'items'->0->>'tipo_nombre'), 'Consulta nueva',
  'devuelve el nombre legible del tipo'
);
select is(
  (public.listar_notificaciones()->'items'->0->'datos'->>'cliente'), 'Cami',
  'el más nuevo viene primero'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.listar_notificaciones()->'items') i
    where i->>'id' in ('b0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000005',
                       'b0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000007')), 0,
  'no lista descartados, sección sin acceso, de otra persona ni de otra organización'
);

-- Tandas con cursor y límite acotado.
select is(
  (select jsonb_array_length(public.listar_notificaciones(2)->'items')), 2,
  'respeta el límite de la tanda'
);
select is(
  (select jsonb_array_length(public.listar_notificaciones(2, now() - interval '90 minutes')->'items')), 2,
  'el cursor devuelve los avisos anteriores a la fecha dada'
);
select is(
  (select jsonb_array_length(public.listar_notificaciones(
    10,
    (public.listar_notificaciones(1)->'items'->0->>'creado_en')::timestamptz,
    (public.listar_notificaciones(1)->'items'->0->>'id')::uuid)->'items')), 2,
  'el cursor compuesto (creado_en, id) continúa justo después del último ítem'
);
select is(
  (select jsonb_array_length(public.listar_notificaciones(1000)->'items')), 3,
  'un límite excesivo se acota sin fallar'
);

-- Marcar leídos.
select is(
  public.marcar_notificaciones_leidas(array['b0000000-0000-0000-0000-000000000001']::uuid[]), 1,
  'marca un aviso propio'
);
select is(public.contar_notificaciones_sin_leer(), 2, 'el conteo baja');
select is(
  public.marcar_notificaciones_leidas(array['b0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000007']::uuid[]), 0,
  'no marca avisos ajenos (misma u otra organización)'
);
select is(public.marcar_notificaciones_leidas(array['b0000000-0000-0000-0000-000000000001']::uuid[]), 0,
  'marcar de nuevo es idempotente');

reset role;
select is(
  (select count(*)::int from public.avisos_pendientes where leido_en is not null), 1,
  'los avisos ajenos siguen sin leer'
);
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(public.marcar_notificaciones_leidas(), 2, 'sin ids marca todos los propios sin leer');
select is(public.contar_notificaciones_sin_leer(), 0, 'no quedan sin leer');

-- Persona 2 de la organización 2: solo ve lo suyo.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'a2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (public.listar_notificaciones()->'items'->0->'datos'->>'cliente'), 'Otra org',
  'otra organización solo ve sus propios avisos'
);

select * from finish();
rollback;
