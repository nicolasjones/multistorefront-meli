-- F-USR-01 (MSF-211): `puede_invitar()` es la puerta previa de la Edge Function `invitar-miembro`
-- (devolución del PR #34): devuelve la organización solo a quien gestiona membresías.
begin;

select plan(4);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email, last_sign_in_at, email_confirmed_at) values
  ('d1000000-0000-0000-0000-000000000001', 'admin@example.com', now(), now()),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com', now(), now()),
  ('d1000000-0000-0000-0000-000000000003', 'sinorg@example.com', now(), now());
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(public.puede_invitar(), '11111111-1111-1111-1111-111111111111'::uuid, 'el administrador recibe su organización');

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.puede_invitar()$$, '42501', 'No puede gestionar usuarios de esta organización', 'un operador no pasa la puerta');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.puede_invitar()$$, '42501', 'No puede gestionar usuarios de esta organización', 'una cuenta sin organización no pasa la puerta');

reset role;
select is(has_function_privilege('anon', 'public.puede_invitar()', 'execute'), false, 'anon no puede ejecutarla');

select * from finish();
rollback;
