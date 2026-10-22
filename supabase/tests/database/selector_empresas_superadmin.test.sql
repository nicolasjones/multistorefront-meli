-- F-ROL-06 / F-CLI-11 · El superadmin con organización activa ve las empresas de esa
-- organización (specs 20261016-140000-permisos-por-empresa FR-010 y
-- 20261018-070000-clientes-empresas F-CLI-11). El fixture corre como postgres
-- (RLS no aplica) y las verificaciones como authenticated vía request.jwt.claims.
begin;

select plan(9);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('a3000000-0000-0000-0000-000000000001', 'super@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'operador1@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'admin1@example.com');

-- El superadmin no tiene fila en usuarios_organizacion: su contexto sale de
-- superadmin_organizacion_activa.
insert into superadmins (user_id) values ('a3000000-0000-0000-0000-000000000001');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Ajena');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador');

-- Superadmin sin organización activa: no hay organización sobre la que mirar.
select set_config('request.jwt.claims', json_build_object('sub', 'a3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::int from public.empresas_para_selector()), 0,
  'sin organización activa el superadmin no tiene empresas en el selector'
);
reset role;

-- Con «Organización Uno» activa: ve las de Uno, ninguna de Dos.
insert into superadmin_organizacion_activa (user_id, organizacion_id)
values ('a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

select set_config('request.jwt.claims', json_build_object('sub', 'a3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::int from public.empresas_para_selector()), 2,
  'el superadmin ve las empresas de su organización activa'
);
select is(
  (select count(*)::int from public.empresas_para_selector() where id = 'e2000000-0000-0000-0000-000000000001'), 0,
  'el superadmin no ve empresas de otra organización'
);
select lives_ok(
  $$select public.cambiar_empresa_activa('e1000000-0000-0000-0000-000000000002')$$,
  'el superadmin activa una empresa de su organización activa'
);
select is(
  (select id::text from public.empresas_para_selector() where es_activa),
  'e1000000-0000-0000-0000-000000000002', 'la empresa activa del superadmin queda marcada'
);
select throws_ok(
  $$select public.cambiar_empresa_activa('e2000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'el superadmin no activa una empresa de otra organización'
);
reset role;

-- Regresión: un miembro sigue viendo solo las asignadas.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::int from public.empresas_para_selector()), 1,
  'un miembro sigue viendo solo las empresas asignadas'
);
reset role;

-- Regresión: el Administrador sigue viendo todas las de su organización.
select set_config('request.jwt.claims', json_build_object('sub', 'a1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::int from public.empresas_para_selector()), 2,
  'el Administrador sigue viendo todas las empresas de su organización'
);
reset role;

-- Al cambiar de organización activa, el superadmin ve las de la nueva.
update superadmin_organizacion_activa set organizacion_id = '22222222-2222-2222-2222-222222222222'
 where user_id = 'a3000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claims', json_build_object('sub', 'a3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::int from public.empresas_para_selector()), 1,
  'al cambiar de organización activa el superadmin ve las de la nueva'
);

select * from finish();
rollback;
