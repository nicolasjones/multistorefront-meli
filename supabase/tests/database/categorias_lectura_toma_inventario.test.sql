-- MSF-620: quien edita Stock (Depósito) lee las categorías de su organización para la toma de inventario;
-- quien solo lee Stock (Mostrador) sigue sin verlas y nadie ve las de otra organización.
begin;

select plan(4);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000005', 'deposito@example.com'),
  ('c1000000-0000-0000-0000-000000000004', 'mostrador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'deposito', 'activo'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('ca000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Ajena');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('c1000000-0000-0000-0000-000000000005');
select is((select nombre from dominio.categorias), 'Joysticks', 'depósito: lee las categorías de su organización para la toma');
select is((select count(*)::int from dominio.categorias), 1, 'depósito: no ve las categorías de otra organización');
select throws_ok(
  $$insert into dominio.categorias (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Nueva')$$,
  '42501', null, 'depósito: leer no habilita crear categorías'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from dominio.categorias), 0, 'mostrador: solo lee Stock, sigue sin ver las categorías');

select * from finish();
rollback;
