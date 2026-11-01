-- MSF-692: borrar la membresía (remover miembro) invalida las sesiones del usuario.
begin;

select plan(2);

insert into public.organizaciones (id, nombre) values
  ('93111111-1111-1111-1111-111111111111', 'Organizacion R');

insert into auth.users (id, email) values
  ('93000000-0000-0000-0000-000000000001', 'removido@example.com'),
  ('93000000-0000-0000-0000-000000000002', 'queda@example.com');

insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('93000000-0000-0000-0000-000000000001', '93111111-1111-1111-1111-111111111111', 'miembro'),
  ('93000000-0000-0000-0000-000000000002', '93111111-1111-1111-1111-111111111111', 'miembro');

insert into auth.sessions (id, user_id) values
  ('94000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000002');

delete from public.usuarios_organizacion
where user_id = '93000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from auth.sessions where user_id = '93000000-0000-0000-0000-000000000001')::int,
  0,
  'remover a un miembro corta sus sesiones abiertas'
);

select is(
  (select count(*) from auth.sessions where user_id = '93000000-0000-0000-0000-000000000002')::int,
  1,
  'las sesiones de los demás miembros no se tocan'
);

select * from finish();
rollback;
